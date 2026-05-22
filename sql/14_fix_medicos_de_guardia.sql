-- ============================================================
-- 14_fix_medicos_de_guardia.sql
-- Permite que el rol "asociacion" llame a medicos_de_guardia()
-- para guardias que pertenecen a sus sedes.
-- ============================================================

CREATE OR REPLACE FUNCTION public.medicos_de_guardia(p_guardia_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  -- Admin: acceso total
  IF public.es_admin() THEN
    NULL;
  -- Asociacion: solo si la guardia pertenece a sus sedes
  ELSIF public.es_asociacion() THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.guardias g
      JOIN public.sedes s ON s.id = g.sede_id
      WHERE g.id = p_guardia_id
        AND s.asociacion_id = public.mi_asociacion_id()
    ) THEN
      RAISE EXCEPTION 'No tenés permiso para consultar esta guardia.';
    END IF;
  ELSE
    RAISE EXCEPTION 'Solo administradores y asociaciones pueden consultar los médicos de una guardia.';
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
