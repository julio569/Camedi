================================================================================
  -- ============================================================
  -- 11_asociaciones.sql — Rol "asociacion" (multi-tenancy)
  -- Ejecutar DESPUÉS de todos los scripts anteriores (01–10).
  --
  -- Este script:
  --   1. Crea la tabla asociaciones
  --   2. Agrega columnas asociacion_id a profiles, sedes, trimestres
  --   3. Agrega display_id a trimestres (para la PK text siga siendo
  --      globalmente única usando UUIDs y el display sea legible)
  --   4. Actualiza el CHECK de profiles.rol para incluir 'asociacion'
  --   5. Crea las funciones helper es_asociacion() y mi_asociacion_id()
  --   6. Reemplaza todas las RLS policies afectadas
  --   7. Actualiza los triggers proteger_campos_sensibles y handle_new_user
  --   8. Actualiza las funciones medicos_de_guardia y cancelar_inscripcion
  -- ============================================================


  -- ============================================================
  -- 1. TABLA asociaciones
  -- ============================================================
  CREATE TABLE IF NOT EXISTS public.asociaciones (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre      text        NOT NULL UNIQUE,
    descripcion text,
    activa      boolean     NOT NULL DEFAULT true,
    creada_en   timestamptz NOT NULL DEFAULT now()
  );

  COMMENT ON TABLE public.asociaciones IS
    'Asociaciones médicas. Cada una tiene su propio panel, sedes, trimestres y médicos.';

  ALTER TABLE public.asociaciones ENABLE ROW LEVEL SECURITY;


  -- ============================================================
  -- 2. COLUMNAS NUEVAS en tablas existentes
  -- ============================================================

  -- profiles: para médicos (su asociación de pertenencia)
  --           y para usuarios rol='asociacion' (la que administran)
  ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS asociacion_id uuid
      REFERENCES public.asociaciones(id) ON DELETE SET NULL;

  -- sedes: asignadas por el admin a una asociación
  ALTER TABLE public.sedes
    ADD COLUMN IF NOT EXISTS asociacion_id uuid
      REFERENCES public.asociaciones(id) ON DELETE SET NULL;

  -- trimestres: cada asociación tiene los suyos
  --   • asociacion_id = FK al owner
  --   • display_id = string legible ("2026-Q2") mostrado en la UI
  --     El id (PK text) ahora se genera como UUID en el JS para
  --     evitar colisiones entre asociaciones.
  ALTER TABLE public.trimestres
    ADD COLUMN IF NOT EXISTS asociacion_id uuid
      REFERENCES public.asociaciones(id) ON DELETE RESTRICT;

  ALTER TABLE public.trimestres
    ADD COLUMN IF NOT EXISTS display_id text NOT NULL DEFAULT '';

  -- Unicidad del display_id dentro de cada asociación
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'trimestres_display_asoc_uq'
    ) THEN
      ALTER TABLE public.trimestres
        ADD CONSTRAINT trimestres_display_asoc_uq
        UNIQUE (display_id, asociacion_id);
    END IF;
  END;
  $$;


  -- ============================================================
  -- 3. ACTUALIZAR CHECK de profiles.rol
  -- ============================================================
  ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_rol_check;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_rol_check
    CHECK (rol IN ('medico', 'admin', 'asociacion'));


  -- ============================================================
  -- 4. FUNCIONES HELPER
  -- ============================================================

  -- Retorna true si el usuario actual tiene rol='asociacion' y activo=true
  CREATE OR REPLACE FUNCTION public.es_asociacion()
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND rol = 'asociacion' AND activo = true
    );
  $$;

  -- Retorna el asociacion_id del usuario actual (NULL para admin)
  CREATE OR REPLACE FUNCTION public.mi_asociacion_id()
  RETURNS uuid
  LANGUAGE sql
  SECURITY DEFINER
  STABLE
  SET search_path = public
  AS $$
    SELECT asociacion_id FROM public.profiles WHERE id = auth.uid();
  $$;

  REVOKE EXECUTE ON FUNCTION public.es_asociacion()    FROM PUBLIC;
  REVOKE EXECUTE ON FUNCTION public.mi_asociacion_id() FROM PUBLIC;
  GRANT  EXECUTE ON FUNCTION public.es_asociacion()    TO authenticated;
  GRANT  EXECUTE ON FUNCTION public.mi_asociacion_id() TO authenticated;
  GRANT  SELECT  ON public.asociaciones                TO authenticated;
  -- anon necesita leer asociaciones para el dropdown del formulario de registro
  GRANT  SELECT  ON public.asociaciones                TO anon;


  -- ============================================================
  -- 5. RLS — tabla asociaciones
  -- ============================================================
  DROP POLICY IF EXISTS "asociaciones_select"        ON public.asociaciones;
  DROP POLICY IF EXISTS "asociaciones_admin_modify"  ON public.asociaciones;

  -- Cualquier visitante puede leerla (necesaria para el dropdown de registro)
  CREATE POLICY "asociaciones_select" ON public.asociaciones
    FOR SELECT TO anon, authenticated
    USING (true);

  -- Solo admin puede crear/editar/eliminar asociaciones
  CREATE POLICY "asociaciones_admin_modify" ON public.asociaciones
    FOR ALL TO authenticated
    USING (public.es_admin())
    WITH CHECK (public.es_admin());


  -- ============================================================
  -- 6. RLS — tabla profiles (reemplazar las existentes)
  -- ============================================================
  DROP POLICY IF EXISTS "profiles_select"              ON public.profiles;
  DROP POLICY IF EXISTS "profiles_update"              ON public.profiles;
  DROP POLICY IF EXISTS "profiles_insert"              ON public.profiles;
  DROP POLICY IF EXISTS "profiles_update_own"          ON public.profiles;
  DROP POLICY IF EXISTS "profiles_admin_update"        ON public.profiles;
  DROP POLICY IF EXISTS "profiles_asociacion_update"   ON public.profiles;

  -- SELECT: propio + admin (todos) + asociacion (médicos de su asociación)
  CREATE POLICY "profiles_select" ON public.profiles
    FOR SELECT TO authenticated
    USING (
      id = auth.uid()
      OR public.es_admin()
      OR (public.es_asociacion() AND asociacion_id = public.mi_asociacion_id())
    );

  -- UPDATE propio (el trigger bloquea cambios a rol/activo/asociacion_id)
  CREATE POLICY "profiles_update_own" ON public.profiles
    FOR UPDATE TO authenticated
    USING  (id = auth.uid())
    WITH CHECK (id = auth.uid());

  -- UPDATE admin: irrestricto
  CREATE POLICY "profiles_admin_update" ON public.profiles
    FOR UPDATE TO authenticated
    USING  (public.es_admin())
    WITH CHECK (public.es_admin());

  -- UPDATE asociacion: puede aprobar/rechazar médicos de SU asociación
  -- (el trigger garantiza que solo pueden cambiar activo, no rol ni asociacion_id)
  CREATE POLICY "profiles_asociacion_update" ON public.profiles
    FOR UPDATE TO authenticated
    USING (
      public.es_asociacion()
      AND asociacion_id = public.mi_asociacion_id()
      AND rol = 'medico'
    )
    WITH CHECK (
      public.es_asociacion()
      AND (asociacion_id = public.mi_asociacion_id() OR asociacion_id IS NULL)
      AND rol = 'medico'
    );

  -- INSERT: lo hace el trigger SECURITY DEFINER + admin puede insertar directamente
  CREATE POLICY "profiles_insert" ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (public.es_admin());


  -- ============================================================
  -- 7. RLS — tabla sedes
  -- ============================================================
  DROP POLICY IF EXISTS "sedes_select" ON public.sedes;

  -- Sedes visibles para todos los autenticados: son datos de referencia (nombres
  -- de hospitales), no datos sensibles. La tenant isolation real está en guardias
  -- e inscripciones. Esto también permite el onboarding de usuarios nuevos antes
  -- de que su asociacion_id esté confirmada en el perfil.
  CREATE POLICY "sedes_select" ON public.sedes
    FOR SELECT TO authenticated
    USING (true);

  -- INSERT/UPDATE/DELETE: solo admin (policy "sedes_modify" existente no se toca)


  -- ============================================================
  -- 8. RLS — tabla trimestres
  -- ============================================================
  DROP POLICY IF EXISTS "trimestres_select"           ON public.trimestres;
  DROP POLICY IF EXISTS "trimestres_modify"           ON public.trimestres;
  DROP POLICY IF EXISTS "trimestres_admin_modify"     ON public.trimestres;
  DROP POLICY IF EXISTS "trimestres_asociacion_modify" ON public.trimestres;

  -- Admin ve todos; asociación ve los suyos; médicos ven los de su asociación.
  -- trimestres con asociacion_id IS NULL (legacy) visibles a todos.
  CREATE POLICY "trimestres_select" ON public.trimestres
    FOR SELECT TO authenticated
    USING (
      public.es_admin()
      OR asociacion_id IS NULL
      OR asociacion_id = public.mi_asociacion_id()
    );

  -- Admin modifica todos
  CREATE POLICY "trimestres_admin_modify" ON public.trimestres
    FOR ALL TO authenticated
    USING  (public.es_admin())
    WITH CHECK (public.es_admin());

  -- Asociación modifica solo los suyos
  CREATE POLICY "trimestres_asociacion_modify" ON public.trimestres
    FOR ALL TO authenticated
    USING (
      public.es_asociacion()
      AND asociacion_id = public.mi_asociacion_id()
    )
    WITH CHECK (
      public.es_asociacion()
      AND asociacion_id = public.mi_asociacion_id()
    );


  -- ============================================================
  -- 9. RLS — tabla guardias
  -- ============================================================
  DROP POLICY IF EXISTS "guardias_select"            ON public.guardias;
  DROP POLICY IF EXISTS "guardias_modify"            ON public.guardias;
  DROP POLICY IF EXISTS "guardias_admin_modify"      ON public.guardias;
  DROP POLICY IF EXISTS "guardias_asociacion_modify" ON public.guardias;

  -- Admin ve todas; resto ve guardias de sedes de su asociación
  -- (o sedes sin asociación asignada — legacy)
  CREATE POLICY "guardias_select" ON public.guardias
    FOR SELECT TO authenticated
    USING (
      public.es_admin()
      OR EXISTS (
        SELECT 1 FROM public.sedes s
        WHERE s.id = sede_id
          AND (s.asociacion_id IS NULL OR s.asociacion_id = public.mi_asociacion_id())
      )
    );

  -- Admin modifica todas
  CREATE POLICY "guardias_admin_modify" ON public.guardias
    FOR ALL TO authenticated
    USING  (public.es_admin())
    WITH CHECK (public.es_admin());

  -- Asociación crea/edita/elimina guardias solo de sus sedes
  CREATE POLICY "guardias_asociacion_modify" ON public.guardias
    FOR ALL TO authenticated
    USING (
      public.es_asociacion()
      AND EXISTS (
        SELECT 1 FROM public.sedes s
        WHERE s.id = sede_id AND s.asociacion_id = public.mi_asociacion_id()
      )
      AND EXISTS (
        SELECT 1 FROM public.trimestres t
        WHERE t.id = trimestre_id
          AND (t.asociacion_id IS NULL OR t.asociacion_id = public.mi_asociacion_id())
      )
    )
    WITH CHECK (
      public.es_asociacion()
      AND EXISTS (
        SELECT 1 FROM public.sedes s
        WHERE s.id = sede_id AND s.asociacion_id = public.mi_asociacion_id()
      )
      AND EXISTS (
        SELECT 1 FROM public.trimestres t
        WHERE t.id = trimestre_id
          AND (t.asociacion_id IS NULL OR t.asociacion_id = public.mi_asociacion_id())
      )
    );


  -- ============================================================
  -- 10. RLS — tabla inscripciones
  -- ============================================================
  DROP POLICY IF EXISTS "inscripciones_select" ON public.inscripciones;
  DROP POLICY IF EXISTS "inscripciones_insert" ON public.inscripciones;
  DROP POLICY IF EXISTS "inscripciones_update" ON public.inscripciones;

  -- SELECT: médico ve las suyas; admin ve todas; asociación ve las de sus guardias
  CREATE POLICY "inscripciones_select" ON public.inscripciones
    FOR SELECT TO authenticated
    USING (
      medico_id = auth.uid()
      OR public.es_admin()
      OR (public.es_asociacion() AND EXISTS (
        SELECT 1 FROM public.guardias g
        JOIN public.sedes s ON s.id = g.sede_id
        WHERE g.id = guardia_id
          AND s.asociacion_id = public.mi_asociacion_id()
      ))
    );

  -- INSERT: solo admin directamente; médicos DEBEN usar inscribirme_en_guardia()
  -- que valida cupo, tope, solapamiento y whitelist (SECURITY DEFINER).
  CREATE POLICY "inscripciones_insert" ON public.inscripciones
    FOR INSERT TO authenticated
    WITH CHECK (public.es_admin());

  -- UPDATE: médico, admin, y asociación pueden actualizar estado
  CREATE POLICY "inscripciones_update" ON public.inscripciones
    FOR UPDATE TO authenticated
    USING (
      medico_id = auth.uid()
      OR public.es_admin()
      OR (public.es_asociacion() AND EXISTS (
        SELECT 1 FROM public.guardias g
        JOIN public.sedes s ON s.id = g.sede_id
        WHERE g.id = guardia_id
          AND s.asociacion_id = public.mi_asociacion_id()
      ))
    );


  -- ============================================================
  -- 11. RLS — tabla medico_sedes
  -- ============================================================
  DROP POLICY IF EXISTS "medico_sedes_select" ON public.medico_sedes;
  DROP POLICY IF EXISTS "medico_sedes_insert" ON public.medico_sedes;
  DROP POLICY IF EXISTS "medico_sedes_delete" ON public.medico_sedes;

  CREATE POLICY "medico_sedes_select" ON public.medico_sedes
    FOR SELECT TO authenticated
    USING (
      medico_id = auth.uid()
      OR public.es_admin()
      OR (public.es_asociacion() AND EXISTS (
        SELECT 1 FROM public.sedes s
        WHERE s.id = sede_id AND s.asociacion_id = public.mi_asociacion_id()
      ))
    );

  CREATE POLICY "medico_sedes_insert" ON public.medico_sedes
    FOR INSERT TO authenticated
    WITH CHECK (medico_id = auth.uid() OR public.es_admin());

  CREATE POLICY "medico_sedes_delete" ON public.medico_sedes
    FOR DELETE TO authenticated
    USING (
      medico_id = auth.uid()
      OR public.es_admin()
      OR (public.es_asociacion() AND EXISTS (
        SELECT 1 FROM public.sedes s
        WHERE s.id = sede_id AND s.asociacion_id = public.mi_asociacion_id()
      ))
    );


  -- ============================================================
  -- 12. TRIGGER: proteger_campos_sensibles() — versión definitiva
  --   • INSERT sin ser admin: fuerza rol='medico', activo=false
  --   • UPDATE admin: irrestricto
  --   • UPDATE asociacion: puede cambiar activo; puede setear
  --     asociacion_id → NULL solo al rechazar (OLD.activo=false)
  --   • UPDATE médico: no puede cambiar rol ni activo; puede setear
  --     su propio asociacion_id UNA SOLA VEZ cuando está pendiente
  --     (onboarding: OLD.asociacion_id IS NULL, OLD.activo=false)
  -- ============================================================
  CREATE OR REPLACE FUNCTION public.proteger_campos_sensibles()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_uid        uuid := auth.uid();
    v_caller_rol text;
  BEGIN

    IF TG_OP = 'INSERT' THEN
      IF v_uid IS NULL THEN
        -- Trigger del sistema (handle_new_user / service_role)
        NEW.rol    := 'medico';
        NEW.activo := false;
        RETURN NEW;
      END IF;
      SELECT rol INTO v_caller_rol FROM public.profiles WHERE id = v_uid;
      IF v_caller_rol IS DISTINCT FROM 'admin' THEN
        NEW.rol    := 'medico';
        NEW.activo := false;
      END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' THEN
      IF v_uid IS NULL THEN
        -- SQL Editor / service_role: irrestricto
        RETURN NEW;
      END IF;
      SELECT rol INTO v_caller_rol FROM public.profiles WHERE id = v_uid;

      IF v_caller_rol = 'admin' THEN
        -- Admin: irrestricto
        RETURN NEW;

      ELSIF v_caller_rol = 'asociacion' THEN
        -- Puede cambiar activo; no puede cambiar rol.
        -- Excepción: puede setear asociacion_id → NULL al rechazar un médico pendiente.
        NEW.rol := OLD.rol;
        IF NOT (OLD.asociacion_id = public.mi_asociacion_id()
                AND NEW.asociacion_id IS NULL
                AND OLD.activo = false) THEN
          NEW.asociacion_id := OLD.asociacion_id;
        END IF;
        RETURN NEW;

      ELSE
        -- Médico: no puede cambiar rol ni activo.
        -- Excepción de onboarding: puede setear su propio asociacion_id
        -- UNA SOLA VEZ, cuando está pendiente y aún no tiene asociación asignada.
        NEW.rol    := OLD.rol;
        NEW.activo := OLD.activo;
        IF NOT (v_uid = NEW.id
                AND OLD.asociacion_id IS NULL
                AND OLD.activo = false
                AND NEW.asociacion_id IS NOT NULL) THEN
          NEW.asociacion_id := OLD.asociacion_id;
        END IF;
        RETURN NEW;
      END IF;
    END IF;

    RETURN NEW;
  END;
  $$;

  -- Limpiar triggers antiguos (09_security_fix usaba nombre diferente)
  DROP TRIGGER IF EXISTS trg_proteger_campos_sensibles   ON public.profiles;
  DROP TRIGGER IF EXISTS proteger_campos_sensibles_trigger ON public.profiles;
  CREATE TRIGGER proteger_campos_sensibles_trigger
    BEFORE INSERT OR UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.proteger_campos_sensibles();


  -- ============================================================
  -- 13. TRIGGER: handle_new_user() — ACTUALIZADO
  -- Ahora lee asociacion_id del metadata de signup.
  -- ============================================================
  CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_asociacion_id uuid;
  BEGIN
    BEGIN
      v_asociacion_id := (NEW.raw_user_meta_data->>'asociacion_id')::uuid;
    EXCEPTION WHEN OTHERS THEN
      v_asociacion_id := NULL;
    END;

    INSERT INTO public.profiles (
      id, nombre, apellido, matricula, especialidad, telefono,
      rol, activo, asociacion_id
    ) VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'nombre',       ''),
      COALESCE(NEW.raw_user_meta_data->>'apellido',     ''),
      COALESCE(NEW.raw_user_meta_data->>'matricula',    ''),
      COALESCE(NEW.raw_user_meta_data->>'especialidad', ''),
      COALESCE(NEW.raw_user_meta_data->>'telefono',     ''),
      'medico',        -- siempre médico, nunca del metadata
      false,           -- siempre pendiente
      v_asociacion_id  -- NULL si no se proporcionó
    );
    RETURN NEW;
  END;
  $$;

  DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
  CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


  -- ============================================================
  -- 14. FUNCIÓN: medicos_de_guardia() — ACTUALIZADA
  -- Permite que la asociación la llame para sus propias guardias.
  -- ============================================================
  CREATE OR REPLACE FUNCTION public.medicos_de_guardia(p_guardia_id uuid)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  STABLE
  SET search_path = public
  AS $$
  DECLARE
    v_sede_asoc_id uuid;
  BEGIN
    IF public.es_admin() THEN
      NULL; -- admin: pasa directo

    ELSIF public.es_asociacion() THEN
      -- Verificar que la guardia pertenece a una sede de esta asociación
      SELECT s.asociacion_id INTO v_sede_asoc_id
      FROM public.guardias g
      JOIN public.sedes s ON s.id = g.sede_id
      WHERE g.id = p_guardia_id;

      IF v_sede_asoc_id IS DISTINCT FROM public.mi_asociacion_id() THEN
        RAISE EXCEPTION 'No tenés permiso para consultar esta guardia.';
      END IF;

    ELSE
      RAISE EXCEPTION 'Solo administradores o asociaciones pueden consultar los médicos de una guardia.';
    END IF;

    RETURN (
      SELECT COALESCE(
        json_agg(
          json_build_object(
            'inscripcion_id', i.id,
            'medico_id',      p.id,
            'nombre',         p.nombre,
            'apellido',       p.apellido,
            'matricula',      p.matricula,
            'especialidad',   p.especialidad,
            'telefono',       p.telefono,
            'estado',         i.estado,
            'inscripto_en',   i.inscripto_en
          ) ORDER BY i.inscripto_en
        ),
        '[]'::json
      )
      FROM public.inscripciones i
      JOIN public.profiles p ON p.id = i.medico_id
      WHERE i.guardia_id = p_guardia_id
        AND i.estado IN ('confirmada', 'asignada_admin')
    );
  END;
  $$;


  -- ============================================================
  -- 15. FUNCIÓN: cancelar_inscripcion() — ACTUALIZADA
  -- Permite que la asociación cancele inscripciones de sus guardias.
  -- ============================================================
  CREATE OR REPLACE FUNCTION public.cancelar_inscripcion(p_inscripcion_id uuid)
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    HORAS_MIN_CANCELAR constant int := 48;

    v_medico_id   uuid := auth.uid();
    v_inscripcion public.inscripciones%ROWTYPE;
    v_guardia     public.guardias%ROWTYPE;
    v_inicio      timestamp;
    v_es_gestion  boolean; -- admin o asociación con permisos
  BEGIN

    SELECT * INTO v_inscripcion
    FROM public.inscripciones WHERE id = p_inscripcion_id;

    IF NOT FOUND THEN
      RETURN json_build_object('ok', false, 'codigo', 'NO_EXISTE');
    END IF;

    SELECT * INTO v_guardia FROM public.guardias WHERE id = v_inscripcion.guardia_id;

    -- ¿Quién llama?
    v_es_gestion := public.es_admin()
      OR (public.es_asociacion() AND EXISTS (
        SELECT 1 FROM public.sedes s
        WHERE s.id = v_guardia.sede_id
          AND s.asociacion_id = public.mi_asociacion_id()
      ));

    IF v_inscripcion.medico_id != v_medico_id AND NOT v_es_gestion THEN
      RETURN json_build_object('ok', false, 'codigo', 'SIN_PERMISO');
    END IF;

    IF v_inscripcion.estado NOT IN ('confirmada', 'asignada_admin') THEN
      RETURN json_build_object('ok', false, 'codigo', 'ESTADO_INVALIDO');
    END IF;

    v_inicio := (v_guardia.fecha + v_guardia.hora_inicio)::timestamp;

    IF v_es_gestion THEN
      -- Admin / asociación: sin restricción de tiempo → cancelada_admin
      UPDATE public.inscripciones
      SET estado = 'cancelada_admin', cancelado_en = now()
      WHERE id = p_inscripcion_id;
    ELSE
      -- Médico: respetar antelación mínima
      IF v_inicio - now() < make_interval(hours => HORAS_MIN_CANCELAR) THEN
        RETURN json_build_object('ok', false, 'codigo', 'CANCELACION_TARDIA');
      END IF;

      UPDATE public.inscripciones
      SET estado = 'cancelada', cancelado_en = now()
      WHERE id = p_inscripcion_id;
    END IF;

    RETURN json_build_object('ok', true, 'codigo', 'CANCELADO');

  EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('ok', false, 'codigo', 'ERROR', 'detalle', SQLERRM);
  END;
  $$;


  -- ============================================================
  -- 16. ÍNDICES para acelerar evaluaciones RLS multi-tenant
  -- ============================================================
  CREATE INDEX IF NOT EXISTS idx_profiles_asociacion_id   ON public.profiles(asociacion_id);
  CREATE INDEX IF NOT EXISTS idx_sedes_asociacion_id      ON public.sedes(asociacion_id);
  CREATE INDEX IF NOT EXISTS idx_trimestres_asociacion_id ON public.trimestres(asociacion_id);


  -- ============================================================
  -- 17. FUNCIÓN: sedes_para_onboarding()
  --     SECURITY DEFINER: lee el asociacion_id del médico
  --     directamente desde su perfil, con fallback a
  --     auth.users.raw_user_meta_data si el trigger no lo guardó.
  --     Devuelve las sedes activas de esa asociación.
  --     Usada en el onboarding de nuevos médicos.
  -- ============================================================
  CREATE OR REPLACE FUNCTION public.sedes_para_onboarding()
  RETURNS TABLE (
    id           uuid,
    nombre       text,
    color_hex    text,
    provincia_id uuid
  )
  LANGUAGE plpgsql
  SECURITY DEFINER
  STABLE
  SET search_path = public
  AS $$
  DECLARE
    v_uid           uuid := auth.uid();
    v_asociacion_id uuid;
  BEGIN
    IF v_uid IS NULL THEN RETURN; END IF;

    -- Intentar desde el perfil
    SELECT p.asociacion_id INTO v_asociacion_id
      FROM public.profiles p WHERE p.id = v_uid LIMIT 1;

    -- Fallback: leer desde el metadata de registro (auth.users es accesible
    -- solo para funciones SECURITY DEFINER)
    IF v_asociacion_id IS NULL THEN
      SELECT (u.raw_user_meta_data->>'asociacion_id')::uuid
        INTO v_asociacion_id
        FROM auth.users u WHERE u.id = v_uid;
    END IF;

    -- Sin asociacion_id determinable → devolver vacío
    IF v_asociacion_id IS NULL THEN RETURN; END IF;

    RETURN QUERY
      SELECT s.id, s.nombre, s.color_hex, s.provincia_id
        FROM public.sedes s
       WHERE s.activa = true
         AND (s.asociacion_id IS NULL OR s.asociacion_id = v_asociacion_id)
       ORDER BY s.nombre;
  END;
  $$;

  REVOKE EXECUTE ON FUNCTION public.sedes_para_onboarding() FROM PUBLIC;
  GRANT  EXECUTE ON FUNCTION public.sedes_para_onboarding() TO authenticated;


  -- ============================================================
  -- 18. FUNCIÓN: reparar_asociacion_onboarding()
  --     SECURITY DEFINER: lee el asociacion_id del metadata de
  --     signup y lo escribe en profiles si el médico tiene NULL.
  --     Solo actúa para cuentas pendientes (activo = false).
  --     El trigger proteger_campos_sensibles permite este update
  --     como excepción de onboarding.
  -- ============================================================
  CREATE OR REPLACE FUNCTION public.reparar_asociacion_onboarding()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
    v_uid           uuid := auth.uid();
    v_asociacion_id uuid;
    v_activo        boolean;
    v_current_asoc  uuid;
  BEGIN
    IF v_uid IS NULL THEN RETURN; END IF;

    SELECT activo, asociacion_id INTO v_activo, v_current_asoc
      FROM public.profiles WHERE id = v_uid;

    -- No hacer nada si ya tiene asociacion_id o ya está activo
    IF v_current_asoc IS NOT NULL THEN RETURN; END IF;
    IF v_activo IS TRUE             THEN RETURN; END IF;

    -- Leer desde el metadata de signup (solo accesible via SECURITY DEFINER)
    SELECT (u.raw_user_meta_data->>'asociacion_id')::uuid
      INTO v_asociacion_id
      FROM auth.users u WHERE u.id = v_uid;

    IF v_asociacion_id IS NULL THEN RETURN; END IF;

    -- Update permitido por la excepción de onboarding en proteger_campos_sensibles
    UPDATE public.profiles
       SET asociacion_id = v_asociacion_id
     WHERE id = v_uid AND activo = false AND asociacion_id IS NULL;
  END;
  $$;

  REVOKE EXECUTE ON FUNCTION public.reparar_asociacion_onboarding() FROM PUBLIC;
  GRANT  EXECUTE ON FUNCTION public.reparar_asociacion_onboarding() TO authenticated;


================================================================================
