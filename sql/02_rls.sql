-- ============================================================
-- 02_rls.sql — Row Level Security y función es_admin()
-- Ejecutar DESPUÉS de 01_schema.sql
-- ============================================================


-- ============================================================
-- FUNCIÓN HELPER: es_admin()
-- Usada por las políticas RLS y por cancelar_inscripcion().
-- SECURITY DEFINER → corre como postgres → evita recursión
-- cuando la propia tabla profiles tiene RLS activo.
-- ============================================================
CREATE OR REPLACE FUNCTION public.es_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND rol = 'admin' AND activo = true
  );
$$;


-- ============================================================
-- profiles
-- ============================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_update"  ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert"  ON public.profiles;

-- Cada usuario ve su propio perfil; el admin ve todos
CREATE POLICY "profiles_select" ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.es_admin());

-- Cada usuario actualiza su propio perfil; el admin actualiza cualquiera
CREATE POLICY "profiles_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.es_admin())
  WITH CHECK (id = auth.uid() OR public.es_admin());

-- El INSERT lo hace el trigger handle_new_user (SECURITY DEFINER → bypass RLS).
-- Esta política permite que el admin inserte perfiles desde el SQL editor.
CREATE POLICY "profiles_insert" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin());


-- ============================================================
-- sedes
-- ============================================================
ALTER TABLE public.sedes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sedes_select"  ON public.sedes;
DROP POLICY IF EXISTS "sedes_modify"  ON public.sedes;

CREATE POLICY "sedes_select" ON public.sedes
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "sedes_modify" ON public.sedes
  FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());


-- ============================================================
-- trimestres
-- ============================================================
ALTER TABLE public.trimestres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trimestres_select"  ON public.trimestres;
DROP POLICY IF EXISTS "trimestres_modify"  ON public.trimestres;

CREATE POLICY "trimestres_select" ON public.trimestres
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "trimestres_modify" ON public.trimestres
  FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());


-- ============================================================
-- guardias
-- ============================================================
ALTER TABLE public.guardias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guardias_select"  ON public.guardias;
DROP POLICY IF EXISTS "guardias_modify"  ON public.guardias;

CREATE POLICY "guardias_select" ON public.guardias
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "guardias_modify" ON public.guardias
  FOR ALL TO authenticated
  USING (public.es_admin())
  WITH CHECK (public.es_admin());


-- ============================================================
-- inscripciones
-- ============================================================
ALTER TABLE public.inscripciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inscripciones_select"  ON public.inscripciones;
DROP POLICY IF EXISTS "inscripciones_insert"  ON public.inscripciones;
DROP POLICY IF EXISTS "inscripciones_update"  ON public.inscripciones;

-- Médico ve solo sus inscripciones; admin ve todas
CREATE POLICY "inscripciones_select" ON public.inscripciones
  FOR SELECT TO authenticated
  USING (medico_id = auth.uid() OR public.es_admin());

-- Las RPCs usan SECURITY DEFINER y no necesitan política,
-- pero dejamos estas por si se accede directamente desde el cliente.
CREATE POLICY "inscripciones_insert" ON public.inscripciones
  FOR INSERT TO authenticated
  WITH CHECK (medico_id = auth.uid() OR public.es_admin());

CREATE POLICY "inscripciones_update" ON public.inscripciones
  FOR UPDATE TO authenticated
  USING (medico_id = auth.uid() OR public.es_admin());


-- ============================================================
-- Grants sobre la vista (las vistas no heredan RLS de las tablas base)
-- ============================================================
GRANT SELECT ON public.guardias_con_cupos TO authenticated;
