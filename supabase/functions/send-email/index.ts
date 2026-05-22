// ============================================================
// send-email — Supabase Edge Function
// Maneja 3 tipos de notificación:
//   • confirmacion      → email al médico al inscribirse
//   • inscripciones_abiertas → email a todos los médicos de la asociación
//   • recordatorio_48h  → cron diario: avisa guardias dentro de 48hs
//
// Requiere:
//   RESEND_API_KEY  → Supabase Dashboard > Settings > Edge Function Secrets
//   SUPABASE_URL    → inyectada automáticamente por Supabase
//   SUPABASE_SERVICE_ROLE_KEY → inyectada automáticamente por Supabase
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const RESEND_API_KEY     = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL       = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SRK       = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const FROM_EMAIL         = 'Camedi <notificaciones@camedi.net>';

const supabase = createClient(SUPABASE_URL, SUPABASE_SRK);

// ── Helpers ──────────────────────────────────────────────

async function enviarEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  });
  return res.ok;
}

function formatFecha(fecha: string) {
  const [a, m, d] = fecha.split('-').map(Number);
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
                 'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const dow = new Date(a, m - 1, d).getDay();
  return `${dias[dow]} ${d} de ${meses[m - 1]} de ${a}`;
}

function formatHora(h: string) {
  return h ? String(h).slice(0, 5) : '';
}

function plantillaBase(titulo: string, cuerpo: string) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f1eb;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1eb;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-radius:16px;overflow:hidden;
                    box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr><td style="background:#0f3b3a;padding:28px 32px;text-align:center;">
          <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">Camedi</span>
          <div style="font-size:11px;color:rgba(255,255,255,0.5);letter-spacing:3px;
                      text-transform:uppercase;margin-top:4px;">Sistema de guardias</div>
        </td></tr>
        <!-- Cuerpo -->
        <tr><td style="padding:32px;">
          <h2 style="margin:0 0 16px;font-size:20px;color:#1a2e1a;font-weight:600;">${titulo}</h2>
          ${cuerpo}
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:20px 32px;border-top:1px solid #e8e4dc;text-align:center;">
          <p style="margin:0;font-size:12px;color:#a0a0a0;">
            © Camedi 2026 — Sistema de guardias médicas.<br>
            Este es un mensaje automático, no respondas a este correo.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Handlers por tipo ────────────────────────────────────

async function handleConfirmacion(payload: Record<string, string>) {
  const { guardia_id, medico_email, medico_nombre } = payload;
  if (!guardia_id || !medico_email) return new Response('missing params', { status: 400 });

  const { data: guardia } = await supabase
    .from('guardias')
    .select('fecha, hora_inicio, duracion_horas, servicio, sedes(nombre)')
    .eq('id', guardia_id)
    .single();

  if (!guardia) return new Response('guardia not found', { status: 404 });

  const sedeName = (guardia.sedes as { nombre: string })?.nombre ?? '';
  const cuerpo = `
    <p style="color:#555;line-height:1.6;margin:0 0 20px;">
      Hola${medico_nombre ? ' <strong>' + medico_nombre + '</strong>' : ''}. Tu inscripción fue <strong style="color:#0f3b3a;">confirmada</strong>.
    </p>
    <div style="background:#f4f1eb;border-radius:10px;padding:20px;margin:0 0 20px;">
      <div style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Guardia confirmada</div>
      <div style="font-size:18px;font-weight:600;color:#1a2e1a;margin-bottom:4px;">${formatFecha(guardia.fecha)}</div>
      <div style="color:#555;font-size:14px;">
        ${formatHora(guardia.hora_inicio)} · ${guardia.duracion_horas}hs
        ${sedeName ? ' · ' + sedeName : ''}
        ${guardia.servicio ? ' · ' + guardia.servicio : ''}
      </div>
    </div>
    <p style="color:#888;font-size:13px;margin:0;">
      Recordá que podés cancelar tu inscripción hasta 48 horas antes de la guardia.
    </p>`;

  await enviarEmail(medico_email, `✓ Guardia confirmada — ${formatFecha(guardia.fecha)}`, plantillaBase('Inscripción confirmada', cuerpo));
  return new Response('ok', { status: 200 });
}

async function handleInscripcionesAbiertas(payload: Record<string, string>) {
  const { trimestre_id, asociacion_id } = payload;
  if (!trimestre_id) return new Response('missing params', { status: 400 });

  const { data: trimestre } = await supabase
    .from('trimestres')
    .select('nombre, display_id, fecha_inicio, fecha_fin')
    .eq('id', trimestre_id)
    .single();

  if (!trimestre) return new Response('trimestre not found', { status: 404 });

  // Obtener médicos activos de la asociación con su email
  let query = supabase
    .from('profiles')
    .select('id, nombre, apellido')
    .eq('rol', 'medico')
    .eq('activo', true);

  if (asociacion_id) query = query.eq('asociacion_id', asociacion_id);

  const { data: medicos } = await query;
  if (!medicos?.length) return new Response('no medicos', { status: 200 });

  // Buscar emails desde auth.users (service role)
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const emailPorId = Object.fromEntries(users.map(u => [u.id, u.email ?? '']));

  const nombreTrimestre = trimestre.display_id || trimestre.nombre;
  const cuerpo = `
    <p style="color:#555;line-height:1.6;margin:0 0 20px;">
      Se abrieron las inscripciones para el trimestre <strong style="color:#0f3b3a;">${nombreTrimestre}</strong>.
    </p>
    <div style="background:#f4f1eb;border-radius:10px;padding:20px;margin:0 0 20px;">
      <div style="font-size:13px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">Período</div>
      <div style="color:#555;font-size:14px;">${trimestre.fecha_inicio} → ${trimestre.fecha_fin}</div>
    </div>
    <p style="color:#555;font-size:14px;margin:0 0 20px;">
      Ingresá a la app para ver las guardias disponibles y anotarte.
    </p>
    <div style="text-align:center;">
      <a href="https://camedi.net" style="display:inline-block;background:#0f3b3a;color:#fff;
         text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
        Ver guardias disponibles →
      </a>
    </div>`;

  let enviados = 0;
  for (const m of medicos) {
    const email = emailPorId[m.id];
    if (!email) continue;
    const ok = await enviarEmail(
      email,
      `📋 Inscripciones abiertas — ${nombreTrimestre}`,
      plantillaBase(`Se abrieron las inscripciones — ${nombreTrimestre}`, cuerpo)
    );
    if (ok) enviados++;
  }

  return new Response(JSON.stringify({ enviados }), { status: 200 });
}

async function handleRecordatorio48h() {
  const ahora      = new Date();
  const en48h      = new Date(ahora.getTime() + 48 * 60 * 60 * 1000);
  const desdeFecha = en48h.toISOString().slice(0, 10);
  const hastaFecha = new Date(en48h.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Query 1: guardias en el rango de fechas
  const { data: guardiasProximas } = await supabase
    .from('guardias')
    .select('id, fecha, hora_inicio, duracion_horas, servicio, sedes(nombre)')
    .gte('fecha', desdeFecha)
    .lt('fecha', hastaFecha);

  if (!guardiasProximas?.length) return new Response(JSON.stringify({ enviados: 0 }), { status: 200 });

  // Query 2: inscripciones confirmadas para esas guardias
  const guardiaIds = guardiasProximas.map(g => g.id);
  const { data: inscripciones } = await supabase
    .from('inscripciones')
    .select('medico_id, guardia_id')
    .in('guardia_id', guardiaIds)
    .in('estado', ['confirmada', 'asignada_admin']);

  if (!inscripciones?.length) return new Response(JSON.stringify({ enviados: 0 }), { status: 200 });

  const guardiaPorId = Object.fromEntries(guardiasProximas.map(g => [g.id, g]));
  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const emailPorId = Object.fromEntries(users.map(u => [u.id, u.email ?? '']));

  let enviados = 0;
  for (const insc of inscripciones) {
    const email = emailPorId[insc.medico_id];
    if (!email) continue;
    const g = guardiaPorId[insc.guardia_id] as {
      fecha: string; hora_inicio: string; duracion_horas: number;
      servicio: string; sedes: { nombre: string };
    };
    if (!g) continue;
    const sedeName = (g.sedes as { nombre: string })?.nombre ?? '';
    const cuerpo = `
      <p style="color:#555;line-height:1.6;margin:0 0 20px;">
        Este es un recordatorio: tenés una guardia programada en <strong>menos de 48 horas</strong>.
      </p>
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:10px;padding:20px;margin:0 0 20px;">
        <div style="font-size:13px;color:#856404;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;">⏰ Guardia próxima</div>
        <div style="font-size:18px;font-weight:600;color:#1a2e1a;margin-bottom:4px;">${formatFecha(g.fecha)}</div>
        <div style="color:#555;font-size:14px;">
          ${formatHora(g.hora_inicio)} · ${g.duracion_horas}hs
          ${sedeName ? ' · ' + sedeName : ''}
          ${g.servicio ? ' · ' + g.servicio : ''}
        </div>
      </div>
      <p style="color:#888;font-size:13px;margin:0;">
        Si no podés asistir, cancelá tu inscripción en la app antes de que se cumpla el plazo.
      </p>`;

    const ok = await enviarEmail(
      email,
      `⏰ Recordatorio — Guardia el ${formatFecha(g.fecha)}`,
      plantillaBase('Recordatorio de guardia', cuerpo)
    );
    if (ok) enviados++;
  }

  return new Response(JSON.stringify({ enviados }), { status: 200 });
}

async function handleNuevasGuardias(payload: Record<string, string>) {
  const { trimestre_id, asociacion_id } = payload;
  if (!trimestre_id) return new Response('missing params', { status: 400 });

  const { data: trimestre } = await supabase
    .from('trimestres')
    .select('nombre, display_id')
    .eq('id', trimestre_id)
    .single();

  if (!trimestre) return new Response('trimestre not found', { status: 404 });

  let query = supabase
    .from('profiles')
    .select('id, nombre, apellido')
    .eq('rol', 'medico')
    .eq('activo', true);

  if (asociacion_id) query = query.eq('asociacion_id', asociacion_id);

  const { data: medicos } = await query;
  if (!medicos?.length) return new Response(JSON.stringify({ enviados: 0 }), { status: 200 });

  const { data: { users } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const emailPorId = Object.fromEntries(users.map(u => [u.id, u.email ?? '']));

  const nombreTrimestre = (trimestre as { display_id: string; nombre: string }).display_id
    || (trimestre as { nombre: string }).nombre;
  const cuerpo = `
    <p style="color:#555;line-height:1.6;margin:0 0 20px;">
      Hay nuevas guardias disponibles para el trimestre <strong style="color:#0f3b3a;">${nombreTrimestre}</strong>.
    </p>
    <p style="color:#555;font-size:14px;margin:0 0 20px;">
      Ingresá a la app para ver las guardias disponibles y anotarte.
    </p>
    <div style="text-align:center;">
      <a href="https://camedi.net" style="display:inline-block;background:#0f3b3a;color:#fff;
         text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;font-size:14px;">
        Ver guardias disponibles →
      </a>
    </div>`;

  let enviados = 0;
  for (const m of medicos) {
    const email = emailPorId[m.id];
    if (!email) continue;
    const ok = await enviarEmail(
      email,
      `📢 Nuevas guardias disponibles — ${nombreTrimestre}`,
      plantillaBase(`Nuevas guardias — ${nombreTrimestre}`, cuerpo)
    );
    if (ok) enviados++;
  }

  return new Response(JSON.stringify({ enviados }), { status: 200 });
}

// ── Entry point ──────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  try {
    const body = await req.json() as Record<string, string>;
    const tipo = body.tipo;

    if (tipo === 'confirmacion')          return await handleConfirmacion(body);
    if (tipo === 'inscripciones_abiertas') return await handleInscripcionesAbiertas(body);
    if (tipo === 'recordatorio_48h')       return await handleRecordatorio48h();
    if (tipo === 'nuevas_guardias')        return await handleNuevasGuardias(body);

    return new Response(JSON.stringify({ error: 'tipo desconocido' }), { status: 400 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
