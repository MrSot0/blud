// src/lib/hemovigilancia.ts
// Hemovigilancia (RF-H1, H2, H4). Cada unidad despachada a un paciente se registra en cabecera de cama:
//   1. doble verificación (identidad, grupo ABO/Rh, etiqueta de la bolsa, consentimiento) con el segundo verificador;
//   2. tiempos y volumen de la infusión, y signos vitales antes, durante (15 min) y al terminar;
//   3. cómo terminó: sin reacción, reacción adversa o incidente, con categoría, severidad, imputabilidad y acciones.
// Mientras la transfusión sigue en curso el registro se puede completar; al cerrarlo queda fijo.
// La dirección consulta los registros de su sede o de toda la red y descarga el PDF de cada uno.
//
// Con base real: blud_hemovigilancia() y blud_registrar_hemovigilancia() (migración 20261125120000).
// En modo demo: colección local, y las unidades pendientes salen de los despachos de ejemplo.

import { sb, usaSupabase } from './supabase';
import { entregas } from './db';
import { getSession } from './auth';

export type EstadoHV = 'en_curso' | 'cerrado';
export type TipoEvento = 'sin_reaccion' | 'reaccion' | 'incidente';

export interface Signos { pa?: string; fc?: string; temp?: string; fr?: string; spo2?: string }
export interface Verificacion {
  identidad: boolean; grupo: boolean; etiqueta: boolean; consentimiento: boolean; ordenMedica?: boolean; segundoVerificador: string;
}
export interface Paciente { nombre: string; cedula: string; servicio?: string; historia?: string }

export interface RegistroHV {
  id: string; // HV-2026-0001
  estado: EstadoHV;
  solicitudId: string;
  unidadId: number | string;
  unidadCodigo?: string;
  componente?: string;
  tipoSangre?: string;
  paciente?: Paciente;
  ubicacion?: string;
  medico?: string;
  sede?: { id?: number; nombre?: string };
  registradoPor?: string;
  registrado: string; // ISO
  actualizado?: string;
  verificacion: Verificacion;
  signos: { antes?: Signos; durante?: Signos; despues?: Signos };
  inicio?: string; // ISO
  fin?: string;
  volumenMl?: number;
  tipoEvento?: TipoEvento;
  categoria?: string;
  severidad?: string;
  imputabilidad?: string;
  sintomas?: string;
  acciones?: string;
  /** RF-H3: velocidad de infusión (p. ej. «60 ml/h» o «30 gotas/min»). */
  velocidad?: string;
  /** Hora del despacho de la solicitud (para la alerta de 30 min fuera de refrigeración). */
  despachado?: string;
  /** RF-H6: bolsa devuelta al banco al suspender o rechazar la transfusión. */
  devolucion?: Devolucion;
  /** RF-H4: notificación al comité de hemovigilancia (la hace la dirección). */
  comite?: { fecha: string; por?: string; nota?: string };
}

export interface Devolucion {
  devuelta: true; motivo: string; fecha?: string; por?: string;
  recibidaEn?: string; recibidaPor?: string; notaRecepcion?: string;
}

/** Unidad despachada que todavía no tiene registro. */
export interface PendienteHV {
  solicitudId: string;
  unidadId: number | string;
  unidadCodigo?: string;
  componente?: string;
  tipoSangre?: string;
  paciente?: Paciente;
  despachado?: string;
  cruzada?: string;
}

export interface DatosHV {
  id?: string;
  solicitudId: string;
  unidadId: number | string;
  verificacion: Verificacion;
  signos: RegistroHV['signos'];
  inicio?: string;
  fin?: string;
  volumenMl?: number | '';
  ubicacion?: string;
  medico?: string;
  tipoEvento?: TipoEvento;
  categoria?: string;
  severidad?: string;
  imputabilidad?: string;
  sintomas?: string;
  acciones?: string;
  velocidad?: string;
  devolucion?: { devuelta: boolean; motivo: string };
  cerrar?: boolean;
}

// ------------------------------------------------------------------ Catálogos
export const TIPO_EVENTO: Record<TipoEvento, string> = {
  sin_reaccion: 'Sin reacción',
  reaccion: 'Reacción adversa',
  incidente: 'Incidente',
};

/** Categorías de reacción adversa (clasificación habitual de hemovigilancia). */
export const CATEGORIAS_REACCION = [
  'Febril no hemolítica', 'Alérgica leve (urticaria, prurito)', 'Anafiláctica', 'Hemolítica aguda', 'Hemolítica tardía',
  'Sobrecarga circulatoria (TACO)', 'Lesión pulmonar aguda (TRALI)', 'Disnea asociada a la transfusión (TAD)',
  'Hipotensiva', 'Contaminación bacteriana', 'Otra',
] as const;

export const CATEGORIAS_INCIDENTE = [
  'Error de identificación del paciente', 'Componente equivocado', 'Bolsa dañada o con fuga', 'Ruptura de la cadena de frío',
  'Unidad vencida o fuera de condición', 'Transfusión interrumpida sin reacción', 'Otro',
] as const;

export const SEVERIDADES = ['Leve', 'Moderada', 'Grave', 'Amenaza la vida', 'Muerte'] as const;
export const IMPUTABILIDAD = ['Por evaluar', 'Descartada', 'Improbable', 'Posible', 'Probable', 'Segura'] as const;

/** Tono de chip según la severidad. */
export function tonoSeveridad(s?: string): string {
  if (!s) return 'bg-sunken text-ink-2';
  if (s === 'Leve') return 'bg-warn-soft text-warn';
  if (s === 'Moderada') return 'bg-warn-soft text-warn';
  return 'bg-accent-soft text-accent-ink';
}
export const esGrave = (r: RegistroHV) => r.tipoEvento !== 'sin_reaccion' && ['Grave', 'Amenaza la vida', 'Muerte'].includes(r.severidad ?? '');

// ------------------------------------------------------------------ Validación (la base repite estas reglas)
export function validarHV(d: DatosHV): string | null {
  const v = d.verificacion;
  if (!(v.identidad && v.grupo && v.etiqueta && v.consentimiento && v.ordenMedica)) return 'Completa la doble verificación en cabecera (incluida la orden médica escrita) antes de registrar la transfusión.';
  if (!v.segundoVerificador.trim()) return 'Indica quién hizo la segunda verificación.';
  if (d.cerrar && !d.tipoEvento) return 'Indica cómo terminó la transfusión antes de cerrarla.';
  if (d.tipoEvento && d.tipoEvento !== 'sin_reaccion' && (!d.categoria || !d.severidad)) return 'Indica la categoría y la severidad del evento.';
  if (d.cerrar && d.tipoEvento && d.tipoEvento !== 'sin_reaccion' && !d.acciones?.trim()) return 'Describe las acciones tomadas ante el evento.';
  if (d.volumenMl !== '' && d.volumenMl != null && (!Number.isFinite(Number(d.volumenMl)) || Number(d.volumenMl) <= 0 || Number(d.volumenMl) > 2000)) return 'El volumen transfundido debe estar entre 1 y 2000 ml.';
  if (d.inicio && d.fin && d.fin < d.inicio) return 'La hora de fin no puede ser anterior a la de inicio.';
  if (d.devolucion?.devuelta && d.devolucion.motivo.trim().length < 10) return 'Explica por qué se devuelve la bolsa (mínimo 10 caracteres).';
  return null;
}

// ------------------------------------------------------------------ RF-H3 · Alertas de tiempo
/** Minutos máximos entre el despacho (salida de refrigeración) y el inicio de la transfusión. */
export const MAX_MIN_HASTA_INICIO = 30;
/** Minutos máximos de infusión de una unidad. */
export const MAX_MIN_INFUSION = 240;

/** Minutos entre el despacho y el inicio (null si falta alguno). */
export function minutosHastaInicio(r: { despachado?: string; inicio?: string }): number | null {
  // Sin hora del despacho (solo la fecha) no se puede medir la espera.
  if (!r.despachado || !r.inicio || r.despachado.length <= 10) return null;
  const m = Math.round((new Date(r.inicio).getTime() - new Date(r.despachado).getTime()) / 60000);
  return Number.isFinite(m) && m >= 0 ? m : null;
}
/** Minutos de infusión: hasta el fin, o hasta ahora si sigue en curso. */
export function minutosInfusion(r: { inicio?: string; fin?: string; estado?: EstadoHV }): number | null {
  if (!r.inicio) return null;
  const fin = r.fin ? new Date(r.fin).getTime() : r.estado === 'cerrado' ? NaN : Date.now();
  const m = Math.round((fin - new Date(r.inicio).getTime()) / 60000);
  return Number.isFinite(m) && m >= 0 ? m : null;
}
/** Alertas de la norma (RF-H3) para un registro o un formulario. */
export function alertasTiempo(r: { despachado?: string; inicio?: string; fin?: string; estado?: EstadoHV }): string[] {
  const out: string[] = [];
  const espera = minutosHastaInicio(r);
  if (espera !== null && espera > MAX_MIN_HASTA_INICIO) out.push(`Inició ${espera} min después del despacho: la unidad no debe pasar más de ${MAX_MIN_HASTA_INICIO} min fuera de refrigeración antes de transfundirse.`);
  const dur = minutosInfusion(r);
  if (dur !== null && dur > MAX_MIN_INFUSION) out.push(`La infusión ${r.fin || r.estado === 'cerrado' ? 'duró' : 'lleva'} ${Math.floor(dur / 60)} h ${dur % 60} min: no debe pasar de 4 horas.`);
  return out;
}

// ------------------------------------------------------------------ Modo demo
const KEY = 'blud-db-hemovigilancia';
const leerDemo = (): RegistroHV[] => {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') as RegistroHV[]; } catch { return []; }
};
const escribirDemo = (l: RegistroHV[]) => {
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch {}
  try { window.dispatchEvent(new CustomEvent('blud:db', { detail: { key: KEY } })); } catch {}
};

function pendientesDemo(registros: RegistroHV[]): PendienteHV[] {
  const hechos = new Set(registros.map((r) => `${r.solicitudId}|${r.unidadId}`));
  const out: PendienteHV[] = [];
  for (const e of entregas.all()) {
    for (let i = 1; i <= e.unidades; i++) {
      const unidadId = `${e.id}-${i}`;
      if (hechos.has(`${e.id}|${unidadId}`)) continue;
      out.push({
        solicitudId: e.id, unidadId, unidadCodigo: `${e.id.slice(-6).toUpperCase()}-${i}`, componente: e.tipoHemocomponente,
        tipoSangre: e.tipoSangre, paciente: { nombre: e.pacienteNombre, cedula: e.pacienteCedula, servicio: e.hospitalDestino },
        despachado: e.fecha, cruzada: 'Compatible',
      });
    }
  }
  return out.sort((a, b) => (b.despachado ?? '').localeCompare(a.despachado ?? ''));
}

function guardarDemo(d: DatosHV): RegistroHV {
  const lista = leerDemo();
  const prev = d.id ? lista.find((r) => r.id === d.id) : undefined;
  if (d.id && !prev) throw new Error('No encontramos ese registro de hemovigilancia.');
  if (prev?.estado === 'cerrado') throw new Error('El registro ya está cerrado: no se puede modificar.');
  const pend = prev ? undefined : pendientesDemo(lista).find((p) => p.solicitudId === d.solicitudId && String(p.unidadId) === String(d.unidadId));
  if (!prev && !pend) throw new Error('Esa unidad ya tiene un registro de hemovigilancia.');
  const ahora = new Date().toISOString();
  const s = (getSession() ?? {}) as Record<string, unknown>;
  // Folio siguiente al mayor existente (no al tamaño de la lista: los de ejemplo no empiezan en 1).
  const n = lista.reduce((m, x) => Math.max(m, Number(/-(\d+)$/.exec(x.id)?.[1] ?? 0)), 0) + 1;
  const r: RegistroHV = {
    ...(prev ?? {
      id: `HV-${ahora.slice(0, 4)}-${String(n).padStart(4, '0')}`,
      solicitudId: d.solicitudId, unidadId: d.unidadId, unidadCodigo: pend!.unidadCodigo, componente: pend!.componente,
      tipoSangre: pend!.tipoSangre, paciente: pend!.paciente, sede: { nombre: String(s.sede ?? 'Banco de Sangre del Zulia') },
      registradoPor: String(s.name ?? 'Operador'), registrado: ahora, despachado: pend!.despachado,
    }),
    estado: d.cerrar ? 'cerrado' : 'en_curso',
    actualizado: ahora,
    verificacion: d.verificacion,
    signos: d.signos,
    inicio: d.inicio || undefined,
    fin: d.fin || undefined,
    volumenMl: d.volumenMl === '' || d.volumenMl == null ? undefined : Number(d.volumenMl),
    ubicacion: d.ubicacion?.trim() || undefined,
    medico: d.medico?.trim() || undefined,
    tipoEvento: d.tipoEvento,
    categoria: d.categoria || undefined,
    severidad: d.severidad || undefined,
    imputabilidad: d.imputabilidad || undefined,
    sintomas: d.sintomas?.trim() || undefined,
    acciones: d.acciones?.trim() || undefined,
    velocidad: d.velocidad?.trim() || undefined,
    devolucion: prev?.devolucion ?? (d.devolucion?.devuelta
      ? { devuelta: true, motivo: d.devolucion.motivo.trim(), fecha: ahora, por: String(s.name ?? 'Operador') } : undefined),
  } as RegistroHV;
  escribirDemo(prev ? lista.map((x) => (x.id === r.id ? r : x)) : [r, ...lista]);
  return r;
}

// ------------------------------------------------------------------ API
/** true si la base todavía no tiene las funciones de hemovigilancia (falta aplicar la migración). */
const sinFuncion = (e: { code?: string; message?: string }) => e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? '');
export class HVNoDisponible extends Error {}

export interface ListaHV { registros: RegistroHV[]; pendientes: PendienteHV[] }

export async function listarHV(o: { desde?: string; hasta?: string; red?: boolean } = {}): Promise<ListaHV> {
  if (!usaSupabase()) {
    seedHVDemo(); // los ejemplos existen aunque se entre primero por Avisos o Trazabilidad
    const registros = leerDemo().filter((r) => (!o.desde || r.registrado.slice(0, 10) >= o.desde) && (!o.hasta || r.registrado.slice(0, 10) <= o.hasta));
    return { registros, pendientes: pendientesDemo(leerDemo()) };
  }
  const { data, error } = await sb()!.rpc('blud_hemovigilancia', { p_desde: o.desde || null, p_hasta: o.hasta || null, p_red: !!o.red });
  if (error) {
    if (sinFuncion(error)) throw new HVNoDisponible('El registro de hemovigilancia aún no está activo en el servidor.');
    throw new Error(error.message || 'No pudimos cargar la hemovigilancia.');
  }
  const r = (data ?? {}) as Partial<ListaHV>;
  return { registros: r.registros ?? [], pendientes: r.pendientes ?? [] };
}

export async function guardarHV(d: DatosHV): Promise<RegistroHV> {
  const motivo = validarHV(d);
  if (motivo) throw new Error(motivo);
  if (!usaSupabase()) return guardarDemo(d);
  const { data, error } = await sb()!.rpc('blud_registrar_hemovigilancia', { p: { ...d, volumenMl: d.volumenMl === '' ? null : d.volumenMl } });
  if (error) {
    if (sinFuncion(error)) throw new HVNoDisponible('El registro de hemovigilancia aún no está activo en el servidor.');
    throw new Error(error.message || 'No pudimos guardar el registro.');
  }
  return data as RegistroHV;
}

/** RF-H4: la dirección notifica un evento adverso al comité de hemovigilancia. */
export async function notificarComite(r: RegistroHV, nota: string): Promise<RegistroHV> {
  if (nota.trim().length < 10) throw new Error('Escribe a quién y cómo se notificó (mínimo 10 caracteres).');
  if (!r.tipoEvento || r.tipoEvento === 'sin_reaccion') throw new Error('Solo se notifican reacciones adversas e incidentes.');
  if (r.comite) throw new Error('Ese evento ya se notificó al comité.');
  if (!usaSupabase()) {
    const s = (getSession() ?? {}) as Record<string, unknown>;
    const nuevo: RegistroHV = { ...r, comite: { fecha: new Date().toISOString(), por: String(s.name ?? 'Dirección'), nota: nota.trim() } };
    escribirDemo(leerDemo().map((x) => (x.id === r.id ? nuevo : x)));
    return nuevo;
  }
  const { data, error } = await sb()!.rpc('blud_hv_notificar_comite', { p_folio: r.id, p_nota: nota.trim() });
  if (error) throw new Error(sinFuncion(error) ? 'La notificación al comité todavía no está habilitada en el servidor.' : error.message);
  return data as RegistroHV;
}

/** RF-H6: bolsas devueltas que el laboratorio todavía no recibe. */
export async function devolucionesPendientes(): Promise<RegistroHV[]> {
  if (!usaSupabase()) { seedHVDemo(); return leerDemo().filter((r) => r.devolucion && !r.devolucion.recibidaEn); }
  const { data, error } = await sb()!.rpc('blud_hv_devoluciones');
  if (error) {
    if (sinFuncion(error)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as RegistroHV[];
}

/** RF-H6: el laboratorio confirma que recibió la bolsa devuelta. */
export async function recibirDevolucion(r: RegistroHV, nota = ''): Promise<RegistroHV> {
  if (!usaSupabase()) {
    const s = (getSession() ?? {}) as Record<string, unknown>;
    const nuevo: RegistroHV = { ...r, devolucion: { ...r.devolucion!, recibidaEn: new Date().toISOString(), recibidaPor: String(s.name ?? 'Laboratorio'), notaRecepcion: nota.trim() || undefined } };
    escribirDemo(leerDemo().map((x) => (x.id === r.id ? nuevo : x)));
    return nuevo;
  }
  const { data, error } = await sb()!.rpc('blud_hv_recibir_devolucion', { p_folio: r.id, p_nota: nota.trim() || null });
  if (error) throw new Error(error.message);
  return data as RegistroHV;
}

// ------------------------------------------------------------------ Formato
export function fmtHora(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
}
export function fmtFechaHora(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short', year: 'numeric' })} · ${fmtHora(iso)}`;
}
/** Minutos de infusión (o null si falta una hora). */
export function duracionMin(r: Pick<RegistroHV, 'inicio' | 'fin'>): number | null {
  if (!r.inicio || !r.fin) return null;
  const m = Math.round((new Date(r.fin).getTime() - new Date(r.inicio).getTime()) / 60000);
  return m >= 0 ? m : null;
}
export const signosTexto = (s?: Signos) =>
  s ? [s.pa && `PA ${s.pa}`, s.fc && `FC ${s.fc}`, s.temp && `T ${s.temp} °C`, s.fr && `FR ${s.fr}`, s.spo2 && `SpO2 ${s.spo2} %`].filter(Boolean).join(' · ') || '—' : '—';

/** Datos de ejemplo para el modo demo: un registro cerrado sin reacción y uno con reacción leve en curso. */
export function seedHVDemo() {
  if (usaSupabase() || leerDemo().length) return;
  const pend = pendientesDemo([]);
  if (!pend.length) return;
  const ver: Verificacion = { identidad: true, grupo: true, etiqueta: true, consentimiento: true, ordenMedica: true, segundoVerificador: 'Lcda. Ana Rivas' };
  const hace = (h: number) => new Date(Date.now() - h * 3600000).toISOString();
  const b = pend[0];
  const a = pend[1];
  escribirDemo([
    {
      id: `HV-${hace(0).slice(0, 4)}-0002`, estado: 'en_curso' as const, solicitudId: b.solicitudId, unidadId: b.unidadId, unidadCodigo: b.unidadCodigo,
      componente: b.componente, tipoSangre: b.tipoSangre, paciente: b.paciente, ubicacion: 'Medicina interna, cama 12', medico: 'Dr. Luis Fernández',
      sede: { nombre: 'Banco de Sangre del Zulia' }, registradoPor: 'Operador de ejemplo', registrado: hace(1), actualizado: hace(0.5),
      verificacion: ver, signos: { antes: { pa: '118/76', fc: '82', temp: '36.7' }, durante: { pa: '120/80', fc: '96', temp: '37.9' } },
      inicio: hace(1), tipoEvento: 'reaccion' as const, categoria: 'Febril no hemolítica', severidad: 'Leve', imputabilidad: 'Probable',
      sintomas: 'Escalofríos y alza térmica de 1,2 °C a los 25 minutos.', acciones: 'Infusión detenida, vía permeable con solución salina, antipirético indicado por el médico.',
    },
    ...(!a ? [] : [{
      id: `HV-${hace(0).slice(0, 4)}-0001`, estado: 'cerrado' as const, solicitudId: a.solicitudId, unidadId: a.unidadId, unidadCodigo: a.unidadCodigo,
      componente: a.componente, tipoSangre: a.tipoSangre, paciente: a.paciente, ubicacion: 'Cirugía, cama 4', medico: 'Dra. Carmen Silva',
      sede: { nombre: 'Banco de Sangre del Zulia' }, registradoPor: 'Operador de ejemplo', registrado: hace(28), actualizado: hace(25),
      verificacion: ver, signos: { antes: { pa: '110/70', fc: '78', temp: '36.5' }, durante: { pa: '112/72', fc: '80', temp: '36.6' }, despues: { pa: '115/74', fc: '76', temp: '36.6' } },
      inicio: hace(28), fin: hace(25.5), volumenMl: 280, tipoEvento: 'sin_reaccion' as const,
    }]),
  ]);
}
