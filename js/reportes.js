// ============================================================
// reportes.js — Generación de archivos Excel (.xlsx)
// Usa la librería SheetJS cargada como global window.XLSX
// ============================================================

import { supabase } from './supabase-client.js';

async function asegurarXLSX() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    script.onload  = () => resolve(window.XLSX);
    script.onerror = () => reject(new Error('No se pudo cargar la librería para exportar Excel.'));
    document.head.appendChild(script);
  });
}

const DIAS_ES  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
const MESES_ES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function diaSemana(fechaStr) {
  const [a, m, d] = fechaStr.split('-').map(Number);
  return DIAS_ES[new Date(a, m - 1, d).getDay()];
}

function mesAnio(fechaStr) {
  const [a, m] = fechaStr.split('-').map(Number);
  return `${MESES_ES[m - 1]} ${a}`;
}

function formatHora(h) {
  return h ? String(h).slice(0, 5) : '';
}

function sanitizarNombreHoja(nombre) {
  return nombre.replace(/[:\\/?*[\]]/g, '').slice(0, 31);
}

// Devuelve true si la guardia ya terminó al momento de generar el Excel
function guardiaYaRealizada(fecha, horaInicio, duracionHoras) {
  if (!fecha) return false;
  const [h, m] = (horaInicio ?? '00:00').split(':').map(Number);
  const fin = new Date(fecha + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
  fin.setHours(fin.getHours() + (Number(duracionHoras) || 0));
  return new Date() > fin;
}

function etiquetaEstado(fecha, horaInicio, duracionHoras, estadoInscripcion) {
  if (guardiaYaRealizada(fecha, horaInicio, duracionHoras)) return 'Realizada';
  if (estadoInscripcion === 'asignada_admin') return 'Asignada por admin';
  return 'Confirmada';
}

function aplicarEstilosEncabezado(ws, ncols) {
  for (let c = 0; c < ncols; c++) {
    const addr = XLSX.utils.encode_cell({ r: 0, c });
    if (!ws[addr]) continue;
    ws[addr].s = {
      font:      { bold: true, color: { rgb: 'FFFFFF' } },
      fill:      { fgColor: { rgb: '2D3748' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        bottom: { style: 'thin', color: { rgb: 'AAAAAA' } },
      },
    };
  }
}


// ── Admin: reporte completo de un trimestre (+ sede opcional) ──────────────

export async function exportarReporteAdmin(guardias, trimestreNombre, sedeNombre) {
  const XLSX = await asegurarXLSX();
  if (!XLSX) { alert('Error: librería Excel no cargada.'); return; }

  if (!guardias?.length) {
    alert('No hay guardias para exportar con los filtros actuales.');
    return;
  }

  // Obtener inscripciones confirmadas para las guardias visibles
  const guardiaIds = guardias.map(g => g.id);

  const { data: inscripciones, error } = await supabase
    .from('inscripciones')
    .select(`
      guardia_id, estado,
      medico:profiles!medico_id(nombre, apellido, matricula, especialidad)
    `)
    .in('guardia_id', guardiaIds)
    .in('estado', ['confirmada', 'asignada_admin']);

  if (error) { alert('Error al obtener datos. Intentá de nuevo.'); return; }

  // Agrupar inscripciones por guardia
  const inscPorGuardia = {};
  (inscripciones ?? []).forEach(i => {
    if (!inscPorGuardia[i.guardia_id]) inscPorGuardia[i.guardia_id] = [];
    inscPorGuardia[i.guardia_id].push(i);
  });

  // Agrupar guardias por mes
  const mesesMap = {};
  guardias.forEach(g => {
    const mes = mesAnio(g.fecha);
    if (!mesesMap[mes]) mesesMap[mes] = [];

    const insc = inscPorGuardia[g.id] ?? [];
    const sedeName = g.sede_nombre ?? sedeNombre ?? '';

    if (!insc.length) {
      mesesMap[mes].push([
        g.fecha, diaSemana(g.fecha), formatHora(g.hora_inicio),
        g.duracion_horas, sedeName, g.servicio ?? '',
        '', '', '', '', 'Sin inscripciones',
      ]);
    } else {
      insc.forEach(i => {
        mesesMap[mes].push([
          g.fecha, diaSemana(g.fecha), formatHora(g.hora_inicio),
          g.duracion_horas, sedeName, g.servicio ?? '',
          i.medico?.nombre    ?? '',
          i.medico?.apellido  ?? '',
          i.medico?.matricula ?? '',
          i.medico?.especialidad ?? '',
          etiquetaEstado(g.fecha, g.hora_inicio, g.duracion_horas, i.estado),
        ]);
      });
    }
  });

  const HEADERS = [
    'Fecha', 'Día', 'Hora inicio', 'Duración (hs)',
    'Sede', 'Servicio',
    'Nombre', 'Apellido', 'Matrícula', 'Especialidad', 'Estado',
  ];
  const ANCHOS = [12, 12, 11, 13, 22, 22, 15, 15, 12, 20, 18];

  const wb = XLSX.utils.book_new();

  Object.entries(mesesMap).forEach(([mes, filas]) => {
    const wsData = [HEADERS, ...filas];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = ANCHOS.map(w => ({ wch: w }));
    aplicarEstilosEncabezado(ws, HEADERS.length);
    XLSX.utils.book_append_sheet(wb, ws, sanitizarNombreHoja(mes));
  });

  // Hoja resumen
  const resumenData = [
    ['Trimestre', trimestreNombre ?? ''],
    ['Sede', sedeNombre ?? 'Todas las sedes'],
    ['Total guardias', guardias.length],
    ['Total inscripciones', (inscripciones ?? []).length],
    ['Guardias sin inscripciones', guardias.filter(g => !inscPorGuardia[g.id]?.length).length],
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
  wsResumen['!cols'] = [{ wch: 24 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  const sedeLabel = sedeNombre ? `_${sedeNombre.replace(/\s+/g, '_')}` : '';
  const trimLabel = (trimestreNombre ?? 'trimestre').replace(/\s+/g, '_');
  XLSX.writeFile(wb, `Guardias_${trimLabel}${sedeLabel}.xlsx`);
}


// ── Asociación: reporte completo (misma lógica que admin, diferente filename) ─

export async function exportarReporteAsociacion(guardias, trimestreNombre, sedeNombre, asociacionNombre) {
  const XLSX = await asegurarXLSX();
  if (!XLSX) { alert('Error: librería Excel no cargada.'); return; }

  if (!guardias?.length) {
    alert('No hay guardias para exportar con los filtros actuales.');
    return;
  }

  const guardiaIds = guardias.map(g => g.id);

  const { data: inscripciones, error } = await supabase
    .from('inscripciones')
    .select(`
      guardia_id, estado,
      medico:profiles!medico_id(nombre, apellido, matricula, especialidad)
    `)
    .in('guardia_id', guardiaIds)
    .in('estado', ['confirmada', 'asignada_admin']);

  if (error) { alert('Error al obtener datos. Intentá de nuevo.'); return; }

  const inscPorGuardia = {};
  (inscripciones ?? []).forEach(i => {
    if (!inscPorGuardia[i.guardia_id]) inscPorGuardia[i.guardia_id] = [];
    inscPorGuardia[i.guardia_id].push(i);
  });

  const mesesMap = {};
  guardias.forEach(g => {
    const mes = mesAnio(g.fecha);
    if (!mesesMap[mes]) mesesMap[mes] = [];

    const insc     = inscPorGuardia[g.id] ?? [];
    const sedeName = g.sede_nombre ?? sedeNombre ?? '';

    if (!insc.length) {
      mesesMap[mes].push([
        g.fecha, diaSemana(g.fecha), formatHora(g.hora_inicio),
        g.duracion_horas, sedeName, g.servicio ?? '',
        '', '', '', '', 'Sin inscripciones',
      ]);
    } else {
      insc.forEach(i => {
        mesesMap[mes].push([
          g.fecha, diaSemana(g.fecha), formatHora(g.hora_inicio),
          g.duracion_horas, sedeName, g.servicio ?? '',
          i.medico?.nombre       ?? '',
          i.medico?.apellido     ?? '',
          i.medico?.matricula    ?? '',
          i.medico?.especialidad ?? '',
          etiquetaEstado(g.fecha, g.hora_inicio, g.duracion_horas, i.estado),
        ]);
      });
    }
  });

  const HEADERS = [
    'Fecha', 'Día', 'Hora inicio', 'Duración (hs)',
    'Sede', 'Servicio',
    'Nombre', 'Apellido', 'Matrícula', 'Especialidad', 'Estado',
  ];
  const ANCHOS = [12, 12, 11, 13, 22, 22, 15, 15, 12, 20, 18];

  const wb = XLSX.utils.book_new();

  Object.entries(mesesMap).forEach(([mes, filas]) => {
    const wsData = [HEADERS, ...filas];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws['!cols'] = ANCHOS.map(w => ({ wch: w }));
    aplicarEstilosEncabezado(ws, HEADERS.length);
    XLSX.utils.book_append_sheet(wb, ws, sanitizarNombreHoja(mes));
  });

  const resumenData = [
    ['Asociación', asociacionNombre ?? ''],
    ['Trimestre',  trimestreNombre  ?? ''],
    ['Sede',       sedeNombre ?? 'Todas las sedes'],
    ['Total guardias',           guardias.length],
    ['Total inscripciones',      (inscripciones ?? []).length],
    ['Guardias sin inscripciones', guardias.filter(g => !inscPorGuardia[g.id]?.length).length],
  ];
  const wsResumen = XLSX.utils.aoa_to_sheet(resumenData);
  wsResumen['!cols'] = [{ wch: 24 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, wsResumen, 'Resumen');

  const asocLabel  = (asociacionNombre ?? 'Asociacion').replace(/\s+/g, '_');
  const sedeLabel  = sedeNombre ? `_${sedeNombre.replace(/\s+/g, '_')}` : '';
  const trimLabel  = (trimestreNombre ?? 'trimestre').replace(/\s+/g, '_');
  XLSX.writeFile(wb, `Guardias_${asocLabel}_${trimLabel}${sedeLabel}.xlsx`);
}


// ── Médico: sus guardias de un trimestre ──────────────────────────────────

export async function exportarReporteMedico(trimestre, nombreCompleto, inscripciones, sinInscripcion = []) {
  const XLSX = await asegurarXLSX();
  if (!XLSX) { alert('Error: librería Excel no cargada.'); return; }

  const filasInscriptas = (inscripciones ?? [])
    .filter(i => i.guardia?.trimestre?.id === trimestre?.id)
    .sort((a, b) => a.guardia.fecha.localeCompare(b.guardia.fecha))
    .map(i => {
      const g = i.guardia;
      return [
        g.fecha,
        diaSemana(g.fecha),
        formatHora(g.hora_inicio),
        g.duracion_horas,
        g.sede?.nombre ?? '',
        g.servicio ?? '',
        etiquetaEstado(g.fecha, g.hora_inicio, g.duracion_horas, i.estado),
      ];
    });

  const filasSinInscripcion = (sinInscripcion ?? [])
    .sort((a, b) => a.fecha.localeCompare(b.fecha))
    .map(g => [
      g.fecha,
      diaSemana(g.fecha),
      formatHora(g.hora_inicio),
      g.duracion_horas,
      g.sede_nombre ?? '',
      g.servicio ?? '',
      'Sin inscripción',
    ]);

  const filas = [...filasInscriptas, ...filasSinInscripcion]
    .sort((a, b) => a[0].localeCompare(b[0]));

  if (!filas.length) {
    alert('No hay guardias para exportar en este trimestre.');
    return;
  }

  const HEADERS = ['Fecha', 'Día', 'Hora inicio', 'Duración (hs)', 'Sede', 'Servicio', 'Estado'];
  const ANCHOS  = [12, 12, 11, 13, 22, 22, 18];

  const wb     = XLSX.utils.book_new();
  const wsData = [HEADERS, ...filas];
  const ws     = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols']  = ANCHOS.map(w => ({ wch: w }));
  aplicarEstilosEncabezado(ws, HEADERS.length);

  XLSX.utils.book_append_sheet(wb, ws, sanitizarNombreHoja(trimestre?.nombre ?? 'Guardias'));

  const nombre    = nombreCompleto.replace(/\s+/g, '_');
  const trimLabel = (trimestre?.nombre ?? 'trimestre').replace(/\s+/g, '_');
  XLSX.writeFile(wb, `MisGuardias_${nombre}_${trimLabel}.xlsx`);
}
