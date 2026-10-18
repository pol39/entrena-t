import { sb } from './supabaseClient.js';
import { render, esc, toast, setBusy, friendlyError } from './ui.js';
import { listTrainerPlans } from './plans.js';

export async function listClients(trainerId) {
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

export async function mount(ctx) {
  const me = ctx.profile;
  render('<div class="splash"><div class="spinner" aria-hidden="true"></div><p>Cargando clientes…</p></div>');
  const [clients, invites, plans] = await Promise.all([listClients(me.id), listPendingInvites(me.id), listTrainerPlans(me.id)]);
  const activeBy = new Map(plans.filter((p) => p.status === 'active').map((p) => [p.client_id, p]));
  const withPlans = new Set(plans.map((p) => p.client_id));
  const byId = new Map(clients.map((c) => [c.id, c]));

  const clientCard = (c) => {
    const noGdpr = !c.gdpr_accepted_at;
    const needsGuardian = c.is_minor && !c.guardian_consent_at;
    const badge = noGdpr ? '<span class="badge badge-warn">Sin aceptar RGPD</span>'
      : needsGuardian ? '<span class="badge badge-warn">Falta tutor</span>'
      : '<span class="badge badge-ok">Activo</span>';
    const active = activeBy.get(c.id);
    return `
      <div class="card stack">
        <div class="row-between">
          <div class="grow">
            <div><b>${esc(c.full_name || c.email)}</b>${c.is_minor ? ' <span class="badge">Menor</span>' : ''}</div>
            <div class="muted small">${esc(c.email)}</div>
          </div>
          ${badge}
        </div>
        <p class="small${active ? '' : ' muted'}">${active ? `Plan activo: ${esc(active.name)}` : (withPlans.has(c.id) ? 'Ningún plan activo' : 'Sin planes todavía')}</p>
        ${withPlans.has(c.id) && !active ? '<div class="alert alert-warn small">Este cliente no ve ningún plan: actívalo en Planificación.</div>' : ''}
        ${needsGuardian ? `<button class="btn btn-secondary" type="button" data-guardian="${esc(c.id)}">Registrar consentimiento del tutor</button>` : ''}
        <button class="btn btn-block" type="button" data-open="${esc(c.id)}">Abrir cliente</button>
      </div>`;
  };

  const app = render(`
    <section class="stack-lg">
      <div class="view-header"><h1>Clientes</h1><span class="badge badge-ok">Entrenador</span></div>

      <div class="stack">
        ${clients.length ? clients.map(clientCard).join('')
          : '<div class="empty"><p>Aún no tienes clientes vinculados. Invita al primero con el formulario de abajo.</p></div>'}
      </div>

      <div class="stack">
        <h2>Invitar cliente</h2>
        <form id="invite-form" class="card stack" novalidate>
          <div class="field">
            <label for="inv-email">Email del cliente</label>
            <input id="inv-email" class="input" type="email" inputmode="email" autocomplete="off" required>
            <span class="field-hint">Debe registrarse en la app con este mismo email.</span>
          </div>
          <div class="field">
            <label for="inv-name">Nombre (opcional)</label>
            <input id="inv-name" class="input" type="text" autocomplete="off">
            <span class="field-hint">Así lo verás en tu lista.</span>
          </div>
          <label class="check"><input type="checkbox" id="inv-minor"><span>Es menor de edad (necesita el consentimiento de su tutor)</span></label>
          <p id="inv-error" class="field-error" role="alert" hidden></p>
          <button id="inv-submit" class="btn btn-block" type="submit">Crear invitación</button>
        </form>
        ${invites.length ? `<div class="card"><ul class="list">${invites.map((i) => `
          <li class="list-item">
            <div class="grow">${esc(i.full_name || i.email)}<div class="muted small">${esc(i.email)}</div></div>
            <span class="badge">Pendiente de registro</span>
          </li>`).join('')}</ul></div>` : ''}
      </div>

      <button id="logout" class="btn btn-secondary btn-block" type="button">Cerrar sesión</button>
    </section>`);

  app.onclick = (ev) => {
    const open = ev.target.closest('[data-open]');
    if (open) { ctx.openClient(byId.get(open.dataset.open)); return; }
    const g = ev.target.closest('[data-guardian]');
    if (g) { registerGuardian(g); return; }
    if (ev.target.closest('#logout')) ctx.logout();
  };
  app.onchange = null;

  async function registerGuardian(btn) {
    const name = (prompt('Nombre del padre, madre o tutor legal que ha dado su consentimiento:') || '').trim();
    if (!name) return;
    setBusy(btn, true);
    try {
      const { error } = await sb.from('profiles')
        .update({ guardian_name: name, guardian_consent_at: new Date().toISOString() })
        .eq('id', btn.dataset.guardian);
      if (error) throw error;
      toast('Consentimiento del tutor registrado.', 'ok');
      await mount(ctx);
    } catch (err) {
      toast(friendlyError(err), 'error');
      setBusy(btn, false);
    }
  }

  app.querySelector('#invite-form').onsubmit = async (e) => {
    e.preventDefault();
    const errBox = app.querySelector('#inv-error');
    errBox.hidden = true;
    const email = app.querySelector('#inv-email').value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      errBox.textContent = 'Escribe un email válido.';
      errBox.hidden = false;
      return;
    }
    const btn = app.querySelector('#inv-submit');
    setBusy(btn, true);
    try {
      const { error } = await sb.from('client_invites').insert({
        email, trainer_id: me.id,
        full_name: app.querySelector('#inv-name').value.trim() || null,
        is_minor: app.querySelector('#inv-minor').checked
      });
      if (error) throw error;
      toast('Invitación creada. Dile que se registre con ese email.', 'ok');
      await mount(ctx);
    } catch (err) {
      errBox.textContent = err.code === '23505' ? 'Ya has invitado a ese email.' : friendlyError(err);
      errBox.hidden = false;
      setBusy(btn, false);
    }
  };
}
