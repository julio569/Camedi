// ============================================================
// calendar.js — Renderizado del calendario mensual
// ============================================================

import { MESES, hoyISO } from './utils.js';

/**
 * Renderiza el grid de un mes dentro del elemento #contenedorId.
 *
 * @param {string}   contenedorId  - ID del div grid (7 columnas)
 * @param {number}   año
 * @param {number}   mes           - 1-indexed (enero=1)
 * @param {Array}    guardias      - guardias del mes (objetos de guardias_con_cupos)
 * @param {Set}      misGuardiaIds - Set de guardia.id donde el médico está inscripto
 * @param {Function} alClickar     - callback(guardia) al hacer click en un chip
 */
export function renderizarCalendario(contenedorId, año, mes, guardias, misGuardiaIds, alClickar) {
  const contenedor = document.getElementById(contenedorId);
  if (!contenedor) return;

  // Día de semana del primer día del mes (lunes=0 … domingo=6)
  const primerDia    = new Date(año, mes - 1, 1);
  const diasEnElMes  = new Date(año, mes, 0).getDate();
  const offsetInicio = (primerDia.getDay() + 6) % 7;
  const diasMesAnt   = new Date(año, mes - 1, 0).getDate();

  // Construir array de 42 celdas (6 filas × 7 columnas)
  const celdas = [];

  // Días finales del mes anterior (relleno inicial)
  for (let i = offsetInicio - 1; i >= 0; i--) {
    celdas.push({ dia: diasMesAnt - i, otroMes: true, fecha: null });
  }

  // Días del mes actual
  for (let d = 1; d <= diasEnElMes; d++) {
    const fecha = `${año}-${String(mes).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    celdas.push({ dia: d, otroMes: false, fecha });
  }

  // Días del mes siguiente (relleno final)
  let sig = 1;
  while (celdas.length < 42) celdas.push({ dia: sig++, otroMes: true, fecha: null });

  // Agrupar guardias por fecha para acceso O(1)
  const porFecha = {};
  for (const g of guardias) {
    if (!porFecha[g.fecha]) porFecha[g.fecha] = [];
    porFecha[g.fecha].push(g);
  }

  const hoy = hoyISO();

  contenedor.innerHTML = celdas.map(celda => {
    const esHoy = celda.fecha === hoy;
    const guardiasDelDia = celda.fecha ? (porFecha[celda.fecha] || []) : [];

    const esCeldaPasada = celda.fecha !== null && celda.fecha < hoy;

    const chips = guardiasDelDia.map(g => {
      // Prioridad: inscripto-finalizado > inscripto > pasada > lleno > pocos > libre
      let claseChip;
      if (misGuardiaIds.has(g.id) && esCeldaPasada) claseChip = 'chip-finalizada';
      else if (misGuardiaIds.has(g.id))              claseChip = 'chip-mio';
      else if (esCeldaPasada)                        claseChip = 'chip-pasada';
      else if (g.cupos_libres <= 0)                  claseChip = 'chip-lleno';
      else if (g.cupos_libres === 1)                 claseChip = 'chip-pocos';
      else                                           claseChip = 'chip-libre';

      const etiqueta = `${g.sede_nombre} · ${g.servicio}`;
      const cuposTexto = `${g.cupos_libres} cupo${g.cupos_libres !== 1 ? 's' : ''} libre${g.cupos_libres !== 1 ? 's' : ''}`;
      return `<span
        class="chip ${claseChip}"
        data-guardia-id="${g.id}"
        title="${etiqueta} — ${cuposTexto}"
      >${etiqueta}</span>`;
    }).join('');

    return `<div class="cal-cell ${celda.otroMes ? 'otro-mes' : ''} ${esHoy ? 'ring-1 ring-inset ring-primary/40' : ''}">
      <div class="cal-day-num ${esHoy ? 'text-primary' : ''}">${celda.dia}</div>
      ${chips}
    </div>`;
  }).join('');

  // Delegar los clicks a chips (más eficiente que un listener por chip)
  contenedor.removeEventListener('click', manejadorClickGrid);
  contenedor.addEventListener('click', manejadorClickGrid);
  contenedor._guardias  = guardias;
  contenedor._alClickar = alClickar;
}

// Handler delegado para chips del calendario
function manejadorClickGrid(e) {
  const chip = e.target.closest('.chip[data-guardia-id]');
  if (!chip) return;
  const guardia = this._guardias?.find(g => g.id === chip.dataset.guardiaId);
  if (guardia && this._alClickar) this._alClickar(guardia);
}

/**
 * Actualiza el título del mes y habilita/deshabilita los botones
 * de navegación según los límites del trimestre.
 */
export function actualizarHeaderMes(año, mes, fechaInicioTrimestre, fechaFinTrimestre) {
  const titulo = document.getElementById('cal-mes-titulo');
  if (titulo) titulo.textContent = `${MESES[mes - 1]} ${año}`;

  const btnPrev = document.getElementById('cal-btn-prev');
  const btnNext = document.getElementById('cal-btn-next');

  if (btnPrev) {
    const [aI, mI] = fechaInicioTrimestre.split('-').map(Number);
    btnPrev.disabled = año < aI || (año === aI && mes <= mI);
  }
  if (btnNext) {
    const [aF, mF] = fechaFinTrimestre.split('-').map(Number);
    btnNext.disabled = año > aF || (año === aF && mes >= mF);
  }
}
