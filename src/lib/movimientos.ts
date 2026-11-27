// src/lib/movimientos.ts
// RF-I2 y RF-DIR3: historial de movimientos de las unidades (ingreso, cambios de estado, ubicación y traslados
// entre sedes), con fecha, hora y responsable. Con base real: blud_movimientos (migración 20261127160000), que lee
// la auditoría automática de unidadsangre. En modo demo se arma con las donaciones de ejemplo.

import { codigoDonacion, donaciones } from './db';
import { rpc } from './rpc';
import { usaSupabase } from './supabase';

export { NoDisponible, MENSAJE_NO_DISPONIBLE } from './rpc';

export type TipoMovimiento = 'Ingreso' | 'Estado' | 'Ubicación' | 'Traslado';
export const TIPOS: { id: TipoMovimiento; label: string }[] = [
  { id: 'Ingreso', label: 'Ingreso al inventario' },
  { id: 'Estado', label: 'Cambio de estado' },
  { id: 'Ubicación', label: 'Cambio de ubicación' },
  { id: 'Traslado', label: 'Traslado entre sedes' },
];

export interface Movimiento {
  id: number | string; fecha: string; tipo: TipoMovimiento; unidad: string; codigo?: string; componente?: string; sangre?: string;
  de?: string; a?: string; causa?: string; usuario?: string;
}
export interface FiltrosMov { q?: string; tipo?: string; desde?: string; hasta?: string }
export interface PaginaMov { items: Movimiento[]; siguiente: string | null }

export const POR_PAGINA = 25;
export const MIN_BUSQUEDA = 3;

/** Estados de la unidad en lenguaje claro. */
export const ESTADO: Record<string, string> = {
  Cuarentena: 'En cuarentena', Disponible: 'Disponible', Reservado: 'Reservada', EnTransito: 'En tránsito',
  Transfundido: 'Transfundida', Descartado: 'Descartada',
};
export const estadoTexto = (e?: string) => (e ? ESTADO[e] ?? e : '');

/** «Cuarentena → Disponible», «Estante 2 → Cámara 1», etc. */
export function cambioTexto(m: Movimiento): string {
  const f = (v?: string) => (m.tipo === 'Ingreso' || m.tipo === 'Estado' ? estadoTexto(v) : v ?? '');
  if (m.tipo === 'Ingreso') return `Entra ${f(m.a).toLowerCase()}`;
  return `${f(m.de) || 'Sin dato'} → ${f(m.a) || 'Sin dato'}`;
}

// ------------------------------------------------------------------ Modo demo
function demo(): Movimiento[] {
  const out: Movimiento[] = [];
  donaciones.all().forEach((d) => {
    const base = { unidad: String(d.id), codigo: codigoDonacion(d.id), componente: d.tipoHemocomponente, sangre: d.tipoSangre, usuario: 'Personal de ejemplo' };
    const t = new Date(d.fecha.length === 10 ? d.fecha + 'T09:00:00' : d.fecha).getTime();
    out.push({ ...base, id: `${d.id}-i`, fecha: new Date(t).toISOString(), tipo: 'Ingreso', a: 'Cuarentena' });
    const lab = d.estadoLab ?? 'liberada';
    if (lab !== 'pendiente') out.push({ ...base, id: `${d.id}-e`, fecha: new Date(t + 26 * 3600000).toISOString(), tipo: 'Estado',
      de: 'Cuarentena', a: lab === 'descartada' ? 'Descartado' : 'Disponible', causa: lab === 'descartada' ? 'Serología reactiva' : undefined });
  });
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// ------------------------------------------------------------------ API
export async function paginaMovimientos(f: FiltrosMov, cursor: string | null, limite = POR_PAGINA): Promise<PaginaMov> {
  const q = (f.q?.trim().length ?? 0) >= MIN_BUSQUEDA ? f.q!.trim() : '';
  if (!usaSupabase()) {
    const ql = q.toLowerCase();
    const todo = demo().filter((m) =>
      (!f.tipo || m.tipo === f.tipo) && (!f.desde || m.fecha.slice(0, 10) >= f.desde) && (!f.hasta || m.fecha.slice(0, 10) <= f.hasta) &&
      (!ql || `${m.codigo} ${m.usuario}`.toLowerCase().includes(ql)));
    const desde = cursor ? Number(cursor) : 0;
    return { items: todo.slice(desde, desde + limite), siguiente: desde + limite < todo.length ? String(desde + limite) : null };
  }
  const r = await rpc<Partial<PaginaMov>>('blud_movimientos', {
    p_q: q || null, p_tipo: f.tipo || null, p_desde: f.desde || null, p_hasta: f.hasta || null,
    p_cursor: cursor ? Number(cursor) : null, p_limite: limite,
  });
  return { items: r?.items ?? [], siguiente: r?.siguiente ?? null };
}
