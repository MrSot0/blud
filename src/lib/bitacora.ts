// src/lib/bitacora.ts
// Bitácora de auditoría (T9, I2, A4): quién hizo qué y cuándo. La dirección ve su sede; soporte, toda la red.
// Con base real: blud_bitacora() pagina por cursor (migración 20261125120000).
// En modo demo se arma con la actividad de ejemplo de todos los roles.

import { sb, usaSupabase } from './supabase';
import { actividadRed } from './director';
import { tickets } from './db';

export interface EntradaBitacora {
  id: string | number;
  fecha: string; // ISO o YYYY-MM-DD
  tabla: string;
  registro?: number | string;
  operacion: string;
  usuario?: string;
  correo?: string;
  sede?: string;
  detalle?: Record<string, unknown>;
}

export interface PaginaBitacora { items: EntradaBitacora[]; siguiente: string | null }

/** Filas por página. La base no acepta más de 100. */
export const POR_PAGINA = 25;
/** Letras mínimas para buscar (la base ignora búsquedas más cortas). */
export const MIN_BUSQUEDA = 3;

export interface FiltrosBitacora { q?: string; tabla?: string; desde?: string; hasta?: string }

/** Nombre legible de cada tabla o módulo. */
export const MODULO: Record<string, string> = {
  donante: 'Donantes',
  donacion: 'Donaciones',
  unidadsangre: 'Unidades',
  solicitudtransfusion: 'Transfusiones',
  prueba_serologica: 'Laboratorio',
  fraccionamiento: 'Fraccionamiento',
  pedido_entre_centros: 'Pedidos entre centros',
  hemo_vigilancia: 'Hemovigilancia',
  usuario: 'Cuentas',
  personalsalud: 'Personal',
  cita: 'Citas',
  ticket_soporte: 'Soporte',
  incidencia_tecnica: 'Incidencias',
  equipo_almacenamiento: 'Equipos',
  prueba_tipaje_muestra: 'Compatibilidad',
};
export const moduloDe = (t: string) => MODULO[t] ?? t.replace(/_/g, ' ');

/** Operaciones conocidas en lenguaje claro. Las demás se muestran tal cual, en minúsculas. */
const OPERACION: Record<string, string> = {
  INSERT: 'Creó', UPDATE: 'Modificó', DELETE: 'Eliminó',
  DESPACHO: 'Despachó', RESERVA: 'Reservó', RECHAZO: 'Rechazó o anuló', INCOMPATIBLE: 'Prueba cruzada incompatible',
  NOTIFICACION: 'Notificó un caso', CONTACTO_DONANTE: 'Contactó al donante',
  HEMOVIGILANCIA: 'Registró una transfusión', HEMOVIGILANCIA_EDICION: 'Actualizó una transfusión', HEMOVIGILANCIA_CIERRE: 'Cerró una transfusión',
  LOGIN: 'Inició sesión', LOGOUT: 'Cerró sesión',
  CUENTA_ACTIVADA: 'Activó una cuenta', CUENTA_DESACTIVADA: 'Desactivó una cuenta', CUENTA_ROL: 'Cambió rol o sede',
  CUENTA_2FA_QUITADA: 'Quitó la verificación en dos pasos', RESTABLECER_ACCESO: 'Envió restablecer acceso',
  INCIDENCIA_CREADA: 'Registró una incidencia', INCIDENCIA_EN_PROCESO: 'Tomó una incidencia', INCIDENCIA_RESUELTA: 'Resolvió una incidencia',
  INCIDENCIA_DESCARTADA: 'Descartó una incidencia', INCIDENCIA_ABIERTA: 'Reabrió una incidencia',
  CORRECCION_ESTADO: 'Corrigió un estado', EQUIPO_CREADO: 'Registró un equipo', EQUIPO_EDITADO: 'Editó un equipo',
  TEMPERATURA_FUERA_DE_RANGO: 'Temperatura fuera de rango', CONSULTA_TRAZABILIDAD: 'Consultó trazabilidad',
};
export const operacionDe = (o: string) => OPERACION[o] ?? (o.charAt(0) + o.slice(1).toLowerCase()).replace(/_/g, ' ');

/** Tono del punto según la operación. */
export function tonoOperacion(o: string): string {
  if (/RECHAZO|DELETE|INCOMPATIBLE|DESACTIVADA|FUERA_DE_RANGO|2FA/.test(o)) return 'bg-accent';
  if (/HEMOVIGILANCIA|NOTIFICACION|CORRECCION|INCIDENCIA|CUENTA_ROL|RESTABLECER/.test(o)) return 'bg-warn';
  if (/DESPACHO|RESERVA|INSERT/.test(o)) return 'bg-ok';
  return 'bg-ink-3';
}

const sinFuncion = (e: { code?: string; message?: string }) => e.code === 'PGRST202' || /could not find the function/i.test(e.message ?? '');
export class BitacoraNoDisponible extends Error {}

// ------------------------------------------------------------------ Modo demo
const TABLA_DEMO: Record<string, string> = {
  donacion: 'donacion', laboratorio: 'prueba_serologica', solicitud: 'solicitudtransfusion', entrega: 'solicitudtransfusion', donante: 'donante',
};
const OP_DEMO: Record<string, string> = { donacion: 'INSERT', laboratorio: 'UPDATE', solicitud: 'INSERT', entrega: 'DESPACHO', donante: 'UPDATE' };

function demo(): EntradaBitacora[] {
  const out: EntradaBitacora[] = actividadRed().map((e) => ({
    id: e.id, fecha: e.fecha, tabla: TABLA_DEMO[e.tipo] ?? e.tipo, operacion: OP_DEMO[e.tipo] ?? 'UPDATE',
    usuario: 'Personal de ejemplo', sede: 'Banco de Sangre del Zulia', detalle: { resumen: `${e.titulo} · ${e.detalle}` },
  }));
  tickets.all().forEach((t) => out.push({
    id: 't' + t.id, fecha: t.actualizado, tabla: 'ticket_soporte', operacion: t.estado === 'resuelto' ? 'UPDATE' : 'INSERT',
    usuario: t.asignadoA?.nombre ?? t.donanteNombre, sede: 'Banco de Sangre del Zulia', detalle: { resumen: `${t.codigo} · ${t.asunto}` },
  }));
  try {
    // Acciones administrativas de soporte en modo demo (lib/administracion y lib/equipos).
    (JSON.parse(localStorage.getItem('blud-demo-admin-log') || '[]') as EntradaBitacora[]).forEach((e) => out.push(e));
  } catch {}
  return out.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

// ------------------------------------------------------------------ API
/**
 * Una página de la bitácora. `cursor` es el id de la última entrada de la página anterior (null = primera).
 * Las páginas ya pedidas con los mismos filtros se reutilizan durante 60 s: volver atrás no consulta otra vez.
 */
const cache = new Map<string, { t: number; pagina: PaginaBitacora }>();
const normalizar = (f: FiltrosBitacora): FiltrosBitacora => ({
  q: (f.q?.trim().length ?? 0) >= MIN_BUSQUEDA ? f.q!.trim() : '', tabla: f.tabla || '', desde: f.desde || '', hasta: f.hasta || '',
});

export async function paginaBitacora(filtros: FiltrosBitacora, cursor: string | null, limite = POR_PAGINA): Promise<PaginaBitacora> {
  const f = normalizar(filtros);
  const clave = JSON.stringify([f, cursor, limite]);
  const enCache = cache.get(clave);
  if (enCache && Date.now() - enCache.t < 60000) return enCache.pagina;

  let pagina: PaginaBitacora;
  if (!usaSupabase()) {
    const q = f.q?.toLowerCase();
    const todo = demo().filter((e) =>
      (!f.tabla || e.tabla === f.tabla) &&
      (!f.desde || String(e.fecha).slice(0, 10) >= f.desde) &&
      (!f.hasta || String(e.fecha).slice(0, 10) <= f.hasta) &&
      (!q || `${e.operacion} ${operacionDe(e.operacion)} ${moduloDe(e.tabla)} ${e.registro ?? ''} ${e.usuario ?? ''} ${JSON.stringify(e.detalle ?? {})}`.toLowerCase().includes(q)));
    const desde = cursor ? Number(cursor) : 0;
    pagina = { items: todo.slice(desde, desde + limite), siguiente: desde + limite < todo.length ? String(desde + limite) : null };
  } else {
    const { data, error } = await sb()!.rpc('blud_bitacora', {
      p_q: f.q || null, p_tabla: f.tabla || null, p_desde: f.desde || null, p_hasta: f.hasta || null,
      p_cursor: cursor ? Number(cursor) : null, p_limite: limite,
    });
    if (error) {
      if (sinFuncion(error)) throw new BitacoraNoDisponible('La bitácora aún no está activa en el servidor.');
      throw new Error(error.message || 'No pudimos cargar la bitácora.');
    }
    const r = (data ?? {}) as Partial<PaginaBitacora>;
    pagina = { items: r.items ?? [], siguiente: r.siguiente ?? null };
  }
  cache.set(clave, { t: Date.now(), pagina });
  if (cache.size > 40) cache.delete(cache.keys().next().value!);
  return pagina;
}

/** Texto corto del detalle (valores_nuevos) para la lista. */
export function resumenDetalle(d?: Record<string, unknown>): string {
  if (!d) return '';
  if (typeof d.resumen === 'string') return d.resumen;
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');
}
