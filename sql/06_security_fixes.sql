-- ============================================================
-- 06_security_fixes.sql — Correcciones del Security Advisor
-- Ejecutar DESPUÉS de 03_functions.sql
-- ============================================================


-- ============================================================
-- FIX 1 (Error): guardias_con_cupos — Security Definer View
--
-- Las vistas en PostgreSQL corren con privilegios del owner
-- (comportamiento SECURITY DEFINER implícito).
-- Con security_invoker = true la vista corre como el usuario
-- que la consulta, respetando RLS correctamente.
-- La función cupos_ocupados_de_guardia() sigue siendo
-- SECURITY DEFINER y puede ver todas las inscripciones.
-- ============================================================
ALTER VIEW public.guardias_con_cupos SET (security_invoker = true);

-- Re-otorgar el SELECT después de alterar la vista
GRANT SELECT ON public.guardias_con_cupos TO authenticated;


-- ============================================================
-- FIX 2 (Warnings): Revocar EXECUTE de public en funciones
--
-- Por defecto PostgreSQL otorga EXECUTE a PUBLIC en todas las
-- funciones nuevas. Esto permite que usuarios anónimos las
-- llamen directamente. Solo deben poder ejecutarlas usuarios
-- autenticados.
-- ============================================================

-- RPCs que el cliente llama directamente
REVOKE EXECUTE ON FUNCTION public.inscribirme_en_guardia(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancelar_inscripcion(uuid)   FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.medicos_de_guardia(uuid)     FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.inscribirme_en_guardia(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancelar_inscripcion(uuid)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.medicos_de_guardia(uuid)     TO authenticated;

-- Funciones auxiliares usadas por RLS y la vista
REVOKE EXECUTE ON FUNCTION public.cupos_ocupados_de_guardia(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.es_admin()                      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.cupos_ocupados_de_guardia(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.es_admin()                      TO authenticated;

-- Trigger function: la llama el trigger internamente, nunca el cliente
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
