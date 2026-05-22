-- ============================================================
-- 09_security_fix.sql — CRÍTICO: Bloquear escalada de privilegios
-- Ejecutar INMEDIATAMENTE en Supabase SQL Editor
-- ============================================================

-- ── 1. Parchear handle_new_user para ignorar rol en metadatos ──
-- RAÍZ DEL PROBLEMA: el trigger de signup leía 'rol' de los metadatos
-- y corría como service role (uid=NULL), bypasseando el fix anterior.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, nombre, apellido, matricula, especialidad, telefono, rol, aprobado
  ) VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nombre',      ''),
    COALESCE(NEW.raw_user_meta_data->>'apellido',    ''),
    COALESCE(NEW.raw_user_meta_data->>'matricula',   ''),
    COALESCE(NEW.raw_user_meta_data->>'especialidad',''),
    COALESCE(NEW.raw_user_meta_data->>'telefono',    ''),
    'pendiente',  -- SIEMPRE pendiente, ignorar cualquier valor en metadatos
    false         -- SIEMPRE false, el admin aprueba manualmente
  );
  RETURN NEW;
END;
$$;

-- ── 2. Trigger que protege 'rol' y 'aprobado' en profiles ──
-- Segunda capa de defensa para INSERTs y UPDATEs directos por API

CREATE OR REPLACE FUNCTION public.proteger_campos_sensibles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid        uuid := auth.uid();
  caller_rol text;
BEGIN
  -- INSERT: siempre forzar pendiente/false salvo que sea el SQL Editor del admin
  IF TG_OP = 'INSERT' THEN
    IF uid IS NULL THEN
      -- Llamada de sistema (trigger de auth): forzar igual
      NEW.rol      := 'pendiente';
      NEW.aprobado := false;
      RETURN NEW;
    END IF;
    SELECT rol INTO caller_rol FROM public.profiles WHERE id = uid;
    IF caller_rol IS DISTINCT FROM 'admin' THEN
      NEW.rol      := 'pendiente';
      NEW.aprobado := false;
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: no-admins no pueden cambiar 'rol' ni 'aprobado'
  IF TG_OP = 'UPDATE' THEN
    IF uid IS NULL THEN
      RETURN NEW; -- SQL Editor / service role puede cambiar roles
    END IF;
    SELECT rol INTO caller_rol FROM public.profiles WHERE id = uid;
    IF caller_rol IS DISTINCT FROM 'admin' THEN
      NEW.rol      := OLD.rol;
      NEW.aprobado := OLD.aprobado;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_campos_sensibles ON public.profiles;
CREATE TRIGGER trg_proteger_campos_sensibles
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.proteger_campos_sensibles();

-- ── 2. Asegurar DEFAULT del campo rol ──────────────────────

ALTER TABLE public.profiles ALTER COLUMN rol SET DEFAULT 'pendiente';

-- ── 3. Eliminar políticas UPDATE permisivas en profiles ────

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE tablename = 'profiles' AND schemaname = 'public' AND cmd = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.profiles', pol.policyname);
  END LOOP;
END;
$$;

-- ── 4. Recrear políticas UPDATE seguras ────────────────────

-- Médicos pueden editar su propio perfil (nombre, apellido, etc.)
-- pero el trigger bloquea cambios en rol y aprobado
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- Admins pueden editar cualquier perfil
CREATE POLICY "profiles_admin_update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.es_admin());

-- ── 5. Verificar: el usuario comprometido ya no puede ser admin ──
-- Si el amigo ya creó un usuario admin, revocarle el acceso:

-- Ver usuarios con rol admin (para identificar intrusos):
-- SELECT id, nombre, apellido, rol, aprobado, created_at FROM public.profiles WHERE rol = 'admin' ORDER BY created_at;

-- Para revocar un admin no autorizado (reemplazar el ID):
-- UPDATE public.profiles SET rol = 'pendiente', aprobado = false WHERE id = 'UUID-DEL-USUARIO-INTRUSO';
