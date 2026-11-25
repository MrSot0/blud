// src/lib/bitacora.ts
// Bitácora de auditoría (T9, I2, A4): quién hizo qué y cuándo. La dirección ve su sede; soporte, toda la red.
// Con base real: blud_bitacora() pagina por cursor (migración 20261125120000).
// En modo demo se arma con la actividad de ejemplo de todos los roles.

import { sb, usaSupabase } from './supabase';
import { actividadRed } from './director';
import { tickets } from './db';

export interface EntradaBitacora {
  id: string | number;
  fecha: string; // ISO o YYYY-MM-DD
  tabla: string;
  registro?: number | string;
  operacion: string;
  usuario?: string;
  correo?: string;
  sede?: string;
  detalle?: Record<string, unknown>;
}

export interface PaginaBitacora { items: EntradaBitacora[]; siguiente: string | null; tablas: string[] }

export interface FiltrosBitacora { q?: string; tabla?: string; desde?: string; hasta?: string }

/** Nombre legible de cada tabla o módulo. */
export const MODULO: Record<string, string> = {
  donante: 'Donantes',
  donacion: 'Donaciones',
  unidadsangre: 'Unidades',
  solicitudtransfusion: 'Transfusiones',
  prueba_serologica: 'Laboratorio',
  fraccionamiento: 'Fraccionamiento',
  pedido_entre_centros: 'Pedidos entre centros',
  hemo_vigilancia: 'Hemovigilancia',
  usuario: 'Cuentas',
  personalsalud: 'Personal',
  cita: 'Citas',
  ticket_soporte: 'Soporte',
};
export const moduloDe = (t: string) => MODULO[t] ?? t.replace(/_/g, ' ');

/** Operaciones conocidas en lenguaje claro. Las demás se muestran tal cual, en minúsculas. */
const OPERACION: Record<string, string> = {
  INSERT: 'Creó', UPDATE: 'Modificó', DELETE: 'Eliminó',
  DESPACHO: 'Despachó', RESERVA: 'Reservó', RECHAZO: 'Rechazó o anuló', INCOMPATIBLE: 'Prueba cruzada incompatible',
  NOTIFICACION: 'Notificó un caso', CONTACTO_DONANTE: 'Contactó al donante',
  HEMOVIGILANCIA: 'Registró una transfusión', HEMOVIGILANCIA_EDICION: 'Actualizó una transfusión', HEMOVIGILANCIA_CIERRE: 'Cerró una transfusión',
  LOGIN: 'Inició sesión', LOGOUT: 'Cerró sesión',
};
export const operacionDe = (o: string) => OPERACION[o] ?? (o.charAt(0) + o.slice(1).toLowerCase()).replace(/_/g, ' ');

/** Tono del punto según la operación. */
export function tonoOperacion(o: string): string {
  if (/RECHAZO|DELETE|INCOMPATIBLE/.test(o)) return 'bg-accent';
  if (/HEMOVIGILANCIA|NOTIFICACION/.test(o)) return 'bg-warn';
  if (/DESPACHO|RESERVA|INSERT/.test(o)) return 'bg-ok';
  return 'bg-ink-3';
}

const sinFuncion = (e: { code?: string; message?: string }) => e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? '');
export class BitacoraNoDisponible extends Error {}

// ------------------------------------------------------------------ Modo demo
const TABLA_DEMO: Record<string, string> = {
  donacion: 'donacion', laboratorio: 'prueba_serologica', solicitud: 'solicitudtransfusion', entrega: 'solicitudtransfusion', donante: 'donante',
};
const OP_DEMO: Record<string, string> = { donacion: 'INSERT', laboratorio: 'UPDATE', solicitud: 'INSERT', entrega: 'DESPACHO', donante: 'UPDATE' };

function demo(): EntradaBitacora[] {
  const out: EntradaBitacora[] = actividadRed().map((e) => ({
    id: e.id, fecha: e.fecha, tabla: TABLA_DEMO[e.tipo] ?? e.tipo, operacion: OP_DEMO[e.tipo] ?? 'UPDATE',
    usuario: 'Personal de ejemplo', sede: 'Banco de Sangre del Zulia', detalle: { resumen: `${e.titulo} · ${e.detalle}` },
  }));
  tickets.all().forEach((t) => out.push({
    id: 't' + t.id, fecha: t.actualizado, tabla: 'ticket_soporte', operacion: t.estado === 'resuelto' ? 'UPDATE' : 'INSERT',
    usuario: t.asignadoA?.nombre ?? t.donanteNombre, sede: 'Banco de Sangre del Zulia', detalle: { resumen: `${t.codigo} · ${t.asunto}` },
  }));
  return out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// ------------------------------------------------------------------ API
export async function paginaBitacora(f: FiltrosBitacora, cursor: string | null, limite = 50): Promise<PaginaBitacora> {
  if (!usaSupabase()) {
    const q = f.q?.trim().toLowerCase();
    const todo = demo().filter((e) =>
      (!f.tabla || e.tabla === f.tabla) &&
      (!f.desde || String(e.fecha).slice(0, 10) >= f.desde) &&
      (!f.hasta || String(e.fecha).slice(0, 10) <= f.hasta) &&
      (!q || `${e.operacion} ${e.usuario ?? ''} ${JSON.stringify(e.detalle ?? {})}`.toLowerCase().includes(q)));
    const desde = cursor ? Number(cursor) : 0;
    const items = todo.slice(desde, desde + limite);
    return {
      items, siguiente: desde + limite < todo.length ? String(desde + limite) : null,
      tablas: [...new Set(demo().map((e) => e.tabla))],
    };
  }
  const { data, error } = await sb()!.rpc('blud_bitacora', {
    p_q: f.q?.trim() || null, p_tabla: f.tabla || null, p_desde: f.desde || null, p_hasta: f.hasta || null,
    p_cursor: cursor ? Number(cursor) : null, p_limite: limite,
  });
  if (error) {
    if (sinFuncion(error)) throw new BitacoraNoDisponible('La bitácora aún no está activa en el servidor.');
    throw new Error(error.message || 'No pudimos cargar la bitácora.');
  }
  const r = (data ?? {}) as Partial<PaginaBitacora>;
  return { items: r.items ?? [], siguiente: r.siguiente ?? null, tablas: r.tablas ?? [] };
}

/** Texto corto del detalle (valores_nuevos) para la lista. */
export function resumenDetalle(d?: Record<string, unknown>): string {
  if (!d) return '';
  if (typeof d.resumen === 'string') return d.resumen;
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');
}
