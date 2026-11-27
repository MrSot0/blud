// src/lib/inventario.ts
// Detalle de las unidades del inventario que no viaja en la caché general (RF-L8, I3, I7):
// variantes, método de obtención, ubicación física, caducidad con hora; mover una unidad y darla de baja con causa,
// método de disposición y firma. Con base real: migración 20261127130000. En modo demo, en el navegador.

import { rpc } from './rpc';
import { usaSupabase } from './supabase';

export { NoDisponible, MENSAJE_NO_DISPONIBLE } from './rpc';

export interface DetalleUnidad {
  id: string; codigo?: string; estado?: string; venceHora?: string; ubicacion?: string; metodo?: string; solucion?: string;
  leucorreducida?: boolean; lavada?: boolean; irradiada?: boolean; horaCongelacion?: string;
}

export const CAUSAS_BAJA = ['Caducidad', 'Serología reactiva', 'Rotura', 'Alteración térmica', 'Hemólisis', 'Otra'] as const;
export const METODOS_DISPOSICION = ['Incineración', 'Autoclave', 'Gestor externo de desechos', 'Devolución a proveedor'] as const;
export interface DatosBaja { causa: string; detalle?: string; metodo: string; firma: string }

export function validarBaja(b: DatosBaja): string | null {
  if (!(CAUSAS_BAJA as readonly string[]).includes(b.causa)) return 'Elige la causa de la baja.';
  if (b.causa === 'Otra' && (b.detalle?.trim().length ?? 0) < 10) return 'Describe la causa de la baja (mínimo 10 caracteres).';
  if (!(METODOS_DISPOSICION as readonly string[]).includes(b.metodo)) return 'Elige el método de disposición.';
  if (b.firma.trim().length < 5) return 'Escribe el nombre completo de quien firma la baja.';
  return null;
}

/** Texto corto de las variantes de una unidad («Leucorreducido · Irradiado · SAG-M»). */
export const variantesTexto = (d?: DetalleUnidad) =>
  d ? [d.leucorreducida && 'Leucorreducido', d.lavada && 'Lavado', d.irradiada && 'Irradiado', d.solucion,
    d.metodo && d.metodo !== 'Fraccionamiento de sangre total' ? d.metodo : ''].filter(Boolean).join(' · ') : '';

// ------------------------------------------------------------------ Modo demo
const KEY = 'blud-demo-inventario';
type Demo = Record<string, { ubicacion?: string; baja?: DatosBaja & { fecha: string } }>;
const leer = (): Demo => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
const escribir = (d: Demo) => {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {}
  try { window.dispatchEvent(new CustomEvent('blud:db', { detail: { key: KEY } })); } catch {}
};
/** En demo: ids de unidades dadas de baja (el inventario de ejemplo las oculta). */
export const bajasDemo = () => new Set(Object.entries(leer()).filter(([, v]) => v.baja).map(([k]) => k));

// ------------------------------------------------------------------ API
export async function detalleInventario(): Promise<Map<string, DetalleUnidad>> {
  if (!usaSupabase()) return new Map(Object.entries(leer()).map(([id, v]) => [id, { id, ubicacion: v.ubicacion }]));
  const l = (await rpc<DetalleUnidad[]>('blud_inventario_detalle')) ?? [];
  return new Map(l.map((d) => [d.id, d]));
}

export async function ubicarUnidad(id: string, ubicacion: string): Promise<void> {
  if (ubicacion.trim().length < 3) throw new Error('Indica la ubicación (equipo, estante y posición).');
  if (usaSupabase()) { await rpc('blud_unidad_ubicar', { p_unidad: id, p_ubicacion: ubicacion.trim() }); return; }
  const d = leer();
  d[id] = { ...d[id], ubicacion: ubicacion.trim() };
  escribir(d);
}

export async function darDeBaja(id: string, b: DatosBaja): Promise<void> {
  const e = validarBaja(b);
  if (e) throw new Error(e);
  if (usaSupabase()) { await rpc('blud_unidad_baja', { p_unidad: id, p: b }); return; }
  const d = leer();
  d[id] = { ...d[id], baja: { ...b, fecha: new Date().toISOString() } };
  escribir(d);
}
