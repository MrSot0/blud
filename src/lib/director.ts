// src/lib/director.ts
// Módulo de dirección: aprueba o rechaza solicitudes, vigila stock y vencimientos, gestiona al personal
// y consolida reportes. Lee la misma base (lib/db) que el resto de roles: lo que registra cada uno se ve aquí.
//
// PRIVACIDAD: la dirección ve cuántas bolsas se descartaron, pero no qué prueba salió reactiva ni de quién:
// ese detalle queda en el laboratorio.

import { crearCuentaPersonal, getSession, listarPersonal, setPersonalActivo } from './auth';
import type { CuentaPersonal, NuevaCuenta } from './auth';
import { BLOOD_TYPES, COMPONENTES, codigoDonacion, codigoPedido, donaciones, entregas, onDb, pedidos, positivos, pruebas, registro, tickets } from './db';
import type { Hemocomponente, PedidoOp } from './db';
import {
  ESTADO_PEDIDO, PRIORIDAD_LABEL, STOCK_BAJO, enCuarentena, getPedidos, getPedidosPorAprobar, getPedidosPorDespachar,
  stockMatriz, stockPorTipo, unidadesInventario, validarPedido,
} from './operador';
import type { DatosPedido, Resultado, Unidad } from './operador';
import { hoyISO, uid } from './ui';

export { BLOOD_TYPES, COMPONENTES, ESTADO_PEDIDO, PRIORIDAD_LABEL, STOCK_BAJO, codigoPedido, onDb, stockPorTipo, unidadesInventario };
export { downloadFile, esc, fmtFecha, hoyISO, sumarDias, toCSV, toast } from './ui';
export type { CuentaPersonal, DatosPedido, Hemocomponente, PedidoOp, Unidad };

const fail = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo });

export function directorActual() {
  const s = (getSession() ?? {}) as Record<string, any>;
  return {
    id: String(s.email ?? '').toLowerCase(),
    nombre: String(s.name ?? 'Dirección'),
    sede: String(s.sede ?? 'Banco de Sangre'),
  };
}

// ------------------------------------------------------------------ Solicitudes
export const todasLasSolicitudes = getPedidos;
export const solicitudesPorAprobar = getPedidosPorAprobar;
export const misSolicitudes = () => getPedidos().filter((p) => p.creadoPor === directorActual().id);
export const getSolicitud = (id: string) => pedidos.get(id);

/** Lo que registra la dirección ya está autorizado: nace aprobado y pasa directo a despacho. */
export function crearSolicitud(input: DatosPedido): Resultado<PedidoOp> {
  const error = validarPedido(input);
  if (error) return fail(error);
  const yo = directorActual();
  const hoy = hoyISO();
  const data = pedidos.upsert({
    ...input,
    pacienteNombre: input.pacienteNombre.trim(),
    hospitalDestino: input.hospitalDestino.trim(),
    prioridad: input.prioridad ?? 'normal',
    id: uid(),
    fecha: hoy,
    estado: 'aprobado',
    creadoPor: yo.id,
    creadoPorNombre: yo.nombre,
    revisadoPor: yo.id,
    revisadoPorNombre: yo.nombre,
    fechaRevision: hoy,
  });
  return { ok: true, data, aviso: 'Quedó aprobada: el operador ya puede despacharla.' };
}

export function actualizarSolicitud(id: string, input: DatosPedido): Resultado<PedidoOp> {
  const p = pedidos.get(id);
  if (!p) return fail('No encontramos esa solicitud.');
  if (p.estado === 'despachado') return fail('Ya fue despachada: no se puede modificar.');
  const error = validarPedido(input);
  if (error) return fail(error);
  return { ok: true, data: pedidos.upsert({ ...p, ...input, pacienteNombre: input.pacienteNombre.trim(), hospitalDestino: input.hospitalDestino.trim() }) };
}

export function aprobarSolicitud(id: string): Resultado<PedidoOp> {
  const p = pedidos.get(id);
  if (!p) return fail('No encontramos esa solicitud.');
  if (p.estado !== 'pendiente') return fail(`Esa solicitud ya está ${ESTADO_PEDIDO[p.estado].toLowerCase()}.`);
  const yo = directorActual();
  return {
    ok: true,
    data: pedidos.upsert({ ...p, estado: 'aprobado', revisadoPor: yo.id, revisadoPorNombre: yo.nombre, fechaRevision: hoyISO(), motivoRechazo: undefined }),
  };
}

export function rechazarSolicitud(id: string, motivo: string): Resultado<PedidoOp> {
  const p = pedidos.get(id);
  if (!p) return fail('No encontramos esa solicitud.');
  if (p.estado === 'despachado') return fail('Ya fue despachada: no se puede rechazar.');
  if (motivo.trim().length < 5) return fail('Explica el motivo del rechazo (mínimo 5 caracteres).');
  const yo = directorActual();
  return {
    ok: true,
    data: pedidos.upsert({ ...p, estado: 'rechazado', revisadoPor: yo.id, revisadoPorNombre: yo.nombre, fechaRevision: hoyISO(), motivoRechazo: motivo.trim() }),
  };
}

export function eliminarSolicitud(id: string): Resultado<true> {
  const p = pedidos.get(id);
  if (!p) return fail('No encontramos esa solicitud.');
  if (p.estado === 'despachado') return fail('Ya fue despachada: queda en el historial.');
  pedidos.remove(id);
  return { ok: true, data: true };
}

// ------------------------------------------------------------------ Inventario
export interface ResumenInventario {
  matriz: Record<string, number>; // `${tipo}|${componente}` → unidades vigentes
  porTipo: Record<string, number>;
  unidades: Unidad[];
  porVencer: Unidad[];
  vencidas: Unidad[];
  cuarentena: number;
  tiposCriticos: string[];
}

export function resumenInventario(): ResumenInventario {
  const unidades = unidadesInventario();
  const porTipo = stockPorTipo();
  return {
    matriz: stockMatriz(),
    porTipo,
    unidades,
    porVencer: unidades.filter((u) => u.estado === 'por_vencer'),
    vencidas: unidades.filter((u) => u.estado === 'vencida'),
    cuarentena: enCuarentena().length,
    tiposCriticos: BLOOD_TYPES.filter((t) => (porTipo[t] ?? 0) < STOCK_BAJO),
  };
}

// ------------------------------------------------------------------ Resumen
export function kpisDirector() {
  const mes = hoyISO().slice(0, 7);
  const inv = resumenInventario();
  return {
    stockTotal: Object.values(inv.porTipo).reduce((a, b) => a + b, 0),
    tiposCriticos: inv.tiposCriticos.length,
    porVencer: inv.porVencer.length,
    vencidas: inv.vencidas.length,
    cuarentena: inv.cuarentena,
    porAprobar: getPedidosPorAprobar().length,
    porDespachar: getPedidosPorDespachar().length,
    donacionesMes: donaciones.all().filter((d) => d.fecha.startsWith(mes)).length,
    entregasMes: entregas.all().filter((e) => e.fecha.startsWith(mes)).reduce((a, e) => a + e.unidades, 0),
    donantesVerificados: registro.all().filter((r) => r.estado === 'verificado').length,
    casosSinNotificar: positivos.all().filter((c) => c.estado === 'pendiente').length,
    ticketsAbiertos: tickets.all().filter((t) => t.estado !== 'resuelto').length,
  };
}

// ------------------------------------------------------------------ Actividad de toda la red
export interface EventoRed {
  id: string;
  fecha: string;
  tipo: 'donacion' | 'laboratorio' | 'solicitud' | 'entrega' | 'donante';
  titulo: string;
  detalle: string;
}

export function actividadRed(): EventoRed[] {
  const out: EventoRed[] = [];
  donaciones.all().forEach((d) =>
    out.push({ id: 'd' + d.id, fecha: d.fecha, tipo: 'donacion', titulo: 'Donación registrada', detalle: `${codigoDonacion(d.id)} · ${d.tipoSangre} · ${d.tipoHemocomponente} · ${d.centroNombre ?? ''}` }));
  pruebas.all().forEach((p) =>
    out.push({
      id: 'p' + p.id, fecha: p.fecha, tipo: 'laboratorio',
      titulo: p.resultadoGlobal === 'negativo' ? 'Bolsa liberada por laboratorio' : p.resultadoGlobal === 'positivo' ? 'Bolsa descartada por laboratorio' : 'Pruebas por repetir',
      detalle: `${p.codigo} · ${p.tipoSangreConfirmado}`,
    }));
  pedidos.all().forEach((p) => {
    out.push({ id: 'n' + p.id, fecha: p.fecha, tipo: 'solicitud', titulo: `Solicitud ${codigoPedido(p.id)} creada`, detalle: `${p.unidades} u. ${p.tipoSangre} ${p.tipoHemocomponente} · ${p.hospitalDestino}` });
    if (p.fechaRevision && p.estado !== 'pendiente' && p.revisadoPor !== p.creadoPor) {
      out.push({ id: 'r' + p.id, fecha: p.fechaRevision, tipo: 'solicitud', titulo: `Solicitud ${codigoPedido(p.id)} ${p.estado === 'rechazado' ? 'rechazada' : 'aprobada'}`, detalle: `por ${p.revisadoPorNombre ?? 'Dirección'}` });
    }
  });
  entregas.all().forEach((e) =>
    out.push({ id: 'e' + e.id, fecha: e.fecha, tipo: 'entrega', titulo: 'Entrega despachada', detalle: `${e.unidades} u. ${e.tipoSangre} ${e.tipoHemocomponente} → ${e.hospitalDestino}` }));
  registro.all().filter((r) => r.fechaVerificacion).forEach((r) =>
    out.push({ id: 'v' + r.id, fecha: r.fechaVerificacion!, tipo: 'donante', titulo: 'Donante verificado', detalle: `${r.nombreCompleto} · ${r.sangre}` }));
  return out.sort((a, b) => b.fecha.localeCompare(a.fecha));
}

// ------------------------------------------------------------------ Personal
export interface FichaPersonal extends CuentaPersonal {
  acciones: number; // registros a su nombre (donaciones, pruebas, entregas, tickets…)
}

export function getPersonal(): FichaPersonal[] {
  return listarPersonal().map((c) => {
    const e = c.email;
    const acciones =
      donaciones.all().filter((d) => d.operadorId === e).length +
      entregas.all().filter((x) => x.operadorId === e).length +
      pruebas.all().filter((p) => p.laboratoristaId === e).length +
      tickets.all().filter((t) => t.asignadoA?.id === e).length +
      pedidos.all().filter((p) => p.creadoPor === e || p.revisadoPor === e).length;
    return { ...c, acciones };
  });
}

export const crearPersonal = (input: NuevaCuenta) => crearCuentaPersonal(input);
export const cambiarEstadoPersonal = setPersonalActivo;

// ------------------------------------------------------------------ Reportes
export interface ReporteDirector {
  desde: string;
  hasta: string;
  donaciones: number;
  volumenMl: number;
  donacionesPorTipo: Record<string, number>;
  donacionesPorComponente: Record<string, number>;
  unidadesEntregadas: number;
  entregasPorDestino: { destino: string; unidades: number }[];
  solicitudesPorEstado: Record<string, number>;
  pruebas: number;
  descartadas: number;
  donantesNuevos: number;
}

export function reporteDirector(desde: string, hasta: string): ReporteDirector {
  const dentro = (f?: string) => !!f && f >= desde && f <= hasta;
  const don = donaciones.all().filter((d) => dentro(d.fecha));
  const ent = entregas.all().filter((e) => dentro(e.fecha));
  const ped = pedidos.all().filter((p) => dentro(p.fecha));
  const contar = <T>(lista: T[], clave: (x: T) => string, peso: (x: T) => number = () => 1) =>
    lista.reduce<Record<string, number>>((acc, x) => ((acc[clave(x)] = (acc[clave(x)] ?? 0) + peso(x)), acc), {});
  const porDestino = contar(ent, (e) => e.hospitalDestino, (e) => e.unidades);
  const pr = pruebas.all().filter((p) => dentro(p.fecha));
  return {
    desde, hasta,
    donaciones: don.length,
    volumenMl: don.reduce((a, d) => a + d.volumenMl, 0),
    donacionesPorTipo: contar(don, (d) => d.tipoSangre),
    donacionesPorComponente: contar(don, (d) => d.tipoHemocomponente),
    unidadesEntregadas: ent.reduce((a, e) => a + e.unidades, 0),
    entregasPorDestino: Object.entries(porDestino).map(([destino, unidades]) => ({ destino, unidades })).sort((a, b) => b.unidades - a.unidades),
    solicitudesPorEstado: contar(ped, (p) => ESTADO_PEDIDO[p.estado]),
    pruebas: pr.length,
    descartadas: pr.filter((p) => p.resultadoGlobal === 'positivo').length,
    donantesNuevos: registro.all().filter((r) => dentro(r.fechaRegistro)).length,
  };
}
