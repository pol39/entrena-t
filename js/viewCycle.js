import { render, esc } from './ui.js';
import * as D from './clientData.js';

const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const mid = (t) => {
  const n = String(t || '').match(/\d+(?:[.,]\d+)?/g);
  return n ? n.map((x) => Number(x.replace(',', '.'))).reduce((a, b) => a + b, 0) / n.length : null;
};
const principal = (s) => (s.session_exercises || []).filter((e) => (e.block || 'principal') === 'principal');
const lines = (s) => (s || '—');
const signed = (n) => `${n >= 0 ? '+' : ''}${n}`;

// Compara el plan de dos semanas: ejercicios cambiados, series/repeticiones, RIR y descansos
export function planChanges(prev, cur) {
  const out = [];
  if (prev.length !== cur.length) {
    out.push({ tag: '#', title: `Sesiones: ${prev.length} → ${cur.length}`, sub: 'Cambia el número de sesiones' });
  }
  cur.forEach((c, i) => {
    const p = prev[i];
    if (!p) return;
    const pe = principal(p);
    principal(c).forEach((e, k) => {
      const q = pe[k];
      if (!q) { out.push({ tag: '+', title: e.exercise_name, sub: `Ejercicio nuevo en la sesión ${i + 1}` }); return; }
      if (norm(q.exercise_name) !== norm(e.exercise_name)) {
        out.push({ tag: '⇄', title: `${q.exercise_name} → ${e.exercise_name}`, sub: `Cambio de ejercicio en la sesión ${i + 1}` });
        return;
      }
      const sub = [];
      let tag = '';
      const repsChanged = (q.sets ?? null) !== (e.sets ?? null) || norm(q.reps) !== norm(e.reps);
      const rirChanged = norm(q.rir) !== norm(e.rir);
      const repsDelta = (mid(e.reps) ?? 0) - (mid(q.reps) ?? 0);
      const rirDelta = (mid(e.rir) ?? 0) - (mid(q.rir) ?? 0);
      if (repsChanged) {
        tag = '↕';
        sub.push(`Series × reps: ${q.sets ?? '?'}×${lines(q.reps)} → ${e.sets ?? '?'}×${lines(e.reps)}`);
      }
      if (rirChanged) {
        tag = tag || 'RIR';
        sub.push(`RIR: ${lines(q.rir)} → ${lines(e.rir)}`);
      }
      if (repsChanged && repsDelta < 0 && rirChanged && rirDelta < 0) sub.push('Menos repeticiones y más intensidad');
      else if (repsChanged && repsDelta < 0) sub.push('Menos repeticiones');
      else if (repsChanged && repsDelta > 0) sub.push('Más repeticiones');
      else if (rirChanged && rirDelta < 0) sub.push('Más intensidad (RIR menor)');
      else if (rirChanged && rirDelta > 0) sub.push('Más margen (RIR mayor)');
      if (norm(q.rest_text) !== norm(e.rest_text) || (q.rest_seconds ?? null) !== (e.rest_seconds ?? null)) {
        tag = tag || '⏱';
        sub.push(`Descanso: ${lines(q.rest_text || (q.rest_seconds && `${q.rest_seconds} s`))} → ${lines(e.rest_text || (e.rest_seconds && `${e.rest_seconds} s`))}`);
      }
      if (tag) out.push({ tag, title: e.exercise_name, sub: sub.join(' · ') });
    });
  });
  return out;
}

export async function mount(ctx) {
  const all = ctx.plan.sessions;
  const ids = all.map((s) => s.id);
  const [logs, completions] = await Promise.all([D.listPlanLogs(ctx.clientId, ids), D.listCompletions(ctx.clientId, ids)]);
  const weekOf = new Map(all.map((s) => [s.id, s.week_number]));
  const weeks = Array.from({ length: ctx.weeks }, (_, i) => i + 1);
  const trainable = (w) => all.filter((s) => s.week_number === w && s.kind !== 'descanso');

  const stats = new Map(weeks.map((w) => [w, { volume: 0, rirSum: 0, rirN: 0, sets: 0, done: 0, total: trainable(w).length, maxW: new Map() }]));
  for (const l of logs) {
    const st = stats.get(l.week_number);
    if (!st) continue;
    const w = Number(l.weight_kg || 0);
    st.volume += w * Number(l.reps_done || 0);
    st.sets += 1;
    if (l.rir_actual !== null && l.rir_actual !== undefined) { st.rirSum += Number(l.rir_actual); st.rirN += 1; }
    const name = l.session_exercises?.exercise_name;
    if (name && w > (st.maxW.get(name) || 0)) st.maxW.set(name, w);
  }
  for (const c of completions) {
    const st = stats.get(weekOf.get(c.session_id));
    if (st) st.done += 1;
  }

  const sel = Math.min(Math.max(ctx.cycleWeek || ctx.week, 1), ctx.weeks);
  const cur = stats.get(sel);
  const prev = sel > 1 ? stats.get(sel - 1) : null;
  const maxVol = Math.max(...[...stats.values()].map((s) => s.volume), 1);
  const rirAvg = (s) => (s.rirN ? s.rirSum / s.rirN : null);
  const rirText = (s) => (rirAvg(s) === null ? '—' : rirAvg(s).toFixed(1).replace('.', ','));

  const chips = weeks.map((w) => `<button class="chip" type="button" data-week="${w}" aria-pressed="${w === sel}">${w === ctx.week ? `S${w} · ahora` : `S${w}`}</button>`).join('');

  const bars = weeks.map((w) => {
    const st = stats.get(w);
    const kind = w < ctx.week ? 'bar blue' : (w === ctx.week ? 'bar' : 'bar plan');
    const h = st.volume > 0 ? Math.max(st.volume / maxVol, 0.06) : (w > ctx.week ? 0.25 : 0.04);
    return `<div><span class="${kind}" style="--v:${h.toFixed(3)}"></span>S${w}<br>${st.volume ? D.fmtKg(st.volume) : '—'}</div>`;
  }).join('');

  let compareCard;
  if (prev) {
    const volPct = prev.volume > 0 ? Math.round(((cur.volume - prev.volume) / prev.volume) * 100) : null;
    const rirDiff = rirAvg(cur) !== null && rirAvg(prev) !== null ? rirAvg(cur) - rirAvg(prev) : null;
    const rows = [
      ['Volumen (kg)', D.fmtKg(prev.volume), D.fmtKg(cur.volume),
        volPct === null ? '—' : `<span class="${volPct >= 0 ? 'up' : 'hot'}">${signed(volPct)}%</span>`],
      ['RIR real medio', rirText(prev), rirText(cur),
        rirDiff === null ? '—' : (rirDiff < 0 ? '<span class="hot">+ intensidad</span>' : (rirDiff > 0 ? 'más margen' : 'igual'))],
      ['Sesiones hechas', `${prev.done}/${prev.total}`, `${cur.done}/${cur.total}`,
        `<span class="${cur.done >= prev.done ? 'up' : 'hot'}">${signed(cur.done - prev.done)}</span>`],
      ['Series registradas', String(prev.sets), String(cur.sets), signed(cur.sets - prev.sets)]
    ];
    compareCard = `
      <div class="card stack">
        <h2>S${sel} respecto a S${sel - 1}</h2>
        <div class="table-wrap"><table class="table">
          <tr><th>Métrica</th><th>S${sel - 1}</th><th>S${sel}</th><th>Cambio</th></tr>
          ${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('')}
        </table></div>
      </div>`;
  } else {
    compareCard = '<div class="card"><p class="muted">La semana 1 es el punto de partida: a partir de la semana 2 verás aquí las diferencias.</p></div>';
  }

  let changesCard = '';
  let gainsCard = '';
  if (prev) {
    const ch = planChanges(trainable(sel - 1), trainable(sel));
    changesCard = `
      <div class="card stack">
        <h2>Cambios del plan: S${sel - 1} → S${sel}</h2>
        ${ch.length ? ch.map((c) => `
          <div class="change"><span class="tag">${esc(c.tag)}</span>
            <div><b>${esc(c.title)}</b><p class="muted small">${esc(c.sub)}</p></div></div>`).join('')
          : '<p class="muted">Sin cambios en el plan respecto a la semana anterior.</p>'}
      </div>`;
    const gains = [...cur.maxW].filter(([n, w]) => prev.maxW.has(n) && w > prev.maxW.get(n))
      .map(([n, w]) => ({ n, a: prev.maxW.get(n), b: w, p: Math.round(((w - prev.maxW.get(n)) / prev.maxW.get(n)) * 100) }))
      .sort((x, y) => y.p - x.p).slice(0, 6);
    gainsCard = `
      <div class="card stack">
        <h2>Mejoras de carga</h2>
        ${gains.length ? gains.map((g) => `
          <div class="change"><span class="tag">↑</span>
            <div><b>${esc(g.n)}</b><p class="muted small">${D.fmtKg(g.a)} → ${D.fmtKg(g.b)} kg <span class="up">(+${g.p}%)</span></p></div></div>`).join('')
          : '<p class="muted">Aquí aparecerán los ejercicios en los que subas peso respecto a la semana anterior.</p>'}
      </div>`;
  }

  const app = render(`
    <section class="stack-lg">
      <div>
        <p class="muted small">Microciclo · ${ctx.weeks} semana${ctx.weeks === 1 ? '' : 's'}</p>
        <h1>Progreso</h1>
      </div>
      <div class="chips" role="group" aria-label="Semanas">${chips}</div>
      <div class="card stack">
        <h2>Peso levantado por semana</h2>
        <div class="bars" role="img" aria-label="Volumen por semana: ${weeks.map((w) => `S${w} ${D.fmtKg(stats.get(w).volume)} kg`).join(', ')}">${bars}</div>
      </div>
      ${compareCard}${changesCard}${gainsCard}
    </section>`);

  app.onclick = (ev) => {
    const chip = ev.target.closest('[data-week]');
    if (chip) { ctx.cycleWeek = Number(chip.dataset.week); mount(ctx); }
  };
  app.onchange = null;
}
