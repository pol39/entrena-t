import { sb } from './supabaseClient.js';
import { render, esc, toast, friendlyError } from './ui.js';
import * as D from './clientData.js';

const CATS = [
  ['alimentacion', 'Alimentación'], ['macros', 'Macros'], ['equivalencias', 'Equivalencias'], ['suplementos', 'Suplementos'],
  ['descanso', 'Descanso'], ['habito', 'Hábitos'], ['consejo', 'Consejos'], ['seguridad', 'Seguridad'],
  ['seguimiento', 'Seguimiento'], ['glosario', 'Glosario'], ['feedback', 'Feedback']
];
let pollId = null;

const when = (iso) => new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const bubbles = (msgs, me) => msgs.map((m) => `
  <div class="bubble ${m.sender_id === me ? 'bubble-me' : 'bubble-them'}" style="white-space: pre-wrap">${esc(m.body)}<time datetime="${esc(m.created_at)}">${esc(when(m.created_at))}</time></div>`).join('');

const pautaHtml = (r) => {
  if (!r.content && !r.detail) return `<h3>${esc(r.title)}</h3>`;
  return `
    <div class="card stack">
      <div class="row-between"><b>${esc(r.title)}</b>${r.frequency ? `<span class="badge">${esc(r.frequency)}</span>` : ''}</div>
      ${r.subtitle ? `<p class="muted small">${esc(r.subtitle)}</p>` : ''}
      ${r.content ? `<p style="white-space: pre-line">${esc(r.content)}</p>` : ''}
      ${r.detail ? `<p class="hot" style="white-space: pre-line">${esc(r.detail)}</p>` : ''}
    </div>`;
};

export async function mount(ctx) {
  const { data } = await sb.auth.getSession();
  const me = data.session?.user.id;
  const other = ctx.mode === 'trainer' ? ctx.clientId : ctx.profile.trainer_id;
  const trainerView = ctx.mode === 'trainer';

  const rows = ctx.plan?.habits_nutrition || [];
  const cats = CATS.filter(([k]) => rows.some((r) => r.category === k));
  const sel = cats.some(([k]) => k === ctx.guideCat) ? ctx.guideCat : cats[0]?.[0];

  let msgs = other ? await D.listMessages(me, other) : [];
  if (other) D.markRead(me, other).catch(() => {});

  const pautas = cats.length
    ? `<div class="chips" role="group" aria-label="Categorías">${cats.map(([k, label]) =>
        `<button class="chip" type="button" data-cat="${k}" aria-pressed="${k === sel}">${label}</button>`).join('')}</div>
       <div class="stack">${rows.filter((r) => r.category === sel).sort((a, b) => a.sort_order - b.sort_order).map(pautaHtml).join('')}</div>`
    : '<div class="empty"><p>Aún no hay recomendaciones. Aquí aparecerán la alimentación, los hábitos y el descanso de tu plan.</p></div>';

  const chat = other
    ? `<div id="chat" class="chat" aria-live="polite">${bubbles(msgs, me)}</div>
       <p id="chat-empty" class="muted"${msgs.length ? ' hidden' : ''}>${trainerView ? 'Escríbele a tu cliente.' : 'Escríbele a tu entrenador cuando quieras.'}</p>
       <form id="chat-form" class="chat-form" novalidate>
         <input id="chat-input" class="input" autocomplete="off" placeholder="Escribe un mensaje" aria-label="Mensaje">
         <button class="btn" type="submit" aria-label="Enviar">Enviar</button>
       </form>`
    : '<p class="muted">Tu cuenta todavía no tiene un entrenador asignado.</p>';

  const app = render(`
    <section class="stack-lg">
      <div><p class="muted small">Guía y entrenador</p><h1>${trainerView ? 'Guía del cliente' : 'Cuídate'}</h1></div>
      ${pautas}
      <div class="card stack">
        <h2>Mensajes</h2>
        ${chat}
      </div>
    </section>`);

  app.onclick = (ev) => {
    const chip = ev.target.closest('[data-cat]');
    if (chip) { ctx.guideCat = chip.dataset.cat; mount(ctx); }
  };
  app.onchange = null;

  const form = app.querySelector('#chat-form');
  if (!form) return;
  const box = app.querySelector('#chat');
  const empty = app.querySelector('#chat-empty');
  const paint = (list) => { msgs = list; box.innerHTML = bubbles(list, me); empty.hidden = list.length > 0; };

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const input = form.querySelector('#chat-input');
    const body = input.value.trim().slice(0, 2000);
    if (!body) return;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await D.sendMessage(me, other, body);
      input.value = '';
      paint(await D.listMessages(me, other));
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      btn.disabled = false;
    }
  };

  // Actualiza la conversación cada 20 s mientras esta pantalla siga abierta
  clearInterval(pollId);
  pollId = setInterval(async () => {
    if (!document.body.contains(box)) { clearInterval(pollId); return; }
    try {
      const list = await D.listMessages(me, other);
      if (list.length !== msgs.length) { paint(list); D.markRead(me, other).catch(() => {}); }
    } catch { /* se reintenta en la próxima vuelta */ }
  }, 20000);
}
