// ============================================================
// guardias.js — Consultas de guardias (compartido con admin)
// ============================================================

import { supabase } from './supabase-client.js';

export async function obtenerTrimestres() {
  const { data, error } = await supabase
    .from('trimestres')
    .select('*')
    .order('fecha_inicio', { ascending: false });
  return { data: data ?? [], error };
}

export async function obtenerGuardiasTrimestre(trimestreId, sedeIds = null) {
  let query = supabase
    .from('guardias_con_cupos')
    .select('*')
    .eq('trimestre_id', trimestreId)
    .order('fecha')
    .order('hora_inicio');

  if (sedeIds && sedeIds.length > 0) {
    query = query.in('sede_id', sedeIds);
  }

  const { data, error } = await query;
  return { data: data ?? [], error };
}

export async function obtenerProvincias() {
  const { data, error } = await supabase
    .from('provincias')
    .select('id, nombre')
    .order('nombre');
  return { data: data ?? [], error };
}

export async function obtenerSedes() {
  const { data, error } = await supabase
    .from('sedes')
    .select('id, nombre, direccion, color_hex, activa, provincia_id, asociacion_id, provincias(nombre)')
    .order('nombre');
  return { data: data ?? [], error };
}

// ── Admin: CRUD ───────────────────────────────────────────

export async function crearGuardia(campos) {
  const { data, error } = await supabase
    .from('guardias')
    .insert([campos])
    .select()
    .single();
  return { data, error };
}

export async function actualizarGuardia(id, campos) {
  const { data, error } = await supabase
    .from('guardias')
    .update(campos)
    .eq('id', id)
    .select()
    .single();
  return { data, error };
}

export async function eliminarGuardia(id) {
  const { error } = await supabase
    .from('guardias')
    .delete()
    .eq('id', id);
  return { error };
}

export async function eliminarGuardias(ids) {
  const { error } = await supabase
    .from('guardias')
    .delete()
    .in('id', ids);
  return { error };
}
