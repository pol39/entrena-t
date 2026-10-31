import { sb } from './supabaseClient.js';
import { render, esc, toast, friendlyError } from './ui.js';
import { countUp, haptic, sparkBurst, funFact } from './fx.js';
import { metricOf, tally, tallyText, exerciseMap, weekSessions as plannedSessions } from './metrics.js';

const DAY_LETTERS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
const KIND = { fuerza: 'Fuerza', cardio: 'Cardio', movilidad: 'Movilidad' };

const pad = (n) => String(n).padStart(2, '0');
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmt = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const empty = (t) => `<div class="empty"><p>${t}</p></div>`;

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
    sb.from('workout_logs').select('log_date, weight_kg, reps_done, session_exercise_id')
      .eq('client_id', ctx.clientId).gte('log_date', fromIso).lte('log_date', toIso),
    sb.from('habit_checks').select('habit_id, done, count')
      .eq('client_id', ctx.clientId).eq('check_date', todayIso)
  ]);
  for (const r of [completions, logs, checks]) if (r.error) throw r.error;
  return { completions: completions.data, logs: logs.data, checks: checks.data };
}

async function setHabitCheck({ clientId, habitId, date, done, count }) {
  const row = { client_id: clientId, habit_id: habitId, check_date: date, done };
  if (count !== undefined) row.count = count;
  const { error } = await sb.from('habit_checks').upsert(row, { onConflict: 'client_id,habit_id,check_date' });
  if (error) throw error;
}

// Pasos del contador según el objetivo (8 vasos → de 1 en 1; 8.000 pasos → de 1.000 en 1.000)
const stepOf = (target) => (target >= 1000 ? 1000 : (target >= 100 ? 50 : 1));

export async function mount(ctx) {
  const today = new Date();
  const todayIso = isoDate(today);
  const dates = weekDates(today);
  const { completions, logs, checks } = await fetchData(ctx, isoDate(dates[0]), isoDate(dates[6]), todayIso);
  const ro = ctx.mode === 'trainer';

  // --- Progreso de la semana ---
  const weekSessions = plannedSessions(ctx);
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

  // --- Peso levantado por día, según el tipo de ejercicio ---
  const exById = exerciseMap(ctx.plan);
  const bw = Number(ctx.profile.body_weight_kg) || null;
  const volumes = dates.map(() => 0);
  const dayIndex = new Map(dates.map((d, i) => [isoDate(d), i]));
  const items = [];
  for (const l of logs) {
    const i = dayIndex.get(l.log_date);
    if (i === undefined) continue;
    const item = { metric: metricOf(exById.get(l.session_exercise_id)), weight: l.weight_kg, reps: l.reps_done };
    items.push(item);
    volumes[i] += tally([item], bw).kg;
  }
  const weekTally = tally(items, bw);
  const total = weekTally.kg;
  const maxV = Math.max(...volumes, 1);
  const bars = dates.map((d, i) => {
    const v = volumes[i];
    const future = isoDate(d) > todayIso;
    const cls = v === 0 && future ? 'bar plan' : 'bar';
    const h = v > 0 ? Math.max(v / maxV, 0.06) : (future ? 0.25 : 0.04);
    return `<div><span class="${cls}" style="--v:${h.toFixed(3)}"></span><small>${DAY_LETTERS[i]}</small></div>`;
  }).join('');
  const barsLabel = dates.map((_, i) => `${DAY_NAMES[i]} ${fmt(volumes[i])} kg`).join(', ');

  // --- Pautas de hoy: alimentación, descanso y hábitos ---
  const all = ctx.plan.habits_nutrition || [];
  const byCat = (cat) => all.filter((h) => h.category === cat);
  const state = new Map(checks.map((c) => [c.habit_id, { done: !!c.done, count: c.count ?? 0 }]));
  const isOn = (h) => h.checkable && appliesOn(h, today);
  const isDone = (h) => {
    const s = state.get(h.id);
    return h.target > 1 ? (s?.count ?? 0) >= h.target : !!s?.done;
  };

  const infoHtml = (h) => ((!h.content && !h.detail)
    ? `<h3>${esc(h.title)}</h3>`
    : `<div class="card stack">
        <b>${esc(h.title)}</b>
        ${h.subtitle ? `<p class="muted small">${esc(h.subtitle)}</p>` : ''}
        ${h.content ? `<p style="white-space: pre-line">${esc(h.content)}</p>` : ''}
        ${h.detail ? `<p class="hot small" style="white-space: pre-line">${esc(h.detail)}</p>` : ''}
      </div>`);

  const itemHtml = (h) => {
    if (!h.checkable) return infoHtml(h);
    if (!appliesOn(h, today)) return '';
    const s = state.get(h.id);
    if (h.target > 1) {
      const step = stepOf(h.target);
      const n = s?.count ?? 0;
      return `
        <div class="card stack" data-counter="${esc(h.id)}" data-target="${h.target}">
          <div class="row-between"><span>${esc(h.title)}</span><span class="muted small">Vas <b data-n>${n}</b>/${h.target}${h.unit ? ` ${esc(h.unit)}` : ''}</span></div>
          <div class="meter${n >= h.target ? ' full' : ''}" style="--p:${Math.min(n / h.target, 1)}"><span></span></div>
          ${ro ? '' : `<div class="counter">
            <button class="btn-round" type="button" data-step="-${step}" aria-label="Quitar ${step}">−</button>
            <span class="count" data-n>${n}</span>
            <button class="btn-round plus" type="button" data-step="${step}" aria-label="Añadir ${step}">+</button>
          </div>`}
        </div>`;
    }
    return `
      <div class="card">
        <label class="check">
          <input type="checkbox" data-habit="${esc(h.id)}"${s?.done ? ' checked' : ''}${ro ? ' disabled' : ''}>
          <span class="grow">
            <b>${esc(h.title)}</b>${h.subtitle ? ` <span class="badge badge-warn">${esc(h.subtitle)}</span>` : ''}
            ${h.content ? `<span class="muted small" style="display:block">${esc(h.content)}</span>` : ''}
            ${h.detail ? `<span class="hot small" style="display:block; white-space: pre-line">${esc(h.detail)}</span>` : ''}
          </span>
        </label>
      </div>`;
  };

  const foodHtml = () => {
    const macros = byCat('macros');
    const kcal = macros.find((m) => /kcal/i.test(m.detail || ''));
    const cards = macros.filter((m) => m !== kcal);
    const meals = byCat('alimentacion');
    const eq = byCat('equivalencias');
    const sup = byCat('suplementos');
    if (!macros.length && !meals.length && !eq.length && !sup.length) {
      return empty('Tu entrenador aún no ha añadido la guía de alimentación a este plan.');
    }
    return `
      ${kcal ? `<div class="card stack"><h3>${esc(kcal.title)}</h3><span class="num-xl">${esc(kcal.detail)}</span>${kcal.content ? `<p class="muted small">${esc(kcal.content)}</p>` : ''}</div>` : ''}
      ${cards.length ? `<div class="macros">${cards.map((m) => `
        <div class="card"><p class="muted small">${esc(m.title)}</p><b class="macro-val">${esc(m.detail || '')}</b><p class="muted small">${esc(m.content || '')}</p></div>`).join('')}</div>` : ''}
      ${meals.map(itemHtml).join('')}
      ${eq.map((h) => ((!h.content) ? `<h3>${esc(h.title)}</h3>`
        : `<details class="card"><summary><strong>${esc(h.title)}</strong></summary><p style="white-space: pre-line; margin-top: var(--s2)">${esc(h.content)}</p></details>`)).join('')}
      ${sup.map(itemHtml).join('')}`;
  };

  const listHtml = (cat, msg) => (byCat(cat).length ? byCat(cat).map(itemHtml).join('') : empty(msg));
  const slides = [
    { label: 'Alimentación', cats: ['alimentacion'], html: foodHtml() },
    { label: 'Descanso', cats: ['descanso'], html: listHtml('descanso', 'Tu entrenador aún no ha añadido pautas de descanso a este plan.') },
    { label: 'Hábitos', cats: ['habito'], html: listHtml('habito', 'Tu entrenador aún no ha añadido hábitos a este plan.') }
  ];
  const progress = (s) => {
    const list = all.filter((h) => s.cats.includes(h.category) && isOn(h));
    return { done: list.filter(isDone).length, total: list.length };
  };
  const chipText = (s) => { const p = progress(s); return `${s.label}${p.total ? ` ${p.done}/${p.total}` : ''}`; };

  const name = ctx.profile.full_name || ctx.profile.email.split('@')[0];
  const nEx = next ? (next.session_exercises || []).filter((e) => (e.block || 'principal') === 'principal').length : 0;

  let todayCard;
  if (next) {
    todayCard = `
      <div class="card card-today stack">
        <p class="muted small">${next === planned ? 'Hoy' : 'Siguiente sesión'}${doneToday ? ' · hoy ya has entrenado' : ''}</p>
        <h2>${esc(next.title)}</h2>
        ${next.focus ? `<p class="muted small">${esc(next.focus)}</p>` : ''}
        <p>${nEx ? `${nEx} ejercicio${nEx === 1 ? '' : 's'}` : (KIND[next.kind] || 'Sesión')}</p>
        ${next.objective ? `<p class="muted small">${esc(next.objective)}</p>` : ''}
        <button id="start" class="btn btn-lg btn-block" type="button">${ro ? 'Ver sesión' : 'Empezar sesión'}</button>
      </div>`;
  } else if (weekSessions.length) {
    todayCard = `<div class="card stack"><h2>¡Semana completada!</h2><p class="muted">Has hecho las ${weekSessions.length} sesiones de esta semana.</p></div>`;
  } else {
    todayCard = '<div class="card"><p class="muted">No hay sesiones programadas esta semana.</p></div>';
  }

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

      <div class="stack">
        <div>
          <h2>Tu día</h2>
          <p class="muted small">${ro ? 'Lo que ha marcado hoy. Desliza para cambiar de apartado.' : 'Marca lo que vas haciendo. Desliza para cambiar de apartado.'}</p>
        </div>
        <div class="chips" role="group" aria-label="Alimentación, descanso y hábitos">
          ${slides.map((s, i) => `<button class="chip" type="button" data-slide="${i}" aria-pressed="${i === 0}">${esc(chipText(s))}</button>`).join('')}
        </div>
        <div class="carousel" id="carousel">
          ${slides.map((s) => `<section class="slide stack" aria-label="${esc(s.label)}">${s.html}</section>`).join('')}
        </div>
      </div>

      <div class="card stack">
        <div class="row">
          <span class="num-xl">${fmt(total)} kg</span>
          <span class="muted">levantados esta semana</span>
        </div>
        <div class="bars" role="img" aria-label="Peso levantado por día: ${barsLabel}">${bars}</div>
        ${tallyText(weekTally) ? `<p class="muted small">${esc(tallyText(weekTally))}</p>` : ''}
        ${funFact(total) ? `<p class="small">${esc(funFact(total))}</p>` : ''}
      </div>

      <div class="card stack">
        <h2>Peso corporal</h2>
        <p class="muted small">Se usa para contar las dominadas con tu propio peso.</p>
        <div class="row">
          <input id="bw" class="input" inputmode="decimal" placeholder="kg" value="${bw ? String(bw).replace('.', ',') : ''}" aria-label="Peso corporal en kilos">
          <button id="bw-save" class="btn btn-secondary" type="button">Guardar</button>
        </div>
      </div>

      ${ro ? '' : '<button id="logout" class="btn btn-secondary btn-block" type="button">Cerrar sesión</button>'}
    </section>`);

  app.querySelector('#start')?.addEventListener('click', () => ctx.go('session'));
  app.querySelector('#logout')?.addEventListener('click', ctx.logout);
  countUp(app.querySelector('.ring .label'), pctText, { format: (n) => `${Math.round(n)}%` });
  countUp(app.querySelector('.num-xl:not(.card .num-xl:first-child)') || app.querySelector('.card .row > .num-xl'), total, { format: (n) => `${fmt(n)} kg` });

  // --- Carrusel: se desliza con el dedo o se toca en los botones ---
  const car = app.querySelector('#carousel');
  const chips = [...app.querySelectorAll('[data-slide]')];
  let active = 0;
  const fit = () => { const s = car.children[active]; if (s) car.style.height = `${s.offsetHeight}px`; };
  const paintChips = () => chips.forEach((c, i) => {
    c.textContent = chipText(slides[i]);
    c.setAttribute('aria-pressed', String(i === active));
  });
  chips.forEach((c, i) => {
    c.onclick = () => {
      active = i;
      car.scrollTo({ left: i * car.clientWidth, behavior: 'smooth' });
      paintChips();
      fit();
    };
  });
  car.addEventListener('scroll', () => {
    const i = Math.round(car.scrollLeft / Math.max(car.clientWidth, 1));
    if (i !== active && i >= 0 && i < slides.length) { active = i; paintChips(); fit(); }
  }, { passive: true });
  fit();
  if (typeof ResizeObserver === 'function') {
    const ro2 = new ResizeObserver(fit);
    [...car.children].forEach((s) => ro2.observe(s));
  }

  // --- Peso corporal ---
  app.querySelector('#bw-save').onclick = async (ev) => {
    const btn = ev.currentTarget;
    const kg = Number(String(app.querySelector('#bw').value).trim().replace(',', '.'));
    if (!Number.isFinite(kg) || kg < 20 || kg > 400) { toast('Escribe un peso entre 20 y 400 kg.', 'error'); return; }
    btn.disabled = true;
    try {
      const { error } = await sb.from('profiles').update({ body_weight_kg: kg }).eq('id', ctx.clientId);
      if (error) throw error;
      ctx.profile.body_weight_kg = kg;
      toast('Peso guardado.', 'ok');
      await mount(ctx);
    } catch (err) {
      toast(friendlyError(err), 'error');
      btn.disabled = false;
    }
  };

  // --- Contadores (vasos de agua, pasos…) ---
  const paintCounter = (box, n, target) => {
    box.querySelectorAll('[data-n]').forEach((el) => { el.textContent = String(n); });
    const meter = box.querySelector('.meter');
    meter.style.setProperty('--p', String(Math.min(n / target, 1)));
    meter.classList.toggle('full', n >= target);
  };
  app.querySelectorAll('[data-counter]').forEach((box) => {
    const id = box.dataset.counter;
    const target = Number(box.dataset.target);
    let n = Number(box.querySelector('[data-n]').textContent);
    box.querySelectorAll('button[data-step]').forEach((b) => {
      b.onclick = async () => {
        const nextN = Math.min(Math.max(n + Number(b.dataset.step), 0), target * 2);
        if (nextN === n) return;
        const prev = n;
        n = nextN;
        paintCounter(box, n, target);
        state.set(id, { done: n >= target, count: n });
        paintChips();
        try {
          await setHabitCheck({ clientId: ctx.clientId, habitId: id, date: todayIso, done: n >= target, count: n });
          if (prev < target && n >= target) { sparkBurst(b); haptic([20, 40, 20]); }
        } catch (err) {
          n = prev;
          paintCounter(box, n, target);
          state.set(id, { done: n >= target, count: n });
          paintChips();
          toast(friendlyError(err), 'error');
        }
      };
    });
  });

  // --- Casillas (comidas, descanso, hábitos) ---
  app.querySelectorAll('input[data-habit]').forEach((input) => {
    input.onchange = async () => {
      const id = input.dataset.habit;
      input.disabled = true;
      try {
        await setHabitCheck({ clientId: ctx.clientId, habitId: id, date: todayIso, done: input.checked });
        state.set(id, { ...(state.get(id) || { count: 0 }), done: input.checked });
        if (input.checked) { sparkBurst(input); haptic(10); }
        paintChips();
      } catch (err) {
        input.checked = !input.checked;
        toast(friendlyError(err), 'error');
      } finally {
        input.disabled = false;
      }
    };
  });
}
