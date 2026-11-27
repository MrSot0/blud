// src/lib/cupos.ts
// RF-D7: cupos libres por franja de una hora en un centro y día (blud_cupos, migración 20261127140000).
// La base valida igual al agendar; esto solo sirve para no ofrecer horas llenas. En modo demo no hay límite.

import { NoDisponible, rpc } from './rpc';
import { usaSupabase } from './supabase';

/** Cupos libres por hora («08» → 3). null = sin datos (modo demo o función sin aplicar): no se limita nada. */
export type Cupos = Map<string, number> | null;

export async function cuposDelDia(centro: string, fecha: string): Promise<Cupos> {
  if (!usaSupabase()) return null;
  try {
    const l = (await rpc<{ hora: string; libres: number }[]>('blud_cupos', { p_centro: centro, p_fecha: fecha })) ?? [];
    return new Map(l.map((c) => [c.hora.slice(0, 2), c.libres]));
  } catch (e) {
    if (e instanceof NoDisponible) return null;
    throw e;
  }
}

/** Cupos libres para una hora «HH:MM» (0 si la franja no existe en la jornada de la sede); undefined si no hay datos. */
export const libresEn = (cupos: Cupos, hhmm: string) => (cupos ? cupos.get(hhmm.slice(0, 2)) ?? 0 : undefined);
