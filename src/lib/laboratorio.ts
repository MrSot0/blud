// src/lib/laboratorio.ts
// Lógica del módulo de laboratorio: pruebas de tamizaje, fraccionamiento, casos positivos y reportes.
//
// Flujo: el operador registra una donación → queda "pendiente" (cuarentena) → el laboratorio registra las
// pruebas → negativa: se LIBERA (entra al stock) · positiva: se DESCARTA, se abre un caso y el donante queda diferido.
// El fraccionamiento convierte una bolsa de sangre total en sus hemocomponentes.
//
// PRIVACIDAD: los resultados son datos de salud sensibles. Las listas usan el código de donación (DON-XXXXXX);
// el nombre solo se muestra en el detalle de un caso. El donante y el operador nunca ven resultados ni motivos.
// En producción: cifrado, control de acceso por rol en el servidor y registro de auditoría.

import {
  BLOOD_TYPES, COMPONENTES, PRUEBAS, codigoDonacion, donaciones, fracciones, onDb, positivos, pruebas, registro,
} from './db';
import type {
  CasoPositivo, DonacionOp, EstadoLab, Fraccionamiento, Hemocomponente, ProductoFraccion,
  PruebaLab, ResultadoGlobal, ResultadoPrueba,
} from './db';
import { operadorActual, seedOperadorDemo } from './operador';
import type { Resultado } from './operador';
import { hoyISO, sumarDias, uid } from './ui';

export { BLOOD_TYPES, COMPONENTES, PRUEBAS, codigoDonacion, onDb };
export { uid, toast, esc, fmtFecha, hoyISO, downloadFile, toCSV } from './ui';
export type { CasoPositivo, DonacionOp, EstadoLab, Fraccionamiento, Hemocomponente, ProductoFraccion, PruebaLab, ResultadoGlobal, ResultadoPrueba };

const fail = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo });
const porFechaDesc = <T extends { fecha: string }>(a: T, b: T) => b.fecha.localeCompare(a.fecha);

/** El personal de laboratorio usa el mismo perfil de personal (sede, colegiado…) que el operador. */
export const laboratoristaActual = operadorActual;

export const estadoLabDe = (d: DonacionOp): EstadoLab => d.estadoLab ?? 'liberada';

// ------------------------------------------------------------------ Pruebas
export const getPruebas = () => pruebas.all().sort(porFechaDesc);
export const getDonacionesLab = () => donaciones.all().sort(porFechaDesc);
export const donacionPorId = (id: string) => donaciones.get(id);

/** Donaciones en cuarentena: aún sin resultado final (incluye las indeterminadas que hay que repetir). */
export const porAnalizar = () => donaciones.all().filter((d) => estadoLabDe(d) === 'pendiente').sort(porFechaDesc);

export function resultadoGlobal(res: Record<string, ResultadoPrueba>): ResultadoGlobal {
  const v = Object.values(res);
  if (v.includes('reactivo')) return 'positivo';
  if (v.includes('indeterminado')) return 'indeterminado';
  return 'negativo';
}

export function registrarPruebas(input: {
  donacionId: string;
  resultados: Record<string, ResultadoPrueba>;
  tipoSangre: string;
  lote?: string;
  observaciones?: string;
}): Resultado<{ prueba: PruebaLab; global: ResultadoGlobal; casos: CasoPositivo[] }> {
  const d = donaciones.get(input.donacionId);
  if (!d) return fail('No encontramos esa donación.');
  if (estadoLabDe(d) !== 'pendiente') return fail('Esa donación ya tiene un resultado final.');
  const faltan = PRUEBAS.filter((p) => !input.resultados[p.id]);
  if (faltan.length) return fail(`Falta el resultado de: ${faltan.map((f) => f.nombre).join(', ')}.`);
  if (!BLOOD_TYPES.includes(input.tipoSangre as any)) return fail('Confirma el grupo sanguíneo (ABO/Rh).');

  const global = resultadoGlobal(input.resultados);
  const fecha = hoyISO();
  const prueba = pruebas.upsert({
    id: uid(),
    donacionId: d.id,
    codigo: codigoDonacion(d.id),
    fecha,
    resultados: input.resultados,
    resultadoGlobal: global,
    tipoSangreConfirmado: input.tipoSangre,
    lote: input.lote?.trim() || undefined,
    observaciones: input.observaciones?.trim() || undefined,
    laboratoristaId: laboratoristaActual().id,
  });

  // negativo → libera · positivo → descarta · indeterminado → sigue en cuarentena hasta repetir
  const estadoLab: EstadoLab = global === 'negativo' ? 'liberada' : global === 'positivo' ? 'descartada' : 'pendiente';
  donaciones.upsert({ ...d, tipoSangre: input.tipoSangre, estadoLab });

  // El grupo confirmado por laboratorio manda sobre el que se anotó en la extracción
  const reg = registro.get(d.donanteId);
  if (reg && input.tipoSangre !== reg.sangre) registro.upsert({ ...reg, sangre: input.tipoSangre });

  const casos: CasoPositivo[] = [];
  if (global === 'positivo') {
    PRUEBAS.filter((p) => input.resultados[p.id] === 'reactivo').forEach((p) =>
      casos.push(positivos.upsert({
        id: uid(), pruebaId: prueba.id, donacionId: d.id, donanteId: d.donanteId, codigo: codigoDonacion(d.id),
        prueba: p.id, enfermedad: p.nombre, fecha, estado: 'pendiente',
      }))
    );
    const r = registro.get(d.donanteId);
    if (r) registro.upsert({ ...r, diferido: { desde: fecha } }); // no puede volver a donar hasta que se revise
  }
  return { ok: true, data: { prueba, global, casos } };
}

// ------------------------------------------------------------------ Fraccionamiento
export const getFraccionamientos = () => fracciones.all().sort(porFechaDesc);

/** Bolsas de sangre total que aún no se fraccionan y no están descartadas. */
export function fraccionables(): DonacionOp[] {
  const hechas = new Set(fracciones.all().map((f) => f.donacionId));
  return donaciones.all()
    .filter((d) => d.tipoHemocomponente === 'Sangre Total' && estadoLabDe(d) !== 'descartada' && !hechas.has(d.id))
    .sort(porFechaDesc);
}

export function registrarFraccionamiento(input: {
  donacionId: string;
  productos: ProductoFraccion[];
  observaciones?: string;
}): Resultado<Fraccionamiento> {
  const d = fraccionables().find((x) => x.id === input.donacionId);
  if (!d) return fail('Esa donación no se puede fraccionar (ya fue fraccionada, está descartada o no es sangre total).');
  const productos = input.productos.filter((p) => p.unidades > 0);
  if (!productos.length) return fail('Indica al menos un hemocomponente obtenido.');
  if (productos.some((p) => p.componente === 'Sangre Total' || !COMPONENTES.includes(p.componente))) return fail('Hemocomponente no válido.');
  if (productos.some((p) => !(p.volumenMl > 0))) return fail('Indica el volumen de cada hemocomponente.');
  const data = fracciones.upsert({
    id: uid(),
    donacionId: d.id,
    codigo: codigoDonacion(d.id),
    fecha: hoyISO(),
    productos: productos.map((p) => ({ componente: p.componente, unidades: Math.round(p.unidades), volumenMl: Math.round(p.volumenMl) })),
    observaciones: input.observaciones?.trim() || undefined,
    laboratoristaId: laboratoristaActual().id,
  });
  return { ok: true, data };
}

// ------------------------------------------------------------------ Casos positivos
export const getCasos = () => positivos.all().sort(porFechaDesc);

export function notificarCaso(id: string, input: { ente: string; referencia?: string }): Resultado<CasoPositivo> {
  const c = positivos.get(id);
  if (!c) return fail('No encontramos ese caso.');
  if (!input.ente.trim()) return fail('Indica a quién se notificó (ej. epidemiología regional).');
  const data = positivos.upsert({
    ...c, estado: 'notificado', notificadoA: input.ente.trim(), referencia: input.referencia?.trim() || undefined,
    fechaNotificacion: hoyISO(), notificadoPor: laboratoristaActual().id,
  });
  return { ok: true, data };
}

/** Detalle (con nombre) de un caso: solo para quien lo abre expresamente. */
export function donanteDeCaso(c: CasoPositivo) {
  const r = registro.get(c.donanteId);
  return r ? { nombre: r.nombreCompleto, cedula: r.cedula, sangre: r.sangre } : undefined;
}

// ------------------------------------------------------------------ Resumen y reportes
export function kpisLab() {
  const mes = hoyISO().slice(0, 7);
  return {
    porAnalizar: porAnalizar().length,
    porFraccionar: fraccionables().length,
    positivosSinNotificar: positivos.all().filter((c) => c.estado === 'pendiente').length,
    pruebasMes: pruebas.all().filter((p) => p.fecha.startsWith(mes)).length,
    fraccionesMes: fracciones.all().filter((f) => f.fecha.startsWith(mes)).length,
  };
}

export interface ReporteLab {
  desde: string;
  hasta: string;
  pruebas: number;
  negativas: number;
  positivas: number;
  indeterminadas: number;
  positividad: number; // % de pruebas con resultado positivo
  porEnfermedad: { id: string; nombre: string; realizadas: number; reactivos: number; tasa: number }[];
  fraccionamientos: number;
  productos: { componente: string; unidades: number; volumenMl: number }[];
  casos: CasoPositivo[];
  casosSinNotificar: number;
}

export function reporte(desde: string, hasta: string): ReporteLab {
  const dentro = (f: string) => f >= desde && f <= hasta;
  const pr = pruebas.all().filter((p) => dentro(p.fecha));
  const por = PRUEBAS.map((t) => {
    const reactivos = pr.filter((p) => p.resultados[t.id] === 'reactivo').length;
    return { id: t.id, nombre: t.nombre, realizadas: pr.length, reactivos, tasa: pr.length ? (reactivos / pr.length) * 100 : 0 };
  });
  const fr = fracciones.all().filter((f) => dentro(f.fecha));
  const acc: Record<string, { unidades: number; volumenMl: number }> = {};
  fr.forEach((f) => f.productos.forEach((p) => {
    const a = (acc[p.componente] ??= { unidades: 0, volumenMl: 0 });
    a.unidades += p.unidades;
    a.volumenMl += p.volumenMl * p.unidades;
  }));
  const casos = positivos.all().filter((c) => dentro(c.fecha)).sort(porFechaDesc);
  const positivas = pr.filter((p) => p.resultadoGlobal === 'positivo').length;
  return {
    desde, hasta,
    pruebas: pr.length,
    negativas: pr.filter((p) => p.resultadoGlobal === 'negativo').length,
    positivas,
    indeterminadas: pr.filter((p) => p.resultadoGlobal === 'indeterminado').length,
    positividad: pr.length ? (positivas / pr.length) * 100 : 0,
    porEnfermedad: por,
    fraccionamientos: fr.length,
    productos: Object.entries(acc).map(([componente, v]) => ({ componente, ...v })),
    casos,
    casosSinNotificar: casos.filter((c) => c.estado === 'pendiente').length,
  };
}

// ------------------------------------------------------------------ Actividad
export interface EventoLab {
  id: string;
  tipo: 'prueba' | 'fraccionamiento' | 'caso';
  fecha: string;
  titulo: string;
  detalle: string;
}

export function actividadLab(): EventoLab[] {
  const me = laboratoristaActual().id;
  const nombre = (id: string) => PRUEBAS.find((p) => p.id === id)?.nombre ?? id;
  const out: EventoLab[] = [];
  pruebas.all().filter((p) => p.laboratoristaId === me).forEach((p) => {
    const reactivas = Object.entries(p.resultados).filter(([, v]) => v === 'reactivo').map(([k]) => nombre(k));
    out.push({
      id: 'p' + p.id, tipo: 'prueba', fecha: p.fecha,
      titulo: `Pruebas ${p.resultadoGlobal === 'positivo' ? 'con resultado reactivo' : p.resultadoGlobal === 'negativo' ? 'negativas' : 'indeterminadas'}`,
      detalle: `${p.codigo} · ${p.tipoSangreConfirmado}${reactivas.length ? ' · ' + reactivas.join(', ') : ''}`,
    });
  });
  fracciones.all().filter((f) => f.laboratoristaId === me).forEach((f) =>
    out.push({ id: 'f' + f.id, tipo: 'fraccionamiento', fecha: f.fecha, titulo: 'Fraccionamiento', detalle: `${f.codigo} → ${f.productos.map((p) => `${p.unidades} ${p.componente}`).join(', ')}` }));
  positivos.all().filter((c) => c.notificadoPor === me).forEach((c) =>
    out.push({ id: 'c' + c.id, tipo: 'caso', fecha: c.fechaNotificacion ?? c.fecha, titulo: 'Caso notificado', detalle: `${c.codigo} · ${c.enfermedad} → ${c.notificadoA}` }));
  return out.sort(porFechaDesc);
}

// ------------------------------------------------------------------ Datos de ejemplo (idempotente)
export function seedLabDemo() {
  seedOperadorDemo(); // donantes y donaciones base
  const lab = laboratoristaActual();
  const hoy = hoyISO();
  const d = (n: number) => sumarDias(hoy, -n);
  const res = (over: Record<string, ResultadoPrueba> = {}) =>
    Object.fromEntries(PRUEBAS.map((p) => [p.id, over[p.id] ?? 'no_reactivo'])) as Record<string, ResultadoPrueba>;

  registro.upsert({ id: 'demo-5', cedula: 'V-14555666', nombreCompleto: 'Pedro Sánchez', sangre: 'A+', fechaRegistro: d(60), fechaVerificacion: d(60), estado: 'verificado', origen: 'operador', operadorId: lab.id });
  const don = (id: string, donante: string, nombre: string, ced: string, tipo: string, n: number, estadoLab: EstadoLab) =>
    donaciones.upsert({ id, donanteId: donante, donanteNombre: nombre, donanteCedula: ced, tipoSangre: tipo, tipoHemocomponente: 'Sangre Total', volumenMl: 450, fecha: d(n), operadorId: lab.id, centroNombre: lab.centro, estadoLab });

  don('demo-l1', 'demo-4', 'Luis Fernández', 'V-12444555', 'B+', 0, 'pendiente');
  don('demo-l2', 'demo-3', 'Ana Morales', 'V-15333444', 'O-', 1, 'pendiente');

  don('demo-l3', 'demo-4', 'Luis Fernández', 'V-12444555', 'B+', 30, 'liberada');
  pruebas.upsert({ id: 'demo-pr3', donacionId: 'demo-l3', codigo: codigoDonacion('demo-l3'), fecha: d(29), resultados: res(), resultadoGlobal: 'negativo', tipoSangreConfirmado: 'B+', laboratoristaId: lab.id });
  fracciones.upsert({ id: 'demo-fr3', donacionId: 'demo-l3', codigo: codigoDonacion('demo-l3'), fecha: d(29), productos: [{ componente: 'Concentrado Globular', unidades: 1, volumenMl: 250 }, { componente: 'Plasma Fresco Congelado', unidades: 1, volumenMl: 200 }], laboratoristaId: lab.id });

  don('demo-l4', 'demo-5', 'Pedro Sánchez', 'V-14555666', 'A+', 15, 'descartada');
  pruebas.upsert({ id: 'demo-pr4', donacionId: 'demo-l4', codigo: codigoDonacion('demo-l4'), fecha: d(14), resultados: res({ hbsag: 'reactivo' }), resultadoGlobal: 'positivo', tipoSangreConfirmado: 'A+', laboratoristaId: lab.id });
  positivos.upsert({ id: 'demo-cs4', pruebaId: 'demo-pr4', donacionId: 'demo-l4', donanteId: 'demo-5', codigo: codigoDonacion('demo-l4'), prueba: 'hbsag', enfermedad: 'Hepatitis B (HBsAg)', fecha: d(14), estado: 'pendiente' });
  const p = registro.get('demo-5');
  if (p) registro.upsert({ ...p, diferido: { desde: d(14) } });
}