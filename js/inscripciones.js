// ============================================================
// inscripciones.js — Inscribirse / cancelar (compartido con admin)
// ============================================================

import { supabase } from './supabase-client.js';

// Inscripción atómica vía función PostgreSQL SECURITY DEFINER
export async function inscribirmeEnGuardia(guardiaId, medicoEmail = null, medicoNombre = null) {
  const { data, error } = await supabase
    .rpc('inscribirme_en_guardia', { p_guardia_id: guardiaId });
  if (error) return { ok: false, codigo: 'ERROR' };

  // Email de confirmación (fire-and-forget — no bloquea la UI)
  if (data?.ok && medicoEmail) {
    supabase.functions.invoke('send-email', {
      body: { tipo: 'confirmacion', guardia_id: guardiaId,
              medico_email: medicoEmail, medico_nombre: medicoNombre ?? '' },
    }).catch(() => {});
  }

  return data; // { ok, codigo }
}

// Cancelación vía función PostgreSQL SECURITY DEFINER
export async function cancelarInscripcion(inscripcionId) {
  const { data, error } = await supabase
    .rpc('cancelar_inscripcion', { p_inscripcion_id: inscripcionId });
  if (error) return { ok: false, codigo: 'ERROR' };
  return data; // { ok, codigo }
}

// Todas las inscripciones activas del médico actual, con detalle de guardia
export async function obtenerMisInscripciones() {
  const { data, error } = await supabase
    .from('inscripciones')
    .select(`
      id, estado, inscripto_en,
      guardia:guardia_id (
        id, fecha, hora_inicio, duracion_horas, servicio, notas,
        sede:sede_id ( nombre, color_hex ),
        trimestre:trimestre_id ( id, nombre, fecha_inicio, fecha_fin )
      )
    `)
    .in('estado', ['confirmada', 'asignada_admin']);
  return { data: data ?? [], error };
}

// Admin: lista de médicos inscriptos en una guardia (vía RPC SECURITY DEFINER)
export async function obtenerMedicosDeGuardia(guardiaId) {
  const { data, error } = await supabase
    .rpc('medicos_de_guardia', { p_guardia_id: guardiaId });
  if (error) return [];
  return data ?? [];
}
