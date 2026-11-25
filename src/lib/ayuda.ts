// src/lib/ayuda.ts
// Ayuda del personal: guía corta por rol y «Reportar un problema» a soporte (administrador técnico).
// El reporte es un ticket como el del donante, marcado con donanteId = 'personal:<rol>', así soporte lo atiende
// en la misma bandeja. Con base real, private.g_ticket acepta estos roles desde la migración 20261125120000.

import { codigoTicket, tickets } from './db';
import type { MensajeTicket, Ticket } from './db';
import { getSession } from './auth';
import type { Role } from './roles';
import { uid } from './ui';

export type RolPersonal = 'operador' | 'laboratorio' | 'director';

export const ROL_LABEL: Record<string, string> = {
  operador: 'Operador', laboratorio: 'Laboratorio', director: 'Dirección', soporte: 'Soporte',
};

export const ASUNTOS_PERSONAL = [
  'No puedo entrar a mi cuenta', 'Un dato quedó mal registrado', 'La pantalla da un error', 'Un permiso que necesito',
  'El escáner o la cámara no funciona', 'Sugerencia', 'Otro',
] as const;

/** Ticket hecho por alguien del personal (no por un donante). */
export const esDelPersonal = (t: Pick<Ticket, 'donanteId'>) => t.donanteId.startsWith('personal:');
export const rolDelReporte = (t: Pick<Ticket, 'donanteId'>) => ROL_LABEL[t.donanteId.split(':')[1] ?? ''] ?? 'Personal';

export interface Pregunta { p: string; r: string; enlace?: { texto: string; href: string } }

/** Guía por rol. Edita o añade preguntas aquí. */
export const GUIA: Record<RolPersonal, Pregunta[]> = {
  operador: [
    { p: '¿Cómo atiendo a un donante que llegó a su cita?', r: 'En Citas del centro marca «Llegó» y luego «Atender». La ficha abre la evaluación médica; al guardar la donación la cita se cierra sola como Atendida.', enlace: { texto: 'Citas del centro', href: '/operador/citas' } },
    { p: 'El donante no tiene cita, ¿lo puedo atender?', r: 'Sí. Búscalo por cédula o escanea su QR en Donantes y registra la donación desde su ficha. Si no tiene cuenta, regístralo ahí mismo.', enlace: { texto: 'Donantes', href: '/operador/donantes' } },
    { p: '¿Por qué una solicitud de transfusión no se puede despachar?', r: 'Falta el tipaje de la muestra del paciente o una prueba cruzada compatible. En Despachos cada tarjeta dice qué falta; el laboratorio lo registra en Compatibilidad.', enlace: { texto: 'Despachos', href: '/operador/entregas' } },
    { p: 'Mi sede no tiene stock para una transfusión, ¿qué hago?', r: 'La solicitud queda «En espera de stock». Reintenta la reserva cuando entren unidades o avisa a tu dirección para que las pida a otro centro.' },
    { p: '¿Cuándo registro la hemovigilancia?', r: 'En cada unidad despachada: antes de iniciar haz la doble verificación en cabecera, toma signos antes, a los 15 minutos y al terminar, y cierra el registro indicando si hubo reacción.', enlace: { texto: 'Hemovigilancia', href: '/operador/hemovigilancia' } },
  ],
  laboratorio: [
    { p: '¿Qué pasa con una bolsa reactiva?', r: 'Al registrar las pruebas con un resultado reactivo la bolsa queda descartada y se abre un caso positivo. Notifícalo al ente de salud desde Casos positivos.', enlace: { texto: 'Casos positivos', href: '/laboratorio/positivos' } },
    { p: '¿Cuándo puedo fraccionar una donación?', r: 'Cuando el tamizaje sale negativo la bolsa queda liberada y aparece en Fraccionamiento.', enlace: { texto: 'Fraccionamiento', href: '/laboratorio/fraccionamiento' } },
    { p: 'Una prueba cruzada salió incompatible, ¿qué hago?', r: 'Usa «Cambiar unidad» en Compatibilidad: se libera la bolsa incompatible, se reserva otra del stock y repites la cruzada. La incompatibilidad queda en la bitácora.', enlace: { texto: 'Compatibilidad', href: '/laboratorio/compatibilidad' } },
    { p: '¿Cómo contacto al donante de un caso positivo?', r: 'El contacto lo hace el operador del centro por el chat o en persona. En el caso queda la marca de contacto pendiente hasta que se registre.' },
  ],
  director: [
    { p: '¿Qué apruebo como dirección?', r: 'Solo los pedidos de hemocomponentes que otro centro le hace al tuyo. Las transfusiones de tu hospital las registra el operador sin pasar por ti.', enlace: { texto: 'Solicitudes entre centros', href: '/director/solicitudes/historial' } },
    { p: 'Necesito bolsas que mi sede no tiene', r: 'En Solicitudes entre centros crea un pedido a otro centro. Su dirección lo aprueba, su operador lo despacha y tu operador confirma la recepción.' },
    { p: '¿Cómo activo o desactivo una cuenta del personal?', r: 'En Personal abre la cuenta y usa «Desactivar». La persona no podrá entrar hasta que la actives de nuevo; su historial se conserva.', enlace: { texto: 'Personal', href: '/director/operadores' } },
    { p: '¿Dónde veo quién hizo un cambio?', r: 'En Bitácora: cada despacho, reserva, rechazo, notificación y registro de hemovigilancia queda con la persona, la sede y la hora.', enlace: { texto: 'Bitácora', href: '/director/bitacora' } },
  ],
};

const ahora = () => new Date().toISOString();
type Resultado<T> = { ok: true; data: T } | { ok: false; motivo: string };

function yo() {
  const s = getSession();
  return { email: String(s?.email ?? '').toLowerCase(), nombre: String(s?.name ?? 'Personal'), rol: (s?.role ?? 'operador') as Role };
}

/** Reportes de esta persona (los que creó con su correo). */
export const misReportes = () => {
  const { email } = yo();
  return tickets.all().filter((t) => t.donanteEmail.toLowerCase() === email && esDelPersonal(t))
    .sort((a, b) => b.actualizado.localeCompare(a.actualizado));
};

export function reportarProblema(i: { asunto: string; mensaje: string; pantalla?: string }): Resultado<Ticket> {
  const texto = i.mensaje.trim();
  if (!i.asunto) return { ok: false, motivo: 'Elige de qué se trata.' };
  if (texto.length < 15) return { ok: false, motivo: 'Cuéntanos qué pasó con un poco más de detalle (mínimo 15 caracteres).' };
  const p = yo();
  const id = 'tk-' + uid();
  const cuerpo = i.pantalla?.trim() ? `${texto}\n\nPantalla: ${i.pantalla.trim()}` : texto;
  const t = tickets.upsert({
    id, codigo: codigoTicket(id), donanteId: `personal:${p.rol}`, donanteNombre: `${p.nombre} · ${ROL_LABEL[p.rol] ?? 'Personal'}`,
    donanteEmail: p.email, asunto: i.asunto, estado: 'abierto', prioridad: 'normal',
    creado: ahora(), actualizado: ahora(),
    mensajes: [{ id: uid(), autor: 'donante', nombre: p.nombre, texto: cuerpo, fecha: ahora() }],
  });
  return { ok: true, data: t };
}

export function responderReporte(id: string, texto: string): Resultado<Ticket> {
  const t = tickets.get(id);
  if (!t) return { ok: false, motivo: 'No encontramos el reporte.' };
  if (texto.trim().length < 2) return { ok: false, motivo: 'Escribe tu mensaje.' };
  const m: MensajeTicket = { id: uid(), autor: 'donante', nombre: yo().nombre, texto: texto.trim(), fecha: ahora() };
  return {
    ok: true,
    data: tickets.upsert({ ...t, mensajes: [...t.mensajes, m], actualizado: ahora(), estado: t.estado === 'resuelto' ? 'abierto' : t.estado, resueltoEn: undefined }),
  };
}
