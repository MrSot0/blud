// src/lib/rpc.ts
// Llamada a una función de la base con errores legibles. Si la función no existe todavía (migración sin aplicar)
// lanza NoDisponible, para que la pantalla muestre un aviso en lugar de un error técnico.

import { sb } from './supabase';

export class NoDisponible extends Error {}

export const MENSAJE_NO_DISPONIBLE = 'Esta sección todavía no está habilitada en el servidor del banco de sangre.';

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const c = sb();
  if (!c) throw new Error('Esta acción necesita conexión con el servidor del banco de sangre.');
  const { data, error } = await c.rpc(fn, args);
  if (error) {
    if (error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '')) throw new NoDisponible(MENSAJE_NO_DISPONIBLE);
    throw new Error(error.message || 'No pudimos conectar con el servidor.');
  }
  return data as T;
}

/** Motivo obligatorio de las acciones administrativas (la base repite la regla). */
export function validarMotivo(m: string): string | null {
  return m.trim().length < 10 ? 'Escribe el motivo (mínimo 10 caracteres): queda en la bitácora.' : null;
}
