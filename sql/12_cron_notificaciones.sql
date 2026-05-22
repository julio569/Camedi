-- ============================================================
-- 12_cron_notificaciones.sql — Recordatorio diario 48hs antes
-- Ejecutar en Supabase SQL Editor UNA SOLA VEZ después de
-- hacer deploy de la Edge Function send-email.
--
-- Requiere:
--   • Extension pg_cron habilitada (Database > Extensions > pg_cron)
--   • Extension pg_net  habilitada (ya activa en Supabase por defecto)
--   • Edge Function send-email deployada
-- ============================================================

-- Reemplazar <PROJECT_REF> con el ID de tu proyecto Supabase
-- (lo encontrás en Settings > General > Reference ID)
-- Reemplazar <SERVICE_ROLE_KEY> con la service role key
-- (Settings > API > service_role key)

SELECT cron.schedule(
  'recordatorio-guardias-48h',
  '0 8 * * *',   -- Todos los días a las 8:00 AM UTC (5 AM Argentina)
  $$
  SELECT net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/send-email',
    body    := '{"tipo":"recordatorio_48h"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    )
  );
  $$
);

-- Para verificar que quedó registrado:
-- SELECT * FROM cron.job;

-- Para eliminar el job si hace falta:
-- SELECT cron.unschedule('recordatorio-guardias-48h');
