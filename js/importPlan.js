import { render, $, esc, toast, setBusy, friendlyError } from './ui.js';
import { parseExcelFile, matchExercises, formatIssue, downloadTemplate } from './excelParser.js';

const DAY_NAMES = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const MAX_ERRORS_SHOWN = 30;

const describe = (ex) => {
  const parts = [];
  if (ex.sets && ex.reps) parts.push(`${ex.sets} × ${ex.reps}`);
  else if (ex.sets) parts.push(`${ex.sets} series`);
  else if (ex.reps) parts.push(`${ex.reps} reps`);
  if (ex.rest_seconds != null) parts.push(`descanso ${ex.rest_seconds} s`);
  if (ex.rpe != null) parts.push(`RPE ${ex.rpe}`);
  if (ex.tempo) parts.push(`tempo ${ex.tempo}`);
  return parts.join(' · ') || 'Sin detalles';
};

// Dependencias recibidas desde fuera (así esta vista no toca Supabase directamente):
//   clients:   [{ id, full_name, email }]
//   library:   [{ id, name }]
//   onConfirm: async ({ clientId, plan, sessions, habits }) => guarda el plan
//   onBack:    () => vuelve al panel
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
        <span class="field-hint">Hojas: Plan, Sesiones y Alimentación.</span>
      </div>
      <button id="template" class="btn btn-ghost btn-block" type="button">Descargar plantilla de ejemplo</button>

      <div id="result" class="stack" aria-live="polite"></div>
    </section>`);

  $('#back').onclick = () => onBack?.();

  $('#template').onclick = async () => {
    try { await downloadTemplate(); }
    catch (err) { toast(err.message || friendlyError(err), 'error'); }
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
        <ul class="list">
          ${shown.map((i) => `<li class="list-item">${esc(formatIssue(i))}</li>`).join('')}
        </ul>
        ${extra > 0 ? `<span class="small">…y ${extra} más.</span>` : ''}
      </div>`;
  }

  function previewHtml(p) {
    const sessions = [...p.sessions].sort((a, b) =>
      a.week_number - b.week_number || a.day_number - b.day_number || a.sort_order - b.sort_order);
    const totalEx = sessions.reduce((n, s) => n + s.exercises.length, 0);
    const dates = [p.plan.start_date, p.plan.end_date].filter(Boolean).join(' → ');

    return `
      <div class="card stack">
        <div class="row-between">
          <h2>${esc(p.plan.name)}</h2>
          <span class="badge badge-warn">Borrador</span>
        </div>
        ${p.plan.description ? `<p class="muted">${esc(p.plan.description)}</p>` : ''}
        <p class="small muted num">
          ${sessions.length} sesiones · ${totalEx} ejercicios · ${p.habits.length} pautas${dates ? ` · ${esc(dates)}` : ''}
        </p>
      </div>

      ${p.warnings.map((w) => `<div class="alert">${esc(w)}</div>`).join('')}
      ${p.unmatched.length ? `
        <div class="alert alert-warn">
          Estos ejercicios no están en tu biblioteca y se guardarán sin vídeo:
          ${esc(p.unmatched.join(', '))}.
        </div>` : ''}

      <div class="stack">
        ${sessions.length ? sessions.map((s) => `
          <details class="card">
            <summary>
              <strong>Semana ${s.week_number} · ${DAY_NAMES[s.day_number]}</strong> — ${esc(s.title)}
              <span class="muted small">(${s.exercises.length})</span>
            </summary>
            <ul class="list">
              ${s.exercises.map((ex) => `
                <li class="list-item">
                  <div class="grow">
                    <div>${esc(ex.exercise_name)}</div>
                    <div class="muted small">${esc(describe(ex))}</div>
                  </div>
                </li>`).join('')}
            </ul>
          </details>`).join('') : '<div class="empty">El plan no tiene sesiones todavía.</div>'}
      </div>

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
