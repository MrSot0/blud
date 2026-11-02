// src/lib/supabase.ts
// Conexión opcional con Supabase. Sin PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY el sitio sigue en modo demo
// (todo en localStorage). Con ellas, localStorage pasa a ser solo una caché: cada cambio se guarda en la base y,
// al cargar un panel, se descarga lo que el rol puede ver. Quién ve qué lo deciden las reglas RLS de la base
// (supabase/migrations), no el navegador.
//
// Este módulo no importa lib/db ni lib/auth para no crear dependencias circulares: escribe la caché directamente.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const URL = import.meta.env.PUBLIC_SUPABASE_URL as string | undefined;
const ANON_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined;

/** true cuando el sitio está conectado a una base de datos real. */
export const usaSupabase = () => Boolean(URL && ANON_KEY);

let client: SupabaseClient | null = null;
export function sb(): SupabaseClient | null {
  if (!usaSupabase()) return null;
  client ??= createClient(URL!, ANON_KEY!, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'blud-sb-auth' } });
  return client;
}

/** Colecciones de lib/db ↔ tablas de la base. */
export const TABLAS: Record<string, string> = {
  'blud-db-donantes': 'donantes',
  'blud-db-donaciones': 'donaciones',
  'blud-db-pedidos': 'pedidos',
  'blud-db-entregas': 'entregas',
  'blud-db-pruebas': 'pruebas',
  'blud-db-fracciones': 'fracciones',
  'blud-db-positivos': 'positivos',
  'blud-db-tickets': 'tickets',
  'blud-db-ticket-notas': 'ticket_notas',
};
/** Caché de perfiles (solo la dirección puede leerlos todos). */
export const PERFILES_KEY = 'blud-db-perfiles';
const CITAS_KEY = 'blud-appointments';

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** Objeto del front → fila: claves en snake_case y undefined → null. Los campos jsonb se guardan tal cual. */
export const aFila = (o: object) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [snake(k), v === undefined ? null : v]));
/** Fila → objeto del front: camelCase y sin nulls. */
export const deFila = <T = Record<string, unknown>>(r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).filter(([, v]) => v !== null).map(([k, v]) => [camel(k), v])) as T;

const guardarCache = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
};
const avisar = () => {
  try { window.dispatchEvent(new CustomEvent('blud:db', { detail: { key: '*' } })); } catch {}
};
function avisarError(mensaje: string) {
  try { window.dispatchEvent(new CustomEvent('blud:sync-error', { detail: { mensaje } })); } catch {}
  console.error('[BLUD · Supabase]', mensaje);
}

/** Rol y correo de la sesión guardada por lib/auth (sin importarlo, para no crear un ciclo). */
function sesion(): { rol: string; email: string } {
  try {
    const s = JSON.parse(localStorage.getItem('blud-session') || sessionStorage.getItem('blud-session') || 'null');
    return { rol: String(s?.role ?? ''), email: String(s?.email ?? '') };
  } catch {
    return { rol: '', email: '' };
  }
}

// ------------------------------------------------------------------ Lectura
let sincronizando: Promise<void> | null = null;

/** Descarga a la caché local todo lo que el rol puede ver (RLS filtra en la base). */
export function sincronizar(): Promise<void> {
  const c = sb();
  const { rol, email } = sesion();
  if (!c || !rol) return Promise.resolve();
  sincronizando ??= (async () => {
    const tablas = Object.entries(TABLAS);
    const res = await Promise.all(tablas.map(([, tabla]) => c.from(tabla).select('*')));
    res.forEach(({ data, error }, i) => {
      if (error) return avisarError(`No se pudo leer ${tablas[i][1]}: ${error.message}`);
      guardarCache(tablas[i][0], (data ?? []).map((r) => deFila(r)));
    });

    // La dirección no ve el detalle del laboratorio: recibe un resumen sin pruebas por enfermedad ni donantes.
    if (rol === 'director') {
      const { data, error } = await c.rpc('resumen_laboratorio');
      if (error) avisarError(`No se pudo leer el resumen del laboratorio: ${error.message}`);
      else {
        guardarCache('blud-db-pruebas', (data?.pruebas ?? []).map((r: Record<string, unknown>) => deFila(r)));
        guardarCache('blud-db-positivos', (data?.positivos ?? []).map((r: Record<string, unknown>) => deFila(r)));
      }
      const perfiles = await c.from('profiles').select('*');
      if (!perfiles.error) guardarCache(PERFILES_KEY, perfiles.data);
    }

    // Citas propias del donante, con la forma que usa lib/auth (libro por correo).
    if (rol === 'donante') {
      const { data, error } = await c.from('citas').select('*');
      if (!error) {
        const citas = (data ?? []).map((r) => {
          const o = deFila<Record<string, unknown>>(r);
          return { id: o.id, centerId: o.centerId, centerName: o.centerName, date: o.date, time: o.time, createdAt: o.createdAt };
        });
        guardarCache(CITAS_KEY, { [email.toLowerCase()]: citas });
      }
    }
    avisar();
  })().finally(() => { sincronizando = null; });
  return sincronizando;
}

// ------------------------------------------------------------------ Escritura
/** Guarda en la base lo que acaba de cambiar en la caché. Si la base lo rechaza, se vuelve a leer para no mostrar algo falso. */
export function subir(key: string, item: object) {
  const c = sb();
  const { rol } = sesion();
  const tabla = TABLAS[key];
  if (!c || !tabla) return;
  c.from(tabla).upsert(aFila(item)).then(async ({ error }) => {
    if (!error) return;
    // Donante ya registrado en persona por un operador: se enlaza su cuenta con ese registro.
    if (tabla === 'donantes' && error.code === '23505' && rol === 'donante') {
      const cedula = (item as { cedula?: string }).cedula;
      if (cedula) await c.rpc('vincular_mi_registro', { p_cedula: cedula });
    } else {
      avisarError(`No se guardó en ${tabla}: ${error.message}`);
    }
    await sincronizar();
  });
}

export function borrar(key: string, id: string) {
  const c = sb();
  const tabla = TABLAS[key];
  if (!c || !tabla) return;
  c.from(tabla).delete().eq('id', id).then(async ({ error }) => {
    if (error) {
      avisarError(`No se borró en ${tabla}: ${error.message}`);
      await sincronizar();
    }
  });
}

/** Al cerrar sesión con base real, se vacía la caché para que la próxima persona no vea datos ajenos. */
export function limpiarCache() {
  try {
    [...Object.keys(TABLAS), PERFILES_KEY, CITAS_KEY, 'blud-donor', 'blud-donor-cita', 'blud-donor-historial'].forEach((k) => localStorage.removeItem(k));
  } catch {}
}
