// ============================================================
// auth.js — Autenticación y router principal
// ============================================================

import { supabase } from './supabase-client.js';

// ── Estado global de sesión ───────────────────────────────
let perfilActual = null;

// ── Mapa de errores de Supabase → español ─────────────────
const MENSAJES_ERROR = {
  'Invalid login credentials':                  'Email o contraseña incorrectos.',
  'Email not confirmed':                        'Confirmá tu email antes de ingresar. Revisá tu bandeja de entrada.',
  'User already registered':                    'Ya existe una cuenta con ese email.',
  'Password should be at least 6 characters':   'La contraseña debe tener al menos 8 caracteres.',
  'Unable to validate email address':           'El formato del email no es válido.',
  'Email rate limit exceeded':                  'Demasiados intentos. Esperá unos minutos e intentá de nuevo.',
  'over_email_send_rate_limit':                 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.',
  'signup_disabled':                            'El registro está deshabilitado temporalmente.',
  'For security purposes':                      'Por seguridad, esperá unos segundos antes de intentar de nuevo.',
};

function traducirError(msg) {
  if (!msg) return 'Ocurrió un error inesperado. Intentá de nuevo.';
  for (const [clave, traduccion] of Object.entries(MENSAJES_ERROR)) {
    if (msg.includes(clave)) return traduccion;
  }
  return 'Ocurrió un error inesperado. Intentá de nuevo.';
}


// ── Helpers de UI ─────────────────────────────────────────

function mostrarVista(id) {
  document.querySelectorAll('.vista').forEach(v => v.classList.remove('activa'));
  const vista = document.getElementById('vista-' + id);
  if (vista) vista.classList.add('activa');
}

function mostrarError(idElemento, mensaje) {
  const el = document.getElementById(idElemento);
  if (!el) return;
  el.textContent = mensaje;
  el.classList.add('visible');
}

function ocultarMensaje(idElemento) {
  const el = document.getElementById(idElemento);
  if (el) el.classList.remove('visible');
}

function mostrarOk(idElemento, mensaje) {
  const el = document.getElementById(idElemento);
  if (!el) return;
  el.textContent = mensaje;
  el.classList.add('visible');
}

function setCargando(btnId, spinId, txtId, cargando) {
  const btn  = document.getElementById(btnId);
  const spin = document.getElementById(spinId);
  const txt  = document.getElementById(txtId);
  if (!btn) return;
  btn.disabled = cargando;
  if (spin) spin.style.display = cargando ? 'block' : 'none';
  if (txt)  txt.style.opacity  = cargando ? '0'     : '1';
}

function limpiarInputs(...ids) {
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}


// ── Router principal ──────────────────────────────────────

async function redirigir(sesion) {
  if (!sesion) {
    mostrarVista('login');
    return;
  }

  // Obtener perfil del médico desde profiles
  const { data: perfil, error } = await supabase
    .from('profiles')
    .select('id, nombre, apellido, matricula, especialidad, telefono, rol, activo, asociacion_id')
    .eq('id', sesion.user.id)
    .single();

  if (error || !perfil) {
    // El perfil puede no existir si el trigger todavía no corrió
    mostrarVista('pendiente');
    return;
  }

  perfilActual = perfil;

  if (!perfil.activo) {
    mostrarVista('pendiente');
    return;
  }

  if (perfil.rol === 'admin') {
    mostrarVista('admin');
    const { iniciarAdmin } = await import('./admin.js');
    iniciarAdmin(perfil);
  } else if (perfil.rol === 'asociacion') {
    mostrarVista('asociacion');
    const { iniciarAsociacion } = await import('./asociacion.js');
    iniciarAsociacion(perfil);
  } else {
    // Médico: chequear si ya eligió sus sedes
    const { count } = await supabase
      .from('medico_sedes')
      .select('*', { count: 'exact', head: true })
      .eq('medico_id', perfil.id);

    if (!count) {
      mostrarVista('elegir-sedes');
      await iniciarVistaElegirSedes(perfil);
    } else {
      mostrarVista('medico');
      const { iniciarMedico } = await import('./medico.js');
      iniciarMedico(perfil);
    }
  }
}

// Expone el perfil actual para otros módulos
export function obtenerPerfil() {
  return perfilActual;
}


// ── Cerrar sesión (exportado para usar en medico.js y admin.js) ──

export async function cerrarSesion() {
  await supabase.auth.signOut();
  perfilActual = null;
  mostrarVista('login');
}


// ── Formulario: Login ─────────────────────────────────────

function iniciarFormLogin() {
  const form = document.getElementById('form-login');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ocultarMensaje('error-login');

    const email = document.getElementById('login-email').value.trim();
    const pass  = document.getElementById('login-pass').value;

    if (!email || !pass) {
      mostrarError('error-login', 'Completá email y contraseña.');
      return;
    }

    setCargando('btn-login', 'spin-login', 'txt-login', true);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });

    setCargando('btn-login', 'spin-login', 'txt-login', false);

    if (error) {
      mostrarError('error-login', traducirError(error.message));
      return;
    }

    await redirigir(data.session);
  });

  document.getElementById('btn-ir-registro')?.addEventListener('click', () => {
    ocultarMensaje('error-login');
    mostrarVista('registro');
    poblarAsociaciones();
    poblarProvinciasRegistro();
  });

  document.getElementById('btn-ir-recuperar')?.addEventListener('click', () => {
    ocultarMensaje('error-login');
    mostrarVista('recuperar');
  });

  document.getElementById('btn-ir-login-asociacion')?.addEventListener('click', () => {
    ocultarMensaje('error-login');
    mostrarVista('login-asociacion');
  });
}


// ── Formulario: Login Asociaciones ────────────────────────

function iniciarFormLoginAsociacion() {
  const form = document.getElementById('form-login-asociacion');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ocultarMensaje('error-login-asociacion');

    const email = document.getElementById('login-asoc-email').value.trim();
    const pass  = document.getElementById('login-asoc-pass').value;

    if (!email || !pass) {
      mostrarError('error-login-asociacion', 'Completá email y contraseña.');
      return;
    }

    setCargando('btn-login-asociacion', 'spin-login-asociacion', 'txt-login-asociacion', true);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pass });

    setCargando('btn-login-asociacion', 'spin-login-asociacion', 'txt-login-asociacion', false);

    if (error) {
      mostrarError('error-login-asociacion', traducirError(error.message));
      return;
    }

    // La función redirigir maneja automáticamente el rol 'asociacion' → vista-asociacion
    await redirigir(data.session);
  });

  document.getElementById('btn-volver-login')?.addEventListener('click', () => {
    ocultarMensaje('error-login-asociacion');
    mostrarVista('login');
  });
}


// ── Formulario: Registro ──────────────────────────────────

async function poblarAsociaciones() {
  const sel = document.getElementById('reg-asociacion');
  if (!sel || sel.dataset.cargado === 'true') return;
  const { data } = await supabase
    .from('asociaciones')
    .select('id, nombre')
    .eq('activa', true)
    .order('nombre');
  if (data?.length) {
    sel.innerHTML = '<option value="">— Seleccioná tu asociación —</option>' +
      data.map(a => `<option value="${a.id}">${a.nombre}</option>`).join('');
    sel.dataset.cargado = 'true';
  } else {
    sel.innerHTML = '<option value="">No hay asociaciones disponibles</option>';
  }
}

async function poblarProvinciasRegistro() {
  const sel = document.getElementById('reg-provincia');
  if (!sel || sel.dataset.cargado === 'true') return;
  const { data } = await supabase.from('provincias').select('id, nombre').order('nombre');
  if (data?.length) {
    sel.innerHTML = '<option value="">— Seleccioná tu provincia —</option>' +
      data.map(p => `<option value="${p.id}">${p.nombre}</option>`).join('');
    sel.dataset.cargado = 'true';
  }
}

function iniciarFormRegistro() {
  const form = document.getElementById('form-registro');
  if (!form) return;

  // Cargar asociaciones cuando el usuario llega a la vista de registro
  poblarAsociaciones();
  poblarProvinciasRegistro();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ocultarMensaje('error-registro');
    ocultarMensaje('ok-registro');

    const nombre       = document.getElementById('reg-nombre').value.trim();
    const apellido     = document.getElementById('reg-apellido').value.trim();
    const email        = document.getElementById('reg-email').value.trim();
    const matricula    = document.getElementById('reg-matricula').value.trim();
    const especialidad = document.getElementById('reg-especialidad').value.trim();
    const telefono     = document.getElementById('reg-telefono').value.trim();
    const asociacionId = document.getElementById('reg-asociacion')?.value ?? '';
    const provinciaId  = document.getElementById('reg-provincia')?.value ?? '';
    const pass         = document.getElementById('reg-pass').value;
    const pass2        = document.getElementById('reg-pass2').value;

    // Validaciones del lado cliente
    if (!nombre || !apellido || !email || !matricula || !especialidad || !pass) {
      mostrarError('error-registro', 'Completá todos los campos obligatorios (*).');
      return;
    }
    if (!asociacionId) {
      mostrarError('error-registro', 'Seleccioná tu asociación médica.');
      return;
    }
    if (!provinciaId) {
      mostrarError('error-registro', 'Seleccioná tu provincia.');
      return;
    }
    if (pass.length < 8) {
      mostrarError('error-registro', 'La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (pass !== pass2) {
      mostrarError('error-registro', 'Las contraseñas no coinciden.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      mostrarError('error-registro', 'El formato del email no es válido.');
      return;
    }

    setCargando('btn-registro', 'spin-registro', 'txt-registro', true);

    const { error } = await supabase.auth.signUp({
      email,
      password: pass,
      options: {
        // Redirige al usuario a la app después de confirmar el email
        emailRedirectTo: window.location.origin + window.location.pathname,
        // Estos datos los recibe el trigger handle_new_user() en raw_user_meta_data
        data: { nombre, apellido, matricula, especialidad, telefono, asociacion_id: asociacionId, provincia_id: provinciaId ? Number(provinciaId) : null },
      },
    });

    setCargando('btn-registro', 'spin-registro', 'txt-registro', false);

    if (error) {
      // Detectar matrícula duplicada (error del trigger de Supabase)
      if (error.message.includes('matricula')) {
        mostrarError('error-registro', 'Esa matrícula ya está registrada en el sistema.');
      } else {
        mostrarError('error-registro', traducirError(error.message));
      }
      return;
    }

    // Éxito: mostrar mensaje y limpiar form
    mostrarOk('ok-registro',
      'Cuenta creada. Revisá tu email para confirmar el registro. ' +
      'Luego el administrador aprobará tu cuenta.'
    );
    limpiarInputs(
      'reg-nombre', 'reg-apellido', 'reg-email',
      'reg-matricula', 'reg-especialidad', 'reg-telefono',
      'reg-pass', 'reg-pass2'
    );
    const selReg = document.getElementById('reg-asociacion');
    if (selReg) selReg.value = '';
    const selProv = document.getElementById('reg-provincia');
    if (selProv) selProv.value = '';
  });

  document.getElementById('btn-ir-login-desde-registro')?.addEventListener('click', () => {
    ocultarMensaje('error-registro');
    ocultarMensaje('ok-registro');
    mostrarVista('login');
  });
}


// ── Formulario: Recuperar contraseña ─────────────────────

function iniciarFormRecuperar() {
  const form = document.getElementById('form-recuperar');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ocultarMensaje('error-recuperar');
    ocultarMensaje('ok-recuperar');

    const email = document.getElementById('rec-email').value.trim();

    if (!email) {
      mostrarError('error-recuperar', 'Ingresá tu email.');
      return;
    }

    setCargando('btn-recuperar', 'spin-recuperar', 'txt-recuperar', true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // Redirige al usuario de vuelta a la app después de hacer clic en el enlace
      redirectTo: window.location.origin + window.location.pathname,
    });

    setCargando('btn-recuperar', 'spin-recuperar', 'txt-recuperar', false);

    if (error) {
      mostrarError('error-recuperar', traducirError(error.message));
      return;
    }

    mostrarOk('ok-recuperar',
      'Si el email está registrado, recibirás el enlace en tu bandeja de entrada.'
    );
    document.getElementById('rec-email').value = '';
  });

  document.getElementById('btn-ir-login-desde-recuperar')?.addEventListener('click', () => {
    ocultarMensaje('error-recuperar');
    ocultarMensaje('ok-recuperar');
    mostrarVista('login');
  });
}


// ── Formulario: Cambiar contraseña ───────────────────────

function iniciarFormCambiarPass() {
  const form = document.getElementById('form-cambiar-pass');
  if (!form) return;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ocultarMensaje('error-cambiar-pass');
    ocultarMensaje('ok-cambiar-pass');

    const pass  = document.getElementById('nueva-pass').value;
    const pass2 = document.getElementById('nueva-pass2').value;

    if (!pass || !pass2) {
      mostrarError('error-cambiar-pass', 'Completá ambos campos.');
      return;
    }
    if (pass.length < 8) {
      mostrarError('error-cambiar-pass', 'La contraseña debe tener al menos 8 caracteres.');
      return;
    }
    if (pass !== pass2) {
      mostrarError('error-cambiar-pass', 'Las contraseñas no coinciden.');
      return;
    }

    setCargando('btn-cambiar-pass', 'spin-cambiar-pass', 'txt-cambiar-pass', true);

    const { error } = await supabase.auth.updateUser({ password: pass });

    setCargando('btn-cambiar-pass', 'spin-cambiar-pass', 'txt-cambiar-pass', false);

    if (error) {
      mostrarError('error-cambiar-pass', traducirError(error.message));
      return;
    }

    mostrarOk('ok-cambiar-pass', 'Contraseña actualizada. Iniciá sesión con tu nueva contraseña.');
    limpiarInputs('nueva-pass', 'nueva-pass2');

    setTimeout(async () => {
      await supabase.auth.signOut();
      mostrarVista('login');
    }, 2000);
  });
}


// ── Vista: Elegir sedes (onboarding médico) ───────────────

async function iniciarVistaElegirSedes(perfil) {
  const lista   = document.getElementById('sedes-lista-elegir');
  const errEl   = document.getElementById('err-elegir-sedes');
  const btnSave = document.getElementById('btn-guardar-sedes');
  const selProv = document.getElementById('elegir-provincia');

  // Asegurar que el selector esté visible por defecto
  selProv?.closest('div')?.classList.remove('hidden');

  const seleccionadas = new Set();

  // Intentar reparar el asociacion_id del perfil si está vacío.
  // falla silenciosamente si la función aún no fue deployada en Supabase.
  if (!perfil.asociacion_id) {
    await supabase.rpc('reparar_asociacion_onboarding').catch(() => {});
  }

  // Cargar provincias y sedes en paralelo.
  // sedes es legible por todos los autenticados (sedes_select USING true).
  const [{ data: provincias }, { data: todasSedes }] = await Promise.all([
    supabase.from('provincias').select('id, nombre').order('nombre'),
    supabase.from('sedes').select('id, nombre, color_hex, provincia_id').eq('activa', true).order('nombre'),
  ]);

  if (!todasSedes?.length) {
    if (lista) lista.innerHTML =
      '<p class="text-bad text-sm text-center">No hay sedes configuradas. Contactá al administrador.</p>';
    selProv?.closest('div')?.classList.add('hidden');
    return;
  }

  // Poblar selector de provincias (solo las que tienen sedes)
  const provConSedes = new Set(todasSedes.map(s => s.provincia_id).filter(Boolean));
  const usarFiltroProvincia = provConSedes.size > 0;

  if (usarFiltroProvincia) {
    if (selProv && provincias?.length) {
      selProv.innerHTML = '<option value="">— Seleccioná una provincia —</option>' +
        provincias
          .filter(p => provConSedes.has(p.id))
          .map(p => `<option value="${p.id}">${p.nombre}</option>`)
          .join('');
    }
    // Auto-seleccionar la provincia que eligió durante el registro
    const { data: { user } } = await supabase.auth.getUser();
    const savedProv = user?.user_metadata?.provincia_id;
    if (savedProv && selProv) {
      selProv.value = String(savedProv);
    }
  } else {
    // Sin provincias configuradas: ocultar selector y mostrar todas las sedes
    selProv?.closest('div')?.classList.add('hidden');
  }

  function renderizarSedes(provinciaId) {
    if (!lista) return;
    const sedesFiltradas = provinciaId
      ? todasSedes.filter(s => String(s.provincia_id) === String(provinciaId))
      : todasSedes;

    if (!sedesFiltradas.length) {
      lista.innerHTML = '<div class="py-4 text-center text-ink-mute text-sm">No hay sedes en esta provincia.</div>';
      return;
    }

    lista.innerHTML = sedesFiltradas.map(s => {
      const activa = seleccionadas.has(s.id);
      return `
        <div class="sede-elegir-card flex items-center gap-3 p-3 rounded-xl border-2
                    cursor-pointer select-none transition-colors
                    ${activa ? 'border-primary bg-accent-soft' : 'border-line hover:border-primary/40'}"
             data-sede-id="${s.id}">
          <span class="w-3 h-3 rounded-full flex-shrink-0" style="background:${s.color_hex ?? '#8a948f'}"></span>
          <span class="font-medium text-sm text-ink flex-1">${s.nombre}</span>
          <span class="sede-check w-5 h-5 rounded border-2 flex items-center justify-center
                       flex-shrink-0 transition-colors ${activa ? 'bg-primary border-primary' : 'border-line'}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" class="${activa ? '' : 'hidden'}">
              <polyline points="2 6 5 9 10 3" stroke="white" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </div>`;
    }).join('');

    lista.querySelectorAll('.sede-elegir-card').forEach(card => {
      card.addEventListener('click', () => {
        const id    = card.dataset.sedeId;
        const check = card.querySelector('.sede-check');
        const svg   = card.querySelector('svg');
        if (seleccionadas.has(id)) {
          seleccionadas.delete(id);
          card.classList.remove('border-primary', 'bg-accent-soft');
          card.classList.add('border-line');
          if (check) { check.classList.remove('bg-primary', 'border-primary'); check.classList.add('border-line'); }
          if (svg)   svg.classList.add('hidden');
        } else {
          seleccionadas.add(id);
          card.classList.add('border-primary', 'bg-accent-soft');
          card.classList.remove('border-line');
          if (check) { check.classList.add('bg-primary', 'border-primary'); check.classList.remove('border-line'); }
          if (svg)   svg.classList.remove('hidden');
        }
      });
    });
  }

  selProv?.addEventListener('change', () => renderizarSedes(selProv.value));

  // Si hay provincia pre-seleccionada, mostrar sus sedes directamente
  renderizarSedes(selProv?.value || null);

  btnSave?.addEventListener('click', async () => {
    if (errEl) errEl.classList.remove('visible');

    if (usarFiltroProvincia && !selProv?.value) {
      if (errEl) { errEl.textContent = 'Seleccioná una provincia primero.'; errEl.classList.add('visible'); }
      return;
    }
    if (seleccionadas.size === 0) {
      if (errEl) { errEl.textContent = 'Seleccioná al menos una sede.'; errEl.classList.add('visible'); }
      return;
    }

    if (btnSave) btnSave.disabled = true;
    const spin = document.getElementById('spin-guardar-sedes');
    const txt  = document.getElementById('txt-guardar-sedes');
    if (spin) spin.style.display = 'block';
    if (txt)  txt.style.opacity  = '0';

    const filas = [...seleccionadas].map(sede_id => ({ medico_id: perfil.id, sede_id }));
    const { error: errIns } = await supabase.from('medico_sedes').insert(filas);

    if (btnSave) btnSave.disabled = false;
    if (spin) spin.style.display = 'none';
    if (txt)  txt.style.opacity  = '1';

    if (errIns) {
      if (errEl) { errEl.textContent = 'Error al guardar. Intentá de nuevo.'; errEl.classList.add('visible'); }
      return;
    }

    mostrarVista('medico');
    const { iniciarMedico } = await import('./medico.js');
    iniciarMedico(perfil);
  });

  document.getElementById('btn-cerrar-sesion-sedes')
    ?.addEventListener('click', cerrarSesion);
}


// ── Vista: Pendiente de aprobación ────────────────────────

function iniciarVistaPendiente() {
  document.getElementById('btn-cerrar-sesion-pendiente')?.addEventListener('click', cerrarSesion);

  document.getElementById('btn-verificar-aprobacion')?.addEventListener('click', async () => {
    setCargando('btn-verificar-aprobacion', 'spin-verificar', 'txt-verificar', true);

    const { data: { session } } = await supabase.auth.getSession();

    setCargando('btn-verificar-aprobacion', 'spin-verificar', 'txt-verificar', false);

    if (session) await redirigir(session);
  });
}


// ── Listener global de cambios de sesión ──────────────────

function iniciarListenerSesion() {
  supabase.auth.onAuthStateChange(async (evento, sesion) => {
    if (evento === 'PASSWORD_RECOVERY') {
      // El usuario llegó desde el enlace de reset → mostrar form de nueva contraseña
      mostrarVista('cambiar-contrasena');
      return;
    }
    if (evento === 'SIGNED_OUT') {
      perfilActual = null;
      mostrarVista('login');
      return;
    }
    // SIGNED_IN / TOKEN_REFRESHED / INITIAL_SESSION manejados por el arranque inicial
  });
}


// ── Arranque ──────────────────────────────────────────────

async function iniciarAuth() {
  // Registrar todos los formularios
  iniciarFormLogin();
  iniciarFormLoginAsociacion();
  iniciarFormRegistro();
  iniciarFormRecuperar();
  iniciarFormCambiarPass();
  iniciarVistaPendiente();
  iniciarListenerSesion();

  // Si el usuario llegó desde un link de reset, mostrar el form directamente
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  if (hashParams.get('type') === 'recovery') {
    mostrarVista('cambiar-contrasena');
    return;
  }

  // Verificar sesión existente al cargar la página
  const { data: { session } } = await supabase.auth.getSession();
  await redirigir(session);
}

iniciarAuth();
