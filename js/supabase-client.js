// ============================================================
// supabase-client.js — Inicialización del cliente Supabase
//
// CONFIGURACIÓN: reemplazá los dos valores de abajo con los
// datos de tu proyecto en https://supabase.com/dashboard
//   → Settings → API → Project URL y anon public key
//
// IMPORTANTE: la anon key es segura para el navegador.
// NUNCA pegues aquí la service_role key.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL     = 'https://dvtzfsepmctaifvcxznj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImR2dHpmc2VwbWN0YWlmdmN4em5qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNDY5NzksImV4cCI6MjA5MjkyMjk3OX0.5gyGp8yiA5wMLDyZZO7Ko6BDfAO1EvFLfJdZ2I-FsM0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Persiste la sesión en localStorage entre recargas de página
    persistSession: true,
    // Detecta y aplica automáticamente el token de recuperación de contraseña
    // que Supabase agrega a la URL como fragmento (#access_token=...)
    detectSessionInUrl: true,
  },
});
