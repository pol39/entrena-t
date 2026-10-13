import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configOk = Boolean(
  SUPABASE_URL && 
  SUPABASE_ANON_KEY && 
  !SUPABASE_URL.includes('PEGA_AQUI') && 
  !SUPABASE_ANON_KEY.includes('PEGA_AQUI')
);

export const sb = configOk ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;