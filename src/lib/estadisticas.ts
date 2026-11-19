// src/lib/estadisticas.ts
// Estadísticas de donación por centro para la dirección: matriz centro × periodo (mapa de calor),
// ranking, sedes con coordenadas y un resumen en texto. Lo usan /director/estadisticas y su PDF.

import { centers } from '../data/centers';
import { donaciones } from './db';
import type { DonacionOp } from './db';
import { sb, usaSupabase } from './supabase';

export type Agrupacion = 'mes' | 'semana';
export type Metrica = 'donaciones' | 'litros';

export interface SedeMapa {
  id: string; nombre: string; tipo?: string; direccion?: string; ciudad?: string; telefono?: string;
  lat?: number; lng?: number; recibeCitas?: boolean;
}

export interface Periodo { key: string; label: string; corto: string; desde: string; hasta: string }

export interface FilaCentro {
  sede: string;
  celdas: number[];
  total: number;
  donaciones: number;
  litros: number;
  /** Periodo con más actividad de este centro (índice en `periodos`). */
  pico: number;
}

export interface Matriz {
  desde: string; hasta: string; agrupacion: Agrupacion; metrica: Metrica;
  periodos: Periodo[];
  filas: FilaCentro[];
  totalesPeriodo: number[];
  total: number;
  totalDonaciones: number;
  totalLitros: number;
  max: number;
  /** Mismo cálculo para el periodo anterior de igual duración (para la tendencia). */
  anterior: number;
}

// ------------------------------------------------------------------ Fechas
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dia = (s: string) => new Date(s.slice(0, 10) + 'T00:00:00');
const sumar = (s: string, n: number) => { const d = dia(s); d.setDate(d.getDate() + n); return iso(d); };
const lunes = (s: string) => { const d = dia(s); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const hoy = () => iso(new Date());

/** Rango de un atajo: los últimos n meses completos hasta hoy, o desde la primera donación. */
export function rangoDe(atajo: '3m' | '6m' | '12m' | 'todo'): { desde: string; hasta: string } {
  const h = hoy();
  if (atajo === 'todo') {
    const primera = donaciones.all().map((d) => d.fecha.slice(0, 10)).sort()[0];
    return { desde: primera ? `${primera.slice(0, 7)}-01` : `${h.slice(0, 4)}-01-01`, hasta: h };
  }
  const n = atajo === '3m' ? 3 : atajo === '6m' ? 6 : 12;
  const d = dia(h); d.setDate(1); d.setMonth(d.getMonth() - (n - 1));
  return { desde: iso(d), hasta: h };
}

export function periodos(desde: string, hasta: string, agr: Agrupacion): Periodo[] {
  const out: Periodo[] = [];
  if (agr === 'mes') {
    let y = Number(desde.slice(0, 4)), m = Number(desde.slice(5, 7)) - 1;
    const fy = Number(hasta.slice(0, 4)), fm = Number(hasta.slice(5, 7)) - 1;
    while (y < fy || (y === fy && m <= fm)) {
      const ini = `${y}-${String(m + 1).padStart(2, '0')}-01`;
      const fin = iso(new Date(y, m + 1, 0));
      out.push({ key: ini.slice(0, 7), label: `${MESES_LARGOS[m]} ${y}`, corto: `${MESES[m]}${y !== fy ? ` ${String(y).slice(2)}` : ''}`, desde: ini, hasta: fin });
      m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  }
  for (let s = lunes(desde); s <= hasta; s = sumar(s, 7)) {
    const fin = sumar(s, 6);
    const d = dia(s);
    out.push({ key: s, label: `Semana del ${d.getDate()} de ${MESES_LARGOS[d.getMonth()]}`, corto: `${d.getDate()} ${MESES[d.getMonth()]}`, desde: s, hasta: fin });
  }
  return out;
}

// ------------------------------------------------------------------ Matriz
const valor = (d: DonacionOp, m: Metrica) => (m === 'litros' ? (d.volumenMl || 0) / 1000 : 1);
const centroDe = (d: DonacionOp) => d.centroNombre?.trim() || 'Sin centro';

export function matriz(desde: string, hasta: string, agrupacion: Agrupacion, metrica: Metrica, fuente = donaciones.all()): Matriz {
  const ps = periodos(desde, hasta, agrupacion);
  const idx = new Map(ps.map((p, i) => [p.key, i]));
  const keyDe = (f: string) => (agrupacion === 'mes' ? f.slice(0, 7) : lunes(f));
  const dentro = fuente.filter((d) => { const f = d.fecha.slice(0, 10); return f >= desde && f <= hasta; });

  const porCentro = new Map<string, FilaCentro>();
  for (const d of dentro) {
    const i = idx.get(keyDe(d.fecha.slice(0, 10)));
    if (i === undefined) continue;
    const c = centroDe(d);
    const fila = porCentro.get(c) ?? { sede: c, celdas: ps.map(() => 0), total: 0, donaciones: 0, litros: 0, pico: 0 };
    const v = valor(d, metrica);
    fila.celdas[i] += v; fila.total += v; fila.donaciones += 1; fila.litros += (d.volumenMl || 0) / 1000;
    porCentro.set(c, fila);
  }
  const filas = [...porCentro.values()]
    .map((f) => ({ ...f, pico: f.celdas.indexOf(Math.max(...f.celdas)) }))
    .sort((a, b) => b.total - a.total || a.sede.localeCompare(b.sede, 'es'));
  const totalesPeriodo = ps.map((_, i) => filas.reduce((a, f) => a + f.celdas[i], 0));

  // Periodo anterior de la misma duración (tendencia).
  const largo = Math.round((dia(hasta).getTime() - dia(desde).getTime()) / 86400000) + 1;
  const antHasta = sumar(desde, -1), antDesde = sumar(desde, -largo);
  const anterior = fuente.filter((d) => { const f = d.fecha.slice(0, 10); return f >= antDesde && f <= antHasta; })
    .reduce((a, d) => a + valor(d, metrica), 0);

  return {
    desde, hasta, agrupacion, metrica, periodos: ps, filas, totalesPeriodo,
    total: filas.reduce((a, f) => a + f.total, 0),
    totalDonaciones: dentro.length,
    totalLitros: dentro.reduce((a, d) => a + (d.volumenMl || 0) / 1000, 0),
    max: Math.max(0, ...filas.flatMap((f) => f.celdas)),
    anterior,
  };
}

// ------------------------------------------------------------------ Sedes
export async function sedesMapa(): Promise<SedeMapa[]> {
  const desdeLista = (): SedeMapa[] => centers.map((c) => ({
    id: c.id, nombre: c.name, tipo: c.type, direccion: c.address, ciudad: c.city, telefono: c.phone, lat: c.coords[0], lng: c.coords[1], recibeCitas: true,
  }));
  if (!usaSupabase()) return desdeLista();
  const { data, error } = await sb()!.rpc('blud_sedes_mapa');
  if (error || !Array.isArray(data)) return desdeLista();
  return (data as (SedeMapa & { id: number })[]).map((s) => ({ ...s, id: String(s.id) }));
}

// ------------------------------------------------------------------ Texto
export const fmtNum = (n: number, m: Metrica) =>
  m === 'litros' ? `${n.toLocaleString('es-VE', { maximumFractionDigits: 1 })} L` : n.toLocaleString('es-VE', { maximumFractionDigits: 0 });
const unidad = (n: number, m: Metrica) => (m === 'litros' ? fmtNum(n, m) : `${fmtNum(n, m)} donaci${n === 1 ? 'ón' : 'ones'}`);
export const fmtFechaLarga = (s: string) => { const d = dia(s); return `${d.getDate()} de ${MESES_LARGOS[d.getMonth()]} de ${d.getFullYear()}`; };

/** Variación porcentual frente al periodo anterior; null si no hay base para comparar. */
export const variacion = (m: Matriz) => (m.anterior > 0 ? ((m.total - m.anterior) / m.anterior) * 100 : null);

/** Resumen ejecutivo en frases cortas, listo para leer en pantalla o imprimir. */
export function resumen(m: Matriz, sedesTotales: number): string[] {
  if (!m.total) return [`Entre el ${fmtFechaLarga(m.desde)} y el ${fmtFechaLarga(m.hasta)} no se registraron donaciones en la red.`];
  const out: string[] = [];
  const lider = m.filas[0];
  const cuota = Math.round((lider.total / m.total) * 100);
  out.push(`Entre el ${fmtFechaLarga(m.desde)} y el ${fmtFechaLarga(m.hasta)} la red registró ${unidad(m.total, m.metrica)} en ${m.filas.length} de ${sedesTotales} centros.`);
  out.push(`${lider.sede} encabeza la red con ${unidad(lider.total, m.metrica)} (${cuota} % del total)${m.filas[1] ? `, seguido de ${m.filas[1].sede} con ${unidad(m.filas[1].total, m.metrica)}` : ''}.`);
  const iPico = m.totalesPeriodo.indexOf(Math.max(...m.totalesPeriodo));
  out.push(`El periodo de mayor actividad fue ${m.agrupacion === 'mes' ? '' : 'la '}${m.periodos[iPico].label} con ${unidad(m.totalesPeriodo[iPico], m.metrica)}.`);
  const v = variacion(m);
  if (v !== null) {
    out.push(Math.abs(v) < 1 ? 'La actividad se mantuvo estable frente al periodo anterior de igual duración.'
      : `La actividad ${v > 0 ? 'creció' : 'cayó'} ${Math.abs(Math.round(v))} % frente al periodo anterior de igual duración.`);
  }
  const inactivos = sedesTotales - m.filas.length;
  if (inactivos > 0) out.push(`${inactivos} ${inactivos === 1 ? 'centro no registró' : 'centros no registraron'} donaciones en el periodo: conviene revisar su captación.`);
  if (m.metrica === 'donaciones' && m.totalLitros) out.push(`Volumen extraído: ${fmtNum(m.totalLitros, 'litros')}.`);
  return out;
}
