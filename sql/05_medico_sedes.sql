-- ============================================================
-- 05_medico_sedes.sql — Tabla médico↔sede y sus políticas RLS
-- Ejecutar DESPUÉS de 01_schema.sql y 02_rls.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.medico_sedes (
  medico_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sede_id   uuid NOT NULL REFERENCES public.sedes(id)    ON DELETE CASCADE,
  PRIMARY KEY (medico_id, sede_id)
);

ALTER TABLE public.medico_sedes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "medico_sedes_select" ON public.medico_sedes;
DROP POLICY IF EXISTS "medico_sedes_insert" ON public.medico_sedes;
DROP POLICY IF EXISTS "medico_sedes_delete" ON public.medico_sedes;

-- Médico ve sus propias sedes; admin ve todas
CREATE POLICY "medico_sedes_select" ON public.medico_sedes
  FOR SELECT TO authenticated
  USING (medico_id = auth.uid() OR public.es_admin());

-- Médico gestiona sus propias sedes; admin puede asignar a cualquiera
CREATE POLICY "medico_sedes_insert" ON public.medico_sedes
  FOR INSERT TO authenticated
  WITH CHECK (medico_id = auth.uid() OR public.es_admin());

CREATE POLICY "medico_sedes_delete" ON public.medico_sedes
  FOR DELETE TO authenticated
  USING (medico_id = auth.uid() OR public.es_admin());
