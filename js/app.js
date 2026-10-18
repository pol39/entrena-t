import { configOk } from './supabaseClient.js';
import { $, renderNotice, friendlyError } from './ui.js';
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
    // Limpia la navegación de la sesión anterior (barra inferior y lateral del entrenador)
    const bar = $('#tabbar');
    if (bar) bar.hidden = true;
    document.getElementById('rail')?.remove();
    document.body.classList.remove('has-rail');

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
      return (await import('./clientApp.js')).showClientApp(profile, { onLogout: logout });
    }
    return (await import('./trainerApp.js')).showTrainerApp(profile, { onLogout: logout });
  } catch (err) {
    renderNotice('No se pudo cargar', friendlyError(err), 'Reintentar', route);
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
