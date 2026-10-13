import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Comprueba que las credenciales existan y estén rellenas
export const configOk = Boolean(
  SUPABASE_URL && 
  SUPABASE_ANON_KEY && 
  SUPABASE_URL.startsWith('http')
);

// Inicializa el cliente oficial de Supabase
export const sb = configOk && window.supabase 
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) 
  : null;