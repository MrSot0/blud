// src/lib/operador.ts
// Lógica del módulo de operador: verificar donantes, registrar donaciones, pedidos, entregas y stock.
// Todo pasa por lib/db, así el donante ve en su carnet e historial lo que el operador registra.

import { getSession } from './auth';
import { centers } from '../data/centers';
import {
  BLOOD_TYPES, COMPONENTES, codigoDonacion, codigoPedido, collection, donaciones, entregas, fracciones, pedidos, registro,
  buscarRegistro, normCedula, onDb, verificarRegistro,
} from './db';
import type { DonacionOp, EntregaOp, EstadoPedido, Hemocomponente, PedidoOp, Prioridad, RegistroDonante } from './db';
import { seedDemo } from './demo';
import { UNIDADES_KEY, usaSupabase } from './supabase';
import { diasDesde, hoyISO, sumarDias, uid } from './ui';

export { BLOOD_TYPES, COMPONENTES, codigoPedido, onDb, normCedula, buscarRegistro as buscarDonante };
export { uid, toast, esc, fmtFecha, hoyISO, downloadFile, toCSV } from './ui';
/** Fecha (YYYY-MM-DD) a n días de hoy: negativo hacia atrás. */
export const sumarDiasOp = (n: number) => sumarDias(hoyISO(), n);
export type { DonacionOp, EntregaOp, EstadoPedido, Hemocomponente, PedidoOp, Prioridad, RegistroDonante };

export const STOCK_BAJO = 3; // unidades por debajo de las cuales se avisa
export const DIAS_ENTRE_DONACIONES = 90; // sangre total

export type Resultado<T> = { ok: true; data: T; aviso?: string } | { ok: false; motivo: string };
const fail = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo });

// ------------------------------------------------------------------ Operador actual
interface PerfilOperador { id: string; nombre: string; email: string; centro: string }
const perfiles = collection<PerfilOperador>('blud-db-operadores');

export function operadorActual() {
  const s = (getSession() ?? {}) as Record<string, any>;
  const email = String(s.email ?? '').toLowerCase();
  const id = email || 'op-actual';
  const saved = perfiles.get(id);
  const centro: string = saved?.centro ?? s.sede ?? 'Banco de Sangre';
  return {
    id,
    nombre: saved?.nombre ?? s.name ?? 'Operador',
    email: saved?.email ?? email,
    colegiado: String(s.colegiado ?? ''),
    cargo: String(s.cargo ?? ''),
    centro,
    centroId: centers.find((c) => c.name === centro)?.id ?? '',
  };
}

export function guardarPerfilOperador(p: { nombre: string; email: string }) {
  const op = operadorActual();
  perfiles.upsert({ id: op.id, nombre: p.nombre, email: p.email, centro: op.centro });
}

const porFechaDesc = <T extends { fecha?: string; fechaRegistro?: string }>(a: T, b: T) =>
  (b.fecha ?? b.fechaRegistro ?? '').localeCompare(a.fecha ?? a.fechaRegistro ?? '');

// ------------------------------------------------------------------ Donantes
/** Donantes que ESTE operador verificó o registró */
export const getDonantesOp = () =>
  registro.all().filter((d) => d.operadorId === operadorActual().id).sort(porFechaDesc);

/** Cola de pre-registrados (vienen de la app) pendientes de verificación */
export const getPorVerificar = () =>
  registro.all().filter((d) => d.estado === 'preregistrado').sort(porFechaDesc);

export function verificarDonanteOp(id: string): Resultado<RegistroDonante> {
  const reg = verificarRegistro(id, operadorActual().id);
  return reg ? { ok: true, data: reg } : fail('No encontramos a ese donante.');
}

export function registrarDonanteOp(input: {
  cedula: string; nombreCompleto: string; sangre: string; nacimiento?: string; sexo?: 'M' | 'F';
}): Resultado<RegistroDonante> {
  const cedula = normCedula(input.cedula);
  if (!/^[VEJ]-\d{5,9}$/.test(cedula)) return fail('La cédula debe verse así: V-12345678.');
  if (!input.nombreCompleto.trim()) return fail('Escribe el nombre completo.');
  if (!BLOOD_TYPES.includes(input.sangre as any)) return fail('Elige el tipo de sangre.');

  const existente = registro.find((r) => r.cedula === cedula);
  if (existente?.estado === 'verificado') return fail(`${existente.nombreCompleto} ya está registrado y verificado.`);
  if (existente) {
    const r = verificarRegistro(existente.id, operadorActual().id)!;
    return { ok: true, data: r, aviso: 'Ya estaba pre-registrado en la app: quedó verificado.' };
  }
  const nuevo = registro.upsert({
    id: 'OP-' + uid().toUpperCase(),
    cedula,
    nombreCompleto: input.nombreCompleto.trim(),
    sangre: input.sangre,
    nacimiento: input.nacimiento || undefined,
    sexo: input.sexo,
    fechaRegistro: hoyISO(),
    fechaVerificacion: hoyISO(),
    estado: 'verificado',
    origen: 'operador',
    operadorId: operadorActual().id,
  });
  return { ok: true, data: nuevo };
}

// ------------------------------------------------------------------ Donaciones
export const getDonacionesOp = () => donaciones.all().sort(porFechaDesc);

export function registrarDonacionOp(input: {
  cedula: string; tipoSangre: string; tipoHemocomponente: Hemocomponente; volumenMl: number;
  evaluacion?: DonacionOp['evaluacion'];
}): Resultado<DonacionOp> {
  const donante = buscarRegistro(input.cedula);
  if (!donante) return fail('No encontramos a ese donante. Regístralo primero en Donantes.');
  if (donante.estado !== 'verificado') return fail('El donante está pre-registrado: verifica su identidad antes de la extracción.');
  if (!BLOOD_TYPES.includes(input.tipoSangre as any)) return fail('Confirma el tipo de sangre.');
  if (!(input.volumenMl >= 50 && input.volumenMl <= 600)) return fail('El volumen debe estar entre 50 y 600 ml.');

  if (input.tipoHemocomponente === 'Sangre Total') {
    const ultima = donaciones.all()
      .filter((d) => d.donanteId === donante.id && d.tipoHemocomponente === 'Sangre Total')
      .sort(porFechaDesc)[0];
    if (ultima && diasDesde(ultima.fecha) < DIAS_ENTRE_DONACIONES) {
      return fail(`${donante.nombreCompleto} donó sangre total el ${ultima.fecha}. Podrá donar de nuevo el ${sumarDias(ultima.fecha, DIAS_ENTRE_DONACIONES)}.`);
    }
  }

  // El tipo confirmado en la extracción actualiza el registro
  if (donante.sangre !== input.tipoSangre) registro.upsert({ ...donante, sangre: input.tipoSangre });

  const op = operadorActual();
  const data = donaciones.upsert({
    id: uid(),
    donanteId: donante.id,
    donanteNombre: donante.nombreCompleto,
    donanteCedula: donante.cedula,
    tipoSangre: input.tipoSangre,
    tipoHemocomponente: input.tipoHemocomponente,
    volumenMl: input.volumenMl,
    fecha: hoyISO(),
    operadorId: op.id,
    centroId: op.centroId || undefined,
    centroNombre: op.centro,
    // Cuarentena: no entra al stock hasta que el laboratorio la libere.
    estadoLab: 'pendiente',
    evaluacion: input.evaluacion,
  });
  return { ok: true, data, aviso: 'Quedó en cuarentena hasta que el laboratorio la analice.' };
}

// ------------------------------------------------------------------ Inventario y stock
const k = (tipo: string, comp: string) => `${tipo}|${comp}`;

/** Vida útil en días desde la extracción (CPDA-1, SAG-M, plasma congelado). Ajústala a tu norma técnica. */
export const VIDA_UTIL: Record<Hemocomponente, number> = {
  'Sangre Total': 35,
  'Concentrado Globular': 42,
  'Plaquetas': 5,
  'Plasma Fresco Congelado': 365,
  'Crioprecipitado': 365,
};
/** Días antes del vencimiento en que una unidad pasa a "por vencer". */
export const DIAS_POR_VENCER = 7;

export type EstadoUnidad = 'disponible' | 'por_vencer' | 'vencida';
export interface Unidad {
  id: string;
  codigo: string; // DON-XXXXXX de la bolsa de origen
  donacionId: string;
  componente: Hemocomponente;
  tipoSangre: string;
  extraccion: string;
  vence: string;
  dias: number; // días para vencer (negativo: vencida)
  estado: EstadoUnidad;
}

const liberada = (d: DonacionOp) => (d.estadoLab ?? 'liberada') === 'liberada';

/**
 * Unidades en existencia: lo que el laboratorio liberó (fraccionado o no) menos lo entregado.
 * Cada entrega consume primero las unidades vigentes que vencen antes (FIFO).
 */
export function unidadesInventario(): Unidad[] {
  if (usaSupabase()) return unidadesRemotas();
  const frac = new Map(fracciones.all().map((f) => [f.donacionId, f]));
  const grupos = new Map<string, Unidad[]>();
  for (const d of donaciones.all()) {
    if (!liberada(d)) continue;
    const productos = frac.get(d.id)?.productos ?? [{ componente: d.tipoHemocomponente, unidades: 1 }];
    for (const p of productos) {
      const key = k(d.tipoSangre, p.componente);
      const lista = grupos.get(key) ?? [];
      grupos.set(key, lista);
      for (let i = 0; i < p.unidades; i++) {
        lista.push({
          id: `${d.id}:${p.componente}:${i}`, codigo: codigoDonacion(d.id), donacionId: d.id,
          componente: p.componente, tipoSangre: d.tipoSangre, extraccion: d.fecha,
          vence: sumarDias(d.fecha, VIDA_UTIL[p.componente] ?? 35), dias: 0, estado: 'disponible',
        });
      }
    }
  }
  for (const e of [...entregas.all()].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const lista = grupos.get(k(e.tipoSangre, e.tipoHemocomponente));
    if (!lista) continue;
    lista.sort((a, b) => a.vence.localeCompare(b.vence));
    let resta = e.unidades;
    for (let i = 0; i < lista.length && resta > 0; ) {
      if (lista[i].extraccion <= e.fecha && lista[i].vence >= e.fecha) { lista.splice(i, 1); resta--; } else i++;
    }
  }
  const out: Unidad[] = [];
  grupos.forEach((lista) => lista.forEach((u) => {
    const dias = -diasDesde(u.vence);
    out.push({ ...u, dias, estado: dias < 0 ? 'vencida' : dias <= DIAS_POR_VENCER ? 'por_vencer' : 'disponible' });
  }));
  return out.sort((a, b) => a.vence.localeCompare(b.vence));
}

/** Con base real, el inventario son las unidades que la base marca como disponibles (ya fraccionadas y liberadas). */
function unidadesRemotas(): Unidad[] {
  let lista: Omit<Unidad, 'dias' | 'estado'>[] = [];
  try { lista = JSON.parse(localStorage.getItem(UNIDADES_KEY) || '[]'); } catch {}
  return lista.map((u) => {
    const dias = -diasDesde(u.vence);
    return { ...u, dias, estado: dias < 0 ? 'vencida' : dias <= DIAS_POR_VENCER ? 'por_vencer' : 'disponible' } as Unidad;
  });
}

/** Unidades vigentes por tipo y hemocomponente (las vencidas no cuentan). */
export function stockMatriz(): Record<string, number> {
  const m: Record<string, number> = {};
  unidadesInventario().forEach((u) => {
    if (u.estado !== 'vencida') m[k(u.tipoSangre, u.componente)] = (m[k(u.tipoSangre, u.componente)] ?? 0) + 1;
  });
  return m;
}

export const stockDe = (tipo: string, comp: string) => stockMatriz()[k(tipo, comp)] ?? 0;

export function stockPorTipo(): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(BLOOD_TYPES.map((t) => [t, 0]));
  Object.entries(stockMatriz()).forEach(([key, v]) => {
    const tipo = key.split('|')[0];
    out[tipo] = (out[tipo] ?? 0) + v;
  });
  return out;
}

/** Bolsas extraídas que el laboratorio aún no libera. */
export const enCuarentena = () => donaciones.all().filter((d) => d.estadoLab === 'pendiente');

// ------------------------------------------------------------------ Solicitudes (pedidos) y entregas
export const ESTADO_PEDIDO: Record<EstadoPedido, string> = {
  pendiente: 'Por aprobar',
  aprobado: 'Aprobada',
  rechazado: 'Rechazada',
  despachado: 'Despachada',
};
export const PRIORIDAD_LABEL: Record<Prioridad, string> = { normal: 'Normal', urgente: 'Urgente', critica: 'Crítica' };

export const getPedidos = () => pedidos.all().sort(porFechaDesc);
/** Esperan la decisión de la dirección. */
export const getPedidosPorAprobar = () => getPedidos().filter((p) => p.estado === 'pendiente');
/** Aprobados por la dirección: listos para despachar. */
export const getPedidosPorDespachar = () => getPedidos().filter((p) => p.estado === 'aprobado');
/** "Pendientes" para el operador = los que ya puede despachar. */
export const getPedidosPendientes = getPedidosPorDespachar;
export const getEntregasOp = () => entregas.all().sort(porFechaDesc);

export type DatosPedido = Pick<PedidoOp, 'pacienteNombre' | 'pacienteCedula' | 'tipoSangre' | 'tipoHemocomponente' | 'unidades' | 'hospitalDestino'>
  & Partial<Pick<PedidoOp, 'prioridad' | 'servicio' | 'medico' | 'diagnostico' | 'clinica'>>;

export function validarPedido(input: DatosPedido): string | null {
  if (!input.pacienteNombre.trim() || !input.hospitalDestino.trim()) return 'Completa el paciente y el centro solicitante.';
  if (!BLOOD_TYPES.includes(input.tipoSangre as any)) return 'Elige el tipo de sangre.';
  if (!COMPONENTES.includes(input.tipoHemocomponente)) return 'Elige el hemocomponente.';
  if (!(input.unidades >= 1 && input.unidades <= 20)) return 'Indica entre 1 y 20 unidades.';
  return null;
}

/** La orden médica que carga el operador queda "por aprobar" hasta que la dirección decida. */
export function registrarPedido(input: DatosPedido): Resultado<PedidoOp> {
  const error = validarPedido(input);
  if (error) return fail(error);
  const op = operadorActual();
  const data = pedidos.upsert({
    ...input,
    pacienteNombre: input.pacienteNombre.trim(),
    hospitalDestino: input.hospitalDestino.trim(),
    pacienteCedula: normCedula(input.pacienteCedula),
    prioridad: input.prioridad ?? 'normal',
    id: uid(),
    fecha: hoyISO(),
    estado: 'pendiente',
    creadoPor: op.id,
    creadoPorNombre: op.nombre,
  });
  return { ok: true, data, aviso: 'La dirección la revisará antes del despacho.' };
}

/** Registra la salida y, si venía de una solicitud aprobada, la cierra. Avisa (sin bloquear) si el stock no alcanza. */
export function registrarEntrega(input: DatosPedido & { pedidoId?: string }): Resultado<EntregaOp> {
  const error = validarPedido(input);
  if (error) return fail(error.replace('el paciente y el centro solicitante', 'el receptor y el destino'));
  const pedido = input.pedidoId ? pedidos.get(input.pedidoId) : undefined;
  if (input.pedidoId && !pedido) return fail('No encontramos esa solicitud.');
  if (pedido && pedido.estado !== 'aprobado') {
    return fail(pedido.estado === 'pendiente'
      ? 'La dirección aún no aprueba esa solicitud.'
      : `Esa solicitud está ${ESTADO_PEDIDO[pedido.estado].toLowerCase()}.`);
  }

  const disponible = stockDe(input.tipoSangre, input.tipoHemocomponente);
  const data = entregas.upsert({
    id: uid(),
    pedidoId: input.pedidoId,
    pacienteNombre: input.pacienteNombre.trim(),
    pacienteCedula: normCedula(input.pacienteCedula),
    tipoSangre: input.tipoSangre,
    tipoHemocomponente: input.tipoHemocomponente,
    unidades: input.unidades,
    hospitalDestino: input.hospitalDestino.trim(),
    fecha: hoyISO(),
    operadorId: operadorActual().id,
  });
  if (pedido) pedidos.upsert({ ...pedido, estado: 'despachado', entregaId: data.id });
  return {
    ok: true,
    data,
    aviso: disponible < input.unidades ? `Ojo: el stock registrado era de ${disponible} u. y se despacharon ${input.unidades}.` : undefined,
  };
}

// ------------------------------------------------------------------ Resumen y actividad
export function kpis() {
  const hoy = hoyISO();
  const mes = hoy.slice(0, 7);
  const don = donaciones.all();
  const stock = stockPorTipo();
  return {
    porVerificar: getPorVerificar().length,
    misDonantes: getDonantesOp().length,
    donacionesHoy: don.filter((d) => d.fecha === hoy).length,
    donacionesMes: don.filter((d) => d.fecha.startsWith(mes)).length,
    stockTotal: Object.values(stock).reduce((a, b) => a + b, 0),
    pedidosPendientes: getPedidosPorDespachar().length,
    porAprobar: getPedidosPorAprobar().length,
    enCuarentena: enCuarentena().length,
  };
}

export interface Evento {
  id: string;
  tipo: 'donante' | 'donacion' | 'pedido' | 'entrega';
  fecha: string;
  titulo: string;
  detalle: string;
}

/** Línea de tiempo unificada de lo que hizo este operador */
export function actividad(): Evento[] {
  const me = operadorActual().id;
  const out: Evento[] = [];
  registro.all().filter((d) => d.operadorId === me).forEach((d) =>
    out.push({ id: 'd' + d.id, tipo: 'donante', fecha: d.fechaVerificacion ?? d.fechaRegistro, titulo: d.origen === 'app' ? 'Donante verificado' : 'Donante registrado', detalle: `${d.nombreCompleto} · ${d.cedula} · ${d.sangre}` }));
  donaciones.all().filter((d) => d.operadorId === me).forEach((d) =>
    out.push({ id: 'n' + d.id, tipo: 'donacion', fecha: d.fecha, titulo: 'Donación registrada', detalle: `${d.donanteNombre} · ${d.tipoSangre} · ${d.tipoHemocomponente} · ${d.volumenMl} ml` }));
  pedidos.all().filter((p) => p.creadoPor === me).forEach((p) =>
    out.push({ id: 'p' + p.id, tipo: 'pedido', fecha: p.fecha, titulo: `Solicitud ${codigoPedido(p.id)} · ${ESTADO_PEDIDO[p.estado].toLowerCase()}`, detalle: `${p.pacienteNombre} · ${p.unidades} u. ${p.tipoSangre} · ${p.hospitalDestino}` }));
  entregas.all().filter((e) => e.operadorId === me).forEach((e) =>
    out.push({ id: 'e' + e.id, tipo: 'entrega', fecha: e.fecha, titulo: 'Entrega realizada', detalle: `${e.unidades} u. ${e.tipoSangre} ${e.tipoHemocomponente} → ${e.hospitalDestino}` }));
  return out.sort(porFechaDesc);
}

// ------------------------------------------------------------------ Datos de ejemplo
/** Un solo conjunto de datos de ejemplo para todos los roles (ver lib/demo). */
export const seedOperadorDemo = seedDemo;
