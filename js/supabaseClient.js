import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configOk = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY &&
  !SUPABASE_URL.includes('PEGA_AQUI') && !SUPABASE_ANON_KEY.includes('PEGA_AQUI')
);

// window.supabase lo aporta la librería cargada por CDN en index.html
export const sb = (window.supabase && configOk)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    })
  : null;
