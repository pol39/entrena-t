import { render, $, esc, toast, setBusy, friendlyError } from './ui.js';
import { parseExcelFile, matchExercises, formatIssue, downloadTemplate } from './excelParser.js';

const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const KIND_NAMES = { fuerza: 'Fuerza', cardio: 'Cardio', movilidad: 'Movilidad', descanso: 'Descanso' };
const CAT_NAMES = {
  metodologia: 'Metodología', horario: 'Horario', macros: 'Macros', alimentacion: 'Alimentación', equivalencias: 'Equivalencias',
  suplementos: 'Suplementos', descanso: 'Descanso', habito: 'Hábitos', consejo: 'Consejos', seguridad: 'Seguridad',
  glosario: 'Glosario', seguimiento: 'Seguimiento', feedback: 'Feedback'
};
const MAX_ERRORS_SHOWN = 30;

// [1,2,3,4] → "1-4"; [1,3] → "1, 3"
const rangeText = (ws) => {
  const out = [];
  for (let i = 0; i < ws.length;) {
    let j = i;
    while (j + 1 < ws.length && ws[j + 1] === ws[j] + 1) j++;
    out.push(j > i ? `${ws[i]}-${ws[j]}` : `${ws[i]}`);
    i = j + 1;
  }
  return out.join(', ');
};

const describe = (ex) => {
  const parts = [];
  if (ex.scheme) parts.push(ex.scheme);
  else if (ex.sets && ex.reps) parts.push(`${ex.sets} × ${ex.reps}`);
  else if (ex.sets) parts.push(`${ex.sets} series`);
  else if (ex.reps) parts.push(ex.reps);
  if (ex.rir) parts.push(`RIR ${ex.rir}`);
  if (ex.rest_text) parts.push(`descanso ${ex.rest_text}`);
  return parts.join(' · ') || 'Sin detalles';
};

// Dependencias recibidas desde fuera (así esta vista no toca Supabase directamente):
//   clients: [{ id, full_name, email }] · library: [{ id, name }]
//   onConfirm: async ({ clientId, plan, sessions, habits }) => guarda el plan · onBack: () => vuelve
export function showImportPlan({ clients = [], library = [], onConfirm, onBack }) {
  let parsed = null;
  let run = 0; // evita que un archivo antiguo pise el resultado de uno nuevo

  render(`
    <section class="stack-lg">
      <div class="view-header">
        <h1>Importar plan</h1>
        <button id="back" class="btn btn-ghost" type="button">Volver</button>
      </div>

      ${clients.length ? '' : `
        <div class="alert alert-warn">
          Aún no tienes clientes vinculados. Invita primero a un cliente con su email para poder asignarle un plan.
        </div>`}

      <div class="field">
        <label for="client">Cliente</label>
        <select id="client" class="select">
          <option value="">Elige un cliente…</option>
          ${clients.map((c) => `<option value="${esc(c.id)}">${esc(c.full_name || c.email)}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label for="file">Archivo Excel (.xlsx)</label>
        <input id="file" class="input" type="file" accept=".xlsx,.xls">
        <span class="field-hint">Hojas: Plan, Sesiones, Ejercicios y Pautas.</span>
      </div>
      <button id="template" class="btn btn-ghost btn-block" type="button">Descargar plantilla en blanco</button>

      <div id="result" class="stack" aria-live="polite"></div>
    </section>`);

  $('#back').onclick = () => onBack?.();
  $('#template').onclick = async () => {
    try { await downloadTemplate(); } catch (err) { toast(err.message || friendlyError(err), 'error'); }
  };

  $('#file').onchange = async (e) => {
    const file = e.target.files[0];
    const box = $('#result');
    parsed = null;
    if (!file) { box.innerHTML = ''; return; }

    const mine = ++run;
    box.innerHTML = '<div class="splash"><div class="spinner" aria-hidden="true"></div><p>Leyendo Excel…</p></div>';
    const result = await parseExcelFile(file);
    if (mine !== run) return;

    parsed = result;
    if (result.ok) result.unmatched = matchExercises(result.sessions, library);
    box.innerHTML = result.ok ? previewHtml(result) : errorsHtml(result);
    if (result.ok) bindConfirm();
  };

  function errorsHtml(p) {
    const shown = p.errors.slice(0, MAX_ERRORS_SHOWN);
    const extra = p.errors.length - shown.length;
    return `
      <div class="alert alert-danger stack">
        <strong>No se puede importar todavía.</strong>
        <span>Corrige estos puntos en el Excel y vuelve a subirlo:</span>
        <ul class="list">${shown.map((i) => `<li class="list-item">${esc(formatIssue(i))}</li>`).join('')}</ul>
        ${extra > 0 ? `<span class="small">…y ${extra} más.</span>` : ''}
      </div>`;
  }

  function sessionHtml({ s, weeks }) {
    const when = [`semanas ${rangeText(weeks)}`, s.day_number ? DAY_NAMES[s.day_number] : '', KIND_NAMES[s.kind]].filter(Boolean).join(' · ');
    const lines = [['Enfoque', s.focus], ['Estrategia', s.rep_strategy], ['Material', s.key_material]].filter(([, v]) => v);
    return `
      <details class="card">
        <summary><strong>${esc(s.title)}</strong> <span class="muted small">· ${esc(when)}</span></summary>
        <div class="stack" style="margin-top: var(--s3)">
          ${s.objective ? `<p>${esc(s.objective)}</p>` : ''}
          ${lines.map(([k, v]) => `<p class="small"><span class="muted">${k}:</span> ${esc(v)}</p>`).join('')}
          ${s.notes ? `<div class="alert small">${s.tip_title ? `<strong>${esc(s.tip_title)}:</strong> ` : ''}${esc(s.notes)}</div>` : ''}
          ${s.exercises.length ? `<ul class="list">${s.exercises.map((ex) => `
            <li class="list-item"><div class="grow">
              <div>${esc(ex.exercise_name)}${ex.tag ? ` <span class="tag">${esc(ex.tag)}</span>` : ''}</div>
              <div class="muted small">${esc([ex.detail, describe(ex), ex.equipment].filter(Boolean).join(' · '))}</div>
            </div></li>`).join('')}</ul>` : '<p class="muted small">Sin ejercicios.</p>'}
          ${s.notes_hint ? `<p class="muted small">Ayuda de anotaciones: ${esc(s.notes_hint)}</p>` : ''}
        </div>
      </details>`;
  }

  function previewHtml(p) {
    const defs = new Map();
    for (const s of p.sessions) {
      if (!defs.has(s.code)) defs.set(s.code, { s, weeks: [] });
      defs.get(s.code).weeks.push(s.week_number);
    }
    const defList = [...defs.values()];
    const exCount = defList.reduce((n, d) => n + d.s.exercises.length, 0);
    const info = [['Usuario', p.plan.client_profile], ['Frecuencia', p.plan.frequency], ['Objetivo', p.plan.goal],
      ['Progreso', p.plan.progress], ['Estructura', p.plan.structure]].filter(([, v]) => v);
    const dates = [p.plan.start_date, p.plan.end_date].filter(Boolean).join(' → ');

    const byCat = new Map();
    for (const h of p.habits) {
      if (!byCat.has(h.category)) byCat.set(h.category, []);
      byCat.get(h.category).push(h);
    }

    return `
      <div class="card stack">
        <div class="row-between"><h2>${esc(p.plan.name)}</h2><span class="badge badge-warn">Borrador</span></div>
        ${p.plan.description ? `<p class="muted">${esc(p.plan.description)}</p>` : ''}
        ${info.map(([k, v]) => `<p class="small"><span class="muted">${k}:</span> ${esc(v)}</p>`).join('')}
        ${p.plan.footer ? `<p class="muted small">${esc(p.plan.footer)}</p>` : ''}
        <p class="small muted num">
          ${defList.length} sesiones · ${p.plan.weeks} semanas · ${exCount} ejercicios por semana · ${p.habits.length} pautas${dates ? ` · ${esc(dates)}` : ''}
        </p>
      </div>

      ${p.warnings.map((w) => `<div class="alert">${esc(w)}</div>`).join('')}
      ${p.unmatched.length ? `
        <div class="alert alert-warn">
          Estos ejercicios no están en tu biblioteca y se guardarán sin vídeo: ${esc(p.unmatched.join(', '))}.
        </div>` : ''}

      <div class="stack">
        <h2>Sesiones</h2>
        ${defList.length ? defList.map(sessionHtml).join('') : '<div class="empty">El plan no tiene sesiones todavía.</div>'}
      </div>

      ${p.habits.length ? `
        <div class="stack">
          <h2>Pautas</h2>
          ${[...byCat].map(([cat, list]) => `
            <details class="card">
              <summary><strong>${esc(CAT_NAMES[cat] || cat)}</strong> <span class="muted small">(${list.length})</span></summary>
              <ul class="list">${list.map((h) => `
                <li class="list-item"><div class="grow">
                  <div>${esc(h.title)}${h.checkable ? ' <span class="badge badge-ok">Marcable</span>' : ''}${h.target ? ` <span class="badge">${h.target}${h.unit ? ` ${esc(h.unit)}` : ''}</span>` : ''}</div>
                  ${!h.content && !h.detail ? '<div class="muted small">Cabecera de sección</div>' : ''}
                  ${h.subtitle ? `<div class="muted small">${esc(h.subtitle)}</div>` : ''}
                </div></li>`).join('')}</ul>
            </details>`).join('')}
        </div>` : ''}

      <button id="confirm" class="btn btn-lg btn-block" type="button">Guardar como borrador</button>`;
  }

  function bindConfirm() {
    const btn = $('#confirm');
    btn.onclick = async () => {
      const clientId = $('#client').value;
      if (!clientId) return toast('Elige primero el cliente.', 'error');
      if (typeof onConfirm !== 'function') return toast('El guardado aún no está disponible.', 'error');

      setBusy(btn, true);
      try {
        await onConfirm({ clientId, plan: parsed.plan, sessions: parsed.sessions, habits: parsed.habits });
        toast('Plan guardado como borrador.', 'ok');
        onBack?.();
      } catch (err) {
        toast(friendlyError(err), 'error');
        setBusy(btn, false);
      }
    };
  }
}
