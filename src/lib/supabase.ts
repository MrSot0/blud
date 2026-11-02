// src/lib/supabase.ts
// Conexión opcional con Supabase. Sin PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY el sitio sigue en modo demo (localStorage).

const URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

/** true cuando el sitio está conectado a una base de datos real. */
export const usaSupabase = () => Boolean(URL && ANON_KEY);
