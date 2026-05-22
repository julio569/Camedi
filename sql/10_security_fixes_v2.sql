-- ============================================================
-- 10_security_fixes_v2.sql — CRÍTICO: Corregir bugs en 09_security_fix.sql
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- ── PROBLEMA: 09_security_fix.sql tenía dos errores ─────────
-- 1. Usaba la columna "aprobado" que no existe (la columna se llama "activo")
-- 2. Insertaba rol='pendiente' que viola el CHECK constraint (solo 'medico'/'admin')
-- Resultado: todos los nuevos registros fallaban con error de base de datos.

-- ── 1. Corregir handle_new_user() ────────────────────────────
-- Usa 'medico' (válido por el CHECK) y 'activo' (nombre real de la columna).
-- La seguridad está en ignorar metadata — nunca leer el rol del usuario.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, nombre, apellido, matricula, especialidad, telefono, rol, activo
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre',       ''),
    COALESCE(NEW.raw_user_meta_data->>'apellido',     ''),
    COALESCE(NEW.raw_user_meta_data->>'matricula',    ''),
    COALESCE(NEW.raw_user_meta_data->>'especialidad', ''),
    COALESCE(NEW.raw_user_meta_data->>'telefono',     ''),
    'medico',  -- SIEMPRE 'medico', ignorar cualquier valor en metadatos
    false      -- SIEMPRE false, el admin aprueba manualmente
  );
  RETURN NEW;
END;
$$;

-- ── 2. Corregir proteger_campos_sensibles() ──────────────────
-- Mismo problema: usaba "aprobado" en vez de "activo".

CREATE OR REPLACE FUNCTION public.proteger_campos_sensibles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid        uuid := auth.uid();
  caller_rol text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF uid IS NULL THEN
      -- Llamada de sistema (trigger handle_new_user): forzar valores seguros
      NEW.rol    := 'medico';
      NEW.activo := false;
      RETURN NEW;
    END IF;
    SELECT rol INTO caller_rol FROM public.profiles WHERE id = uid;
    IF caller_rol IS DISTINCT FROM 'admin' THEN
      NEW.rol    := 'medico';
      NEW.activo := false;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF uid IS NULL THEN
      RETURN NEW; -- SQL Editor (service role) puede cambiar roles
    END IF;
    SELECT rol INTO caller_rol FROM public.profiles WHERE id = uid;
    IF caller_rol IS DISTINCT FROM 'admin' THEN
      NEW.rol    := OLD.rol;
      NEW.activo := OLD.activo;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_campos_sensibles ON public.profiles;
CREATE TRIGGER trg_proteger_campos_sensibles
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.proteger_campos_sensibles();

-- ── 3. Restaurar DEFAULT correcto ─────────────────────────────
-- 09_security_fix.sql había puesto DEFAULT 'pendiente' (valor inválido).

ALTER TABLE public.profiles ALTER COLUMN rol SET DEFAULT 'medico';

-- ── 4. Restringir medicos_de_guardia() solo a admins ─────────
-- Antes cualquier médico autenticado podía ver nombre, matrícula y teléfono
-- de todos los médicos inscriptos en cualquier guardia.

CREATE OR REPLACE FUNCTION public.medicos_de_guardia(p_guardia_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT public.es_admin() THEN
    RAISE EXCEPTION 'Solo los administradores pueden consultar los médicos de una guardia.';
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

-- ── 5. Verificación rápida ────────────────────────────────────
-- Ejecutar para confirmar que el DEFAULT es correcto:
-- SELECT column_default FROM information_schema.columns
-- WHERE table_name = 'profiles' AND column_name = 'rol';

-- Ejecutar para confirmar que el trigger existe:
-- SELECT trigger_name, event_manipulation FROM information_schema.triggers
-- WHERE event_object_table = 'profiles';
