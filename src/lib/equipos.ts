// src/lib/equipos.ts
// RF-I4: equipos de almacenamiento de la sede (cámaras, refrigeradores, congeladores, agitadores) con su rango de
// temperatura, las lecturas y la calibración. Una lectura fuera de rango exige describir qué se hizo y queda en la
// bitácora. Con base real: blud_equipos, blud_equipo_guardar y blud_registrar_temperatura (migración 20261125150000).

import { getSession } from './auth';
import { rpc } from './rpc';
import { usaSupabase } from './supabase';

export { NoDisponible, MENSAJE_NO_DISPONIBLE } from './rpc';

export const TIPOS = ['Cámara fría', 'Refrigerador', 'Congelador', 'Agitador de plaquetas', 'Otro'] as const;
/** Rango sugerido por tipo de equipo (°C). La sede puede ajustarlo. */
export const RANGO_SUGERIDO: Record<string, [number, number]> = {
  'Cámara fría': [2, 6], Refrigerador: [2, 6], Congelador: [-40, -25], 'Agitador de plaquetas': [20, 24], Otro: [2, 8],
};
/** Horas sin lectura a partir de las cuales el equipo se marca «sin control». */
export const HORAS_SIN_LECTURA = 12;

export interface Lectura { temperatura: number; fecha: string; nota?: string; por?: string }
export interface Equipo {
  id: number | string; nombre: string; tipo: string; min: number; max: number; ubicacion?: string; serial?: string;
  ultimaCalibracion?: string; proximaCalibracion?: string; activo: boolean; sede?: string;
  ultima?: Lectura; lecturas: { t: number; f: string }[];
}
export type DatosEquipo = Omit<Equipo, 'id' | 'ultima' | 'lecturas' | 'sede' | 'activo'> & { id?: number | string; activo?: boolean };

export type Alerta = 'fuera' | 'sin_lectura' | 'calibracion' | 'ok' | 'inactivo';
export function alertaDe(e: Equipo): Alerta {
  if (!e.activo) return 'inactivo';
  const t = e.ultima ? Number(e.ultima.temperatura) : null;
  if (t !== null && (t < Number(e.min) || t > Number(e.max))) return 'fuera';
  if (!e.ultima || Date.now() - new Date(e.ultima.fecha).getTime() > HORAS_SIN_LECTURA * 3600000) return 'sin_lectura';
  if (e.proximaCalibracion && e.proximaCalibracion <= new Date().toISOString().slice(0, 10)) return 'calibracion';
  return 'ok';
}
export const ALERTA_LABEL: Record<Alerta, { texto: string; tono: string }> = {
  fuera: { texto: 'Fuera de rango', tono: 'bg-accent-soft text-accent-ink' },
  sin_lectura: { texto: `Sin lectura en ${HORAS_SIN_LECTURA} h`, tono: 'bg-warn-soft text-warn' },
  calibracion: { texto: 'Calibración vencida', tono: 'bg-warn-soft text-warn' },
  ok: { texto: 'En rango', tono: 'bg-ok-soft text-ok' },
  inactivo: { texto: 'Fuera de servicio', tono: 'bg-sunken text-ink-3' },
};

export function validarEquipo(d: DatosEquipo): string | null {
  if (d.nombre.trim().length < 3) return 'Escribe el nombre del equipo.';
  if (!(TIPOS as readonly string[]).includes(d.tipo)) return 'Elige el tipo de equipo.';
  if (!(Number(d.min) < Number(d.max))) return 'La temperatura mínima debe ser menor que la máxima.';
  if (d.ultimaCalibracion && d.proximaCalibracion && d.proximaCalibracion < d.ultimaCalibracion) return 'La próxima calibración debe ser posterior a la última.';
  return null;
}
export function validarLectura(e: Equipo, t: number, nota: string): string | null {
  if (!Number.isFinite(t) || t < -90 || t > 60) return 'Revisa la temperatura: no es una lectura posible.';
  if ((t < Number(e.min) || t > Number(e.max)) && nota.trim().length < 10) return 'La lectura está fuera de rango: describe qué se hizo (mínimo 10 caracteres).';
  return null;
}

// ------------------------------------------------------------------ Modo demo
const KEY = 'blud-demo-equipos';
type EquipoDemo = Equipo & { historial: Lectura[] };
const leer = (): EquipoDemo[] => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') ?? semilla(); } catch { return semilla(); } };
const escribir = (l: EquipoDemo[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {}
  try { window.dispatchEvent(new CustomEvent('blud:db', { detail: { key: KEY } })); } catch {}
};
function semilla(): EquipoDemo[] {
  const h = (horas: number) => new Date(Date.now() - horas * 3600000).toISOString();
  const serie = (base: number, n: number, ruido: number): Lectura[] => Array.from({ length: n }, (_, i) => ({
    temperatura: Math.round((base + Math.sin(i / 2) * ruido) * 10) / 10, fecha: h((n - i) * 8), por: 'Personal de ejemplo',
  }));
  const mk = (id: number, nombre: string, tipo: string, min: number, max: number, ubicacion: string, hist: Lectura[], cal: [string, string]): EquipoDemo => ({
    id, nombre, tipo, min, max, ubicacion, serial: `SN-${1000 + id}`, ultimaCalibracion: cal[0], proximaCalibracion: cal[1], activo: true,
    sede: 'Banco de Sangre del Zulia', historial: hist, ultima: hist.at(-1), lecturas: hist.map((l) => ({ t: l.temperatura, f: l.fecha })),
  });
  const hoy = new Date().toISOString().slice(0, 10);
  const fuera = serie(4, 20, 0.8);
  fuera.push({ temperatura: 7.4, fecha: h(1), por: 'Personal de ejemplo', nota: 'Puerta mal cerrada tras el ingreso de bolsas. Se cerró y se verificó a los 30 min.' });
  const l = [
    mk(1, 'Cámara fría principal', 'Cámara fría', 2, 6, 'Almacén, planta baja', fuera, ['2026-06-10', '2026-12-10']),
    mk(2, 'Congelador de plasma 1', 'Congelador', -40, -25, 'Almacén, estante B', serie(-32, 21, 1.5), ['2026-05-02', hoy]),
    mk(3, 'Agitador de plaquetas', 'Agitador de plaquetas', 20, 24, 'Laboratorio', serie(22, 21, 0.6).slice(0, 15).map((x, i) => ({ ...x, fecha: h(40 - i) })), ['2026-09-01', '2027-03-01']),
  ];
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {}
  return l;
}
const publico = (e: EquipoDemo): Equipo => {
  const semana = Date.now() - 7 * 86400000;
  const { historial, ...resto } = e;
  return { ...resto, ultima: historial.at(-1), lecturas: historial.filter((l) => new Date(l.fecha).getTime() > semana).map((l) => ({ t: l.temperatura, f: l.fecha })) };
};
function anotar(registro: string | number, operacion: string, detalle: Record<string, unknown>) {
  try {
    const k = 'blud-demo-admin-log';
    const l = JSON.parse(localStorage.getItem(k) || '[]');
    localStorage.setItem(k, JSON.stringify([{ id: 'e' + Date.now(), fecha: new Date().toISOString(), tabla: 'equipo_almacenamiento', registro, operacion,
      usuario: String(getSession()?.name ?? 'Personal'), sede: 'Banco de Sangre del Zulia', detalle }, ...l].slice(0, 300)));
  } catch {}
}

// ------------------------------------------------------------------ API
export async function listarEquipos(): Promise<Equipo[]> {
  if (!usaSupabase()) return leer().map(publico);
  return (await rpc<Equipo[]>('blud_equipos')) ?? [];
}

export async function guardarEquipo(d: DatosEquipo): Promise<Equipo> {
  const err = validarEquipo(d);
  if (err) throw new Error(err);
  if (usaSupabase()) return rpc<Equipo>('blud_equipo_guardar', { p: d });
  const l = leer();
  if (d.id != null && d.id !== '') {
    const i = l.findIndex((x) => String(x.id) === String(d.id));
    if (i < 0) throw new Error('No encontramos ese equipo.');
    l[i] = { ...l[i], ...d, id: l[i].id, activo: d.activo ?? l[i].activo };
    escribir(l);
    anotar(l[i].id, 'EQUIPO_EDITADO', { nombre: d.nombre, rango: `${d.min} a ${d.max}` });
    return publico(l[i]);
  }
  const nuevo: EquipoDemo = { ...d, id: Math.max(0, ...l.map((x) => Number(x.id))) + 1, activo: true, sede: 'Banco de Sangre del Zulia', historial: [], lecturas: [] };
  escribir([...l, nuevo]);
  anotar(nuevo.id, 'EQUIPO_CREADO', { nombre: d.nombre, rango: `${d.min} a ${d.max}` });
  return publico(nuevo);
}

export async function registrarTemperatura(e: Equipo, t: number, nota: string): Promise<Equipo> {
  const err = validarLectura(e, t, nota);
  if (err) throw new Error(err);
  if (usaSupabase()) return rpc<Equipo>('blud_registrar_temperatura', { p_equipo: Number(e.id), p_temperatura: t, p_nota: nota.trim() || null });
  const l = leer();
  const i = l.findIndex((x) => String(x.id) === String(e.id));
  if (i < 0 || !l[i].activo) throw new Error('No encontramos ese equipo activo.');
  l[i].historial = [...l[i].historial, { temperatura: t, fecha: new Date().toISOString(), nota: nota.trim() || undefined, por: String(getSession()?.name ?? 'Personal') }];
  escribir(l);
  if (t < e.min || t > e.max) anotar(e.id, 'TEMP_FUERA_RANGO', { equipo: e.nombre, temperatura: t, rango: `${e.min} a ${e.max}`, nota });
  return publico(l[i]);
}

export const fmtTemp = (t?: number | string) => (t === undefined || t === null || t === '' ? '—' : `${Number(t).toLocaleString('es-VE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`);
