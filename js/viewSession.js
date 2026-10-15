import { render, esc, toast, friendlyError } from './ui.js';
import * as D from './clientData.js';

const LOGGED = new Set(['principal', 'final']);
const BLOCKS = [['calentamiento', 'Calentamiento'], ['principal', ''], ['cardio', 'Cardio'], ['final', 'Para terminar']];

const num = (v) => {
  const s = String(v ?? '').trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};
const val = (v) => (v === null || v === undefined ? '' : String(v));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : null);
const opts = (from, to, cur) => ['<option value="">—</option>',
  ...Array.from({ length: to - from + 1 }, (_, i) => from + i)
    .map((n) => `<option value="${n}"${String(cur) === String(n) ? ' selected' : ''}>${n}</option>`)].join('');

function videoHtml(src) {
  if (!src) return '<div class="video-wrap"><div class="video-missing">Este ejercicio aún no tiene vídeo.</div></div>';
  if (/\.(mp4|webm|mov)(\?|$)/i.test(src)) {
    return `<div class="video-wrap"><video src="${esc(src)}" controls playsinline preload="metadata"></video></div>`;
  }
  return `<a class="btn btn-secondary btn-block" href="${esc(src)}" target="_blank" rel="noopener noreferrer">Ver vídeo del ejercicio</a>`;
}

export async function mount(ctx) {
  const list = ctx.plan.sessions.filter((s) => s.week_number === ctx.week && s.kind !== 'descanso');
  if (!list.length) {
    render('<section class="stack-lg"><h1>Sesión</h1><div class="empty"><p>No hay sesiones programadas esta semana.</p></div></section>');
    return;
  }
  const session = list.find((s) => s.id === ctx.sessionId) || list[0];
  ctx.sessionId = session.id;

  const exs = session.session_exercises || [];
  const logged = exs.filter((e) => LOGGED.has(e.block || 'principal'));
  const ids = logged.map((e) => e.id);
  const [logs, last, completion, lib, doneRows] = await Promise.all([
    D.listSessionLogs(ctx.clientId, ids),
    D.listLastLogs(ctx.clientId, [...new Set(logged.map((e) => e.exercise_name))], ids),
    D.getCompletion(ctx.clientId, session.id),
    D.listExerciseInfo([...new Set(exs.map((e) => e.exercise_id).filter(Boolean))]),
    D.listCompletions(ctx.clientId, list.map((s) => s.id))
  ]);

  const libById = new Map(lib.map((l) => [l.id, l]));
  const videos = new Map();
  await Promise.all(exs.map(async (e) => {
    const path = libById.get(e.exercise_id)?.video_path;
    videos.set(e.id, safeUrl(e.video_url) || (path ? await D.signedVideoUrl(path) : null));
  }));

  const ro = ctx.mode === 'trainer';
  const doneSessions = new Set(doneRows.map((r) => r.session_id));
  const byId = new Map(logged.map((e) => [e.id, e]));
  const sets = new Map(ids.map((id) => [id, new Map()]));
  const extras = new Map(ids.map((id) => [id, { rir: '', sensation: '', pain: false, note: '' }]));
  for (const l of logs) {
    sets.get(l.session_exercise_id)?.set(l.set_number, { weight: l.weight_kg, reps: l.reps_done });
    const x = extras.get(l.session_exercise_id);
    if (x) {
      x.rir = l.rir_actual ?? x.rir;
      x.sensation = l.sensation ?? x.sensation;
      x.pain = x.pain || l.pain_flag;
      x.note = l.pain_note || x.note;
    }
  }

  const setsOf = (e) => e.sets || 3;
  const volume = () => {
    let t = 0;
    for (const m of sets.values()) for (const s of m.values()) t += Number(s.weight || 0) * Number(s.reps || 0);
    return t;
  };
  const openId = (logged.find((e) => sets.get(e.id).size < setsOf(e)) || logged[0] || {}).id;

  const prefill = (e, n) => {
    const cur = sets.get(e.id).get(n);
    if (cur) return { weight: cur.weight, reps: cur.reps, done: true };
    const m = last.get(e.exercise_name);
    const l = m?.get(n) || (m ? [...m.values()].pop() : null);
    return l ? { weight: l.weight, reps: l.reps, done: false } : { weight: '', reps: '', done: false };
  };

  const setRow = (e, n) => {
    const p = prefill(e, n);
    const g = p.done ? '' : ' prefilled';
    const dis = ro ? ' disabled' : '';
    return `
      <div class="set-row" data-set="${n}">
        <span class="set-num">${n}</span>
        <input class="input set-input${g}" inputmode="decimal" placeholder="kg" value="${esc(val(p.weight))}" aria-label="Peso de la serie ${n} en kilos"${dis}>
        <input class="input set-input${g}" inputmode="numeric" placeholder="${esc(e.reps || 'reps')}" value="${esc(val(p.reps))}" aria-label="Repeticiones de la serie ${n}"${dis}>
        <button class="set-done" type="button" aria-pressed="${p.done}" aria-label="Serie ${n} hecha"${dis}>✓</button>
      </div>`;
  };

  const exCard = (e) => {
    const n = setsOf(e);
    const x = extras.get(e.id);
    const open = ro ? sets.get(e.id).size > 0 : e.id === openId;
    const info = libById.get(e.exercise_id);
    const detail = e.detail || info?.description;
    const dis = ro ? ' disabled' : '';
    const meta = [
      (e.sets || e.reps) ? `${e.sets ?? '?'} × ${e.reps ?? '—'}` : '',
      e.rir ? `RIR ${e.rir}` : '',
      e.rest_text ? `Descanso ${e.rest_text}` : (e.rest_seconds ? `Descanso ${e.rest_seconds} s` : ''),
      e.equipment
    ].filter(Boolean);
    return `
      <div class="card ex${open ? ' open' : ''}" data-ex="${esc(e.id)}">
        <button class="ex-toggle" type="button" aria-expanded="${open}">
          <div class="grow">
            <div><b>${esc(e.exercise_name)}</b> ${e.tag ? `<span class="tag">${esc(e.tag)}</span>` : ''}</div>
            <div class="muted small">${esc(meta.join(' · '))}</div>
          </div>
          <span class="badge" data-progress>${sets.get(e.id).size}/${n}</span>
        </button>
        <div class="ex-body stack"${open ? '' : ' hidden'}>
          ${info?.muscle_group ? `<p class="muted small">Trabaja: ${esc(info.muscle_group)}</p>` : ''}
          ${detail ? `<p class="muted">${esc(detail)}</p>` : ''}
          ${videoHtml(videos.get(e.id))}
          ${e.notes ? `<p>${esc(e.notes)}</p>` : ''}
          <div class="set-labels"><span></span><span>kg</span><span>reps</span><span></span></div>
          ${Array.from({ length: n }, (_, i) => setRow(e, i + 1)).join('')}
          <details class="stack">
            <summary>RIR real, sensación y molestias</summary>
            <div class="field"><label for="rir-${esc(e.id)}">RIR real</label>
              <select id="rir-${esc(e.id)}" class="select" data-extra="rir"${dis}>${opts(0, 5, x.rir)}</select></div>
            <div class="field"><label for="sen-${esc(e.id)}">Sensación (1-10)</label>
              <select id="sen-${esc(e.id)}" class="select" data-extra="sensation"${dis}>${opts(1, 10, x.sensation)}</select></div>
            <label class="check"><input type="checkbox" data-extra="pain"${x.pain ? ' checked' : ''}${dis}><span>He notado alguna molestia</span></label>
            <div class="field" data-pain-note${x.pain ? '' : ' hidden'}><label for="pn-${esc(e.id)}">¿Dónde y cómo?</label>
              <input id="pn-${esc(e.id)}" class="input" data-extra="note" value="${esc(x.note)}"${dis}></div>
          </details>
        </div>
      </div>`;
  };

  const infoRow = (e) => `
    <li class="list-item"><div class="grow">
      <div>${esc(e.exercise_name)}</div>
      <div class="muted small">${esc([e.reps, e.detail, e.notes].filter(Boolean).join(' · '))}</div>
    </div></li>`;

  const blocksHtml = BLOCKS.map(([key, label]) => {
    const items = exs.filter((e) => (e.block || 'principal') === key);
    if (!items.length) return '';
    const title = items[0].block_title || label;
    const head = title ? `<h2>${esc(title)}</h2>` : '';
    return LOGGED.has(key)
      ? head + items.map(exCard).join('')
      : `${head}<div class="card"><ul class="list">${items.map(infoRow).join('')}</ul></div>`;
  }).join('');

  const chips = list.map((s, i) => `
    <button class="chip" type="button" data-session="${esc(s.id)}" aria-pressed="${s.id === session.id}" aria-label="${esc(s.title)}">
      Sesión ${i + 1}${doneSessions.has(s.id) ? ' ✓' : ''}</button>`).join('');

  const app = render(`
    <section class="stack-lg">
      <div>
        <p class="muted small">Semana ${ctx.week} de ${ctx.weeks}</p>
        <h1>${esc(session.title)}</h1>
        ${session.objective ? `<p class="muted">${esc(session.objective)}</p>` : ''}
        ${session.notes ? `<p class="muted small">${esc(session.notes)}</p>` : ''}
      </div>
      <div class="chips" role="group" aria-label="Sesiones de la semana">${chips}</div>
      ${completion ? `<div class="alert">Sesión terminada el ${esc(completion.completed_on)}. Puedes seguir editando.</div>` : ''}
      ${blocksHtml}
      <div class="card stack">
        <div class="field">
          <label for="note">Anotaciones de la sesión</label>
          <textarea id="note" class="textarea" placeholder="¿Cómo te has sentido? Molestias, sensaciones…"${ro ? ' disabled' : ''}>${esc(completion?.note || '')}</textarea>
        </div>
      </div>
      <div class="summary-bar">
        <div><p class="muted small">Volumen de la sesión</p><span class="num-xl" id="vol">${D.fmtKg(volume())} kg</span></div>
        ${ro ? '' : `<button id="finish" class="btn" type="button">${completion ? 'Actualizar' : 'Acabar sesión'}</button>`}
      </div>
    </section>`);

  const refresh = (e) => {
    app.querySelector(`[data-ex="${e.id}"] [data-progress]`).textContent = `${sets.get(e.id).size}/${setsOf(e)}`;
    app.querySelector('#vol').textContent = `${D.fmtKg(volume())} kg`;
  };

  const readRow = (row) => {
    const [wIn, rIn] = row.querySelectorAll('input');
    const weight = num(wIn.value);
    const reps = Number.parseInt(rIn.value, 10);
    if (Number.isNaN(weight)) { toast('El peso no es válido.', 'error'); wIn.focus(); return null; }
    if (!Number.isInteger(reps) || reps < 1) { toast('Escribe las repeticiones.', 'error'); rIn.focus(); return null; }
    return { weight, reps };
  };

  const saveRow = async (e, n, { weight, reps }) => {
    const x = extras.get(e.id);
    await D.saveSet({
      clientId: ctx.clientId, sessionId: session.id, week: session.week_number, seId: e.id, setNumber: n, weight, reps,
      rir: x.rir === '' ? null : Number(x.rir), sensation: x.sensation === '' ? null : Number(x.sensation),
      pain: x.pain, note: x.pain ? (x.note || null) : null
    });
    sets.get(e.id).set(n, { weight, reps });
  };

  const onToggle = async (btn) => {
    const row = btn.closest('.set-row');
    const e = byId.get(btn.closest('[data-ex]').dataset.ex);
    const n = Number(row.dataset.set);
    btn.disabled = true;
    try {
      if (btn.getAttribute('aria-pressed') === 'true') {
        await D.deleteSet(ctx.clientId, e.id, n);
        sets.get(e.id).delete(n);
        btn.setAttribute('aria-pressed', 'false');
      } else {
        const v = readRow(row);
        if (!v) return;
        await saveRow(e, n, v);
        btn.setAttribute('aria-pressed', 'true');
        row.querySelectorAll('input').forEach((i) => i.classList.remove('prefilled'));
        // las series siguientes (aún sin hacer) heredan este peso como sugerencia
        row.parentElement.querySelectorAll('.set-row').forEach((r) => {
          if (Number(r.dataset.set) <= n || r.querySelector('.set-done').getAttribute('aria-pressed') === 'true') return;
          const w = r.querySelector('input');
          if (w.value === '' || w.classList.contains('prefilled')) { w.value = val(v.weight); w.classList.add('prefilled'); }
        });
      }
      refresh(e);
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      btn.disabled = false;
    }
  };

  const onExtra = async (t) => {
    const e = byId.get(t.closest('[data-ex]').dataset.ex);
    const x = extras.get(e.id);
    const key = t.dataset.extra;
    x[key] = t.type === 'checkbox' ? t.checked : t.value;
    if (key === 'pain') t.closest('details').querySelector('[data-pain-note]').hidden = !t.checked;
    try {
      await D.updateExerciseExtras(ctx.clientId, e.id, {
        rir_actual: x.rir === '' ? null : Number(x.rir), sensation: x.sensation === '' ? null : Number(x.sensation),
        pain_flag: x.pain, pain_note: x.pain ? (x.note || null) : null
      });
    } catch (err) {
      toast(friendlyError(err), 'error');
    }
  };

  const onFinish = async (btn) => {
    if (logged.length && ![...sets.values()].some((m) => m.size)
        && !confirm('No has registrado ninguna serie. ¿Quieres terminar la sesión igualmente?')) return;
    btn.disabled = true;
    try {
      await D.saveCompletion({
        clientId: ctx.clientId, sessionId: session.id, totalVolume: volume(),
        note: app.querySelector('#note').value.trim() || null
      });
      toast('¡Sesión guardada! Buen trabajo.', 'ok');
      ctx.go('home');
    } catch (err) {
      toast(friendlyError(err), 'error');
      btn.disabled = false;
    }
  };

  app.onclick = (ev) => {
    const t = ev.target;
    const chip = t.closest('[data-session]');
    if (chip) { ctx.sessionId = chip.dataset.session; mount(ctx).catch((err) => toast(friendlyError(err), 'error')); return; }
    const tog = t.closest('.ex-toggle');
    if (tog) {
      const body = tog.nextElementSibling;
      body.hidden = !body.hidden;
      tog.setAttribute('aria-expanded', String(!body.hidden));
      return;
    }
    if (ro) return;
    const done = t.closest('.set-done');
    if (done) { onToggle(done); return; }
    const fin = t.closest('#finish');
    if (fin) onFinish(fin);
  };

  app.onchange = async (ev) => {
    const t = ev.target;
    if (ro) return;
    if (t.matches('.set-input')) {
      t.classList.remove('prefilled');
      const row = t.closest('.set-row');
      if (row.querySelector('.set-done').getAttribute('aria-pressed') === 'true') {
        const v = readRow(row);
        if (v) {
          try { await saveRow(byId.get(t.closest('[data-ex]').dataset.ex), Number(row.dataset.set), v); refresh(byId.get(t.closest('[data-ex]').dataset.ex)); }
          catch (err) { toast(friendlyError(err), 'error'); }
        }
      }
    } else if (t.dataset.extra) {
      await onExtra(t);
    }
  };
}
