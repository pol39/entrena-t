import { $, render, esc, renderNotice, friendlyError } from './ui.js';
import { loadProfile } from './auth.js';
import { showClientApp, unmountClientApp } from './clientApp.js';

// Cada pestaña carga su pantalla desde su propio archivo (trainerClients.js, trainerPlans.js…)
export const TABS = [
  { id: 'clients', label: 'Clientes', view: './trainerClients.js',
    icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>' },
  { id: 'plans', label: 'Planificación', view: './trainerPlans.js',
    icon: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4"/>' }
];

export async function showTrainerApp(profile, { onLogout, tab = 'clients' } = {}) {
  unmountClientApp();
  const ctx = { profile, onLogout, tab, nav: 0 };
  ctx.go = (id) => navigate(ctx, id);
  ctx.logout = async () => {
    $('#tabbar').hidden = true;
    await onLogout?.();
  };
  ctx.openClient = (client, opts = {}) => openClient(ctx, client, opts);

  const bar = $('#tabbar');
  bar.innerHTML = TABS.map((t) => `
    <button class="tab" type="button" data-tab="${t.id}">
      <svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg>
      <span>${t.label}</span>
    </button>`).join('');
  bar.hidden = false;
  bar.onclick = (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) navigate(ctx, btn.dataset.tab);
  };
  return navigate(ctx, tab);
}

async function navigate(ctx, id) {
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  ctx.tab = tab.id;
  document.querySelectorAll('#tabbar [data-tab]').forEach((b) => {
    if (b.dataset.tab === tab.id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  const token = ++ctx.nav;
  render('<div class="splash"><div class="spinner" aria-hidden="true"></div></div>');
  let mod = null;
  try { mod = await import(tab.view); } catch { /* el archivo de la pantalla aún no existe */ }
  if (token !== ctx.nav) return;
  try {
    if (mod?.mount) await mod.mount(ctx);
    else render(`<section class="stack-lg"><h1>${esc(tab.label)}</h1><div class="empty"><p>Esta pantalla aún no está disponible.</p></div></section>`);
  } catch (err) {
    if (token === ctx.nav) renderNotice('No se pudo cargar esta pantalla', friendlyError(err), 'Reintentar', () => navigate(ctx, tab.id));
  }
}

// Abre a un cliente con sus 4 pantallas (solo lectura). planId = ver un plan concreto, aunque sea borrador.
async function openClient(ctx, client, { planId = null } = {}) {
  render('<div class="splash"><div class="spinner" aria-hidden="true"></div><p>Abriendo cliente…</p></div>');
  let cp;
  try {
    cp = await loadProfile(client.id);
  } catch (err) {
    return renderNotice('No se pudo abrir el cliente', friendlyError(err), 'Volver', () => navigate(ctx, ctx.tab));
  }
  if (!cp) return renderNotice('No se pudo abrir el cliente', 'No encontramos su perfil.', 'Volver', () => navigate(ctx, ctx.tab));
  return showClientApp(cp, {
    mode: 'trainer', planId,
    onLogout: ctx.onLogout,
    onBack: () => showTrainerApp(ctx.profile, { onLogout: ctx.onLogout, tab: ctx.tab })
  });
}
