// src/lib/operador.ts
// Lógica del módulo de operador: verificar donantes, registrar donaciones, pedidos, entregas y stock.
// Todo pasa por lib/db, así el donante ve en su carnet e historial lo que el operador registra.

import { getSession } from './auth';
import { centers } from '../data/centers';
import {
  BLOOD_TYPES, COMPONENTES, collection, donaciones, entregas, pedidos, registro,
  buscarRegistro, normCedula, onDb, verificarRegistro,
} from './db';
import type { DonacionOp, EntregaOp, Hemocomponente, PedidoOp, RegistroDonante } from './db';
import { diasDesde, hoyISO, sumarDias, uid } from './ui';

export { BLOOD_TYPES, COMPONENTES, onDb, normCedula, buscarRegistro as buscarDonante };
export { uid, toast, esc, fmtFecha, hoyISO, downloadFile, toCSV } from './ui';
export type { DonacionOp, EntregaOp, Hemocomponente, PedidoOp, RegistroDonante };

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

export function registrarDonanteOp(input: { cedula: string; nombreCompleto: string; sangre: string }): Resultado<RegistroDonante> {
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
  });
  return { ok: true, data };
}

// ------------------------------------------------------------------ Stock
const k = (tipo: string, comp: string) => `${tipo}|${comp}`;

/** Cada donación suma 1 unidad; cada entrega resta sus unidades. */
export function stockMatriz(): Record<string, number> {
  const m: Record<string, number> = {};
  donaciones.all().forEach((d) => { m[k(d.tipoSangre, d.tipoHemocomponente)] = (m[k(d.tipoSangre, d.tipoHemocomponente)] ?? 0) + 1; });
  entregas.all().forEach((e) => { m[k(e.tipoSangre, e.tipoHemocomponente)] = (m[k(e.tipoSangre, e.tipoHemocomponente)] ?? 0) - e.unidades; });
  return m;
}

export const stockDe = (tipo: string, comp: string) => Math.max(0, stockMatriz()[k(tipo, comp)] ?? 0);

export function stockPorTipo(): Record<string, number> {
  const m = stockMatriz();
  const out: Record<string, number> = Object.fromEntries(BLOOD_TYPES.map((t) => [t, 0]));
  Object.entries(m).forEach(([key, v]) => {
    const tipo = key.split('|')[0];
    out[tipo] = (out[tipo] ?? 0) + Math.max(0, v);
  });
  return out;
}

// ------------------------------------------------------------------ Pedidos y entregas
export const getPedidos = () => pedidos.all().sort(porFechaDesc);
export const getPedidosPendientes = () => getPedidos().filter((p) => p.estado === 'pendiente');
export const getEntregasOp = () => entregas.all().sort(porFechaDesc);

type DatosPedido = Omit<PedidoOp, 'id' | 'fecha' | 'estado' | 'creadoPor' | 'entregaId'>;

export function registrarPedido(input: DatosPedido): Resultado<PedidoOp> {
  if (!input.pacienteNombre.trim() || !input.hospitalDestino.trim()) return fail('Completa el paciente y el centro solicitante.');
  if (!BLOOD_TYPES.includes(input.tipoSangre as any)) return fail('Elige el tipo de sangre.');
  if (!(input.unidades >= 1)) return fail('Indica al menos 1 unidad.');
  const data = pedidos.upsert({
    ...input,
    pacienteCedula: normCedula(input.pacienteCedula),
    id: uid(),
    fecha: hoyISO(),
    estado: 'pendiente',
    creadoPor: operadorActual().id,
  });
  return { ok: true, data };
}

/** Registra la salida y, si venía de un pedido, lo cierra. Avisa (sin bloquear) si el stock no alcanza. */
export function registrarEntrega(input: DatosPedido & { pedidoId?: string }): Resultado<EntregaOp> {
  if (!input.pacienteNombre.trim() || !input.hospitalDestino.trim()) return fail('Completa el receptor y el destino.');
  if (!BLOOD_TYPES.includes(input.tipoSangre as any)) return fail('Elige el tipo de sangre.');
  if (!(input.unidades >= 1)) return fail('Indica al menos 1 unidad.');

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
  if (input.pedidoId) {
    const p = pedidos.get(input.pedidoId);
    if (p) pedidos.upsert({ ...p, estado: 'despachado', entregaId: data.id });
  }
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
    pedidosPendientes: getPedidosPendientes().length,
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
    out.push({ id: 'p' + p.id, tipo: 'pedido', fecha: p.fecha, titulo: p.estado === 'pendiente' ? 'Pedido pendiente' : 'Pedido cargado', detalle: `${p.pacienteNombre} · ${p.unidades} u. ${p.tipoSangre} · ${p.hospitalDestino}` }));
  entregas.all().filter((e) => e.operadorId === me).forEach((e) =>
    out.push({ id: 'e' + e.id, tipo: 'entrega', fecha: e.fecha, titulo: 'Entrega realizada', detalle: `${e.unidades} u. ${e.tipoSangre} ${e.tipoHemocomponente} → ${e.hospitalDestino}` }));
  return out.sort(porFechaDesc);
}

// ------------------------------------------------------------------ Datos de ejemplo (idempotente)
export function seedOperadorDemo() {
  const op = operadorActual().id;
  const hoy = hoyISO();
  const d = (n: number) => sumarDias(hoy, -n);
  const reg = (id: string, nombre: string, ced: string, sangre: string, estado: 'preregistrado' | 'verificado', n: number, origen: 'app' | 'operador' = 'app') =>
    registro.upsert({ id, cedula: ced, nombreCompleto: nombre, sangre, fechaRegistro: d(n), estado, origen, operadorId: estado === 'verificado' ? op : undefined, fechaVerificacion: estado === 'verificado' ? d(n) : undefined });
  reg('demo-1', 'Laura Pérez', 'V-20111222', 'O+', 'preregistrado', 1);
  reg('demo-2', 'Carlos Rincón', 'V-18222333', 'A-', 'preregistrado', 2);
  reg('demo-3', 'Ana Morales', 'V-15333444', 'O-', 'verificado', 40, 'operador');
  reg('demo-4', 'Luis Fernández', 'V-12444555', 'B+', 'verificado', 120);
  const don = (id: string, donante: string, nombre: string, ced: string, tipo: string, comp: Hemocomponente, n: number) =>
    donaciones.upsert({ id, donanteId: donante, donanteNombre: nombre, donanteCedula: ced, tipoSangre: tipo, tipoHemocomponente: comp, volumenMl: 450, fecha: d(n), operadorId: op, centroNombre: operadorActual().centro });
  don('demo-d1', 'demo-3', 'Ana Morales', 'V-15333444', 'O-', 'Sangre Total', 100);
  don('demo-d2', 'demo-4', 'Luis Fernández', 'V-12444555', 'B+', 'Concentrado Globular', 95);
  don('demo-d3', 'demo-3', 'Ana Morales', 'V-15333444', 'O-', 'Plaquetas', 20);
  don('demo-d4', 'demo-4', 'Luis Fernández', 'V-12444555', 'B+', 'Sangre Total', 12);
  don('demo-d5', 'demo-3', 'Ana Morales', 'V-15333444', 'O-', 'Concentrado Globular', 8);
  pedidos.upsert({ id: 'demo-p1', pacienteNombre: 'Roberto Gómez', pacienteCedula: 'V-9876543', tipoSangre: 'O-', tipoHemocomponente: 'Concentrado Globular', unidades: 1, hospitalDestino: 'Hospital Central Maracaibo', fecha: d(0), estado: 'pendiente', creadoPor: op });
  pedidos.upsert({ id: 'demo-p2', pacienteNombre: 'María Delgado', pacienteCedula: 'V-18765432', tipoSangre: 'B+', tipoHemocomponente: 'Sangre Total', unidades: 2, hospitalDestino: 'Hospital Universitario', fecha: d(1), estado: 'pendiente', creadoPor: op });
}