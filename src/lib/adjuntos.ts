// src/lib/adjuntos.ts
// RF-TR1 y RF-H2: documentos de la solicitud de transfusión (orden médica, consentimiento informado e historia
// clínica). Con base real se suben al bucket privado documentos-clinicos y se ven con un enlace firmado de 5 minutos
// (migración 20261127180000). La base exige la orden y el consentimiento para despachar, salvo en una emergencia.
// En modo demo solo se guardan el nombre y el tipo del archivo en el navegador.

import { rpc } from './rpc';
import { sb, usaSupabase } from './supabase';

export { NoDisponible, MENSAJE_NO_DISPONIBLE } from './rpc';

export type TipoAdjunto = 'orden' | 'consentimiento' | 'historia' | 'otro';
export const TIPOS_ADJUNTO: { id: TipoAdjunto; label: string; obligatorio: boolean }[] = [
  { id: 'orden', label: 'Orden médica', obligatorio: true },
  { id: 'consentimiento', label: 'Consentimiento informado', obligatorio: true },
  { id: 'historia', label: 'Historia clínica', obligatorio: false },
  { id: 'otro', label: 'Otro documento', obligatorio: false },
];
export interface Adjunto { id: number | string; tipo: TipoAdjunto; ruta?: string; nombre: string; mime?: string; bytes?: number; fecha: string; subidoPor?: string }

export const MAX_BYTES = 10 * 1024 * 1024;
export const MIMES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

/** Normaliza el id local o REQ-… a la clave que devuelve la base. */
const clave = (id: string) => (/^REQ-\d+$/.test(id) ? 'REQ-' + id.slice(4).padStart(6, '0') : id);

export function validarArchivo(f: File): string | null {
  if (!MIMES.includes(f.type)) return 'Sube un PDF o una foto (JPG, PNG o WebP).';
  if (f.size > MAX_BYTES) return 'El archivo pesa más de 10 MB.';
  return null;
}

/** Documentos obligatorios que faltan (vacío si está completo). */
export const faltantes = (l: Adjunto[] = []) =>
  TIPOS_ADJUNTO.filter((t) => t.obligatorio && !l.some((a) => a.tipo === t.id)).map((t) => t.label);

// ------------------------------------------------------------------ Modo demo
const KEY = 'blud-demo-adjuntos';
const leer = (): Record<string, Adjunto[]> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

// ------------------------------------------------------------------ API
export async function adjuntosDe(ids: string[]): Promise<Map<string, Adjunto[]>> {
  if (!ids.length) return new Map();
  if (!usaSupabase()) { const d = leer(); return new Map(ids.map((id) => [id, d[id] ?? []])); }
  const r = (await rpc<Record<string, Adjunto[]>>('blud_adjuntos', { p_solicitudes: ids.map(clave) })) ?? {};
  return new Map(ids.map((id) => [id, r[clave(id)] ?? []]));
}

export async function subirAdjunto(solicitud: string, tipo: TipoAdjunto, f: File): Promise<Adjunto> {
  const e = validarArchivo(f);
  if (e) throw new Error(e);
  if (!usaSupabase()) {
    const d = leer();
    const a: Adjunto = { id: Date.now(), tipo, nombre: f.name, mime: f.type, bytes: f.size, fecha: new Date().toISOString(), subidoPor: 'Modo demo' };
    d[solicitud] = [...(d[solicitud] ?? []), a];
    try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {}
    return a;
  }
  const carpeta = await rpc<string>('blud_adjunto_carpeta', { p_solicitud: clave(solicitud) });
  const ext = f.type === 'application/pdf' ? 'pdf' : f.type.split('/')[1].replace('jpeg', 'jpg');
  const ruta = `${carpeta}${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb()!.storage.from('documentos-clinicos').upload(ruta, f, { contentType: f.type, upsert: false });
  if (error) throw new Error(/row-level security|not authorized|403/i.test(error.message) ? 'No tienes permiso para subir documentos a esa solicitud.' : 'No se pudo subir el archivo. Revisa la conexión e inténtalo de nuevo.');
  return rpc<Adjunto>('blud_adjunto_registrar', { p_solicitud: clave(solicitud), p_tipo: tipo, p_ruta: ruta, p_nombre: f.name });
}

/** Enlace temporal (5 min) para abrir el documento. En modo demo no hay archivo. */
export async function enlaceAdjunto(a: Adjunto): Promise<string | null> {
  if (!usaSupabase() || !a.ruta) return null;
  const { data, error } = await sb()!.storage.from('documentos-clinicos').createSignedUrl(a.ruta, 300);
  if (error || !data) throw new Error('No se pudo abrir el documento.');
  return data.signedUrl;
}

export const tamano = (b?: number) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
