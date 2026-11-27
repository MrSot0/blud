// src/lib/centros.ts
// Pedidos de hemocomponentes ENTRE CENTROS. El director del hospital que necesita bolsas pide a otro centro;
// el director del centro proveedor aprueba (se reservan unidades de su stock) o rechaza con motivo; el operador
// del proveedor despacha y el centro solicitante recibe (las unidades pasan a su stock).
// Solo con la base conectada: en modo demo no hay varios centros con stock propio.

import { sb, usaSupabase } from './supabase';

export type EstadoPedidoCentro = 'pendiente' | 'aprobada' | 'rechazada' | 'despachada' | 'recibida' | 'cancelada';

export interface PedidoCentro {
  id: string;
  estado: EstadoPedidoCentro;
  solicitante: { id: number; nombre: string };
  proveedora: { id: number; nombre: string };
  componente: string;
  tipoSangre: string;
  unidades: number;
  prioridad: 'normal' | 'urgente' | 'critica';
  motivo: string;
  solicitudLocal?: string;
  fecha: string;
  creadoPor?: string;
  revisadoPor?: string;
  revisadoEn?: string;
  motivoRechazo?: string;
  despachadoEn?: string;
  recibidoEn?: string;
  stockProveedor: number;
  bolsas?: { codigo: string; vence: string }[];
  /** RF-DS2/DS3: datos del traslado al despachar. */
  traslado?: Traslado & { horaSalida?: string; por?: string };
  /** RF-DS4: recepción con temperatura e inspección visual. */
  recepcion?: Recepcion & { conforme?: boolean; defectos?: string[]; hora?: string; por?: string };
}

export interface Traslado { transporte: string; chofer: string; contenedor: string; datalogger?: string; tempSalida: number }
export const DEFECTOS = [
  { id: 'hemolisis', label: 'Hemólisis' }, { id: 'coagulos', label: 'Coágulos' }, { id: 'turbidez', label: 'Turbidez' },
  { id: 'burbujas', label: 'Burbujas' }, { id: 'fugas', label: 'Fugas o bolsa dañada' },
] as const;
export type Defecto = (typeof DEFECTOS)[number]['id'];
export interface Recepcion { tempLlegada: number; inspeccion: Record<Defecto, boolean>; observaciones?: string }

export function validarTraslado(t: Traslado): string | null {
  if (!t.transporte.trim() || !t.chofer.trim()) return 'Indica el transporte y el chofer del traslado.';
  if (!t.contenedor.trim()) return 'Indica el contenedor isotérmico.';
  if (!Number.isFinite(t.tempSalida) || t.tempSalida < -40 || t.tempSalida > 30) return 'Registra la temperatura de salida del contenedor.';
  return null;
}
export function validarRecepcion(r: Recepcion): string | null {
  if (!Number.isFinite(r.tempLlegada) || r.tempLlegada < -40 || r.tempLlegada > 30) return 'Registra la temperatura de llegada del contenedor.';
  if (Object.values(r.inspeccion).some(Boolean) && (r.observaciones?.trim().length ?? 0) < 10) return 'Describe lo que encontraste en la inspección (mínimo 10 caracteres).';
  return null;
}

export interface LocalSinStock {
  id: string; paciente: string; componente: string; tipoSangre: string; unidades: number;
  prioridad: 'normal' | 'urgente' | 'critica'; fecha: string;
}

export interface BandejaCentros {
  miSede: number;
  centro: string;
  recibidos: PedidoCentro[];
  enviados: PedidoCentro[];
  sinStock: LocalSinStock[];
}

export const ESTADO_PEDIDO_CENTRO: Record<EstadoPedidoCentro, string> = {
  pendiente: 'Por aprobar',
  aprobada: 'Aprobado',
  rechazada: 'Rechazado',
  despachada: 'En camino',
  recibida: 'Recibido',
  cancelada: 'Cancelado',
};

export const TONO_PEDIDO_CENTRO: Record<EstadoPedidoCentro, string> = {
  pendiente: 'bg-warn-soft text-warn',
  aprobada: 'bg-ok-soft text-ok',
  rechazada: 'bg-accent-soft text-accent-ink',
  despachada: 'bg-sunken text-ink',
  recibida: 'bg-sunken text-ink-2',
  cancelada: 'bg-sunken text-ink-3',
};

const cliente = () => {
  const c = usaSupabase() ? sb() : null;
  if (!c) throw new Error('Los pedidos entre centros necesitan conexión con el servidor del banco de sangre.');
  return c;
};
const err = (e: { message?: string } | null) => new Error(e?.message || 'No pudimos conectar con el servidor.');

export async function bandejaCentros(): Promise<BandejaCentros> {
  const { data, error } = await cliente().rpc('blud_pedidos_centros');
  if (error) throw err(error);
  return data as BandejaCentros;
}

export async function crearPedidoCentro(p: {
  sedeProveedora: number; componente: string; tipoSangre: string; unidades: number;
  prioridad: 'normal' | 'urgente' | 'critica'; motivo: string; solicitudLocal?: string;
}): Promise<string> {
  const { data, error } = await cliente().rpc('blud_pedido_centro_crear', { p });
  if (error) throw err(error);
  return String(data);
}

export async function resolverPedidoCentro(id: string, aprobar: boolean, motivo?: string): Promise<void> {
  const { error } = await cliente().rpc('blud_pedido_centro_resolver', { p_id: id, p_aprobar: aprobar, p_motivo: motivo ?? null });
  if (error) throw err(error);
}

export async function despacharPedidoCentro(id: string, traslado: Traslado): Promise<void> {
  const e = validarTraslado(traslado);
  if (e) throw new Error(e);
  const { error } = await cliente().rpc('blud_pedido_centro_despachar', { p_id: id, p_traslado: traslado });
  if (error) throw err(error);
}

export async function recibirPedidoCentro(id: string, recepcion: Recepcion): Promise<{ reservaLocal: number; conforme: boolean }> {
  const e = validarRecepcion(recepcion);
  if (e) throw new Error(e);
  const { data, error } = await cliente().rpc('blud_pedido_centro_recibir', { p_id: id, p_recepcion: recepcion });
  if (error) throw err(error);
  return data as { reservaLocal: number; conforme: boolean };
}

export async function cancelarPedidoCentro(id: string): Promise<void> {
  const { error } = await cliente().rpc('blud_pedido_centro_cancelar', { p_id: id });
  if (error) throw err(error);
}
