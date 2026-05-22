// ============================================================
// asociacion.js — Panel del rol "asociacion"
// Gestión multi-tenant scoped a una asociación médica.
// Las RLS policies en Supabase limitan automáticamente todos
// los queries al tenant (asociacion_id) del usuario activo.
// ============================================================

import { supabase }     from './supabase-client.js';
import { cerrarSesion } from './auth.js';
import {
  formatearFechaLarga, formatearHora, iniciales, setCargando, escapeHtml,
} from './utils.js';
import { cancelarInscripcion, obtenerMedicosDeGuardia } from './inscripciones.js';
import { exportarReporteAsociacion } from './reportes.js';

// ── Helpers ───────────────────────────────────────────────

const DIAS_C  = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
const MESES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function fechaTabla(str) {
  const [a, m, d] = str.split('-').map(Number);
  const dow = (new Date(a, m - 1, d).getDay() + 6) % 7;
  return `${DIAS_C[dow]} ${d} ${MESES_C[m - 1]}`;
}

const COD = {
  NO_EXISTE:          'La inscripción no existe.',
  SIN_PERMISO:        'Sin permiso para realizar esta acción.',
  ESTADO_INVALIDO:    'Estado inválido.',
  CANCELACION_TARDIA: 'No se puede cancelar con menos de 48hs de anticipación.',
  ERROR:              'Ocurrió un error inesperado.',
};
function traducirCod(c) { return COD[c] ?? COD.ERROR; }

// ── Estado ───────────────────────────────────────────────

let perfil                = null;
let trimestresDisponibles = [];
let trimestreActivo       = null;
let guardiasTrimestre     = [];
let sedes                 = [];
let guardiaEditando       = null;
let trimestreEditando     = null;
let guardiaInscriptosActual = null;
let seleccionadasIds      = new Set();
let medicosWhitelistCache = null;
let cacheMedicos          = null;

async function asegurarChartJS() {
  if (window.Chart) return window.Chart;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
    script.onload  = () => resolve(window.Chart);
    script.onerror = () => reject(new Error('No se pudo cargar la librería de gráficos.'));
    document.head.appendChild(script);
  });
}

// ── Punto de entrada ─────────────────────────────────────

export async function iniciarAsociacion(p) {
  perfil = p;
  renderizarShell();
  window.updateThemeIcons && window.updateThemeIcons();
  configurarEventos();
  await cargarDatosIniciales();
}

// ── Shell HTML ────────────────────────────────────────────

function renderizarShell() {
  const ini = iniciales(perfil.nombre, perfil.apellido);

  document.getElementById('vista-asociacion').innerHTML = `
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
          <button id="asoc-btn-logout-mobile"
                  class="w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:text-bad hover:bg-red-50 transition-colors"
                  aria-label="Cerrar sesión">
            ${svgSalir(16)}
          </button>
          <div class="w-8 h-8 rounded-full bg-accent text-white text-xs font-bold
                      flex items-center justify-center flex-shrink-0">${ini}</div>
        </div>
      </div>

      <div class="max-w-[1400px] mx-auto p-4 pb-24 lg:p-8 lg:pb-8
                  grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">

        <!-- Sidebar desktop -->
        <aside class="hidden lg:block bg-surface border border-line rounded-xl p-5
                      h-fit lg:sticky lg:top-8 self-start">

          <div class="flex items-center gap-3 pb-5 border-b border-line">
            <div class="w-11 h-11 rounded-full bg-accent text-white flex items-center
                        justify-center font-display text-lg flex-shrink-0">${ini}</div>
            <div class="min-w-0 flex-1">
              <div class="font-medium text-sm text-ink truncate">
                ${escapeHtml(perfil.nombre)} ${escapeHtml(perfil.apellido)}
              </div>
              <div class="text-xs text-ink-mute">Asociación</div>
            </div>
            <button onclick="window.toggleTheme && window.toggleTheme()" class="theme-btn flex-shrink-0" aria-label="Cambiar tema"></button>
          </div>

          <nav class="mt-4 space-y-0.5">
            <div class="nav-item activo cursor-pointer select-none" data-seccion="guardias">
              <span class="dot"></span> Guardias
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="medicos">
              <span class="dot"></span> Médicos
              <span id="asoc-badge-pendientes" class="ml-auto badge badge-warn hidden"></span>
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="trimestres">
              <span class="dot"></span> Trimestres
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="sedes">
              <span class="dot"></span> Sedes
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="dashboard">
              <span class="dot"></span> Dashboard
            </div>
          </nav>

          <div id="asoc-info-trimestre" class="mt-5 p-4 bg-accent-soft rounded-lg">
            <div class="text-xs font-semibold text-ink uppercase tracking-wider mb-1">
              Trimestre activo
            </div>
            <div class="text-sm text-ink-soft">Cargando…</div>
          </div>

          <div class="mt-4 pt-4 border-t border-line">
            <button id="asoc-btn-logout"
              class="nav-item w-full cursor-pointer select-none hover:!text-bad hover:!bg-red-50">
              <span class="dot"></span> Cerrar sesión
            </button>
          </div>
        </aside>

        <!-- Contenido -->
        <div>

          <!-- SECCIÓN: Guardias -->
          <section id="asoc-sec-guardias" class="asoc-seccion">
            <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                  Panel asociación
                </div>
                <h1 class="font-display text-4xl">Guardias</h1>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <select id="asoc-sel-trimestre" class="input !py-2 !text-sm !w-auto">
                  <option>Cargando…</option>
                </select>
                <select id="asoc-fil-sede" class="input !py-2 !text-sm !w-auto">
                  <option value="">Todas las sedes</option>
                </select>
                <button id="asoc-btn-descargar" class="btn-ghost text-sm whitespace-nowrap">
                  ↓ Excel
                </button>
                <button id="asoc-btn-notificar-medicos" class="btn-ghost text-sm whitespace-nowrap">
                  Notificar médicos
                </button>
                <button id="asoc-btn-nueva-guardia" class="btn-primary text-sm whitespace-nowrap">
                  + Nueva guardia
                </button>
              </div>
            </div>

            <!-- Stats -->
            <div id="asoc-stats" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"></div>

            <!-- Barra de acciones múltiples -->
            <div id="asoc-bulk-bar"
                 class="hidden mb-3 flex items-center justify-between gap-3
                         bg-surface border border-line rounded-xl px-5 py-3">
              <span id="asoc-bulk-count" class="text-sm font-medium text-ink"></span>
              <div class="flex gap-2">
                <button id="asoc-btn-deselect-all" class="btn-ghost text-xs !py-1.5 !px-3">
                  Deseleccionar todo
                </button>
                <button id="asoc-btn-eliminar-seleccion"
                        class="text-xs font-medium px-3 py-1.5 rounded-lg border
                               border-red-200 text-bad bg-red-50 hover:bg-red-100 transition-colors">
                  Eliminar seleccionadas
                </button>
              </div>
            </div>

            <!-- Tabla -->
            <div class="bg-surface border border-line rounded-xl overflow-hidden">
              <div id="asoc-tabla-cargando" class="py-16 text-center text-ink-mute text-sm">
                Cargando guardias…
              </div>
              <div id="asoc-tabla-wrap" class="hidden overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-xs uppercase tracking-wider text-ink-mute
                                border-b border-line">
                      <th class="px-3 py-3 w-10">
                        <input type="checkbox" id="asoc-chk-todos"
                               class="w-4 h-4 rounded accent-primary cursor-pointer"/>
                      </th>
                      <th class="px-5 py-3">Fecha</th>
                      <th class="px-5 py-3">Sede / Servicio</th>
                      <th class="px-5 py-3">Horario</th>
                      <th class="px-5 py-3">Cupos</th>
                      <th class="px-5 py-3">Estado</th>
                      <th class="px-5 py-3"></th>
                    </tr>
                  </thead>
                  <tbody id="asoc-tabla-body"></tbody>
                </table>
              </div>
              <div id="asoc-tabla-vacia"
                   class="hidden py-16 text-center text-ink-mute text-sm">
                No hay guardias para este trimestre.
                <button class="text-primary hover:underline ml-1" id="asoc-btn-nueva-guardia-2">
                  Crear la primera.
                </button>
              </div>
            </div>
          </section>

          <!-- SECCIÓN: Médicos -->
          <section id="asoc-sec-medicos" class="asoc-seccion hidden">
            <div class="mb-6">
              <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                Panel asociación
              </div>
              <h1 class="font-display text-4xl">Médicos</h1>
            </div>
            <div id="asoc-medicos-contenido">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

          <!-- SECCIÓN: Trimestres -->
          <section id="asoc-sec-trimestres" class="asoc-seccion hidden">
            <div class="flex items-end justify-between mb-6 gap-4">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                  Panel asociación
                </div>
                <h1 class="font-display text-4xl">Trimestres</h1>
              </div>
              <button id="asoc-btn-nuevo-trimestre" class="btn-primary text-sm">
                + Nuevo trimestre
              </button>
            </div>
            <div id="asoc-trimestres-contenido">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

          <!-- SECCIÓN: Dashboard -->
          <section id="asoc-sec-dashboard" class="asoc-seccion hidden">
            <div class="mb-6">
              <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                Panel asociación
              </div>
              <h1 class="font-display text-4xl">Dashboard</h1>
            </div>
            <div id="asoc-dash-contenido">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

          <!-- SECCIÓN: Sedes (solo lectura) -->
          <section id="asoc-sec-sedes" class="asoc-seccion hidden">
            <div class="mb-6">
              <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                Panel asociación
              </div>
              <h1 class="font-display text-4xl">Sedes</h1>
              <p class="text-sm text-ink-mute mt-2">
                Las sedes son asignadas por el administrador global. Contactá al admin para agregar o modificar sedes.
              </p>
            </div>
            <div id="asoc-sedes-contenido">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

        </div>
      </div>

      <!-- Nav mobile -->
      <nav class="lg:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-line
                  grid grid-cols-5 z-40">
        <button class="asoc-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-primary" data-seccion="guardias">
          ${svgGuardias(18)} Guardias
        </button>
        <button class="asoc-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-ink-mute" data-seccion="medicos">
          ${svgPersonas(18)} Médicos
        </button>
        <button class="asoc-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-ink-mute" data-seccion="trimestres">
          ${svgCalendario(18)} Trimestres
        </button>
        <button class="asoc-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-ink-mute" data-seccion="sedes">
          ${svgEdificio(18)} Sedes
        </button>
        <button class="asoc-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-ink-mute" data-seccion="dashboard">
          ${svgChart(18)} Stats
        </button>
      </nav>

    </div>

    <!-- ── Modales del panel asociación ────────────────── -->

    <!-- Modal: crear / editar guardia -->
    <div id="asoc-modal-guardia" class="modal-overlay">
      <div class="modal-box">
        <div class="flex items-start justify-between mb-5">
          <h3 id="asoc-modal-guardia-titulo" class="font-display text-2xl">Nueva guardia</h3>
          <button class="asoc-cerrar-modal w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line" data-modal="asoc-modal-guardia"
                  aria-label="Cerrar">✕</button>
        </div>
        <form id="asoc-form-guardia" novalidate class="space-y-4">
          <div id="asoc-err-guardia" class="msg-error"></div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="asoc-g-fecha">Fecha *</label>
              <input id="asoc-g-fecha" type="date" class="input mt-1.5" />
            </div>
            <div>
              <label for="asoc-g-hora">Hora inicio *</label>
              <input id="asoc-g-hora" type="time" class="input mt-1.5" value="08:00" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="asoc-g-duracion">Duración (hs) *</label>
              <input id="asoc-g-duracion" type="number" class="input mt-1.5" value="24" min="1" />
            </div>
            <div>
              <label for="asoc-g-cupos">Cupos *</label>
              <input id="asoc-g-cupos" type="number" class="input mt-1.5" value="1" min="1" />
            </div>
          </div>
          <div>
            <label for="asoc-g-sede">Sede *</label>
            <select id="asoc-g-sede" class="input mt-1.5"></select>
          </div>
          <div>
            <label for="asoc-g-servicio">Servicio *</label>
            <input id="asoc-g-servicio" type="text" class="input mt-1.5"
                   placeholder="Guardia general" />
          </div>
          <div>
            <label for="asoc-g-trimestre">Trimestre *</label>
            <select id="asoc-g-trimestre" class="input mt-1.5"></select>
          </div>
          <div>
            <label for="asoc-g-notas">Notas <span class="text-ink-mute font-normal">(opcional)</span></label>
            <textarea id="asoc-g-notas" class="input mt-1.5" rows="2"></textarea>
          </div>
          <div>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="asoc-g-whitelist-toggle" class="w-4 h-4 accent-primary" />
              <span class="text-sm font-medium text-ink">Limitar a médicos específicos</span>
            </label>
            <div id="asoc-g-whitelist-box" class="hidden mt-2">
              <div id="asoc-g-whitelist-chips"
                   class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2.5
                          border border-line rounded-xl bg-bg"></div>
              <p class="text-xs text-ink-mute mt-1.5">Seleccioná los médicos que SÍ pueden inscribirse. Los demás quedarán bloqueados.</p>
            </div>
          </div>
          <div class="flex gap-3 pt-2">
            <button type="submit" id="asoc-btn-guardar-guardia" class="btn-primary flex-1">
              <span class="spinner" id="asoc-spin-guardia"></span>
              <span id="asoc-txt-guardia">Guardar</span>
            </button>
            <button type="button" class="btn-ghost asoc-cerrar-modal"
                    data-modal="asoc-modal-guardia">Cancelar</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: inscriptos de una guardia -->
    <div id="asoc-modal-inscriptos" class="modal-overlay">
      <div class="modal-box !max-w-2xl">
        <div class="flex items-start justify-between mb-5">
          <h3 id="asoc-modal-inscriptos-titulo" class="font-display text-2xl">Inscriptos</h3>
          <button class="asoc-cerrar-modal w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line" data-modal="asoc-modal-inscriptos"
                  aria-label="Cerrar">✕</button>
        </div>
        <div id="asoc-inscriptos-contenido"></div>
      </div>
    </div>

    <!-- Modal: crear / editar trimestre -->
    <div id="asoc-modal-trimestre" class="modal-overlay">
      <div class="modal-box">
        <div class="flex items-start justify-between mb-5">
          <h3 id="asoc-modal-trimestre-titulo" class="font-display text-2xl">Nuevo trimestre</h3>
          <button class="asoc-cerrar-modal w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line" data-modal="asoc-modal-trimestre"
                  aria-label="Cerrar">✕</button>
        </div>
        <form id="asoc-form-trimestre" novalidate class="space-y-4">
          <div id="asoc-err-trimestre" class="msg-error"></div>
          <div>
            <label for="asoc-t-id">Identificador <span class="text-ink-mute font-normal">(ej. 2026-Q3)</span> *</label>
            <input id="asoc-t-id" type="text" class="input mt-1.5" placeholder="2026-Q3" />
          </div>
          <div>
            <label for="asoc-t-nombre">Nombre *</label>
            <input id="asoc-t-nombre" type="text" class="input mt-1.5"
                   placeholder="Julio – Septiembre 2026" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="asoc-t-inicio">Fecha inicio *</label>
              <input id="asoc-t-inicio" type="date" class="input mt-1.5" />
            </div>
            <div>
              <label for="asoc-t-fin">Fecha fin *</label>
              <input id="asoc-t-fin" type="date" class="input mt-1.5" />
            </div>
          </div>
          <div>
            <label for="asoc-t-max">Máx. guardias por médico *</label>
            <input id="asoc-t-max" type="number" class="input mt-1.5" value="12" min="1" />
          </div>
          <div class="flex gap-3 pt-2">
            <button type="submit" id="asoc-btn-guardar-trimestre" class="btn-primary flex-1">
              <span class="spinner" id="asoc-spin-trimestre"></span>
              <span id="asoc-txt-trimestre">Guardar</span>
            </button>
            <button type="button" class="btn-ghost asoc-cerrar-modal"
                    data-modal="asoc-modal-trimestre">Cancelar</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

// ── Eventos ───────────────────────────────────────────────

function configurarEventos() {
  const root = document.getElementById('vista-asociacion');

  root.addEventListener('click', (e) => {
    const navItem = e.target.closest('[data-seccion]');
    if (navItem) { mostrarSeccion(navItem.dataset.seccion); return; }

    const cerrarBtn = e.target.closest('.asoc-cerrar-modal');
    if (cerrarBtn) { cerrarModal(cerrarBtn.dataset.modal); return; }

    const overlay = e.target.closest('.modal-overlay');
    if (overlay && e.target === overlay && overlay.id.startsWith('asoc-')) {
      cerrarModal(overlay.id); return;
    }
  });

  document.getElementById('asoc-btn-logout')
    ?.addEventListener('click', cerrarSesion);
  document.getElementById('asoc-btn-logout-mobile')
    ?.addEventListener('click', cerrarSesion);

  // Guardias
  document.getElementById('asoc-sel-trimestre')
    ?.addEventListener('change', async (e) => {
      trimestreActivo = trimestresDisponibles.find(t => t.id === e.target.value) ?? trimestreActivo;
      actualizarInfoTrimestre();
      await recargarGuardias();
    });

  document.getElementById('asoc-fil-sede')
    ?.addEventListener('change', renderizarTablaGuardias);

  document.getElementById('asoc-btn-nueva-guardia')
    ?.addEventListener('click', () => abrirFormGuardia());
  document.getElementById('asoc-btn-nueva-guardia-2')
    ?.addEventListener('click', () => abrirFormGuardia());

  document.getElementById('asoc-btn-descargar')
    ?.addEventListener('click', async () => {
      const btn = document.getElementById('asoc-btn-descargar');
      if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }

      const sedeId     = document.getElementById('asoc-fil-sede')?.value || null;
      const sedeNombre = sedeId ? sedes.find(s => s.id === sedeId)?.nombre : null;
      const guardiasParaExportar = sedeId
        ? guardiasTrimestre.filter(g => g.sede_id === sedeId)
        : guardiasTrimestre;

      await exportarReporteAsociacion(
        guardiasParaExportar,
        trimestreActivo?.display_id || trimestreActivo?.nombre,
        sedeNombre,
        perfil?.nombre || 'Asociacion',
      );

      if (btn) { btn.disabled = false; btn.textContent = '↓ Excel'; }
    });

  document.getElementById('asoc-btn-deselect-all')
    ?.addEventListener('click', () => {
      seleccionadasIds.clear();
      renderizarTablaGuardias();
    });

  document.getElementById('asoc-btn-eliminar-seleccion')
    ?.addEventListener('click', eliminarGuardiasSeleccionadas);

  document.getElementById('asoc-form-guardia')
    ?.addEventListener('submit', guardarGuardia);

  document.getElementById('asoc-btn-notificar-medicos')
    ?.addEventListener('click', async () => {
      if (!trimestreActivo) { alert('Seleccioná un trimestre primero.'); return; }
      const btn = document.getElementById('asoc-btn-notificar-medicos');
      if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
      await supabase.functions.invoke('send-email', {
        body: { tipo: 'nuevas_guardias', trimestre_id: trimestreActivo.id,
                asociacion_id: perfil?.asociacion_id ?? null },
      }).catch(() => {});
      if (btn) { btn.disabled = false; btn.textContent = 'Notificar médicos'; }
      alert('Notificación enviada a los médicos activos.');
    });

  document.getElementById('asoc-g-whitelist-toggle')
    ?.addEventListener('change', async function() {
      const box = document.getElementById('asoc-g-whitelist-box');
      if (box) box.classList.toggle('hidden', !this.checked);
      if (this.checked) await cargarMedicosEnWhitelist('asoc-g-whitelist-chips', []);
    });

  // Trimestres
  document.getElementById('asoc-btn-nuevo-trimestre')
    ?.addEventListener('click', () => abrirFormTrimestre());
  document.getElementById('asoc-form-trimestre')
    ?.addEventListener('submit', guardarTrimestre);
}

function mostrarSeccion(nombre) {
  document.querySelectorAll('.asoc-seccion').forEach(s => s.classList.add('hidden'));
  document.getElementById(`asoc-sec-${nombre}`)?.classList.remove('hidden');

  document.querySelectorAll('.nav-item[data-seccion]').forEach(item => {
    item.classList.toggle('activo', item.dataset.seccion === nombre);
  });
  document.querySelectorAll('.asoc-nav-mobile[data-seccion]').forEach(btn => {
    btn.classList.toggle('text-primary',  btn.dataset.seccion === nombre);
    btn.classList.toggle('text-ink-mute', btn.dataset.seccion !== nombre);
  });

  if (nombre === 'medicos')    renderizarMedicos();
  if (nombre === 'trimestres') renderizarTrimestresSeccion();
  if (nombre === 'sedes')      renderizarSedes();
  if (nombre === 'dashboard')  mostrarDashboardAsociacion();
}

function cerrarModal(id) {
  document.getElementById(id)?.classList.remove('visible');
}

// ── Carga inicial ─────────────────────────────────────────

async function cargarDatosIniciales() {
  const [
    { data: trims },
    { data: sedesData },
    { count: pendientes },
  ] = await Promise.all([
    supabase.from('trimestres').select('*').order('fecha_inicio', { ascending: false }),
    supabase.from('sedes').select('id, nombre, color_hex, activa').eq('activa', true).order('nombre'),
    supabase.from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('activo', false).eq('rol', 'medico'),
  ]);

  trimestresDisponibles = trims ?? [];
  sedes                 = sedesData ?? [];

  const badge = document.getElementById('asoc-badge-pendientes');
  if (badge && pendientes > 0) {
    badge.textContent = pendientes;
    badge.classList.remove('hidden');
  }

  if (!trimestresDisponibles.length) {
    document.getElementById('asoc-tabla-cargando').innerHTML =
      '<p class="text-ink-mute">No hay trimestres. Creá uno en la sección Trimestres.</p>';
    poblarFiltroDeSede();
    return;
  }

  const hoy = new Date().toISOString().slice(0, 10);
  trimestreActivo =
    trimestresDisponibles.find(t => t.fecha_inicio <= hoy && hoy <= t.fecha_fin) ??
    [...trimestresDisponibles].find(t => t.fecha_inicio > hoy) ??
    trimestresDisponibles[0];

  const sel = document.getElementById('asoc-sel-trimestre');
  if (sel) {
    sel.innerHTML = trimestresDisponibles.map(t =>
      `<option value="${t.id}" ${t.id === trimestreActivo.id ? 'selected' : ''}>${t.display_id || t.nombre}</option>`
    ).join('');
  }

  poblarFiltroDeSede();
  actualizarInfoTrimestre();
  await recargarGuardias();
}

function poblarFiltroDeSede() {
  const sel = document.getElementById('asoc-fil-sede');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas las sedes</option>' +
    sedes.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
}

function actualizarInfoTrimestre() {
  const el = document.getElementById('asoc-info-trimestre');
  if (!el || !trimestreActivo) return;
  const abierto = trimestreActivo.inscripciones_abiertas;
  el.innerHTML = `
    <div class="text-xs font-semibold text-ink uppercase tracking-wider mb-1">Trimestre activo</div>
    <div class="text-sm font-medium text-ink">${escapeHtml(trimestreActivo.nombre)}</div>
    <div class="mt-1">
      <span class="badge ${abierto ? 'badge-ok' : 'badge-warn'}">
        Inscripciones ${abierto ? 'abiertas' : 'cerradas'}
      </span>
    </div>
  `;
}

// ── Guardias ──────────────────────────────────────────────

async function recargarGuardias() {
  if (!trimestreActivo) return;
  document.getElementById('asoc-tabla-cargando')?.classList.remove('hidden');
  document.getElementById('asoc-tabla-wrap')?.classList.add('hidden');
  document.getElementById('asoc-tabla-vacia')?.classList.add('hidden');

  const { data } = await supabase
    .from('guardias_con_cupos')
    .select('*')
    .eq('trimestre_id', trimestreActivo.id)
    .order('fecha');

  guardiasTrimestre = data ?? [];
  renderizarStats();
  renderizarTablaGuardias();
}

function renderizarStats() {
  const el = document.getElementById('asoc-stats');
  if (!el) return;
  const total      = guardiasTrimestre.length;
  const totalCupos = guardiasTrimestre.reduce((s, g) => s + g.cupos_totales, 0);
  const ocupados   = guardiasTrimestre.reduce((s, g) => s + g.cupos_ocupados, 0);
  const sinCubrir  = guardiasTrimestre.filter(g => g.cupos_ocupados === 0).length;
  const pct        = totalCupos > 0 ? Math.round((ocupados / totalCupos) * 100) : 0;

  el.innerHTML = [
    ['Guardias', total,     'text-ink'],
    ['Cupos cubiertos', `${pct}%`, 'text-primary'],
    ['Inscripciones', ocupados, 'text-ink'],
    ['Sin inscriptos', sinCubrir, sinCubrir > 0 ? 'text-bad' : 'text-ink'],
  ].map(([label, val, cls]) => `
    <div class="bg-surface border border-line rounded-xl p-5">
      <div class="text-xs text-ink-mute uppercase tracking-wider">${label}</div>
      <div class="font-display text-3xl mt-1 ${cls}">${val}</div>
    </div>`).join('');
}

function renderizarTablaGuardias() {
  const sedeId   = document.getElementById('asoc-fil-sede')?.value ?? '';
  const filtradas = sedeId
    ? guardiasTrimestre.filter(g => g.sede_id === sedeId)
    : guardiasTrimestre;

  const cargando = document.getElementById('asoc-tabla-cargando');
  const wrap     = document.getElementById('asoc-tabla-wrap');
  const vacia    = document.getElementById('asoc-tabla-vacia');
  const tbody    = document.getElementById('asoc-tabla-body');

  cargando?.classList.add('hidden');

  if (!filtradas.length) {
    wrap?.classList.add('hidden');
    vacia?.classList.remove('hidden');
    seleccionadasIds.clear();
    actualizarBulkBar();
    return;
  }

  wrap?.classList.remove('hidden');
  vacia?.classList.add('hidden');

  const hoy = new Date().toISOString().slice(0, 10);

  if (tbody) {
    tbody.innerHTML = filtradas.map(g => {
      const pasada  = g.fecha < hoy;
      const seleccionada = seleccionadasIds.has(g.id);
      const pct = g.cupos_totales > 0 ? Math.round(g.cupos_ocupados / g.cupos_totales * 100) : 0;

      let estadoBadge;
      if (pasada)                             estadoBadge = '<span class="badge">Pasada</span>';
      else if (!g.inscripciones_abiertas)     estadoBadge = '<span class="badge badge-warn">Cerrada</span>';
      else if (g.cupos_libres === 0)          estadoBadge = '<span class="badge badge-info">Sin cupo</span>';
      else                                    estadoBadge = '<span class="badge badge-ok">Abierta</span>';

      return `
        <tr class="table-row ${seleccionada ? 'bg-accent-soft' : ''}">
          <td class="px-3 py-3">
            <input type="checkbox" class="w-4 h-4 rounded accent-primary cursor-pointer asoc-chk-guardia"
                   data-guardia-id="${g.id}" ${seleccionada ? 'checked' : ''}/>
          </td>
          <td class="px-5 py-3 font-medium whitespace-nowrap">${fechaTabla(g.fecha)}</td>
          <td class="px-5 py-3">
            <span class="inline-flex items-center gap-1.5">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style="background:${g.sede_color ?? '#8a948f'}"></span>
              <span class="font-medium">${escapeHtml(g.sede_nombre)}</span>
            </span>
            <div class="text-xs text-ink-mute">${escapeHtml(g.servicio)}</div>
          </td>
          <td class="px-5 py-3 text-ink-soft whitespace-nowrap">
            ${formatearHora(g.hora_inicio)} · ${g.duracion_horas}h
          </td>
          <td class="px-5 py-3">
            <span class="text-ink-soft">${g.cupos_ocupados}/${g.cupos_totales}</span>
            <div class="w-16 h-1.5 bg-line rounded-full mt-1 overflow-hidden">
              <div class="h-full rounded-full bg-primary" style="width:${pct}%"></div>
            </div>
          </td>
          <td class="px-5 py-3">${estadoBadge}</td>
          <td class="px-5 py-3">
            <div class="flex gap-2 justify-end">
              <button class="btn-ghost text-xs"
                      data-accion-guardia="inscriptos" data-guardia-id="${g.id}">
                Ver inscriptos
              </button>
              <button class="btn-ghost text-xs"
                      data-accion-guardia="editar" data-guardia-id="${g.id}">
                Editar
              </button>
              <button class="btn-ghost text-xs text-bad hover:!bg-red-50 hover:!border-red-200"
                      data-accion-guardia="eliminar" data-guardia-id="${g.id}">
                Eliminar
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  tbody?.querySelectorAll('.asoc-chk-guardia').forEach(chk => {
    chk.addEventListener('change', () => {
      if (chk.checked) seleccionadasIds.add(chk.dataset.guardiaId);
      else             seleccionadasIds.delete(chk.dataset.guardiaId);
      actualizarBulkBar();
    });
  });

  document.getElementById('asoc-chk-todos')?.addEventListener('change', (e) => {
    const nuevos = filtradas.map(g => g.id);
    if (e.target.checked) nuevos.forEach(id => seleccionadasIds.add(id));
    else                  nuevos.forEach(id => seleccionadasIds.delete(id));
    renderizarTablaGuardias();
  });

  tbody?.querySelectorAll('[data-accion-guardia]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const g = guardiasTrimestre.find(x => x.id === btn.dataset.guardiaId);
      if (!g) return;
      if (btn.dataset.accionGuardia === 'inscriptos') await abrirModalInscriptos(g);
      if (btn.dataset.accionGuardia === 'editar')     abrirFormGuardia(g);
      if (btn.dataset.accionGuardia === 'eliminar')   await confirmarEliminarGuardia(g);
    });
  });

  actualizarBulkBar();
}

function actualizarBulkBar() {
  const bar   = document.getElementById('asoc-bulk-bar');
  const count = document.getElementById('asoc-bulk-count');
  if (!bar) return;
  if (seleccionadasIds.size > 0) {
    bar.classList.remove('hidden');
    if (count) count.textContent = `${seleccionadasIds.size} guardia${seleccionadasIds.size > 1 ? 's' : ''} seleccionada${seleccionadasIds.size > 1 ? 's' : ''}`;
  } else {
    bar.classList.add('hidden');
  }
}

async function cargarMedicosEnWhitelist(chipsId, seleccionados = []) {
  const container = document.getElementById(chipsId);
  if (!container) return;
  if (!medicosWhitelistCache) {
    const { data } = await supabase
      .from('profiles')
      .select('id, nombre, apellido, matricula')
      .eq('rol', 'medico')
      .eq('activo', true)
      .order('apellido');
    medicosWhitelistCache = data ?? [];
  }
  const BASE = 'wl-chip inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer select-none';
  container.innerHTML = medicosWhitelistCache.map(m => {
    const on = seleccionados.includes(m.id);
    const cls = on ? 'border-primary bg-accent-soft text-primary' : 'border-line text-ink-mute bg-surface hover:border-primary hover:text-primary';
    return `<button type="button" class="${BASE} ${cls}" data-medico-id="${m.id}" data-selected="${on}">
      ${escapeHtml(m.apellido)}, ${escapeHtml(m.nombre)} — Mat. ${escapeHtml(m.matricula || '')}
    </button>`;
  }).join('');
  container.querySelectorAll('.wl-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const was = chip.dataset.selected === 'true';
      chip.dataset.selected = (!was).toString();
      chip.classList.toggle('border-primary', !was);
      chip.classList.toggle('bg-accent-soft', !was);
      chip.classList.toggle('text-primary', !was);
      chip.classList.toggle('border-line', was);
      chip.classList.toggle('text-ink-mute', was);
      chip.classList.toggle('bg-surface', was);
    });
  });
}

async function abrirFormGuardia(g = null) {
  guardiaEditando = g;
  document.getElementById('asoc-modal-guardia-titulo').textContent =
    g ? 'Editar guardia' : 'Nueva guardia';

  document.getElementById('asoc-g-fecha').value    = g?.fecha ?? '';
  document.getElementById('asoc-g-hora').value     = g?.hora_inicio?.slice(0, 5) ?? '08:00';
  document.getElementById('asoc-g-duracion').value = g?.duracion_horas ?? 24;
  document.getElementById('asoc-g-cupos').value    = g?.cupos_totales ?? 1;
  document.getElementById('asoc-g-servicio').value = g?.servicio ?? '';
  document.getElementById('asoc-g-notas').value    = g?.notas ?? '';

  const selSede = document.getElementById('asoc-g-sede');
  if (selSede) {
    selSede.innerHTML = '<option value="">— Seleccioná sede —</option>' +
      sedes.map(s => `<option value="${s.id}" ${g?.sede_id === s.id ? 'selected' : ''}>${s.nombre}</option>`).join('');
  }

  const selTrim = document.getElementById('asoc-g-trimestre');
  if (selTrim) {
    selTrim.innerHTML = trimestresDisponibles.map(t =>
      `<option value="${t.id}" ${(g?.trimestre_id ?? trimestreActivo?.id) === t.id ? 'selected' : ''}>${t.display_id || t.nombre}</option>`
    ).join('');
  }

  let whitelist = null;
  if (g) {
    const { data: gwl } = await supabase.from('guardias').select('medicos_permitidos').eq('id', g.id).single();
    whitelist = gwl?.medicos_permitidos ?? null;
  }
  const wlToggle  = document.getElementById('asoc-g-whitelist-toggle');
  const wlBox     = document.getElementById('asoc-g-whitelist-box');
  const wlChips   = document.getElementById('asoc-g-whitelist-chips');
  if (wlToggle) wlToggle.checked = !!(whitelist?.length);
  if (wlBox) wlBox.classList.toggle('hidden', !(whitelist?.length));
  if (whitelist?.length) {
    await cargarMedicosEnWhitelist('asoc-g-whitelist-chips', whitelist);
  } else if (wlChips) {
    wlChips.innerHTML = '';
  }

  const err = document.getElementById('asoc-err-guardia');
  if (err) err.classList.remove('visible');
  document.getElementById('asoc-modal-guardia').classList.add('visible');
}

async function guardarGuardia(e) {
  e.preventDefault();
  const fecha     = document.getElementById('asoc-g-fecha').value;
  const hora      = document.getElementById('asoc-g-hora').value;
  const duracion  = parseInt(document.getElementById('asoc-g-duracion').value);
  const cupos     = parseInt(document.getElementById('asoc-g-cupos').value);
  const sede_id   = document.getElementById('asoc-g-sede').value;
  const servicio  = document.getElementById('asoc-g-servicio').value.trim();
  const trim_id   = document.getElementById('asoc-g-trimestre').value;
  const notas     = document.getElementById('asoc-g-notas').value.trim();
  const errEl     = document.getElementById('asoc-err-guardia');
  const wlToggle = document.getElementById('asoc-g-whitelist-toggle');
  const medicos_permitidos = wlToggle?.checked
    ? Array.from(document.querySelectorAll('#asoc-g-whitelist-chips .wl-chip[data-selected="true"]')).map(el => el.dataset.medicoId)
    : null;

  if (!fecha || !hora || !sede_id || !servicio || !trim_id || isNaN(duracion) || isNaN(cupos)) {
    if (errEl) { errEl.textContent = 'Completá todos los campos obligatorios.'; errEl.classList.add('visible'); }
    return;
  }
  if (errEl) errEl.classList.remove('visible');

  setCargando('asoc-btn-guardar-guardia', 'asoc-spin-guardia', 'asoc-txt-guardia', true);

  const campos = {
    fecha, hora_inicio: hora, duracion_horas: duracion, cupos_totales: cupos,
    sede_id, servicio, trimestre_id: trim_id, notas: notas || null,
    medicos_permitidos: medicos_permitidos?.length ? medicos_permitidos : null,
    creado_por: perfil.id,
  };

  let error;
  if (guardiaEditando) {
    delete campos.creado_por;
    ({ error } = await supabase.from('guardias').update(campos).eq('id', guardiaEditando.id));
  } else {
    ({ error } = await supabase.from('guardias').insert([campos]));
  }

  setCargando('asoc-btn-guardar-guardia', 'asoc-spin-guardia', 'asoc-txt-guardia', false);

  if (error) {
    if (errEl) { errEl.textContent = 'Error al guardar: ' + error.message; errEl.classList.add('visible'); }
    return;
  }

  cerrarModal('asoc-modal-guardia');
  await recargarGuardias();
}

async function confirmarEliminarGuardia(g) {
  if (!confirm(`¿Eliminar la guardia del ${g.fecha} en ${g.sede_nombre}?`)) return;
  const { error } = await supabase.from('guardias').delete().eq('id', g.id);
  if (error) { alert('Error al eliminar: ' + error.message); return; }
  seleccionadasIds.delete(g.id);
  await recargarGuardias();
}

async function eliminarGuardiasSeleccionadas() {
  if (!seleccionadasIds.size) return;
  if (!confirm(`¿Eliminar ${seleccionadasIds.size} guardia(s) seleccionada(s)?`)) return;
  const ids = [...seleccionadasIds];
  const { error } = await supabase.from('guardias').delete().in('id', ids);
  if (error) { alert('Error al eliminar: ' + error.message); return; }
  seleccionadasIds.clear();
  await recargarGuardias();
}

async function abrirModalInscriptos(g) {
  guardiaInscriptosActual = g;
  const modal    = document.getElementById('asoc-modal-inscriptos');
  const contenido = document.getElementById('asoc-inscriptos-contenido');
  const titulo   = document.getElementById('asoc-modal-inscriptos-titulo');

  if (titulo) titulo.textContent = `Inscriptos — ${g.sede_nombre}, ${fechaTabla(g.fecha)}`;
  if (contenido) contenido.innerHTML = '<div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>';
  modal?.classList.add('visible');

  const medicos = await obtenerMedicosDeGuardia(g.id);
  if (!Array.isArray(medicos)) {
    if (contenido) contenido.innerHTML = '<p class="text-bad py-4">Error al cargar inscriptos.</p>';
    return;
  }

  renderizarInscriptos(medicos, g, contenido);
}

function renderizarInscriptos(medicos, guardia, contenido) {
  if (!medicos.length) {
    contenido.innerHTML = '<div class="py-8 text-center text-ink-mute text-sm">Sin inscriptos todavía.</div>';
    return;
  }

  contenido.innerHTML = `
    <div class="bg-surface border border-line rounded-xl divide-y divide-[var(--line)]">
      ${medicos.map(m => `
        <div class="p-4 flex items-center justify-between gap-3 flex-wrap" data-insc-id="${m.inscripcion_id}">
          <div>
            <div class="font-medium text-sm">${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}</div>
            <div class="text-xs text-ink-mute">
              ${escapeHtml(m.matricula)} · ${escapeHtml(m.especialidad)}
              ${m.telefono ? ' · ' + escapeHtml(m.telefono) : ''}
            </div>
            <div class="text-xs text-ink-mute mt-0.5">
              <span class="badge ${m.estado === 'asignada_admin' ? 'badge-warn' : 'badge-ok'}">
                ${m.estado === 'asignada_admin' ? 'Asignado' : 'Confirmado'}
              </span>
            </div>
          </div>
          <button class="text-xs text-bad hover:underline btn-cancelar-insc"
                  data-insc-id="${m.inscripcion_id}"
                  data-medico-nombre="${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}">
            Cancelar inscripción
          </button>
        </div>`).join('')}
    </div>`;

  contenido.querySelectorAll('.btn-cancelar-insc').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Cancelar la inscripción de ${btn.dataset.medicoNombre}?`)) return;
      btn.disabled    = true;
      btn.textContent = 'Cancelando…';
      const res = await cancelarInscripcion(btn.dataset.inscId);
      if (!res?.ok) {
        alert('Error: ' + traducirCod(res?.codigo));
        btn.disabled = false; btn.textContent = 'Cancelar inscripción';
        return;
      }
      const nuevosMedicos = await obtenerMedicosDeGuardia(guardiaInscriptosActual.id);
      renderizarInscriptos(nuevosMedicos ?? [], guardiaInscriptosActual, contenido);
      await recargarGuardias();
    });
  });
}

// ── Médicos ───────────────────────────────────────────────

function renderizarMedicos() {
  const contenedor = document.getElementById('asoc-medicos-contenido');
  if (!contenedor) return;
  cargarYMostrarMedicos(contenedor);
}

async function cargarYMostrarMedicos(contenedor) {
  if (!cacheMedicos) {
    contenedor.innerHTML = '<div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>';
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nombre, apellido, matricula, especialidad, telefono, activo, creado_en')
      .eq('rol', 'medico')
      .order('creado_en', { ascending: false });
    if (error) {
      contenedor.innerHTML = '<p class="text-bad py-8 text-center">Error al cargar médicos.</p>';
      return;
    }
    cacheMedicos = data ?? [];
  }

  const pendientes = cacheMedicos.filter(m => !m.activo);
  const activos    = cacheMedicos.filter(m =>  m.activo);

  const badge = document.getElementById('asoc-badge-pendientes');
  if (badge) {
    if (pendientes.length > 0) {
      badge.textContent = pendientes.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  let html = '';

  if (pendientes.length) {
    html += `
      <div class="mb-8">
        <div class="text-xs uppercase tracking-widest text-ink-mute mb-3 font-semibold">
          Solicitudes pendientes (${pendientes.length})
        </div>
        <div class="bg-surface border border-line rounded-xl divide-y divide-[var(--line)]">
          ${pendientes.map(m => `
            <div class="p-4 flex items-center justify-between flex-wrap gap-3">
              <div>
                <div class="font-medium text-sm">${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}</div>
                <div class="text-xs text-ink-mute">
                  ${escapeHtml(m.matricula)} · ${escapeHtml(m.especialidad)}
                  ${m.telefono ? ' · ' + escapeHtml(m.telefono) : ''}
                </div>
              </div>
              <div class="flex gap-2">
                <button class="btn-ghost text-xs text-bad hover:!bg-red-50 hover:!border-red-200"
                  data-accion-medico="rechazar" data-medico-id="${m.id}"
                  data-medico-nombre="${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}">Rechazar</button>
                <button class="btn-primary text-xs"
                  data-accion-medico="aprobar" data-medico-id="${m.id}"
                  data-medico-nombre="${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}">Aprobar</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  if (activos.length) {
    html += `
      <div>
        <div class="text-xs uppercase tracking-widest text-ink-mute mb-3 font-semibold">
          Médicos activos (${activos.length})
        </div>
        <div class="bg-surface border border-line rounded-xl overflow-hidden">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-xs uppercase tracking-wider text-ink-mute border-b border-line">
                <th class="px-5 py-3">Nombre</th>
                <th class="px-5 py-3">Matrícula</th>
                <th class="px-5 py-3 hidden sm:table-cell">Especialidad</th>
                <th class="px-5 py-3 hidden md:table-cell">Teléfono</th>
                <th class="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              ${activos.map(m => `
                <tr class="table-row">
                  <td class="px-5 py-3 font-medium">${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}</td>
                  <td class="px-5 py-3 text-ink-soft">${escapeHtml(m.matricula)}</td>
                  <td class="px-5 py-3 text-ink-soft hidden sm:table-cell">${escapeHtml(m.especialidad)}</td>
                  <td class="px-5 py-3 text-ink-soft hidden md:table-cell">${escapeHtml(m.telefono ?? '—')}</td>
                  <td class="px-5 py-3 text-right">
                    <button class="text-xs text-bad hover:underline"
                      data-accion-medico="desactivar" data-medico-id="${m.id}"
                      data-medico-nombre="${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}">
                      Dar de baja
                    </button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  if (!pendientes.length && !activos.length) {
    html = '<div class="py-16 text-center text-ink-mute text-sm">No hay médicos en tu asociación todavía.</div>';
  }

  contenedor.innerHTML = html;

  contenedor.querySelectorAll('[data-accion-medico]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = btn.dataset.medicoId;
      const nombre = btn.dataset.medicoNombre;
      const accion = btn.dataset.accionMedico;

      if (accion === 'aprobar') {
        btn.disabled = true; btn.textContent = 'Aprobando…';
        const { error } = await supabase.from('profiles').update({ activo: true }).eq('id', id);
        if (error) { alert('Error: ' + error.message); btn.disabled = false; btn.textContent = 'Aprobar'; return; }
        cacheMedicos = null;
        await cargarYMostrarMedicos(contenedor);

      } else if (accion === 'rechazar') {
        if (!confirm(`¿Rechazar la solicitud de ${nombre}? La cuenta quedará inactiva.`)) return;
        btn.disabled = true; btn.textContent = 'Procesando…';
        const { error: errRech } = await supabase.from('profiles')
          .update({ asociacion_id: null, activo: false }).eq('id', id);
        if (errRech) { alert('Error: ' + errRech.message); btn.disabled = false; btn.textContent = 'Rechazar'; return; }
        cacheMedicos = null;
        await cargarYMostrarMedicos(contenedor);

      } else if (accion === 'desactivar') {
        if (!confirm(`¿Dar de baja a ${nombre}?`)) return;
        btn.disabled = true; btn.textContent = 'Procesando…';
        const { error } = await supabase.from('profiles').update({ activo: false }).eq('id', id);
        if (error) { alert('Error: ' + error.message); btn.disabled = false; btn.textContent = 'Dar de baja'; return; }
        cacheMedicos = null;
        await cargarYMostrarMedicos(contenedor);
      }
    });
  });
}

// ── Trimestres ────────────────────────────────────────────

function renderizarTrimestresSeccion() {
  const contenedor = document.getElementById('asoc-trimestres-contenido');
  if (!contenedor) return;
  mostrarTrimestres(contenedor);
}

function mostrarTrimestres(contenedor) {
  if (!trimestresDisponibles.length) {
    contenedor.innerHTML = `
      <div class="text-center py-16 text-ink-mute text-sm">
        No hay trimestres. Creá el primero con el botón de arriba.
      </div>`;
    return;
  }

  contenedor.innerHTML = `
    <div class="space-y-4">
      ${trimestresDisponibles.map(t => `
        <div class="bg-surface border border-line rounded-xl p-5">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div class="font-semibold text-ink">${escapeHtml(t.nombre)}</div>
              <div class="text-xs text-ink-mute mt-0.5">
                ${t.fecha_inicio} → ${t.fecha_fin} · Máx. ${t.max_guardias_por_medico} guardias/médico
              </div>
              <div class="text-xs text-ink-mute mt-0.5">ID: ${escapeHtml(t.display_id || t.id)}</div>
            </div>
            <div class="flex items-center gap-2 flex-wrap">
              <button
                class="badge cursor-pointer hover:opacity-80 transition-opacity select-none
                       ${t.inscripciones_abiertas ? 'badge-ok' : 'badge-warn'}"
                data-accion-trim="toggle" data-trim-id="${t.id}"
                data-trim-abierto="${t.inscripciones_abiertas}">
                ${t.inscripciones_abiertas ? 'Inscripciones abiertas' : 'Inscripciones cerradas'}
              </button>
              <button class="btn-ghost text-xs"
                data-accion-trim="editar" data-trim-id="${t.id}">Editar</button>
              <button class="btn-ghost text-xs text-bad hover:!bg-red-50 hover:!border-red-200"
                data-accion-trim="eliminar" data-trim-id="${t.id}">Eliminar</button>
            </div>
          </div>
        </div>`).join('')}
    </div>`;

  contenedor.querySelectorAll('[data-accion-trim]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const t = trimestresDisponibles.find(x => x.id === btn.dataset.trimId);
      if (!t) return;

      if (btn.dataset.accionTrim === 'editar') {
        abrirFormTrimestre(t);

      } else if (btn.dataset.accionTrim === 'toggle') {
        const nuevoValor = btn.dataset.trimAbierto === 'true' ? false : true;
        btn.disabled = true;
        const { error } = await supabase.from('trimestres')
          .update({ inscripciones_abiertas: nuevoValor }).eq('id', t.id);
        if (error) { alert('Error: ' + error.message); btn.disabled = false; return; }
        if (nuevoValor) {
          supabase.functions.invoke('send-email', {
            body: { tipo: 'inscripciones_abiertas', trimestre_id: t.id,
                    asociacion_id: perfil?.asociacion_id ?? null },
          }).catch(() => {});
        }
        await recargarTrimestres(contenedor);

      } else if (btn.dataset.accionTrim === 'eliminar') {
        if (!confirm(`¿Eliminar el trimestre "${t.nombre}"?\nSi tiene guardias, la eliminación será rechazada.`)) return;
        const { error } = await supabase.from('trimestres').delete().eq('id', t.id);
        if (error) {
          alert('No se pudo eliminar: ' + (error.message.includes('foreign')
            ? 'El trimestre tiene guardias asignadas.'
            : error.message));
          return;
        }
        await recargarTrimestres(contenedor);
      }
    });
  });
}

async function recargarTrimestres(contenedor) {
  const { data } = await supabase
    .from('trimestres').select('*').order('fecha_inicio', { ascending: false });
  trimestresDisponibles = data ?? [];

  const sel = document.getElementById('asoc-sel-trimestre');
  if (sel) {
    sel.innerHTML = trimestresDisponibles.map(t =>
      `<option value="${t.id}" ${t.id === trimestreActivo?.id ? 'selected' : ''}>${t.display_id || t.nombre}</option>`
    ).join('');
  }
  trimestreActivo = trimestresDisponibles.find(t => t.id === trimestreActivo?.id)
    ?? trimestresDisponibles[0];
  actualizarInfoTrimestre();
  mostrarTrimestres(contenedor);
}

function abrirFormTrimestre(trim = null) {
  trimestreEditando = trim;
  document.getElementById('asoc-modal-trimestre-titulo').textContent =
    trim ? 'Editar trimestre' : 'Nuevo trimestre';

  const idInput = document.getElementById('asoc-t-id');
  idInput.value    = trim?.display_id ?? '';
  idInput.disabled = false;

  document.getElementById('asoc-t-nombre').value = trim?.nombre ?? '';
  document.getElementById('asoc-t-inicio').value = trim?.fecha_inicio ?? '';
  document.getElementById('asoc-t-fin').value    = trim?.fecha_fin ?? '';
  document.getElementById('asoc-t-max').value    = trim?.max_guardias_por_medico ?? 12;

  const err = document.getElementById('asoc-err-trimestre');
  if (err) err.classList.remove('visible');
  document.getElementById('asoc-modal-trimestre').classList.add('visible');
}

async function guardarTrimestre(e) {
  e.preventDefault();
  const displayId = document.getElementById('asoc-t-id').value.trim();
  const nombre    = document.getElementById('asoc-t-nombre').value.trim();
  const inicio    = document.getElementById('asoc-t-inicio').value;
  const fin       = document.getElementById('asoc-t-fin').value;
  const max       = parseInt(document.getElementById('asoc-t-max').value);
  const errEl     = document.getElementById('asoc-err-trimestre');

  if (!displayId || !nombre || !inicio || !fin || isNaN(max) || max < 1) {
    if (errEl) { errEl.textContent = 'Completá todos los campos.'; errEl.classList.add('visible'); }
    return;
  }
  if (fin <= inicio) {
    if (errEl) { errEl.textContent = 'La fecha fin debe ser posterior a la fecha inicio.'; errEl.classList.add('visible'); }
    return;
  }
  if (errEl) errEl.classList.remove('visible');

  setCargando('asoc-btn-guardar-trimestre', 'asoc-spin-trimestre', 'asoc-txt-trimestre', true);

  let error;
  if (trimestreEditando) {
    ({ error } = await supabase.from('trimestres')
      .update({ display_id: displayId, nombre, fecha_inicio: inicio, fecha_fin: fin,
                max_guardias_por_medico: max })
      .eq('id', trimestreEditando.id));
  } else {
    ({ error } = await supabase.from('trimestres')
      .insert([{
        id: crypto.randomUUID(),
        display_id: displayId,
        nombre, fecha_inicio: inicio, fecha_fin: fin,
        max_guardias_por_medico: max, inscripciones_abiertas: false,
        asociacion_id: perfil.asociacion_id,
      }]));
  }

  setCargando('asoc-btn-guardar-trimestre', 'asoc-spin-trimestre', 'asoc-txt-trimestre', false);

  if (error) {
    const msg = error.message.includes('duplicate')
      ? 'Ya existe un trimestre con ese identificador para esta asociación.'
      : 'Error al guardar: ' + error.message;
    if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
    return;
  }

  cerrarModal('asoc-modal-trimestre');
  const contenedor = document.getElementById('asoc-trimestres-contenido');
  await recargarTrimestres(contenedor);
}

// ── Sedes (solo lectura) ──────────────────────────────────

function renderizarSedes() {
  const contenedor = document.getElementById('asoc-sedes-contenido');
  if (!contenedor) return;

  if (!sedes.length) {
    contenedor.innerHTML = `
      <div class="text-center py-16 text-ink-mute text-sm">
        No hay sedes asignadas a tu asociación. Contactá al administrador.
      </div>`;
    return;
  }

  contenedor.innerHTML = `
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${sedes.map(s => `
        <div class="bg-surface border border-line rounded-xl p-5">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-3 h-3 rounded-full flex-shrink-0"
                 style="background:${s.color_hex ?? '#8a948f'}"></div>
            <div class="font-semibold text-ink truncate">${escapeHtml(s.nombre)}</div>
          </div>
          <div class="text-xs text-ink-mute">
            <span class="badge badge-ok">Activa</span>
          </div>
        </div>`).join('')}
    </div>`;
}

// ── SVG Icons ─────────────────────────────────────────────

function svgSalir(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>`;
}

function svgGuardias(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>`;
}

function svgPersonas(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>`;
}

function svgEdificio(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>`;
}

function svgCalendario(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>`;
}

function svgChart(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="20" x2="18" y2="10"/>
    <line x1="12" y1="20" x2="12" y2="4"/>
    <line x1="6" y1="20" x2="6" y2="14"/>
  </svg>`;
}

// ── Dashboard de asociación ───────────────────────────────

const MESES_C_DASH = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

let dashCharts = [];

function statCardAsoc(titulo, valor, subtitulo, clsValor = 'text-ink') {
  return `
    <div class="bg-surface border border-line rounded-xl p-5">
      <div class="text-xs uppercase tracking-wider text-ink-mute font-semibold">${titulo}</div>
      <div class="font-display text-3xl mt-2 mb-1 ${clsValor}">${valor}</div>
      <div class="text-xs text-ink-mute">${subtitulo}</div>
    </div>`;
}

async function mostrarDashboardAsociacion() {
  const contenido = document.getElementById('asoc-dash-contenido');
  if (!contenido) return;
  contenido.innerHTML = '<div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>';

  dashCharts.forEach(c => c.destroy());
  dashCharts = [];

  if (!trimestreActivo) {
    contenido.innerHTML = '<div class="py-16 text-center text-ink-mute text-sm">No hay trimestre activo.</div>';
    return;
  }

  const guardias = guardiasTrimestre; // ya cargado y scoped por RLS
  if (!guardias.length) {
    contenido.innerHTML = '<div class="py-16 text-center text-ink-mute text-sm">No hay guardias en este trimestre.</div>';
    return;
  }

  const totalGuardias = guardias.length;
  const totalCupos    = guardias.reduce((s, g) => s + g.cupos_totales,  0);
  const ocupados      = guardias.reduce((s, g) => s + g.cupos_ocupados, 0);
  const sinCubrir     = guardias.filter(g => g.cupos_ocupados === 0);
  const pct           = totalCupos > 0 ? Math.round(ocupados / totalCupos * 100) : 0;

  // Agrupaciones para charts
  const porMes = {};
  guardias.forEach(g => {
    const mes = g.fecha.slice(0, 7);
    porMes[mes] = (porMes[mes] ?? 0) + 1;
  });

  const porSede = {};
  guardias.forEach(g => {
    if (!porSede[g.sede_nombre])
      porSede[g.sede_nombre] = { totales: 0, ocupados: 0, color: g.color_hex ?? '#8a948f' };
    porSede[g.sede_nombre].totales  += g.cupos_totales;
    porSede[g.sede_nombre].ocupados += g.cupos_ocupados;
  });

  const guardiaIds = guardias.map(g => g.id);

  const [{ data: inscripciones }, { data: medicos }, { data: perfilesMedico }] = await Promise.all([
    supabase.from('inscripciones')
      .select('medico_id, inscripto_en, guardia_id')
      .in('guardia_id', guardiaIds)
      .in('estado', ['confirmada', 'asignada_admin'])
      .order('inscripto_en'),
    supabase.from('profiles')
      .select('id, activo')
      .eq('rol', 'medico'),
    supabase.from('profiles')
      .select('id, nombre, apellido')
      .eq('rol', 'medico')
      .eq('activo', true),
  ]);

  const medicosActivos    = (medicos ?? []).filter(m =>  m.activo).length;
  const medicosPendientes = (medicos ?? []).filter(m => !m.activo).length;

  // Top médicos
  const medicoCount = {};
  (inscripciones ?? []).forEach(i => {
    medicoCount[i.medico_id] = (medicoCount[i.medico_id] ?? 0) + 1;
  });
  const perfilMap = Object.fromEntries((perfilesMedico ?? []).map(p => [p.id, `${p.nombre} ${p.apellido}`]));
  const topMedicos = Object.entries(medicoCount)
    .map(([id, count]) => ({ nombre: perfilMap[id] ?? 'Médico', count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Evolución de inscripciones por día
  const evolucion = {};
  (inscripciones ?? []).forEach(i => {
    const dia = (i.inscripto_en ?? '').slice(0, 10);
    if (dia) evolucion[dia] = (evolucion[dia] ?? 0) + 1;
  });
  const evoDias   = Object.keys(evolucion).sort();
  let acumulado = 0;
  const evoAcum = evoDias.map(d => { acumulado += evolucion[d]; return acumulado; });

  const mesesKeys   = Object.keys(porMes).sort();
  const mesesLabels = mesesKeys.map(m => MESES_C_DASH[parseInt(m.split('-')[1]) - 1]);
  const sedesNombres = Object.keys(porSede);

  const hoy = new Date().toISOString().slice(0, 10);

  contenido.innerHTML = `
    <!-- Stats cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
      ${statCardAsoc('Guardias', totalGuardias, 'en el trimestre activo')}
      ${statCardAsoc('Ocupación', pct + '%', 'de cupos cubiertos', pct >= 80 ? 'text-ok' : pct >= 50 ? 'text-primary' : 'text-bad')}
      ${statCardAsoc('Médicos activos', medicosActivos, medicosPendientes > 0 ? `${medicosPendientes} pendiente${medicosPendientes !== 1 ? 's' : ''}` : 'todos aprobados', medicosPendientes > 0 ? 'text-bad' : 'text-ink')}
      ${statCardAsoc('Sin cubrir', sinCubrir.length, 'guardias sin inscripto', sinCubrir.length > 0 ? 'text-bad' : 'text-ok')}
    </div>

    <!-- Charts fila 1 -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <div class="bg-surface border border-line rounded-xl p-5">
        <h3 class="font-medium text-sm text-ink mb-4">Guardias por mes</h3>
        <canvas id="asoc-chart-meses"></canvas>
      </div>
      <div class="bg-surface border border-line rounded-xl p-5">
        <h3 class="font-medium text-sm text-ink mb-4">Ocupación por sede</h3>
        <canvas id="asoc-chart-sedes"></canvas>
      </div>
    </div>

    <!-- Chart evolución -->
    <div class="bg-surface border border-line rounded-xl p-5 mb-6">
      <h3 class="font-medium text-sm text-ink mb-4">Evolución de inscripciones</h3>
      ${evoAcum.length === 0
        ? '<p class="text-ink-mute text-sm text-center py-6">Sin inscripciones aún.</p>'
        : '<canvas id="asoc-chart-evolucion"></canvas>'}
    </div>

    <!-- Fila inferior: top médicos + sin cubrir -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-surface border border-line rounded-xl p-5">
        <h3 class="font-medium text-sm text-ink mb-4">Top 5 médicos más activos</h3>
        ${topMedicos.length === 0
          ? '<p class="text-ink-mute text-sm text-center py-6">Sin inscripciones en este trimestre.</p>'
          : `<div class="space-y-1">
              ${topMedicos.map((m, i) => `
                <div class="flex items-center gap-3 py-2.5 ${i < topMedicos.length - 1 ? 'border-b border-line' : ''}">
                  <span class="w-6 h-6 rounded-full bg-accent-soft text-primary text-xs font-bold
                               flex items-center justify-center flex-shrink-0">${i + 1}</span>
                  <span class="flex-1 text-sm font-medium text-ink">${escapeHtml(m.nombre)}</span>
                  <span class="text-sm font-semibold text-primary">${m.count} guardia${m.count !== 1 ? 's' : ''}</span>
                </div>`).join('')}
             </div>`}
      </div>
      <div class="bg-surface border border-line rounded-xl p-5">
        <h3 class="font-medium text-sm text-ink mb-4">
          Guardias sin cubrir
          ${sinCubrir.length > 0 ? `<span class="badge badge-warn ml-2">${sinCubrir.length}</span>` : ''}
        </h3>
        ${sinCubrir.length === 0
          ? '<p class="text-ok text-sm text-center py-6">¡Todas las guardias tienen inscriptos!</p>'
          : `<div class="overflow-y-auto max-h-64">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-xs text-ink-mute uppercase tracking-wider border-b border-line">
                    <th class="py-2 text-left">Fecha</th>
                    <th class="py-2 text-left">Sede</th>
                    <th class="py-2 text-left">Servicio</th>
                  </tr>
                </thead>
                <tbody>
                  ${sinCubrir.slice(0, 20).filter(g => g.fecha >= hoy).map(g => `
                    <tr class="border-b border-line last:border-0">
                      <td class="py-2 font-medium">${g.fecha}</td>
                      <td class="py-2 text-ink-soft">${escapeHtml(g.sede_nombre ?? '')}</td>
                      <td class="py-2 text-ink-soft">${escapeHtml(g.servicio ?? '—')}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`}
      </div>
    </div>`;

  await asegurarChartJS();

  dashCharts.push(new window.Chart(document.getElementById('asoc-chart-meses'), {
    type: 'bar',
    data: {
      labels: mesesLabels,
      datasets: [{ label: 'Guardias', data: mesesKeys.map(m => porMes[m]),
                   backgroundColor: '#1e3a5f', borderRadius: 6 }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
    },
  }));

  dashCharts.push(new window.Chart(document.getElementById('asoc-chart-sedes'), {
    type: 'bar',
    data: {
      labels: sedesNombres,
      datasets: [
        { label: 'Ocupados',    data: sedesNombres.map(s => porSede[s].ocupados),
          backgroundColor: sedesNombres.map(s => porSede[s].color), borderRadius: 4 },
        { label: 'Disponibles', data: sedesNombres.map(s => porSede[s].totales - porSede[s].ocupados),
          backgroundColor: '#e8e4dc', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, indexAxis: 'y',
      plugins: { legend: { position: 'bottom' } },
      scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } },
    },
  }));

  if (evoAcum.length > 0) {
    dashCharts.push(new window.Chart(document.getElementById('asoc-chart-evolucion'), {
      type: 'line',
      data: {
        labels: evoDias,
        datasets: [{ label: 'Inscripciones acumuladas', data: evoAcum,
                     borderColor: '#1e3a5f', backgroundColor: 'rgba(30,58,95,0.08)',
                     fill: true, tension: 0.3, pointRadius: 3 }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
      },
    }));
  }
}
