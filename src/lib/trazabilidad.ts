// src/lib/trazabilidad.ts
// RF-H5: trazabilidad en los dos sentidos. Desde un DIN, el código de una bolsa, la cédula del donante o del paciente,
// o una solicitud (REQ-…), arma la cadena donante → donación → tamizaje → bolsas → receptor → hemovigilancia.
// Solo dirección y laboratorio; cada consulta queda en la bitácora. Con base real: blud_trazabilidad (migración
// 20261125150000). En modo demo se arma con las colecciones de ejemplo.

import { codigoDonacion, donaciones, entregas, fracciones, normCedula, pruebas, registro } from './db';
import type { DonacionOp } from './db';
import { rpc } from './rpc';
import { usaSupabase } from './supabase';

export { NoDisponible, MENSAJE_NO_DISPONIBLE } from './rpc';

export interface TrazaDestino {
  solicitud: string; estado?: string; fecha?: string; sede?: string;
  paciente: { nombre: string; cedula: string; servicio?: string };
  hemovigilancia?: { folio: string; estado?: string; tipoEvento?: string; categoria?: string; severidad?: string };
}
export interface TrazaUnidad {
  id: number | string; codigo: string; componente: string; tipo?: string; estado: string; vence?: string; sede?: string; destino?: TrazaDestino;
}
export interface TrazaDonacion {
  din: string; dinIsbt?: string; fecha: string; sede?: string;
  donante: { id: string; nombre: string; cedula: string; sangre?: string };
  tamizaje?: { resultado: string; fecha?: string };
  unidades: TrazaUnidad[];
}
export type BuscadoPor = 'donacion' | 'unidad' | 'solicitud' | 'donante' | 'paciente' | null;
export interface Traza { por: BuscadoPor; donaciones: TrazaDonacion[] }

export const POR_LABEL: Record<Exclude<BuscadoPor, null>, string> = {
  donacion: 'Donación', unidad: 'Bolsa', solicitud: 'Solicitud de transfusión', donante: 'Cédula del donante', paciente: 'Cédula del paciente',
};

/** Estados de la unidad en lenguaje claro. */
export const ESTADO_UNIDAD: Record<string, string> = {
  Cuarentena: 'En cuarentena', Disponible: 'Disponible', Reservado: 'Reservada', EnTransito: 'En tránsito',
  Despachado: 'Despachada', Transfundido: 'Transfundida', Descartado: 'Descartada', Vencido: 'Vencida',
};

// ------------------------------------------------------------------ Modo demo
function hvDemo(): { solicitudId: string; unidadId: string; id: string; estado: string; tipoEvento?: string; categoria?: string; severidad?: string }[] {
  try { return JSON.parse(localStorage.getItem('blud-db-hemovigilancia') || '[]'); } catch { return []; }
}

function demo(q: string): Traza {
  const Q = q.trim().toUpperCase();
  const ced = normCedula(q);
  const ents = entregas.all();
  const hvs = hvDemo();
  // Cada entrega consume las bolsas compatibles más antiguas (como el FIFO del inventario de ejemplo).
  const asignadas = new Map<string, { entrega: (typeof ents)[number]; n: number }>();
  const usadas = new Map<string, number>();
  for (const e of [...ents].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    let resta = e.unidades;
    for (const d of [...donaciones.all()].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
      if (resta <= 0) break;
      if (d.tipoSangre !== e.tipoSangre || d.fecha > e.fecha || (d.estadoLab ?? 'liberada') !== 'liberada') continue;
      const prods = fracciones.all().find((f) => f.donacionId === d.id)?.productos ?? [{ componente: d.tipoHemocomponente, unidades: 1, volumenMl: d.volumenMl }];
      prods.forEach((p) => {
        if (p.componente !== e.tipoHemocomponente) return;
        for (let i = 0; i < p.unidades && resta > 0; i++) {
          const k = `${d.id}:${p.componente}:${i}`;
          if (asignadas.has(k)) continue;
          const n = (usadas.get(e.id) ?? 0) + 1;
          usadas.set(e.id, n);
          asignadas.set(k, { entrega: e, n });
          resta--;
        }
      });
    }
  }
  const armar = (d: DonacionOp): TrazaDonacion => {
    const r = registro.get(d.donanteId);
    const pr = pruebas.all().filter((p) => p.donacionId === d.id).sort((a, b) => b.fecha.localeCompare(a.fecha))[0];
    const prods = fracciones.all().find((f) => f.donacionId === d.id)?.productos ?? [{ componente: d.tipoHemocomponente, unidades: 1, volumenMl: d.volumenMl }];
    const unidades: TrazaUnidad[] = [];
    let n = 0; // número de bolsa dentro de la donación (seguido entre componentes)
    prods.forEach((p) => {
      for (let i = 0; i < p.unidades; i++) {
        const k = `${d.id}:${p.componente}:${i}`;
        const a = asignadas.get(k);
        const hv = a ? hvs.find((h) => h.solicitudId === a.entrega.id && String(h.unidadId) === `${a.entrega.id}-${a.n}`) : undefined;
        const lab = d.estadoLab ?? 'liberada';
        unidades.push({
          id: k, codigo: `${codigoDonacion(d.id)}-${++n}`, componente: p.componente, tipo: d.tipoSangre,
          estado: a ? 'Despachado' : lab === 'pendiente' ? 'Cuarentena' : lab === 'descartada' ? 'Descartado' : 'Disponible',
          sede: d.centroNombre ?? 'Banco de Sangre del Zulia',
          destino: a ? {
            solicitud: a.entrega.id, estado: 'Despachada', fecha: a.entrega.fecha, sede: a.entrega.hospitalDestino,
            paciente: { nombre: a.entrega.pacienteNombre, cedula: a.entrega.pacienteCedula },
            hemovigilancia: hv ? { folio: hv.id, estado: hv.estado, tipoEvento: hv.tipoEvento, categoria: hv.categoria, severidad: hv.severidad } : undefined,
          } : undefined,
        });
      }
    });
    return {
      din: codigoDonacion(d.id), dinIsbt: d.dinIsbt, fecha: d.fecha, sede: d.centroNombre ?? 'Banco de Sangre del Zulia',
      donante: { id: d.donanteId, nombre: r?.nombreCompleto ?? d.donanteNombre, cedula: r?.cedula ?? d.donanteCedula, sangre: d.tipoSangre },
      tamizaje: pr ? { resultado: pr.resultadoGlobal === 'positivo' ? 'Positivo' : pr.resultadoGlobal === 'negativo' ? 'Negativo' : 'Indeterminado', fecha: pr.fecha } : undefined,
      unidades,
    };
  };
  const todas = donaciones.all().map(armar);
  const buscar = (por: BuscadoPor, f: (t: TrazaDonacion) => boolean): Traza | null => {
    const l = todas.filter(f);
    return l.length ? { por, donaciones: l.slice(0, 20) } : null;
  };
  return buscar('donacion', (t) => t.din.toUpperCase() === Q || (t.dinIsbt ?? '').toUpperCase() === Q.replace(/\s/g, ''))
    ?? buscar('unidad', (t) => t.unidades.some((u) => u.codigo.toUpperCase() === Q))
    ?? buscar('solicitud', (t) => t.unidades.some((u) => u.destino?.solicitud.toUpperCase() === Q))
    ?? (ced ? buscar('donante', (t) => normCedula(t.donante.cedula) === ced) : null)
    ?? (ced ? buscar('paciente', (t) => t.unidades.some((u) => u.destino && normCedula(u.destino.paciente.cedula) === ced)) : null)
    ?? { por: null, donaciones: [] };
}

// ------------------------------------------------------------------ API
export async function rastrear(q: string): Promise<Traza> {
  if (q.trim().length < 4) throw new Error('Escribe un DIN, código de bolsa, cédula o solicitud (REQ-…).');
  if (!usaSupabase()) return demo(q);
  const r = await rpc<Traza>('blud_trazabilidad', { p_q: q.trim() });
  return { por: r?.por ?? null, donaciones: r?.donaciones ?? [] };
}
