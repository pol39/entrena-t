import { sb } from './supabaseClient.js';
import { GDPR_VERSION } from './config.js';

export async function getSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: location.origin + location.pathname }
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  await sb.auth.signOut();
}

export async function loadProfile(userId) {
  const { data, error } = await sb.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}

// La fecha exacta la fija el servidor (trigger); aquí solo enviamos la versión aceptada
export async function acceptGdpr(userId) {
  const { error } = await sb.from('profiles').update({ gdpr_version: GDPR_VERSION }).eq('id', userId);
  if (error) throw error;
}

export const needsConsent = (profile) =>
  profile.role === 'client' && profile.gdpr_version !== GDPR_VERSION;
