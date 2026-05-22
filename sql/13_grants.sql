-- ============================================================
-- 13_grants.sql — GRANTs explícitos en todas las tablas públicas
-- Ejecutar en Supabase SQL Editor UNA SOLA VEZ.
--
-- Necesario por el cambio de Supabase (oct 2026): las tablas en
-- el schema "public" ya no recibirán acceso automático al Data API.
-- Con RLS habilitado, estos GRANTs son seguros — las políticas RLS
-- siguen controlando qué puede hacer cada usuario.
-- ============================================================

-- profiles
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles       TO service_role;

-- guardias
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardias       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardias       TO service_role;

-- sedes
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sedes          TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sedes          TO service_role;

-- trimestres
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trimestres     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trimestres     TO service_role;

-- inscripciones
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inscripciones  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inscripciones  TO service_role;

-- medico_sedes
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medico_sedes   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.medico_sedes   TO service_role;

-- asociaciones
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asociaciones   TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.asociaciones   TO service_role;
GRANT SELECT                         ON public.asociaciones   TO anon;

-- provincias (solo lectura)
GRANT SELECT ON public.provincias TO authenticated;
GRANT SELECT ON public.provincias TO anon;
GRANT SELECT ON public.provincias TO service_role;

-- view guardias_con_cupos
GRANT SELECT ON public.guardias_con_cupos TO authenticated;
GRANT SELECT ON public.guardias_con_cupos TO service_role;
