import { sb } from './supabaseClient.js';

// ---------- Guardar un plan importado desde Excel (siempre como BORRADOR) ----------
// Supabase no permite una transacción desde el navegador, así que si algo falla a mitad
// borramos el plan recién creado (sus sesiones y pautas se borran en cascada)
// para no dejar datos a medias.
export async function savePlan({ trainerId, clientId, plan, sessions = [], habits = [] }) {
  let planId = null;
  try {
    const { data: created, error: planErr } = await sb.from('plans')
      .insert({
        trainer_id: trainerId,
        client_id: clientId,
        name: plan.name,
        description: plan.description,
        start_date: plan.start_date,
        end_date: plan.end_date,
        status: 'draft'
      })
      .select('id')
      .single();
    if (planErr) throw planErr;
    planId = created.id;

    if (sessions.length) {
      const { data: savedSessions, error: sessErr } = await sb.from('sessions')
        .insert(sessions.map((s) => ({
          plan_id: planId,
          week_number: s.week_number,
          day_number: s.day_number,
          title: s.title,
          sort_order: s.sort_order
        })))
        .select('id, sort_order');
      if (sessErr) throw sessErr;

      // sort_order es único por sesión dentro del plan: sirve para casar cada sesión con su id
      const idByOrder = new Map(savedSessions.map((r) => [r.sort_order, r.id]));
      const rows = sessions.flatMap((s) => s.exercises.map((ex) => ({
        session_id: idByOrder.get(s.sort_order),
        exercise_id: ex.exercise_id,
        exercise_name: ex.exercise_name,
        sets: ex.sets,
        reps: ex.reps,
        rest_seconds: ex.rest_seconds,
        rpe: ex.rpe,
        tempo: ex.tempo,
        notes: ex.notes,
        sort_order: ex.sort_order
      })));

      if (rows.length) {
        const { error: exErr } = await sb.from('session_exercises').insert(rows);
        if (exErr) throw exErr;
      }
    }

    if (habits.length) {
      const { error: habErr } = await sb.from('habits_nutrition')
        .insert(habits.map((h) => ({
          plan_id: planId,
          category: h.category,
          title: h.title,
          content: h.content,
          frequency: h.frequency,
          sort_order: h.sort_order
        })));
      if (habErr) throw habErr;
    }

    return planId;
  } catch (err) {
    if (planId) await sb.from('plans').delete().eq('id', planId); // deshacer
    throw err;
  }
}

// ---------- Panel del entrenador ----------
export async function listClientPlans(clientId) {
  const { data, error } = await sb.from('plans')
    .select('id, name, status, start_date, end_date, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

const dayBefore = (iso) => {
  const d = iso ? new Date(`${iso}T12:00:00`) : new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Todos los planes del entrenador (se cruzan con la lista de clientes en pantalla)
export async function listTrainerPlans(trainerId) {
  const { data, error } = await sb.from('plans')
    .select('id, name, status, starts_on, ended_on, created_at, client_id')
    .eq('trainer_id', trainerId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

// Un cliente solo tiene un plan activo. Al activar uno con fecha de inicio (startsOn),
// el que estaba activo pasa a archivado y queda vigente hasta el día anterior: no se pierde ningún registro.
export async function setPlanStatus({ planId, clientId, status, startsOn }) {
  const patch = { status };
  if (status === 'active' && startsOn) patch.starts_on = startsOn;
  const { error } = await sb.from('plans').update(patch).eq('id', planId);
  if (error) throw error;
  if (status === 'active') {
    const { error: archErr } = await sb.from('plans')
      .update({ status: 'archived', ended_on: dayBefore(startsOn) })
      .eq('client_id', clientId).eq('status', 'active').neq('id', planId);
    if (archErr) throw archErr;
  }
}

export async function deletePlan(planId) {
  const { error } = await sb.from('plans').delete().eq('id', planId);
  if (error) throw error;
}

// ---------- Pantalla del cliente ----------
const PLAN_SELECT = `*,
  sessions ( *,
    session_exercises ( *,
      exercise:exercises ( description, video_path ) ) ),
  habits_nutrition ( * )`;

function sortPlan(data) {
  const bySort = (a, b) => a.sort_order - b.sort_order;
  data.sessions = (data.sessions || [])
    .sort((a, b) => a.week_number - b.week_number || (a.day_number ?? 8) - (b.day_number ?? 8) || bySort(a, b));
  data.sessions.forEach((x) => { x.session_exercises = (x.session_exercises || []).sort(bySort); });
  data.habits_nutrition = (data.habits_nutrition || []).sort(bySort);
  return data;
}

// Plan activo del cliente con sus sesiones, ejercicios y pautas (o null si no tiene)
export async function loadActivePlan(clientId) {
  const { data, error } = await sb.from('plans').select(PLAN_SELECT)
    .eq('client_id', clientId).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data ? sortPlan(data) : null;
}

// El entrenador puede abrir cualquier plan: borrador, activo o archivado
export async function loadPlanById(planId) {
  const { data, error } = await sb.from('plans').select(PLAN_SELECT).eq('id', planId).maybeSingle();
  if (error) throw error;
  return data ? sortPlan(data) : null;
}
