import { $, render, esc, renderNotice, friendlyError } from './ui.js';
import { loadActivePlan } from './plans.js';

// Cada pestaña carga su pantalla desde su propio archivo (viewHome.js, viewSession.js…).
// Mientras un archivo no exista, se muestra una pantalla provisional.
export const TABS = [
  { id: 'home',    label: 'Inicio',     view: './viewHome.js',    needsPlan: true,  icon: '<path d="M3 11l9-8 9 8v9H3z"/>' },
  { id: 'session', label: 'Sesión',     view: './viewSession.js', needsPlan: true,  icon: '<path d="M6 8v8M18 8v8M3 10v4M21 10v4M6 12h12"/>' },
  { id: 'cycle',   label: 'Microciclo', view: './viewCycle.js',   needsPlan: true,  icon: '<path d="M4 20V10M10 20V4M16 20v-8M22 20H2"/>' },
  { id: 'guide',   label: 'Guía',       view: './viewGuide.js',   needsPlan: false, icon: '<path d="M4 5h16v11H9l-5 4z"/>' }
];

const DAY_MS = 86400000;

// Semana actual del microciclo (la semana 1 empieza el lunes de la semana de inicio del plan)
export function weekInfo(plan, today = new Date()) {
  const weeks = Math.max(plan.weeks || 0, ...(plan.sessions || []).map((s) => s.week_number), 1);
  const startRaw = plan.start_date || plan.activated_at || plan.created_at;
  const monday = (d) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  const diff = startRaw ? Math.round((monday(today) - monday(startRaw)) / DAY_MS / 7) : 0;
  return { weeks, week: Math.min(Math.max(diff + 1, 1), weeks) };
}

// ctx = datos y acciones que comparten todas las pantallas.
// mode: 'client' (el propio cliente) o 'trainer' (el entrenador mirando a un cliente).
export async function showClientApp(profile, { onLogout, mode = 'client' } = {}) {
  render('<div class="splash"><div class="spinner" aria-hidden="true"></div><p>Cargando tu entrenamiento…</p></div>');

  let plan;
  try {
    plan = await loadActivePlan(profile.id);
  } catch (err) {
    return renderNotice('No se pudo cargar el entrenamiento', friendlyError(err), 'Reintentar',
      () => showClientApp(profile, { onLogout, mode }));
  }

  const ctx = { mode, clientId: profile.id, profile, plan, week: 1, weeks: 1, tab: 'home', nav: 0 };
  Object.assign(ctx, plan ? weekInfo(plan) : {});
  ctx.go = (id) => navigate(ctx, id);
  ctx.logout = async () => {
    $('#tabbar').hidden = true;
    await onLogout?.();
  };
  ctx.reload = async () => {
    ctx.plan = await loadActivePlan(profile.id);
    Object.assign(ctx, ctx.plan ? weekInfo(ctx.plan) : {});
    return navigate(ctx, ctx.tab);
  };

  mountTabs(ctx);
  navigate(ctx, 'home');
}

function mountTabs(ctx) {
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
}

async function navigate(ctx, id) {
  const tab = TABS.find((t) => t.id === id) || TABS[0];
  ctx.tab = tab.id;
  document.querySelectorAll('#tabbar [data-tab]').forEach((b) => {
    if (b.dataset.tab === tab.id) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });

  const token = ++ctx.nav; // si el usuario cambia de pestaña mientras carga, se descarta la anterior
  if (tab.needsPlan && !ctx.plan) return showNoPlan(ctx);

  render('<div class="splash"><div class="spinner" aria-hidden="true"></div></div>');
  let mod = null;
  try { mod = await import(tab.view); } catch { /* el archivo de la pantalla aún no existe */ }
  if (token !== ctx.nav) return;

  try {
    if (mod?.mount) await mod.mount(ctx);
    else showPlaceholder(ctx, tab);
  } catch (err) {
    if (token === ctx.nav) {
      renderNotice('No se pudo cargar esta pantalla', friendlyError(err), 'Reintentar', () => navigate(ctx, tab.id));
    }
  }
}

function showNoPlan(ctx) {
  const who = ctx.mode === 'trainer' ? 'Este cliente no tiene' : 'Tu entrenador todavía no te ha activado';
  render(`
    <section class="stack-lg">
      <h1>Hola, ${esc(ctx.profile.full_name || ctx.profile.email)}</h1>
      <div class="empty">
        <p>${who} ningún plan. Cuando haya uno activo, aparecerá aquí el entrenamiento.</p>
      </div>
      ${ctx.mode === 'client' ? '<button id="logout" class="btn btn-secondary btn-block" type="button">Cerrar sesión</button>' : ''}
    </section>`);
  $('#logout')?.addEventListener('click', ctx.logout);
}

function showPlaceholder(ctx, tab) {
  const n = ctx.plan.sessions.filter((s) => s.week_number === ctx.week).length;
  render(`
    <section class="stack-lg">
      <div class="view-header">
        <h1>${tab.label}</h1>
        <span class="badge">Semana ${ctx.week} de ${ctx.weeks}</span>
      </div>
      <div class="card stack">
        <h2>${esc(ctx.plan.name)}</h2>
        <p class="muted">${n} sesiones esta semana. Esta pantalla se construye en el siguiente paso.</p>
      </div>
      ${ctx.mode === 'client' ? '<button id="logout" class="btn btn-secondary btn-block" type="button">Cerrar sesión</button>' : ''}
    </section>`);
  $('#logout')?.addEventListener('click', ctx.logout);
}
