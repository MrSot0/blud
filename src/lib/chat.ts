// src/lib/chat.ts
// Chat en tiempo real entre el personal (operador, soporte, dirección, laboratorio) y el donante.
//
// Protocolo: Supabase Realtime sobre WebSocket (wss://<proyecto>.supabase.co/realtime/v1), con canales
// Broadcast privados. Los mensajes se guardan en Postgres (chat_conversacion, chat_mensaje) mediante las
// funciones blud_chat_*; al guardar uno, la base lo emite (realtime.send) y el servidor lo empuja por el
// WebSocket solo a quien la política de realtime.messages (blud_chat_canal_ok) autoriza:
//   chat:<conversación>        mensajes y cambios de estado de una conversación
//   buzon:donante:<id>         avisos para el donante (id numérico del donante)
//   buzon:personal             avisos para el personal
// Nada del chat se guarda en el navegador: sin conexión con el servidor, el chat no está disponible.

import { getSession } from './auth';
import { sb, usaSupabase } from './supabase';

export type AutorTipo = 'donante' | 'personal';
export type Motivo = 'general' | 'contacto_laboratorio' | 'cita' | 'verificacion';

export interface Mensaje {
  id: number | string;
  conversacion: string;
  autorTipo: AutorTipo;
  autorNombre: string;
  autorRol?: string | null;
  texto: string;
  creado: string;
}

export interface Conversacion {
  id: string;
  asunto: string;
  motivo: Motivo;
  estado: 'abierta' | 'cerrada';
  creada: string;
  actualizada: string;
  donante?: { id: string; nombre: string; sangre?: string; foto?: string };
  creadaPor?: string;
  ultimo?: { texto: string; autorTipo: AutorTipo; creado: string };
  noLeidos?: number;
}

export const MOTIVOS: Record<Motivo, string> = {
  general: 'Consulta general',
  cita: 'Sobre una cita',
  verificacion: 'Verificación de identidad',
  contacto_laboratorio: 'El banco de sangre necesita hablar contigo',
};

export const ROL_LABEL: Record<string, string> = {
  operador: 'Operador',
  soporte: 'Soporte',
  director: 'Dirección',
  laboratorio: 'Laboratorio',
};

/** true si el chat puede usarse (hay conexión configurada con el servidor). */
export const chatDisponible = () => usaSupabase();

const SIN_SERVIDOR = 'El chat necesita conexión con el servidor del banco de sangre.';

function cliente() {
  const c = sb();
  if (!c) throw new Error(SIN_SERVIDOR);
  return c;
}
const err = (e: { message?: string } | null) => new Error(e?.message || 'No pudimos conectar con el servidor.');

const esPersonal = () => {
  const r = getSession()?.role;
  return r === 'operador' || r === 'soporte' || r === 'director' || r === 'laboratorio';
};

// ------------------------------------------------------------------ Consultas (RPC sobre HTTPS)
/** Conversaciones visibles para quien inició sesión (el donante: las suyas; el personal: todas). */
export async function listarConversaciones(): Promise<Conversacion[]> {
  const { data, error } = await cliente().rpc('blud_chat_conversaciones');
  if (error) throw err(error);
  return (data ?? []) as Conversacion[];
}

/** Mensajes de una conversación (y la marca como leída). */
export async function abrirConversacion(id: string): Promise<{ conversacion: Conversacion; mensajes: Mensaje[] }> {
  const { data, error } = await cliente().rpc('blud_chat_mensajes', { p_conv: id });
  if (error) throw err(error);
  return data as { conversacion: Conversacion; mensajes: Mensaje[] };
}

export async function enviarMensaje(id: string, texto: string): Promise<Mensaje> {
  const t = texto.trim();
  if (!t) throw new Error('Escribe un mensaje.');
  const { data, error } = await cliente().rpc('blud_chat_enviar', { p_conv: id, p_texto: t });
  if (error) throw err(error);
  return data as Mensaje;
}

/** El personal abre (o retoma) la conversación abierta con un donante. `donante`: ID del carnet o cédula. */
export async function iniciarConversacion(donante: string, asunto: string, motivo: Motivo = 'general'): Promise<Conversacion> {
  const { data, error } = await cliente().rpc('blud_chat_abrir', { p_donante: donante, p_asunto: asunto, p_motivo: motivo });
  if (error) throw err(error);
  return data as Conversacion;
}

export async function cambiarEstado(id: string, abrir: boolean): Promise<void> {
  const { error } = await cliente().rpc('blud_chat_cerrar', { p_conv: id, p_abrir: abrir });
  if (error) throw err(error);
}

/** Deja constancia de que el personal contactó al donante (RF-D10). */
export async function registrarContacto(donante: string, medio = 'chat'): Promise<void> {
  const { error } = await cliente().rpc('blud_registrar_contacto', { p_donante: donante, p_medio: medio });
  if (error) throw err(error);
}

export const totalNoLeidos = async () =>
  chatDisponible() ? (await listarConversaciones()).reduce((n, c) => n + (c.noLeidos ?? 0), 0) : 0;

// ------------------------------------------------------------------ Tiempo real (WebSocket)
export type EstadoConexion = 'conectando' | 'conectado' | 'desconectado';
type Escucha = {
  alMensaje?: (m: Mensaje) => void;
  alNovedad?: () => void;
  alEstado?: (estado: string) => void;
  alConexion?: (e: EstadoConexion) => void;
};

/**
 * Se suscribe a un canal Broadcast privado por el WebSocket de Supabase Realtime.
 * Devuelve la función para dejar de escuchar. El cliente reconecta solo si se cae la conexión.
 */
export function escuchar(canal: string, h: Escucha): () => void {
  const c = sb();
  if (!c) {
    h.alConexion?.('desconectado');
    return () => {};
  }
  let ch: ReturnType<typeof c.channel> | null = null;
  let cerrado = false;
  h.alConexion?.('conectando');
  (async () => {
    await c.realtime.setAuth(); // el token de la sesión autoriza el canal privado
    if (cerrado) return;
    ch = c.channel(canal, { config: { private: true } })
      .on('broadcast', { event: 'mensaje' }, ({ payload }) => h.alMensaje?.(payload as Mensaje))
      .on('broadcast', { event: 'novedad' }, () => h.alNovedad?.())
      .on('broadcast', { event: 'estado' }, ({ payload }) => h.alEstado?.(String((payload as { estado?: string }).estado)))
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') h.alConexion?.('conectado');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') h.alConexion?.('desconectado');
      });
  })();
  return () => {
    cerrado = true;
    if (ch) c.removeChannel(ch);
  };
}

/** Canal del buzón de quien inició sesión. `donanteId`: BLD-000123 (solo donante). */
export function canalBuzon(donanteId?: string): string | null {
  if (esPersonal()) return 'buzon:personal';
  const n = donanteId?.match(/^BLD-(\d+)$/)?.[1];
  return n ? `buzon:donante:${Number(n)}` : null;
}
