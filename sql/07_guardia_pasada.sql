-- ============================================================
-- 07_guardia_pasada.sql — Bloquear inscripción a guardias pasadas
-- Ejecutar en Supabase SQL Editor
-- ============================================================

CREATE OR REPLACE FUNCTION public.inscribirme_en_guardia(p_guardia_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  HORAS_DISTANCIA_MINIMA constant int := 24;
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

  -- 2. Obtener la guardia con bloqueo de fila
  SELECT * INTO v_guardia
  FROM public.guardias
  WHERE id = p_guardia_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'codigo', 'GUARDIA_NO_EXISTE');
  END IF;

  -- 2b. Verificar que la guardia no sea pasada
  IF v_guardia.fecha < CURRENT_DATE THEN
    RETURN json_build_object('ok', false, 'codigo', 'GUARDIA_PASADA');
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

  -- 5. Verificar que no esté ya inscripto
  IF EXISTS (
    SELECT 1 FROM public.inscripciones
    WHERE guardia_id = p_guardia_id
      AND medico_id  = v_medico_id
      AND estado     = 'confirmada'
  ) THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_INSCRIPTO');
  END IF;

  -- 6. Verificar tope del trimestre
  SELECT COUNT(*) INTO v_count_trimestre
  FROM public.inscripciones i
  JOIN public.guardias g ON g.id = i.guardia_id
  WHERE i.medico_id    = v_medico_id
    AND g.trimestre_id = v_guardia.trimestre_id
    AND i.estado       = 'confirmada';

  IF v_count_trimestre >= v_trimestre.max_guardias_por_medico THEN
    RETURN json_build_object('ok', false, 'codigo', 'TOPE_ALCANZADO');
  END IF;

  -- 6b. Verificar tope mensual
  SELECT COUNT(*) INTO v_count_mes
  FROM public.inscripciones i
  JOIN public.guardias g ON g.id = i.guardia_id
  WHERE i.medico_id = v_medico_id
    AND i.estado    = 'confirmada'
    AND DATE_TRUNC('month', g.fecha) = DATE_TRUNC('month', v_guardia.fecha);

  IF v_count_mes >= GUARDIAS_MAX_MES THEN
    RETURN json_build_object('ok', false, 'codigo', 'TOPE_MENSUAL');
  END IF;

  -- 7. Verificar solapamiento
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

  -- 8. Insertar inscripción
  INSERT INTO public.inscripciones (guardia_id, medico_id, estado)
  VALUES (p_guardia_id, v_medico_id, 'confirmada');

  RETURN json_build_object('ok', true, 'codigo', 'INSCRIPTO');

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'codigo', 'ERROR', 'detalle', SQLERRM);
END;
$$;
