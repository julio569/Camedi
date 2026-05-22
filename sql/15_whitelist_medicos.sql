-- ============================================================
-- 15_whitelist_medicos.sql
-- 1. Agrega columna medicos_permitidos a guardias
--    NULL = sin restricción; array de UUIDs = solo esos médicos
-- 2. Agrega cancelado_en a inscripciones si no existe
-- 3. Recrea guardias_con_cupos con medicos_permitidos incluida
-- 4. Actualiza inscribirme_en_guardia para verificar la whitelist
-- ============================================================

-- Columna whitelist en guardias
ALTER TABLE public.guardias
  ADD COLUMN IF NOT EXISTS medicos_permitidos uuid[] DEFAULT NULL;

-- Columna cancelado_en en inscripciones (puede no existir en la DB real)
ALTER TABLE public.inscripciones
  ADD COLUMN IF NOT EXISTS cancelado_en timestamptz;

-- ── Recrear guardias_con_cupos con medicos_permitidos ────────
-- La vista necesita incluir la nueva columna; PostgreSQL no la
-- agrega automáticamente en vistas con columnas explícitas.
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

ALTER VIEW public.guardias_con_cupos SET (security_invoker = true);
GRANT SELECT ON public.guardias_con_cupos TO authenticated;
GRANT SELECT ON public.guardias_con_cupos TO service_role;

-- ── Actualizar inscribirme_en_guardia ────────────────────────
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

  -- 3. Verificar whitelist: si medicos_permitidos no es NULL,
  --    el médico debe estar en el array
  IF v_guardia.medicos_permitidos IS NOT NULL
     AND array_length(v_guardia.medicos_permitidos, 1) > 0 THEN
    IF NOT (v_medico_id = ANY(v_guardia.medicos_permitidos)) THEN
      RETURN json_build_object('ok', false, 'codigo', 'SIN_PERMISO');
    END IF;
  END IF;

  -- 4. Obtener trimestre y verificar inscripciones abiertas
  SELECT * INTO v_trimestre
  FROM public.trimestres
  WHERE id = v_guardia.trimestre_id;

  IF NOT v_trimestre.inscripciones_abiertas THEN
    RETURN json_build_object('ok', false, 'codigo', 'CERRADO');
  END IF;

  -- 5. Verificar cupo disponible
  SELECT public.cupos_ocupados_de_guardia(p_guardia_id) INTO v_cupos_ocupados;

  IF v_cupos_ocupados >= v_guardia.cupos_totales THEN
    RETURN json_build_object('ok', false, 'codigo', 'SIN_CUPO');
  END IF;

  -- 6. Verificar que no esté ya inscripto en esta guardia
  IF EXISTS (
    SELECT 1 FROM public.inscripciones
    WHERE guardia_id = p_guardia_id
      AND medico_id  = v_medico_id
      AND estado     = 'confirmada'
  ) THEN
    RETURN json_build_object('ok', false, 'codigo', 'YA_INSCRIPTO');
  END IF;

  -- 7. Verificar tope de guardias del trimestre
  SELECT COUNT(*) INTO v_count_trimestre
  FROM public.inscripciones i
  JOIN public.guardias g ON g.id = i.guardia_id
  WHERE i.medico_id    = v_medico_id
    AND g.trimestre_id = v_guardia.trimestre_id
    AND i.estado       = 'confirmada';

  IF v_count_trimestre >= v_trimestre.max_guardias_por_medico THEN
    RETURN json_build_object('ok', false, 'codigo', 'TOPE_ALCANZADO');
  END IF;

  -- 7b. Verificar tope mensual
  SELECT COUNT(*) INTO v_count_mes
  FROM public.inscripciones i
  JOIN public.guardias g ON g.id = i.guardia_id
  WHERE i.medico_id = v_medico_id
    AND i.estado    = 'confirmada'
    AND DATE_TRUNC('month', g.fecha) = DATE_TRUNC('month', v_guardia.fecha);

  IF v_count_mes >= GUARDIAS_MAX_MES THEN
    RETURN json_build_object('ok', false, 'codigo', 'TOPE_MENSUAL');
  END IF;

  -- 8. Verificar solapamiento
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

  -- 9. Todo OK: insertar inscripción
  INSERT INTO public.inscripciones (guardia_id, medico_id, estado)
  VALUES (p_guardia_id, v_medico_id, 'confirmada');

  RETURN json_build_object('ok', true, 'codigo', 'INSCRIPTO');

EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('ok', false, 'codigo', 'ERROR', 'detalle', SQLERRM);
END;
$$;
