-- ============================================================
-- 03_functions.sql — Funciones, triggers y vistas
-- Ejecutar DESPUÉS de 01_schema.sql y 02_rls.sql
-- ============================================================


-- ============================================================
-- TRIGGER: handle_new_user()
-- Crea la fila en profiles cuando se registra un usuario nuevo.
-- Los datos extra (nombre, matrícula, etc.) vienen del campo
-- raw_user_meta_data que el frontend pasa en signUp().
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
    false,           -- siempre pendiente de aprobación
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
-- FUNCIÓN AUXILIAR: cupos_ocupados_de_guardia()
-- SECURITY DEFINER para que cualquier usuario autenticado
-- pueda ver el conteo real de cupos, sin que RLS filtre
-- las inscripciones de otros médicos.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cupos_ocupados_de_guardia(p_guardia_id uuid)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(COUNT(*)::int, 0)
  FROM public.inscripciones
  WHERE guardia_id = p_guardia_id AND estado = 'confirmada';
$$;


-- ============================================================
-- FUNCIÓN AUXILIAR: medicos_de_guardia()
-- Lista de médicos inscriptos en una guardia. Solo la usa el
-- panel admin; los médicos no llaman esta función directamente.
-- ============================================================
CREATE OR REPLACE FUNCTION public.medicos_de_guardia(p_guardia_id uuid)
RETURNS json
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
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
    AND i.estado IN ('confirmada', 'asignada_admin');
$$;


-- ============================================================
-- VISTA: guardias_con_cupos
-- Los médicos ven cupos_ocupados / cupos_libres sin necesitar
-- acceso a inscripciones de otros usuarios (usa la función
-- SECURITY DEFINER cupos_ocupados_de_guardia).
-- ============================================================
CREATE OR REPLACE VIEW public.guardias_con_cupos AS
SELECT
  g.id,
  g.fecha,
  g.hora_inicio,
  g.duracion_horas,
  g.sede_id,
  g.servicio,
  g.cupos_totales,
  g.trimestre_id,
  g.notas,
  g.creado_por,
  g.creado_en,
  s.nombre     AS sede_nombre,
  s.color_hex  AS sede_color,
  t.nombre     AS trimestre_nombre,
  t.inscripciones_abiertas,
  t.max_guardias_por_medico,
  public.cupos_ocupados_de_guardia(g.id) AS cupos_ocupados,
  g.cupos_totales - public.cupos_ocupados_de_guardia(g.id) AS cupos_libres,
  g.medicos_permitidos
FROM public.guardias    g
JOIN public.sedes       s ON s.id  = g.sede_id
JOIN public.trimestres  t ON t.id  = g.trimestre_id;

COMMENT ON VIEW public.guardias_con_cupos IS
  'Guardias con conteo real de cupos. Segura para médicos: '
  'cupos_ocupados se calcula con función SECURITY DEFINER.';


-- ============================================================
-- RPC: inscribirme_en_guardia(guardia_id)
-- Función atómica "por orden de llegada".
-- Usa SELECT FOR UPDATE para evitar doble inscripción en el
-- último cupo cuando dos médicos hacen click simultáneamente.
--
-- Devuelve: { ok: bool, codigo: text }
-- Códigos de error: MEDICO_INACTIVO | CERRADO | SIN_CUPO |
--   YA_INSCRIPTO | TOPE_ALCANZADO | TOPE_MENSUAL | SOLAPA |
--   GUARDIA_NO_EXISTE | ERROR
-- ============================================================
CREATE OR REPLACE FUNCTION public.inscribirme_en_guardia(p_guardia_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Distancia mínima entre dos guardias del mismo médico.
  -- Para cambiar la regla de solapamiento, modificar solo esta línea.
  HORAS_DISTANCIA_MINIMA constant int := 24;
  -- Máximo de guardias por mes calendario por médico.
  -- Para cambiar el límite, modificar solo esta línea.
  GUARDIAS_MAX_MES       constant int := 10;

  v_medico_id       uuid := auth.uid();
  v_guardia         public.guardias%ROWTYPE;
  v_trimestre       public.trimestres%ROWTYPE;
  v_cupos_ocupados  int;
  v_count_trimestre int;
  v_count_mes       int;
  v_hay_solapa      boolean := false;
BEGIN

  -- 1. Verificar que el médico está activo
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_medico_id AND activo = true
  ) THEN
    RETURN json_build_object('ok', false, 'codigo', 'MEDICO_INACTIVO');
  END IF;

  -- 2. Obtener la guardia con bloqueo de fila (evita race condition)
  SELECT * INTO v_guardia
  FROM public.guardias
  WHERE id = p_guardia_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'codigo', 'GUARDIA_NO_EXISTE');
  END IF;

  -- 3. Obtener trimestre y verificar inscripciones abiertas
  SELECT * INTO v_trimestre
  FROM public.trimestres
  WHERE id = v_guardia.trimestre_id;

  IF NOT v_trimestre.inscripciones_abiertas THEN
    RETURN json_build_object('ok', false, 'codigo', 'CERRADO');
  END IF;

  -- 4. Verificar cupo disponible
  SELECT public.cupos_ocupados_de_guardia(p_guardia_id) INTO v_cupos_ocupados;

  IF v_cupos_ocupados >= v_guardia.cupos_totales THEN
    RETURN json_build_object('ok', false, 'codigo', 'SIN_CUPO');
  END IF;

  -- 5. Verificar que no esté ya inscripto en esta guardia
  IF EXISTS (
    SELECT 1 FROM public.inscripciones
    WHERE guardia_id = p_guardia_id
      AND medico_id  = v_medico_id
      AND estado     = 'confirmada'
  ) THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_INSCRIPTO');
  END IF;

  -- 6. Verificar tope de guardias del trimestre
  SELECT COUNT(*) INTO v_count_trimestre
  FROM public.inscripciones i
  JOIN public.guardias g ON g.id = i.guardia_id
  WHERE i.medico_id    = v_medico_id
    AND g.trimestre_id = v_guardia.trimestre_id
    AND i.estado       = 'confirmada';

  IF v_count_trimestre >= v_trimestre.max_guardias_por_medico THEN
    RETURN json_build_object('ok', false, 'codigo', 'TOPE_ALCANZADO');
  END IF;

  -- 6b. Verificar tope mensual (máximo GUARDIAS_MAX_MES por mes calendario)
  SELECT COUNT(*) INTO v_count_mes
  FROM public.inscripciones i
  JOIN public.guardias g ON g.id = i.guardia_id
  WHERE i.medico_id = v_medico_id
    AND i.estado    = 'confirmada'
    AND DATE_TRUNC('month', g.fecha) = DATE_TRUNC('month', v_guardia.fecha);

  IF v_count_mes >= GUARDIAS_MAX_MES THEN
    RETURN json_build_object('ok', false, 'codigo', 'TOPE_MENSUAL');
  END IF;

  -- 7. Verificar solapamiento: ninguna guardia confirmada del médico puede
  --    estar a menos de HORAS_DISTANCIA_MINIMA de la nueva guardia.
  SELECT EXISTS (
    SELECT 1
    FROM public.inscripciones i
    JOIN public.guardias g ON g.id = i.guardia_id
    WHERE i.medico_id = v_medico_id
      AND i.estado    = 'confirmada'
      AND g.id       != p_guardia_id
      AND (
        (g.fecha + g.hora_inicio)
          < (v_guardia.fecha + v_guardia.hora_inicio
             + make_interval(hours => v_guardia.duracion_horas)
             + make_interval(hours => HORAS_DISTANCIA_MINIMA))
        AND
        (g.fecha + g.hora_inicio
         + make_interval(hours => g.duracion_horas)
         + make_interval(hours => HORAS_DISTANCIA_MINIMA))
          > (v_guardia.fecha + v_guardia.hora_inicio)
      )
  ) INTO v_hay_solapa;

  IF v_hay_solapa THEN
    RETURN json_build_object('ok', false, 'codigo', 'SOLAPA');
  END IF;

  -- 8. Todo OK: insertar inscripción
  INSERT INTO public.inscripciones (guardia_id, medico_id, estado)
  VALUES (p_guardia_id, v_medico_id, 'confirmada');

  RETURN json_build_object('ok', true, 'codigo', 'INSCRIPTO');

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'codigo', 'ERROR', 'detalle', SQLERRM);
END;
$$;

COMMENT ON FUNCTION public.inscribirme_en_guardia(uuid) IS
  'Inscripción atómica con SELECT FOR UPDATE. Retorna {ok, codigo}. '
  'Códigos: INSCRIPTO | MEDICO_INACTIVO | CERRADO | SIN_CUPO | '
  'YA_INSCRIPTO | TOPE_ALCANZADO | TOPE_MENSUAL | SOLAPA | GUARDIA_NO_EXISTE | ERROR';


-- ============================================================
-- RPC: cancelar_inscripcion(inscripcion_id)
-- El médico cancela su propia inscripción (mínimo 48 hs antes).
-- El admin cancela cualquiera sin restricción de tiempo.
--
-- Devuelve: { ok: bool, codigo: text }
-- Códigos de error: NO_EXISTE | SIN_PERMISO | ESTADO_INVALIDO |
--   CANCELACION_TARDIA | ERROR
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancelar_inscripcion(p_inscripcion_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Horas mínimas de antelación para que el médico pueda cancelar.
  -- Para cambiar la regla, modificar solo esta línea.
  HORAS_MIN_CANCELAR constant int := 48;

  v_medico_id   uuid := auth.uid();
  v_inscripcion public.inscripciones%ROWTYPE;
  v_guardia     public.guardias%ROWTYPE;
  v_inicio      timestamp;
BEGIN

  SELECT * INTO v_inscripcion
  FROM public.inscripciones WHERE id = p_inscripcion_id;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'codigo', 'NO_EXISTE');
  END IF;

  -- Verificar pertenencia (médico solo puede cancelar la suya)
  IF v_inscripcion.medico_id != v_medico_id AND NOT public.es_admin() THEN
    RETURN json_build_object('ok', false, 'codigo', 'SIN_PERMISO');
  END IF;

  -- Solo se pueden cancelar inscripciones activas
  IF v_inscripcion.estado NOT IN ('confirmada', 'asignada_admin') THEN
    RETURN json_build_object('ok', false, 'codigo', 'ESTADO_INVALIDO');
  END IF;

  SELECT * INTO v_guardia FROM public.guardias WHERE id = v_inscripcion.guardia_id;

  v_inicio := (v_guardia.fecha + v_guardia.hora_inicio)::timestamp;

  IF public.es_admin() THEN
    -- Admin: cancela sin restricción de tiempo, queda como 'cancelada_admin'
    UPDATE public.inscripciones
    SET estado = 'cancelada_admin', cancelado_en = now()
    WHERE id = p_inscripcion_id;
  ELSE
    -- Médico: verificar antelación mínima
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

COMMENT ON FUNCTION public.cancelar_inscripcion(uuid) IS
  'Cancela una inscripción. Médico: mínimo 48 hs de antelación, estado→cancelada. '
  'Admin: sin restricción de tiempo, estado→cancelada_admin.';
