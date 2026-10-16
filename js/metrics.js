// Cómo se cuenta cada ejercicio. El tipo se puede forzar con la columna session_exercises.metric;
// si está vacía, se deduce del nombre y de las repeticiones.
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const normName = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();

export const METRIC_UI = {
  load:       { weight: 'kg',        reps: 'reps', hint: '' },
  bodyweight: { weight: 'lastre kg', reps: 'reps', hint: 'Cuenta tu peso corporal' },
  assisted:   { weight: 'ayuda kg',  reps: 'reps', hint: 'Peso corporal menos la ayuda' },
  reps:       { weight: 'lastre kg', reps: 'reps', hint: 'Solo repeticiones' },
  time:       { weight: null,        reps: 'seg',  hint: 'Se mide en segundos' }
};

export function metricOf(e = {}) {
  if (METRIC_UI[e.metric]) return e.metric;
  const name = norm(`${e.exercise_name || ''} ${e.detail || ''}`);
  const own = norm(e.exercise_name);
  const reps = norm(e.reps);
  if (/\b(seg|segons|segundos|sec)\w*|\bmin/.test(reps)) return 'time';
  if (/planka|plank|isometric/.test(own) && !/rep/.test(reps)) return 'time';
  if (/metre|metro/.test(reps)) return 'reps';
  if (/dominad|pull ?-?up|chin ?-?up|barbilla/.test(own)) return /assist|ayud|goma|banda/.test(own) ? 'assisted' : 'bodyweight';
  if (/flexi|push ?-?up|fons|dips|paral|taula|tauler|abdomin|bicicleta|dead ?bug|crunch|elevaci\w* de cames|mountain|burpee|pont\w* de gluti|glute bridge/.test(name)) return 'reps';
  return 'load';
}

// Kilos que suma una serie al "peso levantado"
export function setVolume(metric, weight, reps, bw) {
  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  if (metric === 'load') return w * r;
  if (metric === 'bodyweight') return bw ? (bw + w) * r : 0;
  if (metric === 'assisted') return bw ? Math.max(bw - w, 0) * r : 0;
  return 0; // 'reps' y 'time' no suman kilos: se cuentan aparte
}

// items: [{ metric, weight, reps }] → { kg, reps (peso corporal), seconds }
export function tally(items, bw) {
  const t = { kg: 0, reps: 0, seconds: 0 };
  for (const i of items) {
    t.kg += setVolume(i.metric, i.weight, i.reps, bw);
    if (i.metric === 'reps') t.reps += Number(i.reps) || 0;
    if (i.metric === 'time') t.seconds += Number(i.reps) || 0;
  }
  return t;
}

const fmtTime = (s) => (s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`);
export const tallyText = (t) => [
  t.reps ? `${t.reps} repeticiones con peso corporal` : '',
  t.seconds ? `${fmtTime(t.seconds)} en ejercicios de tiempo` : ''
].filter(Boolean).join(' · ');

export const exerciseMap = (plan) => new Map((plan?.sessions || [])
  .flatMap((s) => (s.session_exercises || []).map((e) => [e.id, e])));

// Sesiones de una semana. En la semana 1, si el plan empezó a mitad de semana,
// las sesiones asignadas a días anteriores al inicio no cuentan.
export function weekSessions(ctx, week = ctx.week) {
  return ctx.plan.sessions.filter((s) => s.week_number === week && s.kind !== 'descanso'
    && !(week === 1 && s.day_number && s.day_number < (ctx.startDow || 1)));
}
