import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configOk = Boolean(
  SUPABASE_URL && 
  SUPABASE_ANON_KEY && 
  !SUPABASE_URL.includes('https://xlsmomporaagrvwwbsxb.supabase.co') && 
  !SUPABASE_ANON_KEY.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhsc21vbXBvcmFhZ3J2d3dic3hiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4MjIyOTgsImV4cCI6MjEwNzM5ODI5OH0.clcqHDMODZu-Zd80bjFFgmEXL7XOuppUMj0Xc_cRZLU')
);

export const sb = configOk ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;