import { configOk } from './supabaseClient.js';
import { $, render, esc, renderNotice, friendlyError } from './ui.js';
import { getSession, loadProfile, signOut, needsConsent } from './auth.js';
import { showWelcome } from './welcome.js';
import { showConsent } from './consent.js';

async function logout() {
  try { await signOut(); } catch (err) { console.error(err); }
  route();
}

// Decide qué pantalla mostrar según sesión, rol y consentimiento
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
    }
    showHome(profile);
  } catch (err) {
    renderNotice('No se pudo cargar', friendlyError(err), 'Reintentar', route);
  }
}

// Pantalla provisional: se sustituirá en las próximas fases
function showHome(profile) {
  const isTrainer = profile.role === 'trainer';
  render(`
    <section class="stack-lg">
      <div class="view-header">
        <h1>Hola, ${esc(profile.full_name || profile.email)}</h1>
        <span class="badge ${isTrainer ? 'badge-ok' : ''}">${isTrainer ? 'Entrenador' : 'Cliente'}</span>
      </div>
      <div class="alert">
        La conexión con Supabase funciona. En las próximas fases aparecerá aquí
        ${isTrainer ? 'tu panel de clientes' : 'tu entrenamiento de hoy'}.
      </div>
      <button id="logout" class="btn btn-secondary btn-block" type="button">Cerrar sesión</button>
    </section>`);
  $('#logout').onclick = logout;
}

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
