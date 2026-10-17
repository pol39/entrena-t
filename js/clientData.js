import { sb } from './supabaseClient.js';

const pad = (n) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtKg = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const must = ({ data, error }) => { if (error) throw error; return data; };

// ---------- Biblioteca y vídeos ----------
// Biblioteca del entrenador (el cliente solo ve la de su entrenador; lo limita RLS)
export async function listLibrary() {
  return must(await sb.from('exercises').select('id, name, description, video_path, muscle_group'));
}

export async function saveBodyWeight(clientId, kg) {
  must(await sb.from('profiles').update({ body_weight_kg: kg }).eq('id', clientId));
}

export async function signedVideoUrl(path) {
  try {
    const { data, error } = await sb.storage.from('exercise-videos').createSignedUrl(path, 3600);
    return error ? null : data.signedUrl;
  } catch { return null; }
}

// ---------- Series registradas ----------
export async function listSessionLogs(clientId, seIds) {
  if (!seIds.length) return [];
  return must(await sb.from('workout_logs')
    .select('session_exercise_id, set_number, weight_kg, reps_done, rir_actual, sensation, pain_flag, pain_note')
    .eq('client_id', clientId).in('session_exercise_id', seIds));
}

// Valores de la última vez que hizo cada ejercicio (para autorrellenar). Devuelve Map nombre -> Map serie -> {weight, reps}
export async function listLastLogs(clientId, names, excludeIds) {
  const out = new Map();
  if (!names.length) return out;
  const rows = must(await sb.from('workout_logs')
    .select('session_exercise_id, set_number, weight_kg, reps_done, log_date, session_exercises!inner(exercise_name)')
    .eq('client_id', clientId).in('session_exercises.exercise_name', names)
    .order('log_date', { ascending: false }).limit(400));
  const skip = new Set(excludeIds);
  const bestDate = new Map();
  for (const r of rows) {
    if (skip.has(r.session_exercise_id)) continue;
    const name = r.session_exercises.exercise_name;
    if (!bestDate.has(name)) { bestDate.set(name, r.log_date); out.set(name, new Map()); }
    if (r.log_date === bestDate.get(name) && !out.get(name).has(r.set_number)) {
      out.get(name).set(r.set_number, { weight: r.weight_kg, reps: r.reps_done });
    }
  }
  return out;
}

export async function saveSet({ clientId, sessionId, week, seId, setNumber, weight, reps, rir, sensation, pain, note }) {
  must(await sb.from('workout_logs').upsert({
    client_id: clientId, session_id: sessionId, week_number: week, session_exercise_id: seId,
    set_number: setNumber, weight_kg: weight, reps_done: reps, rir_actual: rir, sensation,
    pain_flag: !!pain, pain_note: note, log_date: isoDate(), logged_at: new Date().toISOString()
  }, { onConflict: 'client_id,session_exercise_id,set_number' }));
}

export async function deleteSet(clientId, seId, setNumber) {
  must(await sb.from('workout_logs').delete()
    .eq('client_id', clientId).eq('session_exercise_id', seId).eq('set_number', setNumber));
}

// RIR real, sensación y molestias se guardan en todas las series ya registradas del ejercicio
export async function updateExerciseExtras(clientId, seId, patch) {
  must(await sb.from('workout_logs').update(patch).eq('client_id', clientId).eq('session_exercise_id', seId));
}

// ---------- Sesiones completadas ----------
export async function getCompletion(clientId, sessionId) {
  return must(await sb.from('session_completions').select('completed_on, total_volume, note')
    .eq('client_id', clientId).eq('session_id', sessionId).maybeSingle());
}

export async function listCompletions(clientId, sessionIds) {
  if (!sessionIds.length) return [];
  return must(await sb.from('session_completions').select('session_id, completed_on, total_volume')
    .eq('client_id', clientId).in('session_id', sessionIds));
}

export async function saveCompletion({ clientId, sessionId, totalVolume, note }) {
  must(await sb.from('session_completions').upsert({
    client_id: clientId, session_id: sessionId, completed_on: isoDate(), total_volume: totalVolume, note
  }, { onConflict: 'client_id,session_id' }));
}

// ---------- Microciclo ----------
export async function listPlanLogs(clientId, sessionIds) {
  if (!sessionIds.length) return [];
  return must(await sb.from('workout_logs')
    .select('week_number, weight_kg, reps_done, rir_actual, session_id, session_exercise_id, session_exercises(exercise_name)')
    .eq('client_id', clientId).in('session_id', sessionIds));
}

// ---------- Mensajes ----------
export async function listMessages(me, other, limit = 60) {
  const rows = must(await sb.from('messages').select('id, sender_id, body, created_at')
    .or(`and(sender_id.eq.${me},recipient_id.eq.${other}),and(sender_id.eq.${other},recipient_id.eq.${me})`)
    .order('created_at', { ascending: false }).limit(limit));
  return rows.reverse();
}

export async function sendMessage(me, other, body) {
  must(await sb.from('messages').insert({ sender_id: me, recipient_id: other, body }));
}

export async function markRead(me, other) {
  must(await sb.from('messages').update({ read_at: new Date().toISOString() })
    .eq('recipient_id', me).eq('sender_id', other).is('read_at', null));
}
