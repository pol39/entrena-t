import { sb } from '../supabaseClient.js';

// Guarda un plan importado desde Excel como BORRADOR.
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
