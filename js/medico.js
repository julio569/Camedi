// ============================================================
// medico.js — Dashboard del médico
// ============================================================

import { supabase }     from './supabase-client.js';
import { cerrarSesion } from './auth.js';
import { renderizarCalendario, actualizarHeaderMes } from './calendar.js';
import {
  formatearFechaLarga, formatearFechaCorta,
  formatearHora, horasHasta, hoyISO, iniciales, MESES, escapeHtml,
} from './utils.js';
import { obtenerTrimestres, obtenerGuardiasTrimestre } from './guardias.js';
import {
  inscribirmeEnGuardia, cancelarInscripcion, obtenerMisInscripciones,
} from './inscripciones.js';

// ── Mensajes de error por código RPC ─────────────────────

const MENSAJES_CODIGO = {
  MEDICO_INACTIVO:    'Tu cuenta no está activa.',
  CERRADO:            'Las inscripciones para este trimestre están cerradas.',
  SIN_CUPO:           'Ya no hay cupos disponibles en esta guardia.',
  YA_INSCRIPTO:       'Ya estás inscripto en esta guardia.',
  TOPE_ALCANZADO:     'Alcanzaste el máximo de guardias permitidas para este trimestre.',
  TOPE_MENSUAL:       'Alcanzaste el máximo de 10 guardias en este mes.',
  SOLAPA:             'Esta guardia se solapa con otra confirmada (se requieren 24 hs de separación).',
  GUARDIA_NO_EXISTE:  'La guardia no existe.',
  GUARDIA_PASADA:     'Esta guardia ya finalizó y no acepta inscripciones.',
  NO_EXISTE:          'La inscripción no existe.',
  SIN_PERMISO:        'No tenés permiso para realizar esta acción.',
  ESTADO_INVALIDO:    'El estado de la inscripción no permite esta operación.',
  CANCELACION_TARDIA: 'No podés cancelar con menos de 48 hs de anticipación.',
  ERROR:              'Ocurrió un error inesperado. Intentá de nuevo.',
};

function traducirCodigo(codigo) {
  return MENSAJES_CODIGO[codigo] ?? MENSAJES_CODIGO.ERROR;
}

// ── Estado del módulo ─────────────────────────────────────

let perfil               = null;
let trimestresDisponibles = [];
let trimestreActivo      = null;
let guardiasTrimestre    = [];   // guardias_con_cupos del trimestre activo (filtrado por sedes)
let misInscripciones     = [];   // todas las inscripciones activas del médico
let misSedes             = [];   // IDs de sedes asignadas al médico
let mesVista = {
  año: new Date().getFullYear(),
  mes: new Date().getMonth() + 1,
};

// ── Punto de entrada ─────────────────────────────────────

export async function iniciarMedico(p) {
  perfil = p;
  renderizarShell();
  window.updateThemeIcons && window.updateThemeIcons();
  configurarEventos();
  await cargarDatos();
}

// ── Shell HTML ────────────────────────────────────────────

function renderizarShell() {
  const ini = iniciales(perfil.nombre, perfil.apellido);

  document.getElementById('vista-medico').innerHTML = `
    <div class="bg-bg min-h-screen">

      <!-- Top bar mobile -->
      <div class="lg:hidden bg-surface border-b border-line px-4 py-3 flex items-center
                  justify-between sticky top-0 z-30 shadow-sm">
        <div class="flex items-center gap-2">
          <svg viewBox="0 0 44 44" width="32" height="32" fill="none">
            <rect width="44" height="44" rx="10" fill="#0f3b3a"/>
            <path d="M 29 14 A 11 11 0 1 0 29 30" stroke="white" stroke-width="4.5" fill="none" stroke-linecap="round"/>
            <circle cx="29" cy="30" r="3.2" fill="#c08a4a"/>
          </svg>
          <span class="font-display text-lg text-primary">Camedi</span>
        </div>
        <div class="flex items-center gap-2">
          <button onclick="window.toggleTheme && window.toggleTheme()" class="theme-btn" aria-label="Cambiar tema"></button>
          <button id="med-btn-refresh"
                  class="w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line transition-colors"
                  aria-label="Actualizar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          <div class="w-8 h-8 rounded-full bg-primary text-white text-xs font-bold
                      flex items-center justify-center flex-shrink-0">${ini}</div>
        </div>
      </div>

      <div class="max-w-[1400px] mx-auto p-4 pb-24 lg:p-8 lg:pb-8
                  grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">

        <!-- ── Sidebar (desktop) ──────────────────── -->
        <aside class="hidden lg:block bg-surface border border-line rounded-xl p-5
                      h-fit lg:sticky lg:top-8 self-start">

          <div class="flex items-center gap-3 pb-5 border-b border-line">
            <div class="w-11 h-11 rounded-full bg-primary text-white flex items-center
                        justify-center font-display text-lg flex-shrink-0">${ini}</div>
            <div class="min-w-0 flex-1">
              <div class="font-medium text-sm text-ink truncate">
                Dr. ${escapeHtml(perfil.nombre)} ${escapeHtml(perfil.apellido)}
              </div>
              <div class="text-xs text-ink-mute truncate">
                ${escapeHtml(perfil.especialidad)} · ${escapeHtml(perfil.matricula)}
              </div>
            </div>
            <button onclick="window.toggleTheme && window.toggleTheme()" class="theme-btn flex-shrink-0" aria-label="Cambiar tema"></button>
          </div>

          <nav class="mt-4 space-y-0.5">
            <div class="nav-item activo cursor-pointer select-none" data-seccion="calendario">
              <span class="dot"></span> Calendario
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="mis-guardias">
              <span class="dot"></span> Mis guardias
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="perfil">
              <span class="dot"></span> Mi perfil
            </div>
          </nav>

          <div id="med-stats"
               class="mt-5 p-4 bg-accent-soft rounded-lg">
            <div class="text-xs font-semibold text-ink uppercase tracking-wider mb-1">
              Este trimestre
            </div>
            <div class="font-display text-3xl text-primary">— / —</div>
            <div class="text-xs text-ink-soft mt-1">Guardias inscriptas / máx.</div>
          </div>

          <div class="mt-4 pt-4 border-t border-line">
            <button id="med-btn-logout"
              class="nav-item w-full cursor-pointer select-none hover:!text-bad hover:!bg-red-50">
              <span class="dot"></span> Cerrar sesión
            </button>
          </div>
        </aside>

        <!-- ── Contenido ──────────────────────────── -->
        <div>

          <!-- SECCIÓN: Calendario -->
          <section id="med-sec-calendario" class="med-seccion">

            <header class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                  Trimestre
                </div>
                <select id="med-sel-trimestre" class="input !py-2 !text-sm !w-auto">
                  <option>Cargando…</option>
                </select>
              </div>
            </header>

            <!-- Leyenda -->
            <div class="flex items-center gap-4 mb-4 text-xs flex-wrap">
              <span class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded chip-libre inline-block"></span> Cupo libre
              </span>
              <span class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded chip-pocos inline-block"></span> Último cupo
              </span>
              <span class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded chip-lleno inline-block"></span> Completa
              </span>
              <span class="flex items-center gap-1.5">
                <span class="w-3 h-3 rounded chip-mio inline-block"></span> Inscripto
              </span>
            </div>

            <!-- Aviso inscripciones cerradas -->
            <div id="med-trimestre-estado" class="mb-4"></div>

            <!-- Card del calendario -->
            <div class="bg-surface border border-line rounded-xl overflow-hidden">
              <div class="flex items-center justify-between px-5 py-4 border-b border-line">
                <h2 id="cal-mes-titulo" class="font-display text-2xl">Cargando…</h2>
                <div class="flex gap-1">
                  <button id="cal-btn-prev" class="btn-ghost !py-1.5 !px-3 text-xs">←</button>
                  <button id="cal-btn-next" class="btn-ghost !py-1.5 !px-3 text-xs">→</button>
                </div>
              </div>
              <div class="grid grid-cols-7 text-center text-xs uppercase tracking-wider
                          text-ink-mute font-semibold border-b border-line">
                ${['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map(
                  d => `<div class="py-2">${d}</div>`
                ).join('')}
              </div>
              <div id="med-cal-loading" class="py-16 text-center text-ink-mute text-sm">
                Cargando guardias…
              </div>
              <div id="med-cal-grid" class="grid grid-cols-7 hidden"></div>
            </div>

            <!-- Mis próximas guardias -->
            <section id="med-proximas" class="mt-8 hidden">
              <h2 class="font-display text-2xl mb-4">Mis próximas guardias</h2>
              <div id="med-proximas-lista" class="grid md:grid-cols-2 gap-4"></div>
            </section>

          </section>

          <!-- SECCIÓN: Mis guardias -->
          <section id="med-sec-mis-guardias" class="med-seccion hidden">
            <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                  Historial
                </div>
                <h1 class="font-display text-4xl">Mis guardias</h1>
              </div>
              <button id="med-btn-descargar-guardias" class="btn-ghost text-sm whitespace-nowrap">
                ↓ Descargar Excel
              </button>
            </div>
            <div id="med-lista-guardias">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

          <!-- SECCIÓN: Mi perfil -->
          <section id="med-sec-perfil" class="med-seccion hidden">
            <div class="mb-6">
              <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                Cuenta
              </div>
              <h1 class="font-display text-4xl">Mi perfil</h1>
            </div>
            <div id="med-perfil-contenido"></div>
          </section>

        </div>
      </div>

      <!-- Nav mobile (bottom bar) -->
      <nav class="lg:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-line
                  grid grid-cols-4 z-40">
        <button class="med-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-xs font-medium text-primary" data-seccion="calendario">
          ${svgCalendario(18)} Calendario
        </button>
        <button class="med-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-xs font-medium text-ink-mute" data-seccion="mis-guardias">
          ${svgLista(18)} Mis guardias
        </button>
        <button class="med-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-xs font-medium text-ink-mute" data-seccion="perfil">
          ${svgPerfil(18)} Perfil
        </button>
        <button id="med-btn-logout-mobile"
                class="flex flex-col items-center justify-center gap-0.5
                       py-3 text-xs font-medium text-ink-mute hover:text-bad">
          ${svgSalir(18)} Salir
        </button>
      </nav>

    </div>
  `;
}

// ── Eventos ───────────────────────────────────────────────

function configurarEventos() {
  const root = document.getElementById('vista-medico');

  // Delegación: nav sidebar + nav mobile
  root.addEventListener('click', (e) => {
    const item = e.target.closest('[data-seccion]');
    if (item) mostrarSeccion(item.dataset.seccion);
  });

  document.getElementById('med-btn-logout')
    ?.addEventListener('click', cerrarSesion);
  document.getElementById('med-btn-logout-mobile')
    ?.addEventListener('click', cerrarSesion);

  document.getElementById('med-btn-refresh')
    ?.addEventListener('click', async () => {
      const btn = document.getElementById('med-btn-refresh');
      if (btn) btn.style.opacity = '0.4';
      await recargarGuardias();
      if (btn) btn.style.opacity = '1';
    });

  document.getElementById('med-sel-trimestre')
    ?.addEventListener('change', async (e) => {
      trimestreActivo =
        trimestresDisponibles.find(t => t.id === e.target.value) ?? trimestreActivo;
      ajustarMesAlTrimestre();
      await recargarGuardias();
    });

  document.getElementById('cal-btn-prev')
    ?.addEventListener('click', () => {
      if (mesVista.mes === 1) mesVista = { año: mesVista.año - 1, mes: 12 };
      else                    mesVista = { año: mesVista.año, mes: mesVista.mes - 1 };
      renderizarCalendarioActual();
    });

  document.getElementById('cal-btn-next')
    ?.addEventListener('click', () => {
      if (mesVista.mes === 12) mesVista = { año: mesVista.año + 1, mes: 1 };
      else                     mesVista = { año: mesVista.año, mes: mesVista.mes + 1 };
      renderizarCalendarioActual();
    });

  document.getElementById('med-btn-descargar-guardias')
    ?.addEventListener('click', async () => {
      const btn = document.getElementById('med-btn-descargar-guardias');
      if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }
      const { exportarReporteMedico } = await import('./reportes.js');
      const hoy = new Date().toISOString().slice(0, 10);
      const inscriptasIds = new Set(misInscripciones.map(i => i.guardia?.id).filter(Boolean));
      const sinInscripcion = guardiasTrimestre.filter(g => g.fecha < hoy && !inscriptasIds.has(g.id));
      await exportarReporteMedico(
        trimestreActivo,
        `${perfil.nombre} ${perfil.apellido}`,
        misInscripciones,
        sinInscripcion,
      );
      if (btn) { btn.disabled = false; btn.textContent = '↓ Descargar Excel'; }
    });

  document.getElementById('btn-cerrar-modal')
    ?.addEventListener('click', cerrarModal);
  document.getElementById('modal-guardia')
    ?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) cerrarModal();
    });
}

function mostrarSeccion(nombre) {
  document.querySelectorAll('.med-seccion').forEach(s => s.classList.add('hidden'));
  document.getElementById(`med-sec-${nombre}`)?.classList.remove('hidden');

  // Actualizar estado activo en sidebar
  document.querySelectorAll('.nav-item[data-seccion]').forEach(item => {
    item.classList.toggle('activo', item.dataset.seccion === nombre);
  });

  // Actualizar estado activo en nav mobile
  document.querySelectorAll('.med-nav-mobile[data-seccion]').forEach(btn => {
    const activo = btn.dataset.seccion === nombre;
    btn.classList.toggle('text-primary',  activo);
    btn.classList.toggle('text-ink-mute', !activo);
  });

  if (nombre === 'mis-guardias') renderizarHistorialGuardias();
  if (nombre === 'perfil')       renderizarPerfil();
}

// ── Carga de datos ────────────────────────────────────────

async function cargarDatos() {
  // Cargar sedes del médico primero (para filtrar el calendario)
  const { data: sedesData } = await supabase
    .from('medico_sedes')
    .select('sede_id')
    .eq('medico_id', perfil.id);
  misSedes = (sedesData ?? []).map(s => s.sede_id);

  const { data: trims, error } = await obtenerTrimestres();

  if (error || !trims.length) {
    const el = document.getElementById('med-cal-loading');
    if (el) el.innerHTML =
      '<p class="text-bad">No hay trimestres configurados. Contactá al administrador.</p>';
    return;
  }

  trimestresDisponibles = trims;
  trimestreActivo       = elegirTrimestre(trims);

  const sel = document.getElementById('med-sel-trimestre');
  if (sel) {
    sel.innerHTML = trims.map(t =>
      `<option value="${t.id}" ${t.id === trimestreActivo.id ? 'selected' : ''}>${t.nombre}</option>`
    ).join('');
  }

  ajustarMesAlTrimestre();
  await recargarGuardias();
}

function elegirTrimestre(trims) {
  const hoy = new Date().toISOString().slice(0, 10);
  return (
    trims.find(t => t.fecha_inicio <= hoy && hoy <= t.fecha_fin) ??
    [...trims].reverse().find(t => t.fecha_inicio > hoy)         ??
    trims[0]
  );
}

function ajustarMesAlTrimestre() {
  if (!trimestreActivo) return;
  const hoy = new Date().toISOString().slice(0, 10);
  if (hoy >= trimestreActivo.fecha_inicio && hoy <= trimestreActivo.fecha_fin) {
    mesVista = { año: new Date().getFullYear(), mes: new Date().getMonth() + 1 };
  } else {
    const [a, m] = trimestreActivo.fecha_inicio.split('-').map(Number);
    mesVista = { año: a, mes: m };
  }
}

async function recargarGuardias() {
  if (!trimestreActivo) return;

  mostrarCargandoCalendario(true);

  const [{ data: guardias }, { data: inscripciones }] = await Promise.all([
    obtenerGuardiasTrimestre(trimestreActivo.id, misSedes),
    obtenerMisInscripciones(),
  ]);

  guardiasTrimestre = guardias;
  misInscripciones  = inscripciones;

  mostrarCargandoCalendario(false);
  actualizarStats();
  mostrarEstadoTrimestre();
  renderizarCalendarioActual();
  renderizarProximasGuardias();
}

function mostrarCargandoCalendario(cargando) {
  document.getElementById('med-cal-loading')?.classList.toggle('hidden', !cargando);
  document.getElementById('med-cal-grid')?.classList.toggle('hidden',   cargando);
}

function actualizarStats() {
  const el = document.getElementById('med-stats');
  if (!el || !trimestreActivo) return;
  const hoy = new Date().toISOString().slice(0, 10);
  const count = misInscripciones.filter(
    i => i.guardia?.trimestre?.id === trimestreActivo.id
  ).length;
  const max = trimestreActivo.max_guardias_por_medico;
  const pct  = max > 0 ? Math.min(Math.round((count / max) * 100), 100) : 0;

  const barColor = pct >= 100 ? '#22c55e' : pct >= 50 ? 'var(--color-primary)' : pct > 0 ? '#f59e0b' : 'var(--color-line)';
  const msg = pct >= 100 ? '¡Trimestre completo!' :
              pct >= 75  ? '¡Casi llegás al máximo!' :
              pct >= 50  ? 'Buen ritmo, seguí así.' :
              pct > 0    ? 'Seguí inscribiéndote.' :
              trimestreActivo.inscripciones_abiertas ? '¡Hay guardias disponibles!' : '';

  const proxima = misInscripciones
    .filter(i => i.guardia?.fecha >= hoy && i.guardia?.trimestre?.id === trimestreActivo.id)
    .sort((a, b) => a.guardia.fecha.localeCompare(b.guardia.fecha))[0];
  const proximaStr = proxima
    ? `Próxima: ${formatearFechaCorta(proxima.guardia.fecha)}`
    : '';

  el.innerHTML = `
    <div class="text-xs font-semibold text-ink uppercase tracking-wider mb-2">Este trimestre</div>
    <div class="font-display text-3xl text-primary mb-2">
      ${count} <span class="text-base text-ink-mute font-sans font-normal">/ ${max}</span>
    </div>
    <div class="w-full rounded-full h-1.5 mb-2" style="background:var(--color-line)">
      <div class="h-1.5 rounded-full transition-all duration-500" style="width:${pct}%;background:${barColor}"></div>
    </div>
    ${msg        ? `<div class="text-xs text-ink-soft">${msg}</div>` : ''}
    ${proximaStr ? `<div class="text-xs text-ink-mute mt-1">${proximaStr}</div>` : ''}
  `;
}

function mostrarEstadoTrimestre() {
  const el = document.getElementById('med-trimestre-estado');
  if (!el || !trimestreActivo) return;
  if (!trimestreActivo.inscripciones_abiertas) {
    el.innerHTML = `
      <div class="rounded-lg px-4 py-3 text-sm bg-accent-soft border border-amber-200 text-amber-800">
        Las inscripciones para este trimestre están <strong>cerradas</strong>.
        Podés consultar el calendario pero no inscribirte.
      </div>`;
  } else {
    el.innerHTML = '';
  }
}

// ── Calendario ────────────────────────────────────────────

function renderizarCalendarioActual() {
  if (!trimestreActivo) return;

  const misGuardiaIds = new Set(
    misInscripciones
      .filter(i => i.guardia?.trimestre?.id === trimestreActivo.id)
      .map(i => i.guardia?.id)
      .filter(Boolean)
  );

  const mm           = String(mesVista.mes).padStart(2, '0');
  const guardiasMes  = guardiasTrimestre.filter(g => g.fecha.startsWith(`${mesVista.año}-${mm}`));

  renderizarCalendario(
    'med-cal-grid',
    mesVista.año,
    mesVista.mes,
    guardiasMes,
    misGuardiaIds,
    abrirModalGuardia,
  );

  actualizarHeaderMes(
    mesVista.año,
    mesVista.mes,
    trimestreActivo.fecha_inicio,
    trimestreActivo.fecha_fin,
  );
}

// ── Próximas guardias (bajo el calendario) ────────────────

function renderizarProximasGuardias() {
  const seccion = document.getElementById('med-proximas');
  const lista   = document.getElementById('med-proximas-lista');
  if (!seccion || !lista) return;

  const hoy = new Date().toISOString().slice(0, 10);
  const proximas = misInscripciones
    .filter(i => i.guardia?.fecha >= hoy && i.guardia?.trimestre?.id === trimestreActivo?.id)
    .sort((a, b) => a.guardia.fecha.localeCompare(b.guardia.fecha))
    .slice(0, 4);

  if (!proximas.length) {
    seccion.classList.add('hidden');
    return;
  }

  seccion.classList.remove('hidden');
  lista.innerHTML = proximas.map(i => tarjetaProxima(i)).join('');

  lista.querySelectorAll('[data-accion="ver-detalle"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const guardia = guardiasTrimestre.find(g => g.id === btn.dataset.guardiaId);
      if (guardia) abrirModalGuardia(guardia);
    });
  });

  lista.querySelectorAll('[data-accion="cancelar-directo"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const fecha = btn.dataset.fecha;
      if (!confirm(`¿Cancelar tu inscripción en la guardia del ${formatearFechaLarga(fecha)}?`)) return;
      btn.disabled    = true;
      btn.textContent = 'Cancelando…';
      const res = await cancelarInscripcion(btn.dataset.inscripcionId);
      if (res.ok) {
        await recargarGuardias();
      } else {
        btn.disabled    = false;
        btn.textContent = 'Cancelar';
        alert(traducirCodigo(res.codigo));
      }
    });
  });
}

function tarjetaProxima(ins) {
  const g             = ins.guardia;
  const hora          = formatearHora(g.hora_inicio);
  const dotColor      = g.sede?.color_hex ?? '#8a948f';
  const puedesCancelar = horasHasta(g.fecha, g.hora_inicio) >= 48;
  const badge         = ins.estado === 'asignada_admin'
    ? '<span class="badge badge-info">Asignada</span>'
    : '<span class="badge badge-ok">Confirmada</span>';
  const [, m, d]      = g.fecha.split('-').map(Number);
  const diaNombre     = formatearFechaLarga(g.fecha).split(' ')[0];

  return `
    <div class="guardia-card">
      <div class="flex items-start justify-between mb-3">
        <div>
          <div class="text-xs text-ink-mute uppercase tracking-wider">${diaNombre}</div>
          <div class="font-display text-2xl">${d} de ${MESES[m - 1].toLowerCase()}</div>
        </div>
        ${badge}
      </div>
      <div class="space-y-1 text-sm text-ink-soft">
        <div>${hora} — ${g.duracion_horas} hs</div>
        <div>
          <span class="sede-dot" style="background:${dotColor}"></span>
          ${g.sede?.nombre ?? '—'} — ${g.servicio}
        </div>
      </div>
      <div class="flex gap-2 mt-4 pt-4 border-t border-line">
        <button class="btn-ghost text-xs flex-1"
          data-accion="ver-detalle"
          data-guardia-id="${g.id}">Ver detalle</button>
        ${puedesCancelar
          ? `<button class="btn-ghost text-xs hover:!text-bad hover:!bg-red-50 hover:!border-red-200"
              data-accion="cancelar-directo"
              data-inscripcion-id="${ins.id}"
              data-fecha="${g.fecha}">Cancelar</button>`
          : ''}
      </div>
    </div>
  `;
}

// ── Modal de guardia ──────────────────────────────────────

function abrirModalGuardia(guardia) {
  if (!guardia) return;

  const [a, m] = guardia.fecha.split('-').map(Number);
  const hora   = formatearHora(guardia.hora_inicio);

  const diaEl   = document.getElementById('modal-dia');
  const fechaEl = document.getElementById('modal-fecha');
  if (diaEl)   diaEl.textContent   = `${MESES[m - 1]} ${a}`;
  if (fechaEl) fechaEl.textContent = formatearFechaLarga(guardia.fecha);

  const hoy         = new Date().toISOString().slice(0, 10);
  const esPasada    = guardia.fecha < hoy;
  const inscripcion = misInscripciones.find(i => i.guardia?.id === guardia.id);
  const yaInscripto = !!inscripcion;
  const cuposLibres = guardia.cupos_libres  ?? 0;
  const cuposOcup   = guardia.cupos_ocupados ?? 0;
  const cuposTotal  = guardia.cupos_totales  ?? 0;
  const dotColor    = guardia.sede_color ?? '#8a948f';

  let badgeCupos;
  if (esPasada)               badgeCupos = `<span class="badge badge-warn">Finalizada</span>`;
  else if (cuposLibres <= 0)  badgeCupos = `<span class="badge badge-bad">Sin cupos</span>`;
  else if (cuposLibres === 1) badgeCupos = `<span class="badge badge-warn">Último cupo</span>`;
  else                        badgeCupos = `<span class="badge badge-ok">${cuposLibres} cupos libres</span>`;

  const cuerpo = document.getElementById('modal-cuerpo');
  if (cuerpo) {
    cuerpo.innerHTML = `
      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <div class="flex items-center">
            <span class="sede-dot" style="background:${dotColor}"></span>
            <span class="font-semibold text-ink">${guardia.sede_nombre ?? '—'}</span>
          </div>
          ${badgeCupos}
        </div>
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div class="text-ink-mute text-xs mb-0.5">Servicio</div>
            <div class="text-ink">${guardia.servicio}</div>
          </div>
          <div>
            <div class="text-ink-mute text-xs mb-0.5">Horario</div>
            <div class="text-ink">${hora} · ${guardia.duracion_horas} hs</div>
          </div>
          <div>
            <div class="text-ink-mute text-xs mb-0.5">Cupos</div>
            <div class="text-ink">${cuposOcup} / ${cuposTotal} ocupados</div>
          </div>
          <div>
            <div class="text-ink-mute text-xs mb-0.5">Trimestre</div>
            <div class="text-ink">${guardia.trimestre_nombre ?? '—'}</div>
          </div>
        </div>
        ${guardia.notas ? `
          <div>
            <div class="text-ink-mute text-xs mb-0.5">Notas</div>
            <div class="text-ink text-sm">${escapeHtml(guardia.notas)}</div>
          </div>` : ''}
        ${esPasada ? `
          <div class="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600">
            Esta guardia ya finalizó. No se aceptan nuevas inscripciones.
          </div>` : ''}
        ${yaInscripto && !esPasada ? `
          <div class="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800">
            Estás inscripto en esta guardia
            ${horasHasta(guardia.fecha, guardia.hora_inicio) < 48
              ? ' · <strong>Ya no podés cancelar</strong> (menos de 48 hs)'
              : ''}
          </div>` : ''}
        <div id="modal-msg-resultado" class="hidden"></div>
        <div id="modal-companeros" class="text-xs text-ink-mute">Cargando inscriptos…</div>
      </div>
    `;
  }

  const acciones = document.getElementById('modal-acciones');
  if (acciones) {
    acciones.innerHTML = '';

    if (yaInscripto) {
      if (horasHasta(guardia.fecha, guardia.hora_inicio) >= 48) {
        const btnCancelar = document.createElement('button');
        btnCancelar.className = 'btn-ghost hover:!text-bad hover:!bg-red-50 hover:!border-red-200';
        btnCancelar.id        = 'modal-btn-cancelar';
        btnCancelar.innerHTML = `
          <span class="spinner oscuro" id="spin-modal-cancelar"></span>
          <span id="txt-modal-cancelar">Cancelar inscripción</span>`;
        btnCancelar.addEventListener('click', () => accionCancelar(inscripcion.id, guardia));
        acciones.appendChild(btnCancelar);
      }
    } else if (!esPasada && trimestreActivo?.inscripciones_abiertas && cuposLibres > 0) {
      const btnInscribirse = document.createElement('button');
      btnInscribirse.className = 'btn-primary flex-1';
      btnInscribirse.id        = 'modal-btn-inscribirse';
      btnInscribirse.innerHTML = `
        <span class="spinner" id="spin-modal-inscribirse"></span>
        <span id="txt-modal-inscribirse">Inscribirme</span>`;
      btnInscribirse.addEventListener('click', () => accionInscribirse(guardia.id));
      acciones.appendChild(btnInscribirse);
    }

    const btnCerrar = document.createElement('button');
    btnCerrar.className   = 'btn-ghost';
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.addEventListener('click', cerrarModal);
    acciones.appendChild(btnCerrar);
  }

  document.getElementById('modal-guardia')?.classList.add('visible');

  // Carga async de compañeros inscriptos
  const companeroEl = document.getElementById('modal-companeros');
  if (companeroEl) {
    supabase.rpc('companeros_de_guardia', { p_guardia_id: guardia.id })
      .then(({ data }) => {
        if (!companeroEl.isConnected) return;
        const lista = Array.isArray(data) ? data : [];
        if (!lista.length) {
          companeroEl.textContent = cuposOcup > 0 ? '' : 'Nadie inscripto todavía.';
          return;
        }
        companeroEl.innerHTML = `
          <div class="border-t border-line pt-3 mt-1">
            <div class="text-xs font-semibold text-ink uppercase tracking-wider mb-2">
              Inscriptos (${lista.length})
            </div>
            <div class="space-y-1">
              ${lista.map(m => `
                <div class="text-xs text-ink flex items-center gap-2">
                  <span class="w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0"></span>
                  <span>${escapeHtml(m.apellido)}, ${escapeHtml(m.nombre)}${m.especialidad ? ` — ${escapeHtml(m.especialidad)}` : ''}</span>
                </div>`).join('')}
            </div>
          </div>`;
      })
      .catch(() => { if (companeroEl.isConnected) companeroEl.textContent = ''; });
  }
}

function cerrarModal() {
  document.getElementById('modal-guardia')?.classList.remove('visible');
}

// ── Acciones: inscribirse / cancelar ─────────────────────

async function accionInscribirse(guardiaId) {
  const btn  = document.getElementById('modal-btn-inscribirse');
  const spin = document.getElementById('spin-modal-inscribirse');
  const txt  = document.getElementById('txt-modal-inscribirse');
  if (btn)  btn.disabled       = true;
  if (spin) spin.style.display = 'block';
  if (txt)  txt.style.opacity  = '0';

  const { data: { session } } = await supabase.auth.getSession();
  const medicoEmail  = session?.user?.email ?? null;
  const medicoNombre = perfil ? `${perfil.nombre} ${perfil.apellido}` : null;
  const res = await inscribirmeEnGuardia(guardiaId, medicoEmail, medicoNombre);

  if (btn)  btn.disabled       = false;
  if (spin) spin.style.display = 'none';
  if (txt)  txt.style.opacity  = '1';

  const msgEl = document.getElementById('modal-msg-resultado');
  if (res.ok) {
    if (msgEl) { msgEl.className = 'msg-ok visible'; msgEl.textContent = '¡Inscripción confirmada!'; }
    await recargarGuardias();
    setTimeout(cerrarModal, 1200);
  } else {
    if (msgEl) { msgEl.className = 'msg-error visible'; msgEl.textContent = traducirCodigo(res.codigo); }
    if (['SIN_CUPO', 'YA_INSCRIPTO'].includes(res.codigo)) await recargarGuardias();
  }
}

async function accionCancelar(inscripcionId, guardia) {
  if (!confirm(`¿Cancelar tu inscripción en la guardia del ${formatearFechaLarga(guardia.fecha)}?`)) return;

  const btn  = document.getElementById('modal-btn-cancelar');
  const spin = document.getElementById('spin-modal-cancelar');
  const txt  = document.getElementById('txt-modal-cancelar');
  if (btn)  btn.disabled       = true;
  if (spin) spin.style.display = 'block';
  if (txt)  txt.style.opacity  = '0';

  const res = await cancelarInscripcion(inscripcionId);

  if (btn)  btn.disabled       = false;
  if (spin) spin.style.display = 'none';
  if (txt)  txt.style.opacity  = '1';

  const msgEl = document.getElementById('modal-msg-resultado');
  if (res.ok) {
    if (msgEl) { msgEl.className = 'msg-ok visible'; msgEl.textContent = 'Inscripción cancelada.'; }
    await recargarGuardias();
    setTimeout(cerrarModal, 1200);
  } else {
    if (msgEl) { msgEl.className = 'msg-error visible'; msgEl.textContent = traducirCodigo(res.codigo); }
  }
}

// ── Mis guardias (historial completo) ─────────────────────

function renderizarHistorialGuardias() {
  const contenedor = document.getElementById('med-lista-guardias');
  if (!contenedor) return;
  cargarYMostrarHistorial(contenedor);
}

async function cargarYMostrarHistorial(contenedor) {
  contenedor.innerHTML = '<div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>';

  const { data, error } = await obtenerMisInscripciones();

  const hoy            = new Date().toISOString().slice(0, 10);
  const inscriptasIds  = new Set((data ?? []).map(i => i.guardia?.id).filter(Boolean));
  const sinInscripcion = guardiasTrimestre
    .filter(g => g.fecha < hoy && !inscriptasIds.has(g.id))
    .sort((a, b) => b.fecha.localeCompare(a.fecha));

  if (error || (!data?.length && !sinInscripcion.length)) {
    contenedor.innerHTML = `
      <div class="text-center py-16 text-ink-mute">
        <p class="text-sm">No tenés guardias confirmadas.</p>
        <p class="text-xs mt-2">Inscribite desde el calendario.</p>
      </div>`;
    return;
  }

  const proximas = (data ?? [])
    .filter(i => i.guardia?.fecha >= hoy)
    .sort((a, b) => a.guardia.fecha.localeCompare(b.guardia.fecha));
  const pasadas  = (data ?? [])
    .filter(i => i.guardia?.fecha < hoy)
    .sort((a, b) => b.guardia.fecha.localeCompare(a.guardia.fecha));

  let html = '';
  if (proximas.length) {
    html += `
      <div class="mb-8">
        <div class="text-xs uppercase tracking-widest text-ink-mute mb-3 font-semibold">Próximas</div>
        <div class="space-y-3">${proximas.map(i => tarjetaHistorial(i)).join('')}</div>
      </div>`;
  }
  if (pasadas.length) {
    html += `
      <div class="mb-8">
        <div class="text-xs uppercase tracking-widest text-ink-mute mb-3 font-semibold">Realizadas</div>
        <div class="space-y-3">${pasadas.map(i => tarjetaHistorial(i)).join('')}</div>
      </div>`;
  }
  if (sinInscripcion.length) {
    html += `
      <div>
        <div class="text-xs uppercase tracking-widest text-ink-mute mb-3 font-semibold">
          Sin inscripción — ${trimestreActivo?.nombre ?? ''}
        </div>
        <div class="space-y-3">${sinInscripcion.map(g => tarjetaSinInscripcion(g)).join('')}</div>
      </div>`;
  }

  contenedor.innerHTML = html;

  contenedor.querySelectorAll('[data-cancelar-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id    = btn.dataset.cancelarId;
      const fecha = btn.dataset.cancelarFecha;
      if (!confirm(`¿Cancelar tu inscripción en la guardia del ${formatearFechaLarga(fecha)}?`)) return;
      btn.disabled    = true;
      btn.textContent = 'Cancelando…';
      const res = await cancelarInscripcion(id);
      if (res.ok) {
        await Promise.all([cargarYMostrarHistorial(contenedor), recargarGuardias()]);
      } else {
        btn.disabled    = false;
        btn.textContent = 'Cancelar';
        const errEl = document.getElementById(`err-ins-${id}`);
        if (errEl) { errEl.textContent = traducirCodigo(res.codigo); errEl.classList.remove('hidden'); }
      }
    });
  });
}

function tarjetaHistorial(ins) {
  const g              = ins.guardia;
  if (!g) return '';
  const hoy            = new Date().toISOString().slice(0, 10);
  const esFutura       = g.fecha >= hoy;
  const hora           = formatearHora(g.hora_inicio);
  const dotColor       = g.sede?.color_hex ?? '#8a948f';
  const puedesCancelar = esFutura && horasHasta(g.fecha, g.hora_inicio) >= 48;
  const badge          = ins.estado === 'asignada_admin'
    ? '<span class="badge badge-info ml-2">Asignada</span>'
    : esFutura
      ? '<span class="badge badge-ok">Confirmada</span>'
      : '<span class="badge badge-ok">Realizada</span>';

  return `
    <div class="guardia-card">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-1 rounded-full self-stretch flex-shrink-0 mt-1" style="background:${dotColor}; min-width:3px;"></div>
          <div class="min-w-0">
            <div class="font-semibold text-ink text-sm">${formatearFechaLarga(g.fecha)}</div>
            <div class="text-ink-soft text-xs mt-0.5">${hora} · ${g.duracion_horas} hs</div>
            <div class="text-ink-soft text-xs mt-0.5">${g.sede?.nombre ?? '—'} · ${g.servicio}</div>
            ${g.notas ? `<div class="text-ink-mute text-xs mt-1 italic">${escapeHtml(g.notas)}</div>` : ''}
          </div>
        </div>
        <div class="flex-shrink-0 text-right">
          ${badge}
          ${puedesCancelar
            ? `<button class="text-xs text-bad hover:underline mt-2 block"
                data-cancelar-id="${ins.id}"
                data-cancelar-fecha="${g.fecha}">Cancelar</button>`
            : esFutura
              ? '<div class="text-xs text-ink-mute mt-1">< 48 hs</div>'
              : ''}
        </div>
      </div>
      <div id="err-ins-${ins.id}" class="hidden text-xs text-bad mt-2"></div>
    </div>
  `;
}

function tarjetaSinInscripcion(g) {
  const hora     = formatearHora(g.hora_inicio);
  const dotColor = g.sede_color ?? '#8a948f';
  return `
    <div class="guardia-card opacity-60">
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-start gap-3 min-w-0">
          <div class="w-1 rounded-full self-stretch flex-shrink-0 mt-1"
               style="background:${dotColor}; min-width:3px;"></div>
          <div class="min-w-0">
            <div class="font-semibold text-ink text-sm">${formatearFechaLarga(g.fecha)}</div>
            <div class="text-ink-soft text-xs mt-0.5">${hora} · ${g.duracion_horas} hs</div>
            <div class="text-ink-soft text-xs mt-0.5">${g.sede_nombre ?? '—'} · ${g.servicio}</div>
          </div>
        </div>
        <span class="badge badge-warn flex-shrink-0">Sin inscripción</span>
      </div>
    </div>
  `;
}

// ── Mi perfil ─────────────────────────────────────────────

function renderizarPerfil() {
  const contenedor = document.getElementById('med-perfil-contenido');
  if (!contenedor || contenedor.dataset.listo) return;
  contenedor.dataset.listo = '1';
  mostrarVistaPerfil(contenedor);
}

function colorGradientAvatar(nombre, apellido) {
  const paleta = [
    ['#1c5552', '#0f3b3a'], ['#2d6a4f', '#1b4332'],
    ['#1565c0', '#0d47a1'], ['#6a1b9a', '#4a148c'], ['#bf360c', '#7f2400'],
  ];
  let h = 0;
  for (const c of (nombre + apellido).toLowerCase())
    h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  const [a, b] = paleta[h % paleta.length];
  return `linear-gradient(135deg,${a},${b})`;
}

function memberDesde(fechaStr) {
  if (!fechaStr) return '';
  const d = new Date(fechaStr);
  return `${MESES[d.getMonth()].slice(0, 3).toLowerCase()} ${d.getFullYear()}`;
}

function mostrarVistaPerfil(contenedor) {
  const hoy        = hoyISO();
  const mesActual  = hoy.slice(0, 7);

  const countTrimestre = misInscripciones.filter(
    i => i.guardia?.trimestre?.id === trimestreActivo?.id
  ).length;
  const maxTrimestre = trimestreActivo?.max_guardias_por_medico ?? 0;
  const pctTrimestre = maxTrimestre
    ? Math.min(100, Math.round(countTrimestre / maxTrimestre * 100))
    : 0;

  const completadas = misInscripciones.filter(i => i.guardia?.fecha < hoy);
  const totalHoras  = completadas.reduce((s, i) => s + (i.guardia?.duracion_horas || 24), 0);
  const esteMes     = misInscripciones.filter(
    i => i.guardia?.fecha?.startsWith(mesActual)
  ).length;

  const proxima = [...misInscripciones]
    .filter(i => i.guardia?.fecha >= hoy)
    .sort((a, b) =>
      (a.guardia.fecha + (a.guardia.hora_inicio || ''))
        .localeCompare(b.guardia.fecha + (b.guardia.hora_inicio || ''))
    )[0] ?? null;

  const gradAvatar = colorGradientAvatar(perfil.nombre, perfil.apellido);
  const ini        = iniciales(perfil.nombre, perfil.apellido);
  const desde      = memberDesde(perfil.creado_en);
  const nombreCompleto = `${escapeHtml(perfil.nombre)} ${escapeHtml(perfil.apellido)}`;

  // Bloque de próxima guardia
  let proximaHTML = '';
  if (proxima) {
    const [, pMes, pDia] = proxima.guardia.fecha.split('-').map(Number);
    const pMesNombre     = MESES[pMes - 1].slice(0, 3).toLowerCase();
    const pHora          = formatearHora(proxima.guardia.hora_inicio);
    const pDuracion      = proxima.guardia.duracion_horas ?? 24;
    const pSede          = proxima.guardia.sede?.nombre ?? '';
    const pServicio      = escapeHtml(proxima.guardia.servicio || 'Guardia');
    proximaHTML = `
      <div class="bg-surface border border-line rounded-2xl p-5">
        <div class="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-4">Próxima guardia</div>
        <div class="flex items-center gap-4">
          <div class="shrink-0 flex flex-col items-center justify-center rounded-2xl text-white"
               style="width:56px;height:56px;background:var(--primary)">
            <div class="text-lg font-bold leading-none">${pDia}</div>
            <div class="text-xs font-medium mt-0.5 opacity-80">${pMesNombre}</div>
          </div>
          <div class="min-w-0">
            <div class="font-semibold text-ink leading-tight">${pServicio}</div>
            <div class="text-sm text-ink-soft mt-1">
              ${pHora} &nbsp;·&nbsp; ${pDuracion} hs${pSede ? ` &nbsp;·&nbsp; ${escapeHtml(pSede)}` : ''}
            </div>
          </div>
        </div>
      </div>`;
  }

  // Stat card helper
  const statCard = (label, valor, sub, barra) => `
    <div class="bg-surface border border-line rounded-2xl p-4 flex flex-col gap-1">
      <div class="text-xs text-ink-mute uppercase tracking-wider leading-none">${label}</div>
      <div class="font-display text-2xl font-bold text-primary leading-tight">${valor}</div>
      <div class="text-xs text-ink-soft">${sub}</div>
      ${barra !== null ? `
      <div class="w-full h-1 rounded-full mt-1" style="background:var(--color-line)">
        <div class="h-1 rounded-full transition-all duration-500"
             style="width:${barra}%;background:var(--accent)"></div>
      </div>` : ''}
    </div>`;

  // Campo con icono SVG
  const campoIcono = (svg, label, valor) => `
    <div class="flex items-start gap-3">
      <div class="shrink-0 mt-0.5" style="color:var(--ink-mute)">${svg}</div>
      <div class="min-w-0">
        <div class="text-xs text-ink-mute mb-0.5">${label}</div>
        <div class="text-sm font-medium text-ink break-words">${escapeHtml(String(valor || '—'))}</div>
      </div>
    </div>`;

  const icoPersona = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  const icoDoc     = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 10h8M8 14h5"/></svg>`;
  const icoEstrella= `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
  const icoTel     = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 2.1 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
  const icoCal     = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>`;

  contenedor.innerHTML = `
    <div class="space-y-4">

      <!-- HERO CARD -->
      <div class="bg-surface border border-line rounded-3xl p-6 sm:p-8">
        <div class="flex flex-col sm:flex-row sm:items-start gap-5">
          <div class="shrink-0 flex items-center justify-center rounded-full"
               style="width:88px;height:88px;background:${gradAvatar};box-shadow:0 0 0 3px var(--surface),0 0 0 5px var(--accent)">
            <span style="color:white;font-size:1.75rem;font-weight:700;letter-spacing:-1px;font-family:var(--font-display, serif)">${ini}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="font-display text-3xl sm:text-4xl leading-tight mb-1">${nombreCompleto}</div>
            <div class="text-ink-soft text-base mb-3">${escapeHtml(perfil.especialidad)}</div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="badge">${escapeHtml(perfil.matricula)}</span>
              ${desde ? `<span class="text-xs text-ink-mute">Miembro desde ${desde}</span>` : ''}
            </div>
          </div>
          <button id="btn-editar-perfil" class="btn-ghost text-sm self-start shrink-0">Editar datos</button>
        </div>
      </div>

      <!-- STATS ROW -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
        ${statCard(
          'Este trimestre',
          maxTrimestre ? `${countTrimestre}<span style="font-size:.875rem;font-weight:400;color:var(--ink-mute);font-family:sans-serif"> / ${maxTrimestre}</span>` : countTrimestre,
          'guardias confirmadas',
          maxTrimestre ? pctTrimestre : null
        )}
        ${statCard('Completadas', completadas.length, 'guardias totales', null)}
        ${statCard('Horas totales', totalHoras.toLocaleString('es'), 'en guardia', null)}
        ${statCard('Este mes', esteMes, 'guardias confirmadas', null)}
      </div>

      <!-- PRÓXIMA GUARDIA -->
      ${proximaHTML}

      <!-- DATOS PERSONALES -->
      <div class="bg-surface border border-line rounded-2xl p-6">
        <div class="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-5">Datos personales</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
          ${campoIcono(icoPersona, 'Nombre completo', `${perfil.nombre} ${perfil.apellido}`)}
          ${campoIcono(icoDoc,     'Matrícula',        perfil.matricula)}
          ${campoIcono(icoEstrella,'Especialidad',     perfil.especialidad)}
          ${campoIcono(icoTel,     'Teléfono',         perfil.telefono || '—')}
          ${desde ? campoIcono(icoCal, 'Miembro desde', `${memberDesde(perfil.creado_en)}`) : ''}
        </div>
      </div>

      <!-- MIS SEDES -->
      <div id="perfil-sedes-card" class="bg-surface border border-line rounded-2xl p-6">
        <div class="flex items-center justify-between mb-4">
          <div class="text-xs uppercase tracking-widest text-ink-mute font-semibold">Mis sedes</div>
          <button id="btn-editar-sedes" class="btn-ghost text-xs !py-1 !px-3">Cambiar</button>
        </div>
        <div id="perfil-sedes-lista" class="text-sm text-ink-soft">Cargando…</div>
      </div>

    </div>
  `;

  document.getElementById('btn-editar-perfil')
    ?.addEventListener('click', () => mostrarFormularioPerfil(contenedor));
  document.getElementById('btn-editar-sedes')
    ?.addEventListener('click', () => mostrarEditorSedes(contenedor));

  cargarSedesPerfil();
}

async function cargarSedesPerfil() {
  const el = document.getElementById('perfil-sedes-lista');
  if (!el) return;

  const { data: todasSedes } = await supabase
    .from('sedes').select('id, nombre, color_hex').eq('activa', true).order('nombre');

  if (!misSedes.length) {
    el.innerHTML = '<span class="text-ink-mute">Sin sedes asignadas.</span>';
    return;
  }

  const activas = (todasSedes ?? []).filter(s => misSedes.includes(s.id));
  el.innerHTML = `<div class="flex flex-wrap gap-2">${
    activas.map(s => `
      <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-line text-sm font-medium text-ink"
           style="background:var(--bg)">
        <span class="w-2.5 h-2.5 rounded-full shrink-0"
              style="background:${s.color_hex ?? '#8a948f'}"></span>
        ${escapeHtml(s.nombre)}
      </div>`
    ).join('')
  }</div>`;
}

async function mostrarEditorSedes(contenedor) {
  const card = contenedor.querySelector('#perfil-sedes-card');
  if (!card) return;

  const [{ data: todasSedes }, { data: provinciasData }] = await Promise.all([
    supabase.from('sedes').select('id, nombre, color_hex, provincia_id').eq('activa', true).order('nombre'),
    supabase.from('provincias').select('id, nombre').order('nombre'),
  ]);

  if (!todasSedes?.length) return;

  const seleccionadas  = new Set(misSedes);
  const provConSedes   = new Set(todasSedes.map(s => s.provincia_id).filter(Boolean));
  const provinciasDisp = (provinciasData ?? []).filter(p => provConSedes.has(p.id));
  let provinciaFiltro  = '';

  function renderListaSedes() {
    const lista = card.querySelector('#editor-sedes-lista');
    if (!lista) return;
    const filtradas = provinciaFiltro
      ? todasSedes.filter(s => String(s.provincia_id) === String(provinciaFiltro))
      : todasSedes;

    if (!filtradas.length) {
      lista.innerHTML = '<div class="py-3 text-center text-ink-mute text-sm">No hay sedes en esta provincia.</div>';
      return;
    }

    lista.innerHTML = filtradas.map(s => {
      const activa = seleccionadas.has(s.id);
      return `
        <div class="sede-elegir-card flex items-center gap-3 p-3 rounded-xl border-2
                    cursor-pointer select-none transition-colors
                    ${activa ? 'border-primary bg-accent-soft' : 'border-line hover:border-primary/40'}"
             data-sede-id="${s.id}">
          <span class="w-3 h-3 rounded-full flex-shrink-0"
                style="background:${s.color_hex ?? '#8a948f'}"></span>
          <span class="font-medium text-sm text-ink flex-1">${s.nombre}</span>
          <span class="sede-check w-5 h-5 rounded border-2 flex items-center justify-center
                       flex-shrink-0 transition-colors
                       ${activa ? 'bg-primary border-primary' : 'border-line'}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
                 class="${activa ? '' : 'hidden'}">
              <polyline points="2 6 5 9 10 3" stroke="white" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </div>`;
    }).join('');

    lista.querySelectorAll('.sede-elegir-card').forEach(c => {
      c.addEventListener('click', () => {
        const id    = c.dataset.sedeId;
        const check = c.querySelector('.sede-check');
        const svg   = c.querySelector('svg');
        if (seleccionadas.has(id)) {
          seleccionadas.delete(id);
          c.classList.remove('border-primary', 'bg-accent-soft');
          c.classList.add('border-line');
          if (check) { check.classList.remove('bg-primary', 'border-primary'); check.classList.add('border-line'); }
          if (svg)   svg.classList.add('hidden');
        } else {
          seleccionadas.add(id);
          c.classList.add('border-primary', 'bg-accent-soft');
          c.classList.remove('border-line');
          if (check) { check.classList.add('bg-primary', 'border-primary'); check.classList.remove('border-line'); }
          if (svg)   svg.classList.remove('hidden');
        }
      });
    });
  }

  card.innerHTML = `
    <div class="text-xs uppercase tracking-widest text-ink-mute font-semibold mb-3">Mis sedes</div>
    ${provinciasDisp.length > 1 ? `
    <div class="mb-3">
      <select id="editor-filtro-provincia" class="input !py-1.5 !text-sm w-full">
        <option value="">Todas las provincias</option>
        ${provinciasDisp.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('')}
      </select>
    </div>` : ''}
    <div id="editor-sedes-lista" class="space-y-2 mb-4"></div>
    <div id="err-editor-sedes" class="msg-error mb-3"></div>
    <div class="flex gap-2">
      <button id="btn-guardar-editor-sedes" class="btn-primary text-sm flex-1">
        <span class="spinner" id="spin-editor-sedes"></span>
        <span id="txt-editor-sedes">Guardar</span>
      </button>
      <button id="btn-cancelar-editor-sedes" class="btn-ghost text-sm">Cancelar</button>
    </div>
  `;

  renderListaSedes();

  card.querySelector('#editor-filtro-provincia')
    ?.addEventListener('change', (e) => {
      provinciaFiltro = e.target.value;
      renderListaSedes();
    });

  document.getElementById('btn-cancelar-editor-sedes')
    ?.addEventListener('click', () => { delete contenedor.dataset.listo; mostrarVistaPerfil(contenedor); });

  document.getElementById('btn-guardar-editor-sedes')
    ?.addEventListener('click', async () => {
      const errEl = document.getElementById('err-editor-sedes');
      if (errEl) errEl.classList.remove('visible');

      if (seleccionadas.size === 0) {
        if (errEl) { errEl.textContent = 'Seleccioná al menos una sede.'; errEl.classList.add('visible'); }
        return;
      }

      const btn  = document.getElementById('btn-guardar-editor-sedes');
      const spin = document.getElementById('spin-editor-sedes');
      const txt  = document.getElementById('txt-editor-sedes');
      if (btn)  btn.disabled       = true;
      if (spin) spin.style.display = 'block';
      if (txt)  txt.style.opacity  = '0';

      // Borrar las actuales e insertar las nuevas
      const { error: errDel } = await supabase
        .from('medico_sedes').delete().eq('medico_id', perfil.id);
      const { error: errIns } = await supabase
        .from('medico_sedes')
        .insert([...seleccionadas].map(sede_id => ({ medico_id: perfil.id, sede_id })));

      if (btn)  btn.disabled       = false;
      if (spin) spin.style.display = 'none';
      if (txt)  txt.style.opacity  = '1';

      if (errDel || errIns) {
        if (errEl) { errEl.textContent = 'Error al guardar. Intentá de nuevo.'; errEl.classList.add('visible'); }
        return;
      }

      // Actualizar estado local y recargar guardias
      misSedes = [...seleccionadas];
      await recargarGuardias();

      delete contenedor.dataset.listo;
      mostrarVistaPerfil(contenedor);
    });
}

function campoPerfil(label, valor) {
  return `<div>
    <div class="text-xs text-ink-mute mb-0.5">${label}</div>
    <div class="text-sm font-medium text-ink">${escapeHtml(valor)}</div>
  </div>`;
}

function mostrarFormularioPerfil(contenedor) {
  contenedor.innerHTML = `
    <div class="bg-surface border border-line rounded-2xl p-6 max-w-lg">
      <form id="form-perfil" class="space-y-4" novalidate>
        <div id="err-perfil" class="msg-error"></div>
        <div id="ok-perfil"  class="msg-ok"></div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label for="perf-nombre">Nombre *</label>
            <input id="perf-nombre" type="text" class="input mt-1.5" value="${escapeHtml(perfil.nombre)}" />
          </div>
          <div>
            <label for="perf-apellido">Apellido *</label>
            <input id="perf-apellido" type="text" class="input mt-1.5" value="${escapeHtml(perfil.apellido)}" />
          </div>
        </div>
        <div>
          <label for="perf-matricula">Matrícula *</label>
          <input id="perf-matricula" type="text" class="input mt-1.5" value="${escapeHtml(perfil.matricula)}" />
        </div>
        <div>
          <label for="perf-especialidad">Especialidad *</label>
          <input id="perf-especialidad" type="text" class="input mt-1.5" value="${escapeHtml(perfil.especialidad)}" />
        </div>
        <div>
          <label for="perf-telefono">Teléfono</label>
          <input id="perf-telefono" type="tel" class="input mt-1.5" value="${escapeHtml(perfil.telefono ?? '')}" />
        </div>

        <div class="flex gap-3 pt-2">
          <button type="submit" id="btn-guardar-perfil" class="btn-primary">
            <span class="spinner"   id="spin-perfil"></span>
            <span id="txt-btn-perfil">Guardar cambios</span>
          </button>
          <button type="button" id="btn-cancelar-perfil" class="btn-ghost">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  document.getElementById('btn-cancelar-perfil')
    ?.addEventListener('click', () => {
      delete contenedor.dataset.listo;
      mostrarVistaPerfil(contenedor);
    });

  document.getElementById('form-perfil')
    ?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre       = document.getElementById('perf-nombre').value.trim();
      const apellido     = document.getElementById('perf-apellido').value.trim();
      const matricula    = document.getElementById('perf-matricula').value.trim();
      const especialidad = document.getElementById('perf-especialidad').value.trim();
      const telefono     = document.getElementById('perf-telefono').value.trim();
      const errEl        = document.getElementById('err-perfil');
      const okEl         = document.getElementById('ok-perfil');

      if (!nombre || !apellido || !matricula || !especialidad) {
        if (errEl) { errEl.textContent = 'Completá todos los campos obligatorios.'; errEl.classList.add('visible'); }
        return;
      }
      if (errEl) errEl.classList.remove('visible');
      if (okEl)  okEl.classList.remove('visible');

      const btn  = document.getElementById('btn-guardar-perfil');
      const spin = document.getElementById('spin-perfil');
      const txt  = document.getElementById('txt-btn-perfil');
      if (btn)  btn.disabled       = true;
      if (spin) spin.style.display = 'block';
      if (txt)  txt.style.opacity  = '0';

      const { error } = await supabase
        .from('profiles')
        .update({ nombre, apellido, matricula, especialidad, telefono: telefono || null })
        .eq('id', perfil.id);

      if (btn)  btn.disabled       = false;
      if (spin) spin.style.display = 'none';
      if (txt)  txt.style.opacity  = '1';

      if (error) {
        const msg = error.message.includes('matricula')
          ? 'Esa matrícula ya está registrada en el sistema.'
          : 'Error al guardar. Intentá de nuevo.';
        if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
        return;
      }

      perfil.nombre       = nombre;
      perfil.apellido     = apellido;
      perfil.matricula    = matricula;
      perfil.especialidad = especialidad;
      perfil.telefono     = telefono || null;

      if (okEl) { okEl.textContent = 'Datos actualizados correctamente.'; okEl.classList.add('visible'); }

      setTimeout(() => {
        delete contenedor.dataset.listo;
        mostrarVistaPerfil(contenedor);
      }, 1200);
    });
}

// ── Iconos SVG inline ─────────────────────────────────────

function svgSalir(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>`;
}

function svgCalendario(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8"  y1="2" x2="8"  y2="6"/>
    <line x1="3"  y1="10" x2="21" y2="10"/>
  </svg>`;
}

function svgLista(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="8"  y1="6"  x2="21" y2="6"/>
    <line x1="8"  y1="12" x2="21" y2="12"/>
    <line x1="8"  y1="18" x2="21" y2="18"/>
    <line x1="3"  y1="6"  x2="3.01" y2="6"/>
    <line x1="3"  y1="12" x2="3.01" y2="12"/>
    <line x1="3"  y1="18" x2="3.01" y2="18"/>
  </svg>`;
}

function svgPerfil(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
    <circle cx="12" cy="7" r="4"/>
  </svg>`;
}
