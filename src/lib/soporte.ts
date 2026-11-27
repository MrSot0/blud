// src/lib/soporte.ts
// Lógica del módulo de soporte: solicitudes (tickets) de los donantes, respuestas y consulta de donantes.
//
// Flujo: el donante escribe desde /donante/soporte → se crea una solicitud "abierta" → soporte la toma
// ("en proceso"), responde y la resuelve → el donante ve la respuesta en su propia pantalla.
//
// PRIVACIDAD: soporte ve datos de contacto y de cuenta, pero NUNCA resultados de laboratorio ni motivos de
// diferimiento. Por eso aquí no se importa nada del laboratorio. En producción: permisos por rol en el servidor.

import { buscarRegistro, codigoTicket, donaciones, normCedula, onDb, registro, ticketNotas, tickets } from './db';
import type { EstadoTicket, MensajeTicket, RegistroDonante, Ticket } from './db';
import { operadorActual } from './operador';
import { seedDemo } from './demo';
import { hoyISO, uid } from './ui';

export { onDb, codigoTicket };
export { uid, toast, esc, fmtFecha, hoyISO } from './ui';
export type { EstadoTicket, MensajeTicket, RegistroDonante, Ticket };

export type Resultado<T> = { ok: true; data: T } | { ok: false; motivo: string };
const fail = (motivo: string): { ok: false; motivo: string } => ({ ok: false, motivo });

export const ASUNTOS = ['Mi cita', 'Mi carnet o mi QR', 'Verificación de identidad', 'Mis datos', 'Otro'] as const;

export const ESTADO_LABEL: Record<EstadoTicket, string> = {
  abierto: 'Abierto',
  en_proceso: 'En proceso',
  resuelto: 'Resuelto',
};

/** Respuestas rápidas del personal. Edita o añade las tuyas: se ofrecen en el formulario de respuesta. */
export const RESPUESTAS_RAPIDAS: { titulo: string; texto: string }[] = [
  { titulo: 'Cambiar o cancelar la cita', texto: 'Hola, puedes cambiar o cancelar tu cita desde "Mi historial" con los botones Cambiar o Cancelar de tu próxima cita. Si no te aparece, dinos tu cédula y lo hacemos por ti.' },
  { titulo: 'Verificación de identidad', texto: 'Hola, la verificación se completa cuando un operador del centro confirma tu cédula física. Lleva tu cédula el día de tu cita y quedará verificada en el momento.' },
  { titulo: 'Corregir datos con cédula verificada', texto: 'Hola, como tu cédula ya fue verificada no puedes cambiarla desde la app. Envíanos una foto legible de tu cédula con el dato correcto y lo actualizamos.' },
  { titulo: 'Carnet o QR no carga', texto: 'Hola, prueba cerrar sesión y volver a entrar; tu carnet se vuelve a generar al abrir "Mi perfil". Si sigue sin aparecer, cuéntanos qué dispositivo y navegador usas.' },
  { titulo: 'Cierre amable', texto: 'Quedamos atentos por si necesitas algo más. Gracias por donar.' },
];

export const soporteActual = operadorActual;

const ahora = () => new Date().toISOString();
const masReciente = (a: Ticket, b: Ticket) => b.actualizado.localeCompare(a.actualizado);

/** "11 oct · 14:05" */
export function fmtFechaHora(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}

// ------------------------------------------------------------------ Lectura
export const getTickets = () => tickets.all().sort(masReciente);
/** Notas internas del ticket (las antiguas guardadas dentro del ticket y las nuevas, aparte). */
export const notasDe = (id: string) => [...(tickets.get(id)?.notas ?? []), ...(ticketNotas.get(id)?.notas ?? [])];
/** Ticket con sus notas internas: solo para el personal de soporte. */
export const getTicket = (id: string) => {
  const t = tickets.get(id);
  return t ? { ...t, notas: notasDe(id) } : undefined;
};
export const ticketsDeDonante = (donanteId: string) => getTickets().filter((t) => t.donanteId === donanteId);

/** Primero lo urgente y sin atender; dentro de cada grupo, lo más reciente. */
const prioridadOrden = (t: Ticket) => (t.estado === 'resuelto' ? 3 : t.prioridad === 'alta' ? 0 : t.asignadoA ? 2 : 1);
export const bandeja = () =>
  getTickets().filter((t) => t.estado !== 'resuelto').sort((a, b) => prioridadOrden(a) - prioridadOrden(b) || masReciente(a, b));
export const misCasos = () => {
  const yo = soporteActual().id;
  return getTickets().filter((t) => t.asignadoA?.id === yo && t.estado !== 'resuelto');
};
export const resueltos = () => getTickets().filter((t) => t.estado === 'resuelto');

export function kpisSoporte() {
  const all = tickets.all();
  const yo = soporteActual().id;
  const abiertos = all.filter((t) => t.estado !== 'resuelto');
  const hoy = hoyISO();
  return {
    sinResolver: abiertos.length,
    sinAsignar: abiertos.filter((t) => !t.asignadoA).length,
    urgentes: abiertos.filter((t) => t.prioridad === 'alta').length,
    mios: abiertos.filter((t) => t.asignadoA?.id === yo).length,
    resueltosHoy: all.filter((t) => t.estado === 'resuelto' && (t.resueltoEn ?? '').slice(0, 10) === hoy).length,
  };
}

// ------------------------------------------------------------------ Donante: crear y responder
export function crearTicket(i: { donanteId: string; nombre: string; email: string; asunto: string; mensaje: string }): Resultado<Ticket> {
  const mensaje = i.mensaje.trim();
  if (mensaje.length < 10) return fail('Cuéntanos un poco más (mínimo 10 caracteres).');
  const id = 'tk-' + uid();
  const t = tickets.upsert({
    id,
    codigo: codigoTicket(id),
    donanteId: i.donanteId,
    donanteNombre: i.nombre.trim() || 'Donante',
    donanteEmail: i.email,
    asunto: i.asunto,
    estado: 'abierto',
    prioridad: 'normal',
    creado: ahora(),
    actualizado: ahora(),
    mensajes: [{ id: uid(), autor: 'donante', nombre: i.nombre.trim() || 'Donante', texto: mensaje, fecha: ahora() }],
  });
  return { ok: true, data: t };
}

/** El donante escribe en su solicitud. Si estaba resuelta, se reabre. */
export function responderComoDonante(ticketId: string, texto: string, nombre: string): Resultado<Ticket> {
  const t = tickets.get(ticketId);
  if (!t) return fail('No encontramos la solicitud.');
  if (texto.trim().length < 2) return fail('Escribe tu mensaje.');
  const m: MensajeTicket = { id: uid(), autor: 'donante', nombre, texto: texto.trim(), fecha: ahora() };
  return {
    ok: true,
    data: tickets.upsert({ ...t, mensajes: [...t.mensajes, m], actualizado: ahora(), estado: t.estado === 'resuelto' ? 'abierto' : t.estado, resueltoEn: undefined }),
  };
}

// ------------------------------------------------------------------ Personal de soporte
export function tomarCaso(ticketId: string): Resultado<Ticket> {
  const t = tickets.get(ticketId);
  if (!t) return fail('No encontramos la solicitud.');
  const yo = soporteActual();
  return { ok: true, data: tickets.upsert({ ...t, asignadoA: { id: yo.id, nombre: yo.nombre }, estado: t.estado === 'abierto' ? 'en_proceso' : t.estado, actualizado: ahora() }) };
}

export function soltarCaso(ticketId: string): Resultado<Ticket> {
  const t = tickets.get(ticketId);
  if (!t) return fail('No encontramos la solicitud.');
  return { ok: true, data: tickets.upsert({ ...t, asignadoA: undefined, estado: t.estado === 'en_proceso' ? 'abierto' : t.estado, actualizado: ahora() }) };
}

/** Responde al donante. Si nadie tenía el caso, lo toma; si estaba abierto, pasa a "en proceso". */
export function responderComoSoporte(ticketId: string, texto: string, resolver = false): Resultado<Ticket> {
  const t = tickets.get(ticketId);
  if (!t) return fail('No encontramos la solicitud.');
  const limpio = texto.trim();
  if (limpio.length < 2) return fail('Escribe una respuesta antes de enviar.');
  const yo = soporteActual();
  const m: MensajeTicket = { id: uid(), autor: 'soporte', nombre: yo.nombre, texto: limpio, fecha: ahora() };
  return {
    ok: true,
    data: tickets.upsert({
      ...t,
      mensajes: [...t.mensajes, m],
      asignadoA: t.asignadoA ?? { id: yo.id, nombre: yo.nombre },
      estado: resolver ? 'resuelto' : 'en_proceso',
      resueltoEn: resolver ? ahora() : undefined,
      actualizado: ahora(),
    }),
  };
}

export function cambiarEstado(ticketId: string, estado: EstadoTicket): Resultado<Ticket> {
  const t = tickets.get(ticketId);
  if (!t) return fail('No encontramos la solicitud.');
  return { ok: true, data: tickets.upsert({ ...t, estado, resueltoEn: estado === 'resuelto' ? ahora() : undefined, actualizado: ahora() }) };
}

export function marcarUrgente(ticketId: string, alta: boolean): Resultado<Ticket> {
  const t = tickets.get(ticketId);
  if (!t) return fail('No encontramos la solicitud.');
  return { ok: true, data: tickets.upsert({ ...t, prioridad: alta ? 'alta' : 'normal', actualizado: ahora() }) };
}

export function agregarNota(ticketId: string, texto: string): Resultado<Ticket> {
  const t = tickets.get(ticketId);
  if (!t) return fail('No encontramos la solicitud.');
  if (texto.trim().length < 2) return fail('Escribe la nota.');
  const previas = ticketNotas.get(ticketId)?.notas ?? [];
  ticketNotas.upsert({ id: ticketId, notas: [...previas, { id: uid(), autor: soporteActual().nombre, texto: texto.trim(), fecha: ahora() }] });
  return { ok: true, data: getTicket(ticketId)! };
}

// ------------------------------------------------------------------ Consulta de donantes (solo lectura)
export interface FichaDonante {
  registro: RegistroDonante;
  donaciones: number;
  ultimaDonacion?: string;
  tickets: Ticket[];
}

/** Cédula, ID del carnet (BLD-XXXXXX), correo o contenido del QR. Devuelve solo datos de cuenta y contacto. */
export function consultarDonante(query: string): FichaDonante | undefined {
  const q = query.trim();
  if (!q) return undefined;
  let reg = buscarRegistro(q);
  if (!reg && q.includes('@')) reg = registro.find((r) => (r.email ?? '').toLowerCase() === q.toLowerCase());
  if (!reg) return undefined;
  const ced = normCedula(reg.cedula);
  const don = donaciones.all().filter((d) => d.donanteId === reg!.id || normCedula(d.donanteCedula) === ced);
  return {
    registro: reg,
    donaciones: don.length,
    ultimaDonacion: don.map((d) => d.fecha).sort().at(-1),
    tickets: ticketsDeDonante(reg.id),
  };
}

// ------------------------------------------------------------------ Datos de ejemplo
/** Un solo conjunto de datos de ejemplo para todos los roles (ver lib/demo). */
export const seedSoporteDemo = seedDemo;

// ------------------------------------------------------------------ RF-S4 · Tiempos de atención
/** Meta de primera respuesta (horas). */
export const META_PRIMERA_RESPUESTA_H = 24;

/** Minutos hasta la primera respuesta de soporte y hasta la resolución (null si aún no ocurre). */
export function tiemposTicket(t: Ticket): { primeraRespuesta: number | null; resolucion: number | null } {
  const inicio = new Date(t.creado).getTime();
  const primera = t.mensajes.find((m) => m.autor === 'soporte');
  const min = (iso?: string) => (iso ? Math.max(0, Math.round((new Date(iso).getTime() - inicio) / 60000)) : null);
  return { primeraRespuesta: min(primera?.fecha), resolucion: t.estado === 'resuelto' ? min(t.resueltoEn) : null };
}

/** «45 min», «3 h 10 min», «2 d 4 h». */
export function fmtDuracion(min: number | null): string {
  if (min === null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} h ${min % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

const mediana = (l: number[]) => {
  if (!l.length) return null;
  const s = [...l].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

/** Indicadores de los últimos `dias` días: medianas y cumplimiento de la meta de primera respuesta. */
export function tiemposSoporte(dias = 30) {
  const desde = Date.now() - dias * 86400000;
  const lista = tickets.all().filter((t) => new Date(t.creado).getTime() >= desde);
  const t = lista.map(tiemposTicket);
  const respondidas = t.map((x) => x.primeraRespuesta).filter((x): x is number => x !== null);
  const resueltas = t.map((x) => x.resolucion).filter((x): x is number => x !== null);
  const meta = META_PRIMERA_RESPUESTA_H * 60;
  const sinRespuesta = lista.filter((x, i) => t[i].primeraRespuesta === null && x.estado !== 'resuelto');
  return {
    total: lista.length,
    medianaPrimera: mediana(respondidas),
    medianaResolucion: mediana(resueltas),
    dentroDeMeta: respondidas.length ? Math.round((respondidas.filter((m) => m <= meta).length / respondidas.length) * 100) : null,
    sinRespuesta: sinRespuesta.length,
    vencidasSinRespuesta: sinRespuesta.filter((x) => Date.now() - new Date(x.creado).getTime() > meta * 60000).length,
  };
}
