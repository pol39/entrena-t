import { configOk, sb } from './supabaseClient.js';
import { $, render, esc, toast, setBusy, renderNotice, friendlyError } from './ui.js';
import { getSession, loadProfile, signOut, needsConsent } from './auth.js';
import { showWelcome } from './welcome.js';
import { showConsent } from './consent.js';
import { showImportPlan } from './importPlan.js';
import { savePlan } from './plans.js';

// ---------- Consultas del panel ----------
async function listClients(trainerId) {
  const { data, error } = await sb.from('profiles')
    .select('id, full_name, email, is_minor, gdpr_accepted_at, guardian_consent_at')
    .eq('trainer_id', trainerId).order('created_at');
  if (error) throw error;
  return data;
}

async function listPendingInvites(trainerId) {
  const { data, error } = await sb.from('client_invites')
    .select('email, full_name, is_minor')
    .eq('trainer_id', trainerId).is('used_at', null).order('created_at');
  if (error) throw error;
  return data;
}

// Si la biblioteca falla o está vacía, la app sigue funcionando (los ejercicios quedan sin vídeo)
async function listLibrary(trainerId) {
  try {
    const { data, error } = await sb.from('exercises').select('id, name').eq('trainer_id', trainerId);
    if (error) throw error;
    return data;
  } catch (err) {
    console.error(err);
    return [];
  }
}

// ---------- Navegación general ----------
async function logout() {
  try { await signOut(); } catch (err) { console.error(err); }
  route();
}

async function route() {
  try {
    const session = await getSession();
    if (!session) return showWelcome(route);

    const profile = await loadProfile(session.user.id);
    if (!profile) {
      return renderNotice('No encontramos tu perfil',
        'Tu cuenta existe pero no tiene perfil. Avisa a tu entrenador.', 'Salir', logout);
    }

    if (profile.role === 'client') {
      if (needsConsent(profile)) return showConsent(profile, route, logout);
      if (!profile.trainer_id) {
        return renderNotice('Cuenta pendiente de vincular',
          `Tu cuenta (${profile.email}) aún no está asociada a un entrenador. Pídele que te invite con este mismo email.`,
          'Salir', logout);
      }
      if (profile.is_minor && !profile.guardian_consent_at) {
        return renderNotice('Falta el consentimiento de tu tutor',
          'Tu entrenador debe registrar el consentimiento de tu madre, padre o tutor antes de que puedas acceder.',
          'Salir', logout);
      }
      return showClientHome(profile);
    }
    showTrainerHome(profile);
  } catch (err) {
    renderNotice('No se pudo cargar', friendlyError(err), 'Reintentar', route);
  }
}

// ---------- Pantalla provisional del cliente (se sustituirá en la próxima fase) ----------
function showClientHome(profile) {
  render(`
    <section class="stack-lg">
      <div class="view-header">
        <h1>Hola, ${esc(profile.full_name || profile.email)}</h1>
        <span class="badge">Cliente</span>
      </div>
      <div class="alert">Aquí aparecerá tu entrenamiento de hoy.</div>
      <button id="logout" class="btn btn-secondary btn-block" type="button">Cerrar sesión</button>
    </section>`);
  $('#logout').onclick = logout;
}

// ---------- Panel del entrenador ----------
async function showTrainerHome(profile) {
  render('<div class="splash"><div class="spinner" aria-hidden="true"></div><p>Cargando panel…</p></div>');

  let clients, invites;
  try {
    [clients, invites] = await Promise.all([listClients(profile.id), listPendingInvites(profile.id)]);
  } catch (err) {
    return renderNotice('No se pudo cargar el panel', friendlyError(err), 'Reintentar', () => showTrainerHome(profile));
  }

  const clientRow = (c) => {
    const noGdpr = !c.gdpr_accepted_at;
    const needsGuardian = c.is_minor && !c.guardian_consent_at;
    const badge = noGdpr ? '<span class="badge badge-warn">Sin aceptar RGPD</span>'
      : needsGuardian ? '<span class="badge badge-warn">Falta tutor</span>'
      : '<span class="badge badge-ok">Activo</span>';
    return `
      <li class="list-item">
        <div class="grow stack">
          <div>
            <div>${esc(c.full_name || c.email)}${c.is_minor ? ' <span class="badge">Menor</span>' : ''}</div>
            <div class="muted small">${esc(c.email)}</div>
          </div>
          ${needsGuardian ? `<button class="btn btn-secondary" type="button" data-guardian="${esc(c.id)}">Registrar consentimiento del tutor</button>` : ''}
        </div>
        ${badge}
      </li>`;
  };

  const app = render(`
    <section class="stack-lg">
      <div class="view-header">
        <h1>Hola, ${esc(profile.full_name || profile.email)}</h1>
        <span class="badge badge-ok">Entrenador</span>
      </div>

      <button id="import" class="btn btn-lg btn-block" type="button">Importar plan desde Excel</button>

      <div class="stack">
        <h2>Clientes</h2>
        ${clients.length
          ? `<div class="card"><ul class="list">${clients.map(clientRow).join('')}</ul></div>`
          : '<div class="empty"><p>Aún no tienes clientes vinculados. Invita al primero con el formulario de abajo.</p></div>'}
      </div>

      <div class="stack">
        <h2>Invitar cliente</h2>
        <form id="invite-form" class="card stack" novalidate>
          <div class="field">
            <label for="inv-email">Email del cliente</label>
            <input id="inv-email" class="input" type="email" inputmode="email" autocomplete="off" required>
          </div>
          <div class="field">
            <label for="inv-name">Nombre (opcional)</label>
            <input id="inv-name" class="input" type="text" autocomplete="off">
          </div>
          <label class="check"><input type="checkbox" id="inv-minor"><span>Es menor de edad (requiere consentimiento del tutor)</span></label>
          <p id="inv-error" class="field-error" role="alert" hidden></p>
          <button id="inv-submit" class="btn btn-block" type="submit">Crear invitación</button>
          <p class="field-hint">Después, el cliente debe crear su cuenta en la app con ese mismo email.</p>
        </form>
        ${invites.length ? `
          <div class="card"><ul class="list">
            ${invites.map((i) => `
              <li class="list-item">
                <div class="grow">${esc(i.full_name || i.email)}<div class="muted small">${esc(i.email)}</div></div>
                <span class="badge">Pendiente de registro</span>
              </li>`).join('')}
          </ul></div>` : ''}
      </div>

      <button id="logout" class="btn btn-secondary btn-block" type="button">Cerrar sesión</button>
    </section>`);

  $('#logout').onclick = logout;
  $('#import').onclick = () => openImport(profile);

  $('#invite-form').onsubmit = async (e) => {
    e.preventDefault();
    const errBox = $('#inv-error');
    errBox.hidden = true;
    const email = $('#inv-email').value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      errBox.textContent = 'Escribe un email válido.';
      errBox.hidden = false;
      return;
    }
    const btn = $('#inv-submit');
    setBusy(btn, true);
    try {
      const { error } = await sb.from('client_invites').insert({
        email, trainer_id: profile.id,
        full_name: $('#inv-name').value.trim() || null,
        is_minor: $('#inv-minor').checked
      });
      if (error) throw error;
      toast('Invitación creada. Dile que se registre con ese email.', 'ok');
      showTrainerHome(profile);
    } catch (err) {
      errBox.textContent = err.code === '23505' ? 'Ya has invitado a ese email.' : friendlyError(err);
      errBox.hidden = false;
      setBusy(btn, false);
    }
  };

  app.querySelectorAll('[data-guardian]').forEach((btn) => {
    btn.onclick = async () => {
      const name = (prompt('Nombre del padre, madre o tutor legal que ha dado su consentimiento:') || '').trim();
      if (!name) return;
      setBusy(btn, true);
      try {
        const { error } = await sb.from('profiles')
          .update({ guardian_name: name, guardian_consent_at: new Date().toISOString() })
          .eq('id', btn.dataset.guardian);
        if (error) throw error;
        toast('Consentimiento del tutor registrado.', 'ok');
        showTrainerHome(profile);
      } catch (err) {
        toast(friendlyError(err), 'error');
        setBusy(btn, false);
      }
    };
  });
}

async function openImport(profile) {
  try {
    const [clients, library] = await Promise.all([listClients(profile.id), listLibrary(profile.id)]);
    showImportPlan({
      clients, library,
      onConfirm: (data) => savePlan({ trainerId: profile.id, ...data }),
      onBack: () => showTrainerHome(profile)
    });
  } catch (err) {
    toast(friendlyError(err), 'error');
  }
}

// ---------- Arranque ----------
function init() {
  const banner = $('#offline-banner');
  const updateBanner = () => { banner.hidden = navigator.onLine; };
  addEventListener('online', updateBanner);
  addEventListener('offline', updateBanner);
  updateBanner();

  if (window.__supabaseFailed || !window.supabase) {
    return renderNotice('No se pudo cargar la aplicación',
      'Falta un componente necesario. Comprueba tu conexión e inténtalo de nuevo.',
      'Reintentar', () => location.reload());
  }
  if (!configOk) {
    return renderNotice('Falta configurar la app',
      'Edita js/config.js y pega la URL y la clave anon de tu proyecto de Supabase.',
      'Recargar', () => location.reload());
  }
  route();
}

init();
