import { sb } from './supabaseClient.js';
import { render, esc, toast, friendlyError } from './ui.js';

const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const KIND = { fuerza: 'Fuerza', cardio: 'Cardio', movilidad: 'Movilidad' };

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Lunes a domingo de la semana de "today", a medianoche local
function weekDates(today) {
  const mon = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, i) => new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i));
}

// Un hábito con frecuencia "Cada lunes" solo aparece ese día; el resto, a diario
function appliesOn(habit, date) {
  const m = norm(habit.frequency).match(/cada (lunes|martes|miercoles|jueves|viernes|sabado|domingo)/);
  return !m || WEEKDAYS[date.getDay()] === m[1];
}

async function fetchData(ctx, fromIso, toIso, todayIso) {
  const sessionIds = ctx.plan.sessions.map((s) => s.id);
  const [completions, logs, checks] = await Promise.all([
    sb.from('session_completions').select('session_id, completed_on, total_volume')
      .eq('client_id', ctx.clientId).in('session_id', sessionIds),
    sb.from('workout_logs').select('log_date, weight_kg, reps_done')
      .eq('client_id', ctx.clientId).gte('log_date', fromIso).lte('log_date', toIso),
    sb.from('habit_checks').select('habit_id, done')
      .eq('client_id', ctx.clientId).eq('check_date', todayIso)
  ]);
  for (const r of [completions, logs, checks]) if (r.error) throw r.error;
  return { completions: completions.data, logs: logs.data, checks: checks.data };
}

async function setHabitCheck({ clientId, habitId, date, done }) {
  const { error } = await sb.from('habit_checks').upsert(
    { client_id: clientId, habit_id: habitId, check_date: date, done },
    { onConflict: 'client_id,habit_id,check_date' });
  if (error) throw error;
}

export async function mount(ctx) {
  const today = new Date();
  const todayIso = isoDate(today);
  const dates = weekDates(today);
  const { completions, logs, checks } = await fetchData(ctx, isoDate(dates[0]), isoDate(dates[6]), todayIso);
  const ro = ctx.mode === 'trainer';

  // --- Progreso de la semana ---
  const weekSessions = ctx.plan.sessions.filter((s) => s.week_number === ctx.week && s.kind !== 'descanso');
  const doneIds = new Set(completions.map((c) => c.session_id));
  const doneCount = weekSessions.filter((s) => doneIds.has(s.id)).length;
  const pct = weekSessions.length ? doneCount / weekSessions.length : 0;
  const pctText = Math.round(pct * 100);

  // --- Sesión de hoy (la del día si tiene día asignado; si no, la primera pendiente) ---
  const dayNum = today.getDay() === 0 ? 7 : today.getDay();
  const planned = weekSessions.find((s) => s.day_number === dayNum);
  const next = (planned && !doneIds.has(planned.id)) ? planned : (weekSessions.find((s) => !doneIds.has(s.id)) || null);
  ctx.sessionId = next ? next.id : null;
  const doneToday = planned && doneIds.has(planned.id);

  // --- Calendario de la semana ---
  const completedDays = new Set(completions.map((c) => c.completed_on));
  const plannedDays = new Set(weekSessions.map((s) => s.day_number).filter(Boolean));
  const strip = dates.map((d, i) => {
    const iso = isoDate(d);
    const cls = ['day'];
    let label = DAY_NAMES[i];
    if (completedDays.has(iso)) { cls.push('done'); label += ': sesión hecha'; }
    else if (plannedDays.size && !plannedDays.has(i + 1)) { cls.push('rest'); label += ': descanso'; }
    if (iso === todayIso) { cls.push('today'); label += ' (hoy)'; }
    return `<div class="${cls.join(' ')}" role="listitem" aria-label="${label}">${DAY_LETTERS[i]}<span class="dot"></span></div>`;
  }).join('');

  // --- Peso levantado por día (peso × repeticiones) ---
  const volumes = dates.map(() => 0);
  const dayIndex = new Map(dates.map((d, i) => [isoDate(d), i]));
  for (const l of logs) {
    const i = dayIndex.get(l.log_date);
    if (i !== undefined) volumes[i] += Number(l.weight_kg || 0) * Number(l.reps_done || 0);
  }
  const total = volumes.reduce((a, b) => a + b, 0);
  const maxV = Math.max(...volumes, 1);
  const bars = dates.map((d, i) => {
    const v = volumes[i];
    const future = isoDate(d) > todayIso;
    const cls = v === 0 && future ? 'bar plan' : 'bar';
    const h = v > 0 ? Math.max(v / maxV, 0.06) : (future ? 0.25 : 0.04);
    return `<div><span class="${cls}" style="--v:${h.toFixed(3)}"></span><small>${DAY_LETTERS[i]}</small></div>`;
  }).join('');
  const barsLabel = dates.map((_, i) => `${DAY_NAMES[i]} ${fmt(volumes[i])} kg`).join(', ');

  // --- Hábitos marcables de hoy ---
  const checkMap = new Map(checks.map((c) => [c.habit_id, c.done]));
  const habits = (ctx.plan.habits_nutrition || []).filter((h) => h.checkable && appliesOn(h, today));

  const name = ctx.profile.full_name || ctx.profile.email.split('@')[0];
  const nEx = next ? (next.session_exercises || []).filter((e) => (e.block || 'principal') === 'principal').length : 0;

  let todayCard;
  if (next) {
    todayCard = `
      <div class="card card-today stack">
        <p class="muted small">${next === planned ? 'Hoy' : 'Siguiente sesión'}${doneToday ? ' · hoy ya has entrenado' : ''}</p>
        <h2>${esc(next.title)}</h2>
        <p>${nEx ? `${nEx} ejercicio${nEx === 1 ? '' : 's'}` : (KIND[next.kind] || 'Sesión')}</p>
        ${next.objective ? `<p class="muted small">${esc(next.objective)}</p>` : ''}
        <button id="start" class="btn btn-lg btn-block" type="button">${ro ? 'Ver sesión' : 'Empezar sesión'}</button>
      </div>`;
  } else if (weekSessions.length) {
    todayCard = `<div class="card stack"><h2>¡Semana completada!</h2><p class="muted">Has hecho las ${weekSessions.length} sesiones de esta semana.</p></div>`;
  } else {
    todayCard = '<div class="card"><p class="muted">No hay sesiones programadas esta semana.</p></div>';
  }

  const habitsCard = habits.length ? `
    <div class="card stack">
      <div>
        <h2>Hábitos y descanso</h2>
        <p class="muted small">${ro ? 'Lo que ha marcado hoy' : 'Marca lo que has hecho hoy'}</p>
      </div>
      ${habits.map((h) => `
        <label class="check">
          <input type="checkbox" data-habit="${esc(h.id)}"${checkMap.get(h.id) ? ' checked' : ''}${ro ? ' disabled' : ''}>
          <span>${esc(h.title)}</span>
        </label>`).join('')}
    </div>` : '';

  const app = render(`
    <section class="stack-lg">
      <div>
        <p class="muted small">Semana ${ctx.week} de ${ctx.weeks}</p>
        <h1>${ro ? esc(name) : `Hola, ${esc(name)}`}</h1>
      </div>

      <div class="card stack">
        <div class="row">
          <div class="ring" style="--p:${pct.toFixed(3)}" role="img" aria-label="${pctText}% de las sesiones de la semana hechas">
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <circle class="track" cx="50" cy="50" r="42"/><circle class="fill" cx="50" cy="50" r="42"/>
            </svg>
            <span class="label">${pctText}%</span>
          </div>
          <div>
            <h2>${weekSessions.length ? `${doneCount} de ${weekSessions.length} sesiones` : 'Sin sesiones'}</h2>
            <p class="muted">hechas esta semana</p>
          </div>
        </div>
        <div class="week" role="list">${strip}</div>
      </div>

      ${todayCard}
      ${habitsCard}

      <div class="card stack">
        <div class="row">
          <span class="num-xl">${fmt(total)} kg</span>
          <span class="muted">levantados esta semana</span>
        </div>
        <div class="bars" role="img" aria-label="Peso levantado por día: ${barsLabel}">${bars}</div>
      </div>

      ${ro ? '' : '<button id="logout" class="btn btn-secondary btn-block" type="button">Cerrar sesión</button>'}
    </section>`);

  app.querySelector('#start')?.addEventListener('click', () => ctx.go('session'));
  app.querySelector('#logout')?.addEventListener('click', ctx.logout);
  app.querySelectorAll('input[data-habit]').forEach((input) => {
    input.onchange = async () => {
      input.disabled = true;
      try {
        await setHabitCheck({ clientId: ctx.clientId, habitId: input.dataset.habit, date: todayIso, done: input.checked });
      } catch (err) {
        input.checked = !input.checked;
        toast(friendlyError(err), 'error');
      } finally {
        input.disabled = false;
      }
    };
  });
}
