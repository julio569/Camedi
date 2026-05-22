-- ============================================================
-- 16_companeros_de_guardia.sql
-- Permite que cualquier médico vea quiénes están inscriptos
-- en una guardia (nombre + especialidad, sin datos sensibles).
-- ============================================================

CREATE OR REPLACE FUNCTION public.companeros_de_guardia(p_guardia_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'nombre',       p.nombre,
          'apellido',     p.apellido,
          'especialidad', p.especialidad
        ) ORDER BY p.apellido, p.nombre
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

GRANT EXECUTE ON FUNCTION public.companeros_de_guardia(uuid) TO authenticated;
