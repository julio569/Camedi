-- ============================================================
-- 08_provincias.sql — Sistema de provincias
-- Ejecutar en Supabase SQL Editor
-- ============================================================

-- Tabla provincias
CREATE TABLE IF NOT EXISTS public.provincias (
  id     smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre text     NOT NULL UNIQUE
);

-- 24 provincias argentinas
INSERT INTO public.provincias (nombre) VALUES
  ('Buenos Aires'), ('CABA'), ('Catamarca'), ('Chaco'), ('Chubut'),
  ('Córdoba'), ('Corrientes'), ('Entre Ríos'), ('Formosa'), ('Jujuy'),
  ('La Pampa'), ('La Rioja'), ('Mendoza'), ('Misiones'), ('Neuquén'),
  ('Río Negro'), ('Salta'), ('San Juan'), ('San Luis'), ('Santa Cruz'),
  ('Santa Fe'), ('Santiago del Estero'), ('Tierra del Fuego'), ('Tucumán')
ON CONFLICT (nombre) DO NOTHING;

-- Agregar provincia_id a sedes
ALTER TABLE public.sedes
  ADD COLUMN IF NOT EXISTS provincia_id smallint REFERENCES public.provincias(id);

-- RLS para provincias
-- anon también puede leer: el formulario de registro las necesita antes del login
ALTER TABLE public.provincias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provincias_select" ON public.provincias;
CREATE POLICY "provincias_select" ON public.provincias
  FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "provincias_admin" ON public.provincias;
CREATE POLICY "provincias_admin" ON public.provincias
  FOR ALL TO authenticated USING (public.es_admin());

GRANT SELECT ON public.provincias TO anon;
GRANT SELECT ON public.provincias TO authenticated;
