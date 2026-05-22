-- ============================================================
-- 04_seed.sql — Datos de prueba para Guardias Médicas
-- Ejecutar DESPUÉS de los tres scripts anteriores.
--
-- ANTES DE EJECUTAR:
--   1. En Supabase Dashboard → Authentication → Users → "Add user"
--      Crear usuario: admin@guardias.com / Admin1234!
--      (o el email/password que quieras para el admin)
--   2. Copiar el UUID del usuario recién creado.
--   3. Al final de este script hay un UPDATE que activa ese usuario
--      como admin. Reemplazá 'REEMPLAZAR-CON-UUID-DEL-ADMIN' con el UUID real.
-- ============================================================


-- ------------------------------------------------------------
-- Sedes
-- (UUIDs fijos para que las guardias de abajo puedan referenciarlas)
-- ------------------------------------------------------------
INSERT INTO public.sedes (id, nombre, direccion, color_hex, activa) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Hospital Central', 'Av. Corrientes 1234, CABA', '#c08a4a', true),
  ('a1000000-0000-0000-0000-000000000002', 'Clínica Norte',    'Av. Cabildo 567, CABA',     '#2f7d4c', true),
  ('a1000000-0000-0000-0000-000000000003', 'Sanatorio Sur',    'Av. Rivadavia 9876, CABA',  '#2f5d7d', true)
ON CONFLICT (id) DO NOTHING;


-- ------------------------------------------------------------
-- Trimestre
-- ------------------------------------------------------------
INSERT INTO public.trimestres (
  id, nombre, fecha_inicio, fecha_fin,
  max_guardias_por_medico, inscripciones_abiertas
) VALUES (
  '2026-Q2', 'Abril – Junio 2026', '2026-04-01', '2026-06-30',
  12, true
) ON CONFLICT (id) DO NOTHING;


-- ------------------------------------------------------------
-- Guardias de prueba (~10 en mayo 2026)
-- Notar que creado_por queda NULL (lo actualizará el admin más tarde)
-- ------------------------------------------------------------
INSERT INTO public.guardias (fecha, hora_inicio, duracion_horas, sede_id, servicio, cupos_totales, trimestre_id)
VALUES
  ('2026-05-03', '08:00', 24, 'a1000000-0000-0000-0000-000000000001', 'Guardia general', 3, '2026-Q2'),
  ('2026-05-07', '08:00', 24, 'a1000000-0000-0000-0000-000000000002', 'Pediatría',        2, '2026-Q2'),
  ('2026-05-10', '08:00', 24, 'a1000000-0000-0000-0000-000000000001', 'Guardia general', 3, '2026-Q2'),
  ('2026-05-11', '08:00', 24, 'a1000000-0000-0000-0000-000000000002', 'Cardiología',      2, '2026-Q2'),
  ('2026-05-13', '20:00', 24, 'a1000000-0000-0000-0000-000000000001', 'Pediatría',        2, '2026-Q2'),
  ('2026-05-17', '08:00', 24, 'a1000000-0000-0000-0000-000000000002', 'Guardia general', 2, '2026-Q2'),
  ('2026-05-21', '08:00', 24, 'a1000000-0000-0000-0000-000000000002', 'Cardiología',      2, '2026-Q2'),
  ('2026-05-24', '08:00', 24, 'a1000000-0000-0000-0000-000000000003', 'Guardia general', 3, '2026-Q2'),
  ('2026-05-28', '08:00', 24, 'a1000000-0000-0000-0000-000000000001', 'Guardia general', 3, '2026-Q2'),
  ('2026-05-31', '08:00', 24, 'a1000000-0000-0000-0000-000000000002', 'Pediatría',        2, '2026-Q2');


-- ------------------------------------------------------------
-- Activar usuario admin
-- Reemplazá el UUID antes de ejecutar este bloque.
-- ------------------------------------------------------------
UPDATE public.profiles SET
  nombre       = 'Admin',
  apellido     = 'Sistema',
  matricula    = 'ADMIN-001',
  especialidad = 'Administración',
  rol          = 'admin',
  activo       = true
WHERE id = 'REEMPLAZAR-CON-UUID-DEL-ADMIN';

-- Si el UPDATE no actualizó ninguna fila, el trigger todavía no creó el perfil.
-- Esperá unos segundos y volvé a ejecutar solo el UPDATE de arriba.
