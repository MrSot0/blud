// src/lib/supabase.ts
// Conexión opcional con Supabase (proyecto Bloodonor). Sin PUBLIC_SUPABASE_URL y PUBLIC_SUPABASE_ANON_KEY el sitio
// sigue en modo demo (todo en localStorage). Con ellas, localStorage pasa a ser solo una caché:
//   - al cargar un panel, blud_panel() devuelve lo que el rol puede ver, ya con la forma de las colecciones;
//   - cada cambio de una colección se envía a blud_guardar(), que lo aplica con las funciones del esquema
//     (evaluar_donante, registrar_donacion, reservar_unidades…). Quién puede qué lo decide la base, no el navegador.
// Ver supabase/migrations/20261102120000_blud_adaptador.sql.
//
// Este módulo no importa lib/db ni lib/auth para no crear dependencias circulares: escribe la caché directamente.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { centers } from '../data/centers';

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

/** Colecciones que blud_panel() rellena (las que el rol no puede ver llegan vacías). */
const COLECCIONES = [
  'blud-db-donantes', 'blud-db-donaciones', 'blud-db-pedidos', 'blud-db-entregas', 'blud-db-pruebas',
  'blud-db-fracciones', 'blud-db-positivos', 'blud-db-tickets', 'blud-db-ticket-notas',
];
/** Unidades disponibles en el inventario (solo con base real: en modo demo se calculan de las donaciones). */
export const UNIDADES_KEY = 'blud-db-unidades';
/** Caché de perfiles del personal (solo la dirección los recibe). */
export const PERFILES_KEY = 'blud-db-perfiles';
const CITAS_KEY = 'blud-appointments';

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
function avisarAviso(mensaje: string) {
  try { window.dispatchEvent(new CustomEvent('blud:sync-aviso', { detail: { mensaje } })); } catch {}
}

/** Correo de la sesión guardada por lib/auth (sin importarlo, para no crear un ciclo). */
function correoSesion(): string {
  try {
    const s = JSON.parse(localStorage.getItem('blud-session') || sessionStorage.getItem('blud-session') || 'null');
    return String(s?.email ?? '').toLowerCase();
  } catch {
    return '';
  }
}

// ------------------------------------------------------------------ Lectura
let sincronizando: Promise<void> | null = null;

/** Descarga a la caché local todo lo que el rol puede ver. */
export function sincronizar(): Promise<void> {
  const c = sb();
  if (!c || !correoSesion()) return Promise.resolve();
  sincronizando ??= (async () => {
    const { data, error } = await c.rpc('blud_panel');
    if (error) return avisarError(error.message);
    const panel = (data ?? {}) as Record<string, unknown>;
    COLECCIONES.forEach((k) => guardarCache(k, panel[k] ?? []));
    guardarCache(UNIDADES_KEY, panel[UNIDADES_KEY] ?? []);
    if (panel.perfiles) guardarCache(PERFILES_KEY, panel.perfiles);
    if (panel.citas) {
      // Citas del donante con la forma que usa lib/auth (libro por correo).
      const citas = (panel.citas as { id: string; centerName: string; date: string; time: string; estado?: string }[]).map((x) => ({
        id: x.id, centerName: x.centerName, date: x.date, time: x.time, estado: x.estado,
        centerId: centers.find((ce) => ce.name === x.centerName)?.id ?? '', createdAt: x.date,
      }));
      guardarCache(CITAS_KEY, { [correoSesion()]: citas });
    }
    avisar();
  })().finally(() => { sincronizando = null; });
  return sincronizando;
}

// ------------------------------------------------------------------ Escritura
/**
 * Envía a la base lo que acaba de cambiar en la caché y vuelve a leer: la base asigna los códigos definitivos
 * (DON-…, REQ-…) y, si rechaza el cambio, el panel vuelve a mostrar lo que de verdad quedó guardado.
 */
export function subir(key: string, item: object) {
  const c = sb();
  if (!c || !COLECCIONES.includes(key)) return;
  c.rpc('blud_guardar', { p_coleccion: key, p_item: item }).then(async ({ data, error }) => {
    const res = (data ?? {}) as { error?: string; aviso?: string };
    if (error || res.error) avisarError(error?.message ?? res.error!);
    else if (res.aviso) avisarAviso(res.aviso);
    await sincronizar();
  });
}

export function borrar(key: string, id: string) {
  const c = sb();
  if (!c || !COLECCIONES.includes(key)) return;
  c.rpc('blud_borrar', { p_coleccion: key, p_id: id }).then(async ({ error }) => {
    if (error) avisarError(error.message);
    await sincronizar();
  });
}

/** Al cerrar sesión con base real, se vacía la caché para que la próxima persona no vea datos ajenos. */
export function limpiarCache() {
  try {
    [...COLECCIONES, UNIDADES_KEY, PERFILES_KEY, CITAS_KEY, 'blud-donor', 'blud-donor-cita', 'blud-donor-historial', 'blud-donor-foto']
      .forEach((k) => localStorage.removeItem(k));
  } catch {}
}
