// ============================================================
// admin.js — Panel del administrador
// ============================================================

import { supabase }     from './supabase-client.js';
import { cerrarSesion } from './auth.js';
import {
  formatearFechaLarga, formatearHora, iniciales, MESES, setCargando, escapeHtml,
} from './utils.js';
import {
  obtenerTrimestres, obtenerGuardiasTrimestre,
  obtenerSedes, obtenerProvincias, crearGuardia, actualizarGuardia, eliminarGuardia, eliminarGuardias,
} from './guardias.js';
import { cancelarInscripcion, obtenerMedicosDeGuardia } from './inscripciones.js';
import { exportarReporteAdmin } from './reportes.js';

// ── Helpers locales ───────────────────────────────────────

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

let perfil               = null;
let trimestresDisponibles = [];
let trimestreActivo      = null;
let guardiasTrimestre    = [];
let sedes                = [];
let provincias           = [];
let guardiaEditando      = null;
let sedeEditando         = null;
let trimestreEditando    = null;
let guardiaInscriptosActual = null;
let seleccionadasIds     = new Set();
let dashCharts           = [];
let asociaciones         = [];
let asociacionEditando   = null;
let perfilEditando       = null;
let medicosWhitelistCache = {};  // keyed by asociacion_id (or '__all__')
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

export async function iniciarAdmin(p) {
  perfil = p;
  renderizarShell();
  window.updateThemeIcons && window.updateThemeIcons();
  configurarEventos();
  await cargarDatosIniciales();
}

// ── Shell HTML ────────────────────────────────────────────

function renderizarShell() {
  const ini = iniciales(perfil.nombre, perfil.apellido);

  document.getElementById('vista-admin').innerHTML = `
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
          <button id="adm-btn-logout-mobile"
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
                ${perfil.nombre} ${perfil.apellido}
              </div>
              <div class="text-xs text-ink-mute">Administrador</div>
            </div>
            <button onclick="window.toggleTheme && window.toggleTheme()" class="theme-btn flex-shrink-0" aria-label="Cambiar tema"></button>
          </div>

          <nav class="mt-4 space-y-0.5">
            <div class="nav-item cursor-pointer select-none" data-seccion="dashboard">
              <span class="dot"></span> Dashboard
            </div>
            <div class="nav-item activo cursor-pointer select-none" data-seccion="guardias">
              <span class="dot"></span> Guardias
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="medicos">
              <span class="dot"></span> Médicos
              <span id="adm-badge-pendientes" class="ml-auto badge badge-warn hidden"></span>
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="sedes">
              <span class="dot"></span> Sedes
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="trimestres">
              <span class="dot"></span> Trimestres
            </div>
            <div class="nav-item cursor-pointer select-none" data-seccion="asociaciones">
              <span class="dot"></span> Asociaciones
            </div>
          </nav>

          <div id="adm-info-trimestre" class="mt-5 p-4 bg-accent-soft rounded-lg">
            <div class="text-xs font-semibold text-ink uppercase tracking-wider mb-1">
              Trimestre activo
            </div>
            <div class="text-sm text-ink-soft">Cargando…</div>
          </div>

          <div class="mt-4 pt-4 border-t border-line">
            <button id="adm-btn-logout"
              class="nav-item w-full cursor-pointer select-none hover:!text-bad hover:!bg-red-50">
              <span class="dot"></span> Cerrar sesión
            </button>
          </div>
        </aside>

        <!-- Contenido -->
        <div>

          <!-- SECCIÓN: Guardias -->
          <section id="adm-sec-guardias" class="adm-seccion">
            <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                  Panel administrador
                </div>
                <h1 class="font-display text-4xl">Guardias</h1>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <select id="adm-sel-trimestre" class="input !py-2 !text-sm !w-auto">
                  <option>Cargando…</option>
                </select>
                <select id="adm-fil-sede" class="input !py-2 !text-sm !w-auto">
                  <option value="">Todas las sedes</option>
                </select>
                <button id="adm-btn-notificar-medicos" class="btn-ghost text-sm whitespace-nowrap">
                  Notificar médicos
                </button>
                <button id="adm-btn-nueva-guardia" class="btn-primary text-sm whitespace-nowrap">
                  + Nueva guardia
                </button>
                <button id="adm-btn-descargar" class="btn-ghost text-sm whitespace-nowrap">
                  ↓ Excel
                </button>
              </div>
            </div>

            <!-- Stats -->
            <div id="adm-stats" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6"></div>

            <!-- Barra de acciones múltiples (oculta hasta seleccionar) -->
            <div id="adm-bulk-bar"
                 class="hidden mb-3 flex items-center justify-between gap-3
                         bg-surface border border-line rounded-xl px-5 py-3">
              <span id="adm-bulk-count" class="text-sm font-medium text-ink"></span>
              <div class="flex gap-2">
                <button id="adm-btn-deselect-all"
                        class="btn-ghost text-xs !py-1.5 !px-3">
                  Deseleccionar todo
                </button>
                <button id="adm-btn-eliminar-seleccion"
                        class="text-xs font-medium px-3 py-1.5 rounded-lg border
                               border-red-200 text-bad bg-red-50 hover:bg-red-100 transition-colors">
                  Eliminar seleccionadas
                </button>
              </div>
            </div>

            <!-- Tabla -->
            <div class="bg-surface border border-line rounded-xl overflow-hidden">
              <div id="adm-tabla-cargando" class="py-16 text-center text-ink-mute text-sm">
                Cargando guardias…
              </div>
              <div id="adm-tabla-wrap" class="hidden overflow-x-auto">
                <table class="w-full text-sm">
                  <thead>
                    <tr class="text-left text-xs uppercase tracking-wider text-ink-mute
                                border-b border-line">
                      <th class="px-3 py-3 w-10">
                        <input type="checkbox" id="adm-chk-todos"
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
                  <tbody id="adm-tabla-body"></tbody>
                </table>
              </div>
              <div id="adm-tabla-vacia"
                   class="hidden py-16 text-center text-ink-mute text-sm">
                No hay guardias para este trimestre.
                <button class="text-primary hover:underline ml-1" id="adm-btn-nueva-guardia-2">
                  Crear la primera.
                </button>
              </div>
            </div>
          </section>

          <!-- SECCIÓN: Dashboard -->
          <section id="adm-sec-dashboard" class="adm-seccion hidden">
            <div class="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-6">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                  Panel administrador
                </div>
                <h1 class="font-display text-4xl">Dashboard</h1>
              </div>
              <select id="adm-dash-trimestre" class="input !py-2 !text-sm !w-auto"></select>
            </div>
            <div id="adm-dash-contenido">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

          <!-- SECCIÓN: Médicos -->
          <section id="adm-sec-medicos" class="adm-seccion hidden">
            <div class="mb-6">
              <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                Panel administrador
              </div>
              <h1 class="font-display text-4xl">Médicos</h1>
            </div>
            <div id="adm-medicos-contenido">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

          <!-- SECCIÓN: Sedes -->
          <section id="adm-sec-sedes" class="adm-seccion hidden">
            <div class="flex items-end justify-between mb-6 gap-4">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                  Panel administrador
                </div>
                <h1 class="font-display text-4xl">Sedes</h1>
              </div>
              <button id="adm-btn-nueva-sede" class="btn-primary text-sm">+ Nueva sede</button>
            </div>
            <div id="adm-sedes-contenido">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

          <!-- SECCIÓN: Trimestres -->
          <section id="adm-sec-trimestres" class="adm-seccion hidden">
            <div class="flex items-end justify-between mb-6 gap-4">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                  Panel administrador
                </div>
                <h1 class="font-display text-4xl">Trimestres</h1>
              </div>
              <button id="adm-btn-nuevo-trimestre" class="btn-primary text-sm">
                + Nuevo trimestre
              </button>
            </div>
            <div id="adm-trimestres-contenido">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

          <!-- SECCIÓN: Asociaciones -->
          <section id="adm-sec-asociaciones" class="adm-seccion hidden">
            <div class="flex items-end justify-between mb-6 gap-4">
              <div>
                <div class="text-xs uppercase tracking-[0.18em] text-ink-mute font-semibold mb-1">
                  Panel administrador
                </div>
                <h1 class="font-display text-4xl">Asociaciones</h1>
              </div>
              <button id="adm-btn-nueva-asociacion" class="btn-primary text-sm">
                + Nueva asociación
              </button>
            </div>
            <div id="adm-asociaciones-contenido">
              <div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>
            </div>
          </section>

        </div>
      </div>

      <!-- Nav mobile -->
      <nav class="lg:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-line
                  grid grid-cols-6 z-40">
        <button class="adm-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-ink-mute" data-seccion="dashboard">
          ${svgChart(18)} Dashboard
        </button>
        <button class="adm-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-primary" data-seccion="guardias">
          ${svgGuardias(18)} Guardias
        </button>
        <button class="adm-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-ink-mute" data-seccion="medicos">
          ${svgPersonas(18)} Médicos
        </button>
        <button class="adm-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-ink-mute" data-seccion="sedes">
          ${svgEdificio(18)} Sedes
        </button>
        <button class="adm-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-ink-mute" data-seccion="trimestres">
          ${svgCalendario(18)} Trimestres
        </button>
        <button class="adm-nav-mobile flex flex-col items-center justify-center gap-0.5
                       py-3 text-[10px] font-medium text-ink-mute" data-seccion="asociaciones">
          ${svgAsociaciones(18)} Asoc.
        </button>
      </nav>

    </div>

    <!-- ── Modales del panel admin ──────────────────────── -->

    <!-- Modal: crear / editar guardia -->
    <div id="adm-modal-guardia" class="modal-overlay">
      <div class="modal-box">
        <div class="flex items-start justify-between mb-5">
          <h3 id="adm-modal-guardia-titulo" class="font-display text-2xl">Nueva guardia</h3>
          <button class="adm-cerrar-modal w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line" data-modal="adm-modal-guardia"
                  aria-label="Cerrar">✕</button>
        </div>
        <form id="adm-form-guardia" novalidate class="space-y-4">
          <div id="adm-err-guardia" class="msg-error"></div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="adm-g-fecha">Fecha *</label>
              <input id="adm-g-fecha" type="date" class="input mt-1.5" />
            </div>
            <div>
              <label for="adm-g-hora">Hora inicio *</label>
              <input id="adm-g-hora" type="time" class="input mt-1.5" value="08:00" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="adm-g-duracion">Duración (hs) *</label>
              <input id="adm-g-duracion" type="number" class="input mt-1.5" value="24" min="1" />
            </div>
            <div>
              <label for="adm-g-cupos">Cupos *</label>
              <input id="adm-g-cupos" type="number" class="input mt-1.5" value="1" min="1" />
            </div>
          </div>
          <div>
            <label for="adm-g-sede">Sede *</label>
            <select id="adm-g-sede" class="input mt-1.5"></select>
          </div>
          <div>
            <label for="adm-g-servicio">Servicio *</label>
            <input id="adm-g-servicio" type="text" class="input mt-1.5"
                   placeholder="Guardia general" />
          </div>
          <div>
            <label for="adm-g-trimestre">Trimestre *</label>
            <select id="adm-g-trimestre" class="input mt-1.5"></select>
          </div>
          <div>
            <label for="adm-g-notas">Notas <span class="text-ink-mute font-normal">(opcional)</span></label>
            <textarea id="adm-g-notas" class="input mt-1.5" rows="2"></textarea>
          </div>
          <div>
            <label class="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" id="adm-g-whitelist-toggle" class="w-4 h-4 accent-primary" />
              <span class="text-sm font-medium text-ink">Limitar a médicos específicos</span>
            </label>
            <div id="adm-g-whitelist-box" class="hidden mt-2">
              <div id="adm-g-whitelist-chips"
                   class="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2.5
                          border border-line rounded-xl bg-bg"></div>
              <p class="text-xs text-ink-mute mt-1.5">Seleccioná los médicos que SÍ pueden inscribirse. Los demás quedarán bloqueados.</p>
            </div>
          </div>
          <div class="flex gap-3 pt-2">
            <button type="submit" id="adm-btn-guardar-guardia" class="btn-primary flex-1">
              <span class="spinner" id="adm-spin-guardia"></span>
              <span id="adm-txt-guardia">Guardar</span>
            </button>
            <button type="button" class="btn-ghost adm-cerrar-modal"
                    data-modal="adm-modal-guardia">Cancelar</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: crear / editar sede -->
    <div id="adm-modal-sede" class="modal-overlay">
      <div class="modal-box">
        <div class="flex items-start justify-between mb-5">
          <h3 id="adm-modal-sede-titulo" class="font-display text-2xl">Nueva sede</h3>
          <button class="adm-cerrar-modal w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line" data-modal="adm-modal-sede"
                  aria-label="Cerrar">✕</button>
        </div>
        <form id="adm-form-sede" novalidate class="space-y-4">
          <div id="adm-err-sede" class="msg-error"></div>
          <div>
            <label for="adm-s-nombre">Nombre *</label>
            <input id="adm-s-nombre" type="text" class="input mt-1.5" />
          </div>
          <div>
            <label for="adm-s-provincia">Provincia *</label>
            <select id="adm-s-provincia" class="input mt-1.5"></select>
          </div>
          <div>
            <label for="adm-s-asociacion">Asociación <span class="text-ink-mute font-normal">(opcional)</span></label>
            <select id="adm-s-asociacion" class="input mt-1.5">
              <option value="">— Sin asociación —</option>
            </select>
          </div>
          <div>
            <label for="adm-s-dir">Dirección <span class="text-ink-mute font-normal">(opcional)</span></label>
            <input id="adm-s-dir" type="text" class="input mt-1.5" />
          </div>
          <div>
            <label>Color en el calendario <span class="text-ink-mute font-normal">(opcional)</span></label>
            <div class="flex gap-2 mt-1.5 items-center">
              <input id="adm-s-color-picker" type="color" value="#c08a4a"
                     class="h-10 w-16 rounded border border-line cursor-pointer p-0.5" />
              <input id="adm-s-color" type="text" class="input flex-1"
                     placeholder="#c08a4a" maxlength="7" />
            </div>
          </div>
          <div class="flex gap-3 pt-2">
            <button type="submit" id="adm-btn-guardar-sede" class="btn-primary flex-1">
              <span class="spinner" id="adm-spin-sede"></span>
              <span id="adm-txt-sede">Guardar</span>
            </button>
            <button type="button" class="btn-ghost adm-cerrar-modal"
                    data-modal="adm-modal-sede">Cancelar</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: crear / editar asociación -->
    <div id="adm-modal-asociacion" class="modal-overlay">
      <div class="modal-box">
        <div class="flex items-start justify-between mb-5">
          <h3 id="adm-modal-asociacion-titulo" class="font-display text-2xl">Nueva asociación</h3>
          <button class="adm-cerrar-modal w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line" data-modal="adm-modal-asociacion"
                  aria-label="Cerrar">✕</button>
        </div>
        <form id="adm-form-asociacion" novalidate class="space-y-4">
          <div id="adm-err-asociacion" class="msg-error"></div>
          <div>
            <label for="adm-a-nombre">Nombre *</label>
            <input id="adm-a-nombre" type="text" class="input mt-1.5"
                   placeholder="Asociación de Cirugía de Mendoza" />
          </div>
          <div>
            <label for="adm-a-descripcion">Descripción <span class="text-ink-mute font-normal">(opcional)</span></label>
            <textarea id="adm-a-descripcion" class="input mt-1.5" rows="2"></textarea>
          </div>
          <div class="flex gap-3 pt-2">
            <button type="submit" id="adm-btn-guardar-asociacion" class="btn-primary flex-1">
              <span class="spinner" id="adm-spin-asociacion"></span>
              <span id="adm-txt-asociacion">Guardar</span>
            </button>
            <button type="button" class="btn-ghost adm-cerrar-modal"
                    data-modal="adm-modal-asociacion">Cancelar</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: editar perfil de médico/asociacion -->
    <div id="adm-modal-editar-perfil" class="modal-overlay">
      <div class="modal-box">
        <div class="flex items-start justify-between mb-5">
          <h3 class="font-display text-2xl">Editar perfil</h3>
          <button class="adm-cerrar-modal w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line" data-modal="adm-modal-editar-perfil"
                  aria-label="Cerrar">✕</button>
        </div>
        <form id="adm-form-editar-perfil" novalidate class="space-y-4">
          <div id="adm-err-editar-perfil" class="msg-error"></div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="adm-ep-nombre">Nombre *</label>
              <input id="adm-ep-nombre" type="text" class="input mt-1.5" />
            </div>
            <div>
              <label for="adm-ep-apellido">Apellido *</label>
              <input id="adm-ep-apellido" type="text" class="input mt-1.5" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="adm-ep-matricula">Matrícula</label>
              <input id="adm-ep-matricula" type="text" class="input mt-1.5" />
            </div>
            <div>
              <label for="adm-ep-especialidad">Especialidad</label>
              <input id="adm-ep-especialidad" type="text" class="input mt-1.5" />
            </div>
          </div>
          <div>
            <label for="adm-ep-telefono">Teléfono</label>
            <input id="adm-ep-telefono" type="tel" class="input mt-1.5" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="adm-ep-rol">Rol *</label>
              <select id="adm-ep-rol" class="input mt-1.5">
                <option value="medico">Médico</option>
                <option value="asociacion">Asociación</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label for="adm-ep-asociacion">Asociación</label>
              <select id="adm-ep-asociacion" class="input mt-1.5">
                <option value="">— Sin asociación —</option>
              </select>
            </div>
          </div>
          <div class="flex items-center gap-3 pt-1">
            <input id="adm-ep-activo" type="checkbox" class="w-4 h-4 accent-primary" />
            <label for="adm-ep-activo" class="text-sm">Cuenta activa</label>
          </div>
          <div class="flex gap-3 pt-2">
            <button type="submit" id="adm-btn-guardar-perfil" class="btn-primary flex-1">
              <span class="spinner" id="adm-spin-perfil"></span>
              <span id="adm-txt-perfil">Guardar cambios</span>
            </button>
            <button type="button" class="btn-ghost adm-cerrar-modal"
                    data-modal="adm-modal-editar-perfil">Cancelar</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: crear / editar trimestre -->
    <div id="adm-modal-trimestre" class="modal-overlay">
      <div class="modal-box">
        <div class="flex items-start justify-between mb-5">
          <h3 id="adm-modal-trimestre-titulo" class="font-display text-2xl">Nuevo trimestre</h3>
          <button class="adm-cerrar-modal w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line" data-modal="adm-modal-trimestre"
                  aria-label="Cerrar">✕</button>
        </div>
        <form id="adm-form-trimestre" novalidate class="space-y-4">
          <div id="adm-err-trimestre" class="msg-error"></div>
          <div>
            <label for="adm-t-asociacion">Asociación *</label>
            <select id="adm-t-asociacion" class="input mt-1.5">
              <option value="">— Seleccioná asociación —</option>
            </select>
          </div>
          <div>
            <label for="adm-t-id">Identificador <span class="text-ink-mute font-normal">(ej. 2026-Q3)</span> *</label>
            <input id="adm-t-id" type="text" class="input mt-1.5" placeholder="2026-Q3" />
          </div>
          <div>
            <label for="adm-t-nombre">Nombre *</label>
            <input id="adm-t-nombre" type="text" class="input mt-1.5"
                   placeholder="Julio – Septiembre 2026" />
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="adm-t-inicio">Fecha inicio *</label>
              <input id="adm-t-inicio" type="date" class="input mt-1.5" />
            </div>
            <div>
              <label for="adm-t-fin">Fecha fin *</label>
              <input id="adm-t-fin" type="date" class="input mt-1.5" />
            </div>
          </div>
          <div>
            <label for="adm-t-max">Máx. guardias por médico *</label>
            <input id="adm-t-max" type="number" class="input mt-1.5" value="12" min="1" />
          </div>
          <div class="flex gap-3 pt-2">
            <button type="submit" id="adm-btn-guardar-trimestre" class="btn-primary flex-1">
              <span class="spinner" id="adm-spin-trimestre"></span>
              <span id="adm-txt-trimestre">Guardar</span>
            </button>
            <button type="button" class="btn-ghost adm-cerrar-modal"
                    data-modal="adm-modal-trimestre">Cancelar</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Modal: inscriptos de una guardia -->
    <div id="adm-modal-inscriptos" class="modal-overlay">
      <div class="modal-box !max-w-2xl">
        <div class="flex items-start justify-between mb-5">
          <h3 id="adm-modal-inscriptos-titulo" class="font-display text-2xl">Inscriptos</h3>
          <button class="adm-cerrar-modal w-8 h-8 rounded-full flex items-center justify-center
                         text-ink-mute hover:bg-line" data-modal="adm-modal-inscriptos"
                  aria-label="Cerrar">✕</button>
        </div>
        <div id="adm-inscriptos-contenido"></div>
      </div>
    </div>
  `;
}

// ── Eventos ───────────────────────────────────────────────

function configurarEventos() {
  const root = document.getElementById('vista-admin');

  root.addEventListener('click', (e) => {
    // Nav
    const navItem = e.target.closest('[data-seccion]');
    if (navItem) { mostrarSeccion(navItem.dataset.seccion); return; }

    // Cerrar modales admin
    const cerrarBtn = e.target.closest('.adm-cerrar-modal');
    if (cerrarBtn) { cerrarModalAdmin(cerrarBtn.dataset.modal); return; }

    // Click en overlay de modales admin
    const overlay = e.target.closest('.modal-overlay');
    if (overlay && e.target === overlay && overlay.id.startsWith('adm-')) {
      cerrarModalAdmin(overlay.id); return;
    }
  });

  document.getElementById('adm-btn-logout')
    ?.addEventListener('click', cerrarSesion);
  document.getElementById('adm-btn-logout-mobile')
    ?.addEventListener('click', cerrarSesion);

  // Guardias
  document.getElementById('adm-sel-trimestre')
    ?.addEventListener('change', async (e) => {
      trimestreActivo = trimestresDisponibles.find(t => t.id === e.target.value) ?? trimestreActivo;
      actualizarInfoTrimestre();
      await recargarGuardias();
    });

  document.getElementById('adm-fil-sede')
    ?.addEventListener('change', renderizarTablaGuardias);

  document.getElementById('adm-btn-nueva-guardia')
    ?.addEventListener('click', () => abrirFormGuardia());

  document.getElementById('adm-btn-notificar-medicos')
    ?.addEventListener('click', async () => {
      if (!trimestreActivo) { alert('Seleccioná un trimestre primero.'); return; }
      const btn = document.getElementById('adm-btn-notificar-medicos');
      if (btn) { btn.disabled = true; btn.textContent = 'Enviando…'; }
      await supabase.functions.invoke('send-email', {
        body: { tipo: 'nuevas_guardias', trimestre_id: trimestreActivo.id,
                asociacion_id: trimestreActivo.asociacion_id ?? null },
      }).catch(() => {});
      if (btn) { btn.disabled = false; btn.textContent = 'Notificar médicos'; }
      alert('Notificación enviada a los médicos activos.');
    });

  document.getElementById('adm-g-whitelist-toggle')
    ?.addEventListener('change', async function() {
      const box = document.getElementById('adm-g-whitelist-box');
      if (box) box.classList.toggle('hidden', !this.checked);
      if (this.checked) {
        const sedeId  = document.getElementById('adm-g-sede').value;
        const sede    = sedes.find(s => s.id === sedeId);
        const asociId = sede?.asociacion_id ?? null;
        await cargarMedicosEnWhitelist('adm-g-whitelist-chips', [], asociId);
      }
    });

  document.getElementById('adm-g-sede')
    ?.addEventListener('change', async function() {
      const toggle = document.getElementById('adm-g-whitelist-toggle');
      if (!toggle?.checked) return;
      const sede    = sedes.find(s => s.id === this.value);
      const asociId = sede?.asociacion_id ?? null;
      await cargarMedicosEnWhitelist('adm-g-whitelist-chips', [], asociId);
    });

  document.getElementById('adm-btn-descargar')
    ?.addEventListener('click', async () => {
      const btn = document.getElementById('adm-btn-descargar');
      if (btn) { btn.disabled = true; btn.textContent = 'Generando…'; }

      const sedeId    = document.getElementById('adm-fil-sede')?.value || null;
      const sedeNombre = sedeId ? sedes.find(s => s.id === sedeId)?.nombre : null;
      const guardiasParaExportar = sedeId
        ? guardiasTrimestre.filter(g => g.sede_id === sedeId)
        : guardiasTrimestre;

      await exportarReporteAdmin(guardiasParaExportar, trimestreActivo?.nombre, sedeNombre);

      if (btn) { btn.disabled = false; btn.textContent = '↓ Excel'; }
    });
  document.getElementById('adm-btn-nueva-guardia-2')
    ?.addEventListener('click', () => abrirFormGuardia());

  document.getElementById('adm-btn-deselect-all')
    ?.addEventListener('click', () => {
      seleccionadasIds.clear();
      renderizarTablaGuardias();
    });

  document.getElementById('adm-btn-eliminar-seleccion')
    ?.addEventListener('click', eliminarGuardiasSeleccionadas);

  document.getElementById('adm-form-guardia')
    ?.addEventListener('submit', guardarGuardia);

  // Sedes
  document.getElementById('adm-btn-nueva-sede')
    ?.addEventListener('click', () => abrirFormSede());
  document.getElementById('adm-form-sede')
    ?.addEventListener('submit', guardarSede);

  // Color picker sync
  document.getElementById('adm-s-color-picker')
    ?.addEventListener('input', (e) => {
      document.getElementById('adm-s-color').value = e.target.value;
    });
  document.getElementById('adm-s-color')
    ?.addEventListener('input', (e) => {
      if (/^#[0-9a-fA-F]{6}$/.test(e.target.value))
        document.getElementById('adm-s-color-picker').value = e.target.value;
    });

  // Trimestres
  document.getElementById('adm-btn-nuevo-trimestre')
    ?.addEventListener('click', () => abrirFormTrimestre());
  document.getElementById('adm-form-trimestre')
    ?.addEventListener('submit', guardarTrimestre);

  // Asociaciones
  document.getElementById('adm-btn-nueva-asociacion')
    ?.addEventListener('click', () => abrirFormAsociacion());
  document.getElementById('adm-form-asociacion')
    ?.addEventListener('submit', guardarAsociacion);

  // Editar perfil
  document.getElementById('adm-form-editar-perfil')
    ?.addEventListener('submit', guardarEditarPerfil);

  // Modal inscriptos (compartido con index.html)
  document.getElementById('btn-cerrar-modal')
    ?.addEventListener('click', cerrarModalInscriptos);
  document.getElementById('modal-guardia')
    ?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) cerrarModalInscriptos();
    });
}

function mostrarSeccion(nombre) {
  document.querySelectorAll('.adm-seccion').forEach(s => s.classList.add('hidden'));
  document.getElementById(`adm-sec-${nombre}`)?.classList.remove('hidden');

  document.querySelectorAll('.nav-item[data-seccion]').forEach(item => {
    item.classList.toggle('activo', item.dataset.seccion === nombre);
  });
  document.querySelectorAll('.adm-nav-mobile[data-seccion]').forEach(btn => {
    btn.classList.toggle('text-primary',  btn.dataset.seccion === nombre);
    btn.classList.toggle('text-ink-mute', btn.dataset.seccion !== nombre);
  });

  if (nombre === 'dashboard')    mostrarDashboard();
  if (nombre === 'medicos')      renderizarMedicos();
  if (nombre === 'sedes')        renderizarSedes();
  if (nombre === 'trimestres')   renderizarTrimestres();
  if (nombre === 'asociaciones') renderizarAsociaciones();
}

function cerrarModalAdmin(id) {
  document.getElementById(id)?.classList.remove('visible');
}

// ── Carga inicial ─────────────────────────────────────────

async function cargarDatosIniciales() {
  const [
    { data: trims },
    { data: sedesData },
    { data: provinciasData },
    { data: asociacionesData },
    { count: pendientes },
  ] = await Promise.all([
    obtenerTrimestres(),
    obtenerSedes(),
    obtenerProvincias(),
    supabase.from('asociaciones').select('id, nombre, descripcion, activa, creada_en').order('nombre'),
    supabase.from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('activo', false).eq('rol', 'medico'),
  ]);

  trimestresDisponibles = trims ?? [];
  sedes                 = sedesData ?? [];
  provincias            = provinciasData ?? [];
  asociaciones          = asociacionesData ?? [];

  const badge = document.getElementById('adm-badge-pendientes');
  if (badge && pendientes > 0) {
    badge.textContent = pendientes;
    badge.classList.remove('hidden');
  }

  if (!trimestresDisponibles.length) {
    document.getElementById('adm-tabla-cargando').innerHTML =
      '<p class="text-bad">No hay trimestres. Creá uno en la sección Trimestres.</p>';
    poblarFiltroDeSede();
    return;
  }

  const hoy = new Date().toISOString().slice(0, 10);
  trimestreActivo =
    trimestresDisponibles.find(t => t.fecha_inicio <= hoy && hoy <= t.fecha_fin) ??
    [...trimestresDisponibles].reverse().find(t => t.fecha_inicio > hoy) ??
    trimestresDisponibles[0];

  const sel = document.getElementById('adm-sel-trimestre');
  if (sel) {
    sel.innerHTML = trimestresDisponibles.map(t =>
      `<option value="${t.id}" ${t.id === trimestreActivo.id ? 'selected' : ''}>${t.nombre}</option>`
    ).join('');
  }

  poblarFiltroDeSede();
  actualizarInfoTrimestre();
  await recargarGuardias();
}

function poblarFiltroDeSede() {
  const sel = document.getElementById('adm-fil-sede');
  if (!sel) return;
  sel.innerHTML = '<option value="">Todas las sedes</option>' +
    sedes.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
}

function actualizarInfoTrimestre() {
  const el = document.getElementById('adm-info-trimestre');
  if (!el || !trimestreActivo) return;
  const abierto = trimestreActivo.inscripciones_abiertas;
  el.innerHTML = `
    <div class="text-xs font-semibold text-ink uppercase tracking-wider mb-1">Trimestre activo</div>
    <div class="text-sm font-medium text-ink">${trimestreActivo.nombre}</div>
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
  document.getElementById('adm-tabla-cargando')?.classList.remove('hidden');
  document.getElementById('adm-tabla-wrap')?.classList.add('hidden');
  document.getElementById('adm-tabla-vacia')?.classList.add('hidden');

  const { data } = await obtenerGuardiasTrimestre(trimestreActivo.id);
  guardiasTrimestre = data;

  renderizarStats();
  renderizarTablaGuardias();
}

function renderizarStats() {
  const el = document.getElementById('adm-stats');
  if (!el) return;
  const total    = guardiasTrimestre.length;
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
  const sedeId  = document.getElementById('adm-fil-sede')?.value ?? '';
  const filtradas = sedeId
    ? guardiasTrimestre.filter(g => g.sede_id === sedeId)
    : guardiasTrimestre;

  const cargando = document.getElementById('adm-tabla-cargando');
  const wrap     = document.getElementById('adm-tabla-wrap');
  const vacia    = document.getElementById('adm-tabla-vacia');
  const tbody    = document.getElementById('adm-tabla-body');

  cargando?.classList.add('hidden');

  if (!filtradas.length) {
    wrap?.classList.add('hidden');
    vacia?.classList.remove('hidden');
    seleccionadasIds.clear();
    actualizarBulkBar(filtradas);
    return;
  }

  vacia?.classList.add('hidden');
  wrap?.classList.remove('hidden');

  const hoy = new Date().toISOString().slice(0, 10);

  tbody.innerHTML = filtradas.map(g => {
    const dotColor   = g.sede_color ?? '#8a948f';
    const checked    = seleccionadasIds.has(g.id) ? 'checked' : '';
    const rowActiva  = seleccionadasIds.has(g.id) ? 'bg-accent-soft' : '';
    const pasada     = g.fecha < hoy;
    const cuposBadge = pasada
      ? '<span class="badge">Pasada</span>'
      : g.cupos_libres <= 0
        ? '<span class="badge badge-ok">Completa</span>'
        : g.cupos_ocupados === 0
          ? '<span class="badge badge-bad">Sin inscriptos</span>'
          : `<span class="badge badge-warn">${g.cupos_libres} libre${g.cupos_libres !== 1 ? 's' : ''}</span>`;

    return `<tr class="table-row ${rowActiva}" data-guardia-id="${g.id}">
      <td class="px-3 py-4">
        <input type="checkbox" class="adm-chk-fila w-4 h-4 rounded accent-primary cursor-pointer"
               data-id="${g.id}" ${checked}/>
      </td>
      <td class="px-5 py-4">
        <div class="font-medium">${fechaTabla(g.fecha)}</div>
        <div class="text-xs text-ink-mute">${formatearHora(g.hora_inicio)}</div>
      </td>
      <td class="px-5 py-4">
        <div>
          <span class="sede-dot" style="background:${dotColor}"></span>
          ${g.sede_nombre}
        </div>
        <div class="text-xs text-ink-mute pl-4">${g.servicio}</div>
      </td>
      <td class="px-5 py-4">${g.duracion_horas} hs</td>
      <td class="px-5 py-4">
        <span class="font-medium">${g.cupos_ocupados} / ${g.cupos_totales}</span>
      </td>
      <td class="px-5 py-4">${cuposBadge}</td>
      <td class="px-5 py-4">
        <div class="flex gap-2 justify-end">
          <button class="btn-ghost text-xs"
            data-accion="inscriptos" data-id="${g.id}">Ver inscriptos</button>
          <button class="btn-ghost text-xs"
            data-accion="editar" data-id="${g.id}">Editar</button>
          <button class="btn-ghost text-xs text-bad hover:!bg-red-50 hover:!border-red-200"
            data-accion="eliminar" data-id="${g.id}">Eliminar</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Checkboxes individuales
  tbody.querySelectorAll('.adm-chk-fila').forEach(chk => {
    chk.addEventListener('change', () => {
      if (chk.checked) seleccionadasIds.add(chk.dataset.id);
      else             seleccionadasIds.delete(chk.dataset.id);
      const fila = chk.closest('tr');
      fila?.classList.toggle('bg-accent-soft', chk.checked);
      actualizarBulkBar(filtradas);
      actualizarChkTodos(filtradas);
    });
  });

  // Checkbox "seleccionar todos"
  const chkTodos = document.getElementById('adm-chk-todos');
  if (chkTodos) {
    chkTodos.checked       = filtradas.length > 0 && filtradas.every(g => seleccionadasIds.has(g.id));
    chkTodos.indeterminate = !chkTodos.checked && filtradas.some(g => seleccionadasIds.has(g.id));
    chkTodos.onchange = () => {
      if (chkTodos.checked) filtradas.forEach(g => seleccionadasIds.add(g.id));
      else                  filtradas.forEach(g => seleccionadasIds.delete(g.id));
      renderizarTablaGuardias();
    };
  }

  // Delegación de eventos en botones de acción
  tbody.querySelectorAll('[data-accion]').forEach(btn => {
    btn.addEventListener('click', () => {
      const g = guardiasTrimestre.find(x => x.id === btn.dataset.id);
      if (!g) return;
      if (btn.dataset.accion === 'inscriptos') abrirModalInscriptos(g);
      if (btn.dataset.accion === 'editar')     abrirFormGuardia(g);
      if (btn.dataset.accion === 'eliminar')   confirmarEliminarGuardia(g);
    });
  });

  actualizarBulkBar(filtradas);
}

function actualizarBulkBar(filtradas) {
  const bar   = document.getElementById('adm-bulk-bar');
  const count = document.getElementById('adm-bulk-count');
  const n     = seleccionadasIds.size;
  if (!bar) return;
  if (n === 0) {
    bar.classList.add('hidden');
  } else {
    bar.classList.remove('hidden');
    if (count) count.textContent = `${n} guardia${n !== 1 ? 's' : ''} seleccionada${n !== 1 ? 's' : ''}`;
  }
}

function actualizarChkTodos(filtradas) {
  const chkTodos = document.getElementById('adm-chk-todos');
  if (!chkTodos) return;
  const todas = filtradas.every(g => seleccionadasIds.has(g.id));
  const alguna = filtradas.some(g => seleccionadasIds.has(g.id));
  chkTodos.checked       = todas && filtradas.length > 0;
  chkTodos.indeterminate = !todas && alguna;
}

// ── Form guardia ──────────────────────────────────────────

async function cargarMedicosEnWhitelist(chipsId, seleccionados = [], asociacionId = null) {
  const container = document.getElementById(chipsId);
  if (!container) return;
  const cacheKey = asociacionId ?? '__all__';
  if (!medicosWhitelistCache[cacheKey]) {
    let q = supabase
      .from('profiles')
      .select('id, nombre, apellido, matricula')
      .eq('rol', 'medico')
      .eq('activo', true)
      .order('apellido');
    if (asociacionId) q = q.eq('asociacion_id', asociacionId);
    const { data } = await q;
    medicosWhitelistCache[cacheKey] = data ?? [];
  }
  const BASE = 'wl-chip inline-flex items-center px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer select-none';
  container.innerHTML = medicosWhitelistCache[cacheKey].map(m => {
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

async function abrirFormGuardia(guardia = null) {
  guardiaEditando = guardia;

  document.getElementById('adm-modal-guardia-titulo').textContent =
    guardia ? 'Editar guardia' : 'Nueva guardia';

  const sedesActivas = sedes.filter(s => s.activa);
  document.getElementById('adm-g-sede').innerHTML = sedesActivas.map(s =>
    `<option value="${s.id}" ${guardia?.sede_id === s.id ? 'selected' : ''}>${s.nombre}</option>`
  ).join('');

  document.getElementById('adm-g-trimestre').innerHTML = trimestresDisponibles.map(t =>
    `<option value="${t.id}" ${
      guardia ? t.id === guardia.trimestre_id : t.id === trimestreActivo?.id
        ? 'selected' : ''
    }>${t.nombre}</option>`
  ).join('');

  const hoyMin = new Date().toISOString().slice(0, 10);
  const fechaInput = document.getElementById('adm-g-fecha');
  fechaInput.min   = guardia ? '' : hoyMin;
  fechaInput.value = guardia?.fecha ?? '';
  document.getElementById('adm-g-hora').value     = guardia ? formatearHora(guardia.hora_inicio) : '08:00';
  document.getElementById('adm-g-duracion').value = guardia?.duracion_horas ?? 24;
  document.getElementById('adm-g-servicio').value = guardia?.servicio ?? '';
  document.getElementById('adm-g-cupos').value    = guardia?.cupos_totales ?? 1;
  document.getElementById('adm-g-notas').value    = guardia?.notas ?? '';

  const sedeSelId    = guardia?.sede_id ?? sedesActivas[0]?.id;
  const sedeActual   = sedes.find(s => s.id === sedeSelId);
  const asociacionId = sedeActual?.asociacion_id ?? null;

  let whitelist = null;
  if (guardia) {
    const { data: gwl } = await supabase.from('guardias').select('medicos_permitidos').eq('id', guardia.id).single();
    whitelist = gwl?.medicos_permitidos ?? null;
  }
  const wlToggle  = document.getElementById('adm-g-whitelist-toggle');
  const wlBox     = document.getElementById('adm-g-whitelist-box');
  const wlChips   = document.getElementById('adm-g-whitelist-chips');
  if (wlToggle) wlToggle.checked = !!(whitelist?.length);
  if (wlBox) wlBox.classList.toggle('hidden', !(whitelist?.length));
  if (whitelist?.length) {
    await cargarMedicosEnWhitelist('adm-g-whitelist-chips', whitelist, asociacionId);
  } else if (wlChips) {
    wlChips.innerHTML = '';
  }

  const err = document.getElementById('adm-err-guardia');
  if (err) err.classList.remove('visible');

  document.getElementById('adm-modal-guardia').classList.add('visible');
}

async function guardarGuardia(e) {
  e.preventDefault();
  const fecha        = document.getElementById('adm-g-fecha').value;
  const hora_inicio  = document.getElementById('adm-g-hora').value;
  const duracion     = parseInt(document.getElementById('adm-g-duracion').value);
  const sede_id      = document.getElementById('adm-g-sede').value;
  const servicio     = document.getElementById('adm-g-servicio').value.trim();
  const cupos        = parseInt(document.getElementById('adm-g-cupos').value);
  const trimestre_id = document.getElementById('adm-g-trimestre').value;
  const notas        = document.getElementById('adm-g-notas').value.trim();
  const errEl        = document.getElementById('adm-err-guardia');
  const wlToggle = document.getElementById('adm-g-whitelist-toggle');
  const medicos_permitidos = wlToggle?.checked
    ? Array.from(document.querySelectorAll('#adm-g-whitelist-chips .wl-chip[data-selected="true"]')).map(el => el.dataset.medicoId)
    : null;

  if (!fecha || !hora_inicio || !sede_id || !servicio || !trimestre_id ||
      isNaN(duracion) || isNaN(cupos) || cupos < 1) {
    if (errEl) { errEl.textContent = 'Completá todos los campos obligatorios.'; errEl.classList.add('visible'); }
    return;
  }
  if (!guardiaEditando && fecha < new Date().toISOString().slice(0, 10)) {
    if (errEl) { errEl.textContent = 'No podés crear guardias en fechas pasadas.'; errEl.classList.add('visible'); }
    return;
  }
  if (guardiaEditando && cupos < (guardiaEditando.cupos_ocupados ?? 0)) {
    if (errEl) {
      errEl.textContent = `No podés reducir a menos de ${guardiaEditando.cupos_ocupados} cupos (hay inscriptos).`;
      errEl.classList.add('visible');
    }
    return;
  }
  if (errEl) errEl.classList.remove('visible');

  setCargando('adm-btn-guardar-guardia', 'adm-spin-guardia', 'adm-txt-guardia', true);

  const campos = { fecha, hora_inicio, duracion_horas: duracion, sede_id, servicio,
                   cupos_totales: cupos, trimestre_id, notas: notas || null,
                   medicos_permitidos: medicos_permitidos?.length ? medicos_permitidos : null };
  let error;
  if (guardiaEditando) {
    ({ error } = await actualizarGuardia(guardiaEditando.id, campos));
  } else {
    campos.creado_por = perfil.id;
    ({ error } = await crearGuardia(campos));
  }

  setCargando('adm-btn-guardar-guardia', 'adm-spin-guardia', 'adm-txt-guardia', false);

  if (error) {
    if (errEl) { errEl.textContent = 'Error al guardar: ' + error.message; errEl.classList.add('visible'); }
    return;
  }

  cerrarModalAdmin('adm-modal-guardia');
  await recargarGuardias();
}

async function confirmarEliminarGuardia(g) {
  const msg = g.cupos_ocupados > 0
    ? `Esta guardia tiene ${g.cupos_ocupados} médico(s) inscripto(s).\n¿Eliminarla de todas formas? Las inscripciones también se eliminarán.`
    : `¿Eliminar la guardia del ${formatearFechaLarga(g.fecha)}?`;
  if (!confirm(msg)) return;
  const { error } = await eliminarGuardia(g.id);
  if (error) { alert('No se pudo eliminar: ' + error.message); return; }
  await recargarGuardias();
}

async function eliminarGuardiasSeleccionadas() {
  const ids = [...seleccionadasIds];
  if (!ids.length) return;

  const conInscriptos = ids.filter(id => {
    const g = guardiasTrimestre.find(x => x.id === id);
    return g && g.cupos_ocupados > 0;
  });

  const msg = conInscriptos.length > 0
    ? `Vas a eliminar ${ids.length} guardia${ids.length !== 1 ? 's' : ''}, de las cuales ${conInscriptos.length} tiene${conInscriptos.length !== 1 ? 'n' : ''} médicos inscriptos.\n¿Eliminar todas? Las inscripciones también se eliminarán.`
    : `¿Eliminar las ${ids.length} guardia${ids.length !== 1 ? 's' : ''} seleccionada${ids.length !== 1 ? 's' : ''}?`;

  if (!confirm(msg)) return;

  const btn = document.getElementById('adm-btn-eliminar-seleccion');
  if (btn) { btn.disabled = true; btn.textContent = 'Eliminando…'; }

  const { error } = await eliminarGuardias(ids);

  if (btn) { btn.disabled = false; btn.textContent = 'Eliminar seleccionadas'; }

  if (error) { alert('Error al eliminar: ' + error.message); return; }

  seleccionadasIds.clear();
  await recargarGuardias();
}

// ── Modal inscriptos (usa #adm-modal-inscriptos) ───

async function abrirModalInscriptos(guardia) {
  guardiaInscriptosActual = guardia;
  const modal    = document.getElementById('adm-modal-inscriptos');
  const contenido = document.getElementById('adm-inscriptos-contenido');
  const titulo   = document.getElementById('adm-modal-inscriptos-titulo');

  if (titulo) {
    titulo.textContent = `Inscriptos — ${guardia.sede_nombre}, ${fechaTabla(guardia.fecha)}`;
  }
  if (contenido) {
    contenido.innerHTML = '<div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>';
  }
  modal?.classList.add('visible');

  const medicos = await obtenerMedicosDeGuardia(guardia.id);
  renderizarInscriptos(medicos, guardia);
}

function renderizarInscriptos(medicos, guardia) {
  const lista = document.getElementById('adm-inscriptos-contenido');
  if (!lista) return;

  if (!medicos.length) {
    lista.innerHTML = '<div class="py-8 text-center text-ink-mute text-sm">Sin médicos inscriptos todavía.</div>';
    return;
  }

  lista.innerHTML = `
    <div class="bg-surface border border-line rounded-xl divide-y divide-[var(--line)]">
      ${medicos.map(m => `
        <div class="p-4 flex items-center justify-between gap-3 flex-wrap" data-ins-row="${m.inscripcion_id}">
          <div>
            <div class="font-medium text-sm text-ink">${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}</div>
            <div class="text-xs text-ink-mute mt-0.5">
              ${escapeHtml(m.matricula)} · ${escapeHtml(m.especialidad)}
              ${m.telefono ? ' · ' + escapeHtml(m.telefono) : ''}
            </div>
            <div class="text-xs text-ink-mute mt-1.5">
              <span class="badge ${m.estado === 'asignada_admin' ? 'badge-info' : 'badge-ok'}">
                ${m.estado === 'asignada_admin' ? 'Asignado' : 'Confirmado'}
              </span>
            </div>
          </div>
          <button class="text-xs text-bad hover:underline btn-baja-medico whitespace-nowrap"
            data-baja-id="${m.inscripcion_id}"
            data-baja-nombre="${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}">
            Dar de baja
          </button>
        </div>`).join('')}
    </div>`;

  lista.querySelectorAll('.btn-baja-medico').forEach(btn => {
    btn.addEventListener('click', async () => {
      const nombre = btn.dataset.bajaNombre;
      if (!confirm(`¿Dar de baja la inscripción de ${nombre}?`)) return;
      btn.disabled    = true;
      btn.textContent = 'Procesando…';
      const res = await cancelarInscripcion(btn.dataset.bajaId);
      if (res.ok) {
        const nuevosMedicos = await obtenerMedicosDeGuardia(guardiaInscriptosActual.id);
        renderizarInscriptos(nuevosMedicos ?? [], guardiaInscriptosActual);
        await recargarGuardias();
      } else {
        btn.disabled    = false;
        btn.textContent = 'Dar de baja';
        alert(traducirCod(res.codigo));
      }
    });
  });
}

function cerrarModalInscriptos() {
  document.getElementById('modal-guardia')?.classList.remove('visible');
  document.getElementById('adm-modal-inscriptos')?.classList.remove('visible');
}

// ── Médicos ───────────────────────────────────────────────

function renderizarMedicos() {
  const contenedor = document.getElementById('adm-medicos-contenido');
  if (!contenedor) return;
  cargarYMostrarMedicos(contenedor);
}

async function cargarYMostrarMedicos(contenedor) {
  if (!cacheMedicos) {
    contenedor.innerHTML = '<div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>';
    const { data, error } = await supabase
      .from('profiles')
      .select('id, nombre, apellido, matricula, especialidad, telefono, rol, activo, creado_en, asociacion_id')
      .order('creado_en', { ascending: false });
    if (error) {
      contenedor.innerHTML = '<p class="text-bad py-8 text-center">Error al cargar médicos.</p>';
      return;
    }
    cacheMedicos = data ?? [];
  }

  const pendientes = cacheMedicos.filter(p => !p.activo && p.rol === 'medico');
  const activos    = cacheMedicos.filter(p =>  p.activo);

  // Actualizar badge
  const badge = document.getElementById('adm-badge-pendientes');
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
            <div class="p-4 flex items-center justify-between flex-wrap gap-3"
                 data-medico-id="${m.id}">
              <div>
                <div class="font-medium text-sm">${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}</div>
                <div class="text-xs text-ink-mute">
                  ${escapeHtml(m.matricula)} · ${escapeHtml(m.especialidad)}
                  ${m.telefono ? ' · ' + escapeHtml(m.telefono) : ''}
                  ${m.asociacion_id
                    ? ' · ' + escapeHtml(asociaciones.find(a => a.id === m.asociacion_id)?.nombre ?? '—')
                    : ''}
                </div>
              </div>
              <div class="flex gap-2">
                <button class="btn-ghost text-xs"
                  data-accion-medico="editar" data-medico-id="${m.id}">Editar</button>
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
                <th class="px-5 py-3 hidden sm:table-cell">Rol</th>
                <th class="px-5 py-3 hidden lg:table-cell">Asociación</th>
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
                  <td class="px-5 py-3 hidden sm:table-cell">
                    <span class="badge ${m.rol === 'admin' ? 'badge-info' : m.rol === 'asociacion' ? 'badge-warn' : 'badge-ok'}">
                      ${m.rol === 'admin' ? 'Admin' : m.rol === 'asociacion' ? 'Asociación' : 'Médico'}
                    </span>
                  </td>
                  <td class="px-5 py-3 text-ink-mute text-xs hidden lg:table-cell">
                    ${m.asociacion_id
                      ? escapeHtml(asociaciones.find(a => a.id === m.asociacion_id)?.nombre ?? '—')
                      : '—'}
                  </td>
                  <td class="px-5 py-3 text-right">
                    <div class="flex items-center justify-end gap-3">
                      <button class="text-xs text-primary hover:underline"
                        data-accion-medico="editar" data-medico-id="${m.id}">Editar</button>
                      ${m.id !== perfil.id ? `
                        <button class="text-xs text-bad hover:underline"
                          data-accion-medico="desactivar" data-medico-id="${m.id}"
                          data-medico-nombre="${escapeHtml(m.nombre)} ${escapeHtml(m.apellido)}">Dar de baja</button>
                      ` : '<span class="text-xs text-ink-mute">(tu cuenta)</span>'}
                    </div>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  if (!pendientes.length && !activos.length) {
    html = '<div class="py-16 text-center text-ink-mute text-sm">No hay médicos registrados.</div>';
  }

  contenedor.innerHTML = html;

  contenedor.querySelectorAll('[data-accion-medico]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = btn.dataset.medicoId;
      const nombre = btn.dataset.medicoNombre;
      const accion = btn.dataset.accionMedico;

      if (accion === 'editar') {
        const medico = cacheMedicos.find(m => m.id === id);
        if (medico) abrirFormEditarPerfil(medico, contenedor);

      } else if (accion === 'aprobar') {
        btn.disabled    = true;
        btn.textContent = 'Aprobando…';
        const { error } = await supabase.from('profiles')
          .update({ activo: true }).eq('id', id);
        if (error) { alert('Error: ' + error.message); btn.disabled = false; btn.textContent = 'Aprobar'; return; }
        cacheMedicos = null;
        await cargarYMostrarMedicos(contenedor);

      } else if (accion === 'rechazar') {
        if (!confirm(`¿Rechazar la solicitud de ${nombre}? La cuenta quedará inactiva.`)) return;
        btn.disabled    = true;
        btn.textContent = 'Procesando…';
        const { error: errRech } = await supabase.from('profiles')
          .update({ asociacion_id: null, activo: false }).eq('id', id);
        if (errRech) { alert('Error: ' + errRech.message); btn.disabled = false; btn.textContent = 'Rechazar'; return; }
        cacheMedicos = null;
        await cargarYMostrarMedicos(contenedor);

      } else if (accion === 'desactivar') {
        if (!confirm(`¿Dar de baja a ${nombre}? No podrá acceder al sistema.`)) return;
        btn.disabled    = true;
        btn.textContent = 'Procesando…';
        const { error } = await supabase.from('profiles')
          .update({ activo: false }).eq('id', id);
        if (error) { alert('Error: ' + error.message); btn.disabled = false; btn.textContent = 'Dar de baja'; return; }
        cacheMedicos = null;
        await cargarYMostrarMedicos(contenedor);
      }
    });
  });
}

function abrirFormEditarPerfil(medico, contenedor) {
  perfilEditando = { medico, contenedor };

  document.getElementById('adm-ep-nombre').value      = medico.nombre ?? '';
  document.getElementById('adm-ep-apellido').value    = medico.apellido ?? '';
  document.getElementById('adm-ep-matricula').value   = medico.matricula ?? '';
  document.getElementById('adm-ep-especialidad').value = medico.especialidad ?? '';
  document.getElementById('adm-ep-telefono').value    = medico.telefono ?? '';
  document.getElementById('adm-ep-rol').value         = medico.rol ?? 'medico';
  document.getElementById('adm-ep-activo').checked    = !!medico.activo;

  const selAsoc = document.getElementById('adm-ep-asociacion');
  selAsoc.innerHTML = '<option value="">— Sin asociación —</option>' +
    asociaciones.map(a =>
      `<option value="${a.id}" ${medico.asociacion_id === a.id ? 'selected' : ''}>${escapeHtml(a.nombre)}</option>`
    ).join('');

  const errEl = document.getElementById('adm-err-editar-perfil');
  if (errEl) errEl.classList.remove('visible');

  document.getElementById('adm-modal-editar-perfil').classList.add('visible');
}

async function guardarEditarPerfil(e) {
  e.preventDefault();
  if (!perfilEditando) return;

  const { medico, contenedor } = perfilEditando;
  const nombre       = document.getElementById('adm-ep-nombre').value.trim();
  const apellido     = document.getElementById('adm-ep-apellido').value.trim();
  const matricula    = document.getElementById('adm-ep-matricula').value.trim();
  const especialidad = document.getElementById('adm-ep-especialidad').value.trim();
  const telefono     = document.getElementById('adm-ep-telefono').value.trim();
  const rol          = document.getElementById('adm-ep-rol').value;
  const asociacion_id = document.getElementById('adm-ep-asociacion').value || null;
  const activo       = document.getElementById('adm-ep-activo').checked;
  const errEl        = document.getElementById('adm-err-editar-perfil');

  if (!nombre || !apellido) {
    if (errEl) { errEl.textContent = 'Nombre y apellido son obligatorios.'; errEl.classList.add('visible'); }
    return;
  }
  if (errEl) errEl.classList.remove('visible');

  setCargando('adm-btn-guardar-perfil', 'adm-spin-perfil', 'adm-txt-perfil', true);

  const { error } = await supabase.from('profiles')
    .update({ nombre, apellido, matricula, especialidad, telefono: telefono || null,
              rol, asociacion_id, activo })
    .eq('id', medico.id);

  setCargando('adm-btn-guardar-perfil', 'adm-spin-perfil', 'adm-txt-perfil', false);

  if (error) {
    const msg = error.message.includes('profiles_rol_check')
      ? 'Rol inválido. Ejecutá el script SQL 11_asociaciones.sql primero.'
      : 'Error al guardar: ' + error.message;
    if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
    return;
  }

  cerrarModalAdmin('adm-modal-editar-perfil');
  perfilEditando = null;
  await cargarYMostrarMedicos(contenedor);
}

// ── Sedes ─────────────────────────────────────────────────

function renderizarSedes() {
  const contenedor = document.getElementById('adm-sedes-contenido');
  if (!contenedor) return;
  cargarYMostrarSedes(contenedor);
}

async function cargarYMostrarSedes(contenedor) {
  contenedor.innerHTML = '<div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>';

  const { data, error } = await obtenerSedes();
  sedes = data;

  if (error) {
    contenedor.innerHTML = '<p class="text-bad py-8 text-center">Error al cargar sedes.</p>';
    return;
  }

  if (!data.length) {
    contenedor.innerHTML = `
      <div class="text-center py-16 text-ink-mute text-sm">
        No hay sedes. Creá la primera con el botón de arriba.
      </div>`;
    return;
  }

  contenedor.innerHTML = `
    <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${data.map(s => `
        <div class="bg-surface border border-line rounded-xl p-5">
          <div class="flex items-center gap-3 mb-3">
            <div class="w-3 h-3 rounded-full flex-shrink-0"
                 style="background:${s.color_hex ?? '#8a948f'}"></div>
            <div class="font-semibold text-ink truncate">${s.nombre}</div>
            ${!s.activa ? '<span class="badge badge-warn ml-auto">Inactiva</span>' : ''}
          </div>
          ${s.direccion
            ? `<div class="text-xs text-ink-mute mb-4">${s.direccion}</div>`
            : '<div class="mb-4"></div>'}
          <div class="flex gap-2 pt-3 border-t border-line">
            <button class="btn-ghost text-xs flex-1"
              data-accion-sede="editar" data-sede-id="${s.id}">Editar</button>
            <button class="btn-ghost text-xs text-bad hover:!bg-red-50 hover:!border-red-200"
              data-accion-sede="eliminar" data-sede-id="${s.id}"
              data-sede-nombre="${s.nombre}">Eliminar</button>
          </div>
        </div>`).join('')}
    </div>`;

  contenedor.querySelectorAll('[data-accion-sede]').forEach(btn => {
    btn.addEventListener('click', () => {
      const sede = sedes.find(s => s.id === btn.dataset.sedeId);
      if (!sede) return;
      if (btn.dataset.accionSede === 'editar')   abrirFormSede(sede);
      if (btn.dataset.accionSede === 'eliminar') confirmarEliminarSede(sede, contenedor);
    });
  });
}

function abrirFormSede(sede = null) {
  sedeEditando = sede;
  document.getElementById('adm-modal-sede-titulo').textContent =
    sede ? 'Editar sede' : 'Nueva sede';
  document.getElementById('adm-s-nombre').value = sede?.nombre ?? '';
  document.getElementById('adm-s-dir').value    = sede?.direccion ?? '';

  const selProv = document.getElementById('adm-s-provincia');
  if (selProv) {
    selProv.innerHTML = '<option value="">— Seleccioná provincia —</option>' +
      provincias.map(p =>
        `<option value="${p.id}" ${sede?.provincia_id === p.id ? 'selected' : ''}>${p.nombre}</option>`
      ).join('');
  }

  const selAsoc = document.getElementById('adm-s-asociacion');
  if (selAsoc) {
    selAsoc.innerHTML = '<option value="">— Sin asociación —</option>' +
      asociaciones.map(a =>
        `<option value="${a.id}" ${sede?.asociacion_id === a.id ? 'selected' : ''}>${a.nombre}</option>`
      ).join('');
  }

  const color = sede?.color_hex ?? '#c08a4a';
  document.getElementById('adm-s-color-picker').value = color;
  document.getElementById('adm-s-color').value        = color;
  const err = document.getElementById('adm-err-sede');
  if (err) err.classList.remove('visible');
  document.getElementById('adm-modal-sede').classList.add('visible');
}

async function guardarSede(e) {
  e.preventDefault();
  const nombre      = document.getElementById('adm-s-nombre').value.trim();
  const direccion   = document.getElementById('adm-s-dir').value.trim();
  const color_hex   = document.getElementById('adm-s-color').value.trim() || null;
  const provincia_id = document.getElementById('adm-s-provincia').value || null;
  const errEl       = document.getElementById('adm-err-sede');

  if (!nombre) {
    if (errEl) { errEl.textContent = 'El nombre es obligatorio.'; errEl.classList.add('visible'); }
    return;
  }
  if (!provincia_id) {
    if (errEl) { errEl.textContent = 'Seleccioná una provincia.'; errEl.classList.add('visible'); }
    return;
  }
  if (errEl) errEl.classList.remove('visible');

  setCargando('adm-btn-guardar-sede', 'adm-spin-sede', 'adm-txt-sede', true);

  const asociacion_id = document.getElementById('adm-s-asociacion')?.value || null;
  const campos = { nombre, direccion: direccion || null, color_hex, provincia_id: Number(provincia_id), asociacion_id };
  let error;
  if (sedeEditando) {
    ({ error } = await supabase.from('sedes').update(campos).eq('id', sedeEditando.id));
  } else {
    ({ error } = await supabase.from('sedes').insert([{ ...campos, activa: true }]));
  }

  setCargando('adm-btn-guardar-sede', 'adm-spin-sede', 'adm-txt-sede', false);

  if (error) {
    if (errEl) { errEl.textContent = 'Error al guardar: ' + error.message; errEl.classList.add('visible'); }
    return;
  }

  cerrarModalAdmin('adm-modal-sede');
  const { data } = await obtenerSedes();
  sedes = data;
  poblarFiltroDeSede();
  renderizarSedes();
}

async function confirmarEliminarSede(sede, contenedor) {
  if (!confirm(`¿Eliminar la sede "${sede.nombre}"?\nSi tiene guardias asignadas, la eliminación será rechazada.`)) return;
  const { error } = await supabase.from('sedes').delete().eq('id', sede.id);
  if (error) {
    alert('No se pudo eliminar: ' + (error.message.includes('foreign')
      ? 'La sede tiene guardias asignadas.'
      : error.message));
    return;
  }
  const { data } = await obtenerSedes();
  sedes = data;
  poblarFiltroDeSede();
  cargarYMostrarSedes(contenedor);
}

// ── Trimestres ────────────────────────────────────────────

function renderizarTrimestres() {
  const contenedor = document.getElementById('adm-trimestres-contenido');
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
              <div class="font-semibold text-ink">${t.nombre}</div>
              <div class="text-xs text-ink-mute mt-0.5">
                ${t.fecha_inicio} → ${t.fecha_fin} · Máx. ${t.max_guardias_por_medico} guardias/médico
              </div>
              <div class="text-xs text-ink-mute mt-0.5">
                ID: ${t.display_id || t.id}
                ${t.asociacion_id
                  ? ' · ' + (asociaciones.find(a => a.id === t.asociacion_id)?.nombre ?? 'Asoc. desconocida')
                  : ''}
              </div>
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
                data-accion-trim="eliminar" data-trim-id="${t.id}"
                data-trim-nombre="${escapeHtml(t.display_id || t.nombre)}">Eliminar</button>
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
                    asociacion_id: t.asociacion_id ?? null },
          }).catch(() => {});
        }
        await recargarTrimestres(contenedor);
      } else if (btn.dataset.accionTrim === 'eliminar') {
        await confirmarEliminarTrimestre(t, contenedor);
      }
    });
  });
}

async function confirmarEliminarTrimestre(trim, contenedor) {
  // Verificar si tiene guardias antes de intentar el DELETE
  const { count, error: countError } = await supabase
    .from('guardias')
    .select('*', { count: 'exact', head: true })
    .eq('trimestre_id', trim.id);

  if (countError) { alert('Error al verificar: ' + countError.message); return; }

  if (count > 0) {
    alert(`No se puede eliminar "${trim.display_id || trim.nombre}": tiene ${count} guardia${count !== 1 ? 's' : ''} cargada${count !== 1 ? 's' : ''}.\n\nPrimero eliminá todas las guardias del trimestre.`);
    return;
  }

  if (!confirm(`¿Eliminar el trimestre "${trim.display_id || trim.nombre}"?\nEsta acción no se puede deshacer.`)) return;

  const { error } = await supabase.from('trimestres').delete().eq('id', trim.id);
  if (error) {
    alert('Error al eliminar: ' + error.message);
    return;
  }
  await recargarTrimestres(contenedor);
}

async function recargarTrimestres(contenedor) {
  const { data } = await obtenerTrimestres();
  trimestresDisponibles = data ?? [];
  const sel = document.getElementById('adm-sel-trimestre');
  if (sel) {
    sel.innerHTML = trimestresDisponibles.map(t =>
      `<option value="${t.id}" ${t.id === trimestreActivo?.id ? 'selected' : ''}>${t.nombre}</option>`
    ).join('');
  }
  trimestreActivo = trimestresDisponibles.find(t => t.id === trimestreActivo?.id)
    ?? trimestresDisponibles[0];
  actualizarInfoTrimestre();
  mostrarTrimestres(contenedor);
}

function abrirFormTrimestre(trim = null) {
  trimestreEditando = trim;
  document.getElementById('adm-modal-trimestre-titulo').textContent =
    trim ? 'Editar trimestre' : 'Nuevo trimestre';

  const selAsocTrim = document.getElementById('adm-t-asociacion');
  if (selAsocTrim) {
    selAsocTrim.innerHTML = '<option value="">— Seleccioná asociación —</option>' +
      asociaciones.map(a =>
        `<option value="${a.id}" ${trim?.asociacion_id === a.id ? 'selected' : ''}>${a.nombre}</option>`
      ).join('');
    selAsocTrim.disabled = !!trim; // no cambiar asociación al editar
  }

  const idInput = document.getElementById('adm-t-id');
  idInput.value    = trim?.display_id ?? trim?.id ?? '';
  idInput.disabled = false; // display_id sí se puede editar

  document.getElementById('adm-t-nombre').value = trim?.nombre ?? '';
  document.getElementById('adm-t-inicio').value = trim?.fecha_inicio ?? '';
  document.getElementById('adm-t-fin').value    = trim?.fecha_fin ?? '';
  document.getElementById('adm-t-max').value    = trim?.max_guardias_por_medico ?? 12;

  const err = document.getElementById('adm-err-trimestre');
  if (err) err.classList.remove('visible');
  document.getElementById('adm-modal-trimestre').classList.add('visible');
}

async function guardarTrimestre(e) {
  e.preventDefault();
  const displayId    = document.getElementById('adm-t-id').value.trim();
  const nombre       = document.getElementById('adm-t-nombre').value.trim();
  const inicio       = document.getElementById('adm-t-inicio').value;
  const fin          = document.getElementById('adm-t-fin').value;
  const max          = parseInt(document.getElementById('adm-t-max').value);
  const asociacion_id = document.getElementById('adm-t-asociacion')?.value || null;
  const errEl        = document.getElementById('adm-err-trimestre');

  if (!nombre || !inicio || !fin || isNaN(max) || max < 1) {
    if (errEl) { errEl.textContent = 'Completá todos los campos.'; errEl.classList.add('visible'); }
    return;
  }
  if (!trimestreEditando && !displayId) {
    if (errEl) { errEl.textContent = 'El identificador es obligatorio.'; errEl.classList.add('visible'); }
    return;
  }
  if (!trimestreEditando && !asociacion_id) {
    if (errEl) { errEl.textContent = 'Seleccioná una asociación.'; errEl.classList.add('visible'); }
    return;
  }
  if (fin <= inicio) {
    if (errEl) { errEl.textContent = 'La fecha fin debe ser posterior a la fecha inicio.'; errEl.classList.add('visible'); }
    return;
  }
  if (errEl) errEl.classList.remove('visible');

  setCargando('adm-btn-guardar-trimestre', 'adm-spin-trimestre', 'adm-txt-trimestre', true);

  let error;
  if (trimestreEditando) {
    ({ error } = await supabase.from('trimestres')
      .update({ nombre, fecha_inicio: inicio, fecha_fin: fin, max_guardias_por_medico: max,
                display_id: displayId })
      .eq('id', trimestreEditando.id));
  } else {
    const nuevoId = crypto.randomUUID();
    ({ error } = await supabase.from('trimestres')
      .insert([{ id: nuevoId, display_id: displayId, nombre, fecha_inicio: inicio, fecha_fin: fin,
                 max_guardias_por_medico: max, inscripciones_abiertas: false, asociacion_id }]));
  }

  setCargando('adm-btn-guardar-trimestre', 'adm-spin-trimestre', 'adm-txt-trimestre', false);

  if (error) {
    const msg = error.message.includes('duplicate')
      ? 'Ya existe ese identificador para esta asociación.'
      : 'Error al guardar: ' + error.message;
    if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
    return;
  }

  cerrarModalAdmin('adm-modal-trimestre');
  const contenedor = document.getElementById('adm-trimestres-contenido');
  await recargarTrimestres(contenedor);
}

// ── Iconos SVG ────────────────────────────────────────────

// ── Asociaciones ──────────────────────────────────────────

function renderizarAsociaciones() {
  const contenedor = document.getElementById('adm-asociaciones-contenido');
  if (!contenedor) return;
  cargarYMostrarAsociaciones(contenedor);
}

async function cargarYMostrarAsociaciones(contenedor) {
  contenedor.innerHTML = '<div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>';

  const { data, error } = await supabase
    .from('asociaciones')
    .select('id, nombre, descripcion, activa, creada_en')
    .order('nombre');

  asociaciones = data ?? [];

  if (error) {
    const msg = error.message.includes('relation') || error.message.includes('does not exist')
      ? 'Ejecutá el script <strong>sql/11_asociaciones.sql</strong> en Supabase para habilitar esta sección.'
      : 'Error al cargar: ' + error.message;
    contenedor.innerHTML = `<p class="text-bad py-8 text-center">${msg}</p>`;
    return;
  }

  if (!data.length) {
    contenedor.innerHTML = `
      <div class="text-center py-16 text-ink-mute text-sm">
        No hay asociaciones. Creá la primera con el botón de arriba.
      </div>`;
    return;
  }

  contenedor.innerHTML = `
    <div class="space-y-3">
      ${data.map(a => `
        <div class="bg-surface border border-line rounded-xl p-5">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <div class="font-semibold text-ink flex items-center gap-2">
                ${escapeHtml(a.nombre)}
                ${!a.activa ? '<span class="badge badge-warn">Inactiva</span>' : ''}
              </div>
              ${a.descripcion
                ? `<div class="text-xs text-ink-mute mt-1">${escapeHtml(a.descripcion)}</div>`
                : ''}
              <div class="text-xs text-ink-mute mt-1">
                ${sedes.filter(s => s.asociacion_id === a.id).length} sedes asignadas
              </div>
            </div>
            <div class="flex gap-2">
              <button class="btn-ghost text-xs"
                data-accion-asoc="editar" data-asoc-id="${a.id}">Editar</button>
              <button class="btn-ghost text-xs text-bad hover:!bg-red-50 hover:!border-red-200"
                data-accion-asoc="eliminar" data-asoc-id="${a.id}"
                data-asoc-nombre="${escapeHtml(a.nombre)}">Eliminar</button>
            </div>
          </div>
        </div>`).join('')}
    </div>`;

  contenedor.querySelectorAll('[data-accion-asoc]').forEach(btn => {
    btn.addEventListener('click', () => {
      const asoc = asociaciones.find(a => a.id === btn.dataset.asocId);
      if (!asoc) return;
      if (btn.dataset.accionAsoc === 'editar')   abrirFormAsociacion(asoc);
      if (btn.dataset.accionAsoc === 'eliminar') confirmarEliminarAsociacion(asoc, contenedor);
    });
  });
}

function abrirFormAsociacion(asoc = null) {
  asociacionEditando = asoc;
  document.getElementById('adm-modal-asociacion-titulo').textContent =
    asoc ? 'Editar asociación' : 'Nueva asociación';
  document.getElementById('adm-a-nombre').value      = asoc?.nombre ?? '';
  document.getElementById('adm-a-descripcion').value = asoc?.descripcion ?? '';
  const err = document.getElementById('adm-err-asociacion');
  if (err) err.classList.remove('visible');
  document.getElementById('adm-modal-asociacion').classList.add('visible');
}

async function guardarAsociacion(e) {
  e.preventDefault();
  const nombre      = document.getElementById('adm-a-nombre').value.trim();
  const descripcion = document.getElementById('adm-a-descripcion').value.trim();
  const errEl       = document.getElementById('adm-err-asociacion');

  if (!nombre) {
    if (errEl) { errEl.textContent = 'El nombre es obligatorio.'; errEl.classList.add('visible'); }
    return;
  }
  if (errEl) errEl.classList.remove('visible');

  setCargando('adm-btn-guardar-asociacion', 'adm-spin-asociacion', 'adm-txt-asociacion', true);

  let error;
  if (asociacionEditando) {
    ({ error } = await supabase.from('asociaciones')
      .update({ nombre, descripcion: descripcion || null })
      .eq('id', asociacionEditando.id));
  } else {
    ({ error } = await supabase.from('asociaciones')
      .insert([{ nombre, descripcion: descripcion || null }]));
  }

  setCargando('adm-btn-guardar-asociacion', 'adm-spin-asociacion', 'adm-txt-asociacion', false);

  if (error) {
    const msg = error.message.includes('unique')
      ? 'Ya existe una asociación con ese nombre.'
      : error.message.includes('relation') || error.message.includes('does not exist')
        ? 'La tabla no existe. Ejecutá el script sql/11_asociaciones.sql en Supabase primero.'
        : 'Error al guardar: ' + error.message;
    if (errEl) { errEl.textContent = msg; errEl.classList.add('visible'); }
    return;
  }

  cerrarModalAdmin('adm-modal-asociacion');
  const contenedor = document.getElementById('adm-asociaciones-contenido');
  await cargarYMostrarAsociaciones(contenedor);
}

async function confirmarEliminarAsociacion(asoc, contenedor) {
  if (!confirm(`¿Eliminar la asociación "${asoc.nombre}"?\nSe desasignarán las sedes vinculadas.`)) return;
  const { error } = await supabase.from('asociaciones').delete().eq('id', asoc.id);
  if (error) {
    alert('No se pudo eliminar: ' + (error.message.includes('foreign')
      ? 'La asociación tiene trimestres o usuarios vinculados.'
      : error.message));
    return;
  }
  await cargarYMostrarAsociaciones(contenedor);
}

// ── Iconos SVG ────────────────────────────────────────────

function svgAsociaciones(s = 16) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    <line x1="19" y1="8" x2="23" y2="8"/>
    <line x1="21" y1="6" x2="21" y2="10"/>
  </svg>`;
}

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

// ── Dashboard ─────────────────────────────────────────────

async function mostrarDashboard() {
  const sel = document.getElementById('adm-dash-trimestre');
  if (sel && !sel.dataset.cargado) {
    sel.dataset.cargado = '1';
    sel.innerHTML = trimestresDisponibles
      .map(t => `<option value="${t.id}" ${t.id === trimestreActivo?.id ? 'selected' : ''}>${t.nombre}</option>`)
      .join('') || '<option>Sin trimestres</option>';
    sel.addEventListener('change', () => cargarDashboard(sel.value));
  }
  await cargarDashboard(sel?.value || trimestreActivo?.id);
}

async function cargarDashboard(trimestreId) {
  if (!trimestreId) return;
  await asegurarChartJS();
  const contenido = document.getElementById('adm-dash-contenido');
  if (contenido) contenido.innerHTML =
    '<div class="space-y-3 py-8 px-2"><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div><div class="shimmer-placeholder h-14 w-full"></div></div>';

  dashCharts.forEach(c => c.destroy());
  dashCharts = [];

  const { data: guardias } = await supabase
    .from('guardias_con_cupos')
    .select('*')
    .eq('trimestre_id', trimestreId)
    .order('fecha');

  if (!guardias?.length) {
    if (contenido) contenido.innerHTML =
      '<div class="py-16 text-center text-ink-mute text-sm">No hay guardias en este trimestre.</div>';
    return;
  }

  const totalGuardias = guardias.length;
  const totalCupos    = guardias.reduce((s, g) => s + g.cupos_totales,  0);
  const ocupados      = guardias.reduce((s, g) => s + g.cupos_ocupados, 0);
  const pct           = totalCupos > 0 ? Math.round(ocupados / totalCupos * 100) : 0;

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
  const [{ data: inscripciones }, { data: perfiles }] = await Promise.all([
    supabase.from('inscripciones').select('medico_id').in('guardia_id', guardiaIds),
    supabase.from('profiles').select('id, nombre, apellido').eq('rol', 'medico'),
  ]);

  const medicoCount = {};
  (inscripciones ?? []).forEach(i => {
    medicoCount[i.medico_id] = (medicoCount[i.medico_id] ?? 0) + 1;
  });
  const perfilMap = Object.fromEntries((perfiles ?? []).map(p => [p.id, `${p.nombre} ${p.apellido}`]));
  const topMedicos = Object.entries(medicoCount)
    .map(([id, count]) => ({ nombre: perfilMap[id] ?? 'Médico', count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const mesesKeys    = Object.keys(porMes).sort();
  const mesesLabels  = mesesKeys.map(m => MESES_C[parseInt(m.split('-')[1]) - 1]);
  const sedesNombres = Object.keys(porSede);

  if (contenido) {
    contenido.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        ${statCard('Guardias', totalGuardias, 'en el trimestre')}
        ${statCard('Cupos totales', totalCupos, 'disponibles')}
        ${statCard('Cupos ocupados', ocupados, 'inscripciones')}
        ${statCard('Ocupación', pct + '%', 'del total disponible')}
      </div>
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div class="bg-surface border border-line rounded-xl p-5">
          <h3 class="font-medium text-sm text-ink mb-4">Guardias por mes</h3>
          <canvas id="adm-chart-meses"></canvas>
        </div>
        <div class="bg-surface border border-line rounded-xl p-5">
          <h3 class="font-medium text-sm text-ink mb-4">Ocupación por sede</h3>
          <canvas id="adm-chart-sedes"></canvas>
        </div>
      </div>
      <div class="bg-surface border border-line rounded-xl p-5">
        <h3 class="font-medium text-sm text-ink mb-4">Médicos más activos</h3>
        ${topMedicos.length === 0
          ? '<p class="text-ink-mute text-sm text-center py-6">Sin inscripciones en este trimestre.</p>'
          : `<div class="space-y-1">
              ${topMedicos.map((m, i) => `
                <div class="flex items-center gap-3 py-2.5 ${i < topMedicos.length - 1 ? 'border-b border-line' : ''}">
                  <span class="w-6 h-6 rounded-full bg-accent-soft text-primary text-xs font-bold
                               flex items-center justify-center flex-shrink-0">${i + 1}</span>
                  <span class="flex-1 text-sm font-medium text-ink">${m.nombre}</span>
                  <span class="text-sm font-semibold text-primary">${m.count} guardia${m.count !== 1 ? 's' : ''}</span>
                </div>`).join('')}
             </div>`
        }
      </div>`;

    {
      dashCharts.push(new window.Chart(document.getElementById('adm-chart-meses'), {
        type: 'bar',
        data: {
          labels: mesesLabels,
          datasets: [{
            label: 'Guardias',
            data: mesesKeys.map(m => porMes[m]),
            backgroundColor: '#0f3b3a',
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } },
        },
      }));

      dashCharts.push(new window.Chart(document.getElementById('adm-chart-sedes'), {
        type: 'bar',
        data: {
          labels: sedesNombres,
          datasets: [
            {
              label: 'Ocupados',
              data: sedesNombres.map(s => porSede[s].ocupados),
              backgroundColor: sedesNombres.map(s => porSede[s].color),
              borderRadius: 4,
            },
            {
              label: 'Disponibles',
              data: sedesNombres.map(s => porSede[s].totales - porSede[s].ocupados),
              backgroundColor: '#e8e4dc',
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: true,
          indexAxis: 'y',
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } },
        },
      }));
    }
  }
}

function statCard(titulo, valor, subtitulo) {
  return `
    <div class="bg-surface border border-line rounded-xl p-5">
      <div class="text-xs uppercase tracking-wider text-ink-mute font-semibold">${titulo}</div>
      <div class="font-display text-3xl text-ink mt-2 mb-1">${valor}</div>
      <div class="text-xs text-ink-mute">${subtitulo}</div>
    </div>`;
}
