import { sb } from './supabaseClient.js';
import { render, esc, toast, setBusy, friendlyError } from './ui.js';
import { listTrainerPlans, savePlan, setPlanStatus, deletePlan } from './plans.js';
import { listClients } from './trainerClients.js';
import { showImportPlan } from './importPlan.js';
import { isoDate } from './clientData.js';

const STATUS = { draft: ['Borrador', 'badge-warn'], active: ['Activo', 'badge-ok'], archived: ['Archivado', ''] };
const fmtDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

// Si la biblioteca falla o está vacía, la importación sigue funcionando (los ejercicios quedan sin vídeo)
async function listLibraryNames(trainerId) {
  try {
    const { data, error } = await sb.from('exercises').select('id, name').eq('trainer_id', trainerId);
    if (error) throw error;
    return data;
  } catch (err) {
    console.error(err);
    return [];
  }
}

// Ventana para elegir desde qué día rige el plan. Devuelve 'AAAA-MM-DD' o null si se cancela.
function askStartDate(clientName, planName) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <div class="stack">
        <h2>Activar plan</h2>
        <p class="muted">«${esc(planName)}» para ${esc(clientName)}.</p>
        <div class="field">
          <label for="sd">El plan rige desde</label>
          <input id="sd" class="input" type="date" value="${isoDate()}">
          <span class="field-hint">Todo lo que el cliente ya ha registrado se conserva. El plan activo pasará a archivado.</span>
        </div>
        <p id="sd-err" class="field-error" role="alert" hidden>Elige una fecha.</p>
        <div class="row">
          <button type="button" class="btn btn-secondary" data-cancel>Cancelar</button>
          <button type="button" class="btn" data-ok>Activar</button>
        </div>
      </div>`;
    const done = (value) => { dlg.close?.(); dlg.remove(); resolve(value); };
    dlg.querySelector('[data-cancel]').onclick = () => done(null);
    dlg.querySelector('[data-ok]').onclick = () => {
      const v = dlg.querySelector('#sd').value;
      if (!v) { dlg.querySelector('#sd-err').hidden = false; return; }
      done(v);
    };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(null); });
    document.body.append(dlg);
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  });
}

export async function mount(ctx) {
  const me = ctx.profile;
  render('<div class="splash"><div class="spinner" aria-hidden="true"></div><p>Cargando planes…</p></div>');
  const [clients, plans] = await Promise.all([listClients(me.id), listTrainerPlans(me.id)]);
  const clientById = new Map(clients.map((c) => [c.id, c]));
  const planById = new Map(plans.map((p) => [p.id, p]));

  const planCard = (p) => {
    const [label, cls] = STATUS[p.status] || [p.status, ''];
    const when = p.status === 'active' ? `Rige desde ${fmtDate(p.starts_on) || '—'}`
      : p.status === 'archived' ? `${fmtDate(p.starts_on) || '—'} → ${fmtDate(p.ended_on) || '—'}`
      : 'Aún no es visible para el cliente';
    const btn = (action, text, kind = 'btn-secondary') =>
      `<button class="btn ${kind}" type="button" data-action="${action}" data-plan="${esc(p.id)}">${text}</button>`;
    return `
      <div class="card stack">
        <div class="row-between"><b class="grow">${esc(p.name)}</b><span class="badge ${cls}">${label}</span></div>
        <p class="muted small">${when}</p>
        <div class="row" style="flex-wrap: wrap">
          ${btn('view', 'Ver como el cliente')}
          ${p.status === 'active' ? btn('archive', 'Archivar') : btn('activate', 'Activar', '')}
          ${p.status === 'active' ? '' : btn('delete', 'Borrar', 'btn-ghost')}
        </div>
      </div>`;
  };

  const groups = clients.map((c) => {
    const list = plans.filter((p) => p.client_id === c.id);
    return `
      <div class="stack">
        <h2>${esc(c.full_name || c.email)}</h2>
        ${list.length ? list.map(planCard).join('') : '<p class="muted small">Sin planes. Impórtalo con el botón de arriba.</p>'}
      </div>`;
  }).join('');

  const app = render(`
    <section class="stack-lg">
      <div class="view-header"><h1>Planificación</h1></div>
      <button id="import" class="btn btn-lg btn-block" type="button">
        <svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5M4 20h16"/></svg>
        Importar plan desde Excel
      </button>
      ${clients.length ? groups : '<div class="empty"><p>Primero invita a un cliente en la pestaña Clientes.</p></div>'}
    </section>`);

  app.onclick = async (ev) => {
    if (ev.target.closest('#import')) { openImport(); return; }
    const btn = ev.target.closest('[data-action]');
    if (!btn) return;
    const plan = planById.get(btn.dataset.plan);
    const client = clientById.get(plan.client_id);
    const action = btn.dataset.action;

    if (action === 'view') { ctx.openClient(client, { planId: plan.id }); return; }
    if (action === 'archive' && !confirm('¿Archivar este plan? El cliente dejará de verlo, pero sus registros se conservan.')) return;
    if (action === 'delete' && !confirm('¿Borrar este plan con todo su contenido? No se puede deshacer.')) return;

    let startsOn;
    if (action === 'activate') {
      startsOn = await askStartDate(client.full_name || client.email, plan.name);
      if (!startsOn) return;
    }
    setBusy(btn, true);
    try {
      if (action === 'delete') {
        await deletePlan(plan.id);
        toast('Plan borrado.', 'ok');
      } else {
        const status = action === 'activate' ? 'active' : 'archived';
        await setPlanStatus({ planId: plan.id, clientId: plan.client_id, status, startsOn });
        toast(status === 'active' ? `Plan activado desde el ${fmtDate(startsOn)}.` : 'Plan archivado.', 'ok');
      }
      await mount(ctx);
    } catch (err) {
      // El plan con registros del cliente no se puede borrar: se explica y se propone archivarlo
      toast(/registros del cliente/i.test(err.message || '') ? err.message : friendlyError(err), 'error');
      setBusy(btn, false);
    }
  };
  app.onchange = null;

  async function openImport() {
    try {
      const library = await listLibraryNames(me.id);
      showImportPlan({
        clients, library,
        onConfirm: (data) => savePlan({ trainerId: me.id, ...data }),
        onBack: () => ctx.go('plans')
      });
    } catch (err) {
      toast(friendlyError(err), 'error');
    }
  }
}
