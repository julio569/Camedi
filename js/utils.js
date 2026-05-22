// ============================================================
// utils.js — Helpers de fecha, formato y UI compartidos
// ============================================================

export const MESES = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];

export const DIAS_LARGOS = [
  'Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo',
];

// Iniciales de nombre + apellido: "Juan Pérez" → "JP"
export function iniciales(nombre, apellido) {
  return ((nombre?.[0] || '') + (apellido?.[0] || '')).toUpperCase();
}

// Día de semana con lunes=0, evitando problemas de timezone
// al usar el constructor local en vez de parsear 'YYYY-MM-DD' como UTC
export function diaSemana(fechaStr) {
  const [a, m, d] = fechaStr.split('-').map(Number);
  return (new Date(a, m - 1, d).getDay() + 6) % 7;
}

// "2026-05-10" → "Sábado 10 de mayo"
export function formatearFechaLarga(fechaStr) {
  const [a, m, d] = fechaStr.split('-').map(Number);
  const diaNombre = DIAS_LARGOS[(new Date(a, m - 1, d).getDay() + 6) % 7];
  return `${diaNombre} ${d} de ${MESES[m - 1].toLowerCase()}`;
}

// "2026-05-10" → "10 de mayo"
export function formatearFechaCorta(fechaStr) {
  const [, m, d] = fechaStr.split('-').map(Number);
  return `${d} de ${MESES[m - 1].toLowerCase()}`;
}

// "08:00:00" → "08:00"
export function formatearHora(horaStr) {
  return (horaStr || '').substring(0, 5);
}

// Horas desde ahora hasta la fecha+hora de inicio de una guardia.
// Negativo si ya pasó.
export function horasHasta(fechaStr, horaStr) {
  const [a, m, d] = fechaStr.split('-').map(Number);
  const [h, min]  = (horaStr || '00:00').split(':').map(Number);
  return (new Date(a, m - 1, d, h, min) - Date.now()) / 3_600_000;
}

// Hoy en formato "YYYY-MM-DD" (hora local, sin desplazamiento UTC)
export function hoyISO() {
  const hoy = new Date();
  return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2,'0')}-${String(hoy.getDate()).padStart(2,'0')}`;
}

// Escapa caracteres HTML para prevenir XSS al insertar en innerHTML o atributos.
export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Helpers de UI ─────────────────────────────────────────

export function mostrarMsg(elId, texto, tipo = 'error') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = texto;
  el.className = tipo === 'ok' ? 'msg-ok visible' : 'msg-error visible';
}

export function ocultarMsg(elId) {
  const el = document.getElementById(elId);
  if (el) el.classList.remove('visible');
}

// Activa/desactiva el estado de carga de un botón con spinner
export function setCargando(btnId, spinId, txtId, cargando) {
  const btn  = document.getElementById(btnId);
  const spin = document.getElementById(spinId);
  const txt  = document.getElementById(txtId);
  if (btn)  btn.disabled          = cargando;
  if (spin) spin.style.display    = cargando ? 'block' : 'none';
  if (txt)  txt.style.opacity     = cargando ? '0'     : '1';
}
