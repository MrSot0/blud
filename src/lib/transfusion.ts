// src/lib/transfusion.ts
// Compatibilidad antes de transfundir (RF-TR2, RF-TR3, RF-TR4, RF-TR7). Solo con la base conectada:
// el operador registra la solicitud, la dirección la aprueba (se reservan unidades), el laboratorio hace el tipaje
// de la muestra del paciente y la prueba cruzada de cada unidad, y el operador despacha cuando todo es compatible.

import { sb } from './supabase';

export interface Tipaje {
  fecha: string; tubo: string; conforme: boolean; motivoRechazo?: string; abo?: string; rh?: string;
  du?: string; directa?: string; inversa?: string; anticuerpos?: string; observaciones?: string;
}
export interface Cruzada {
  resultado: 'Compatible' | 'Incompatible'; mayor: number; menor: number;
  coombsDirecto: string; coombsIndirecto: string; fecha: string; detalle: string;
}
export interface UnidadReservada {
  unidadId: number; codigo: string; componente: string; tipo: string; vence: string; estado: string; cruzada?: Cruzada;
}
export interface Transfusion {
  id: string; estado: 'aprobado' | 'despachado'; prioridad: 'normal' | 'urgente' | 'critica'; fecha: string;
  paciente: { nombre: string; cedula: string; servicio?: string; historia?: string };
  componente: string; requiereCruzada: boolean; tipoSolicitado: string; unidadesSolicitadas: number;
  consentimiento: boolean; tipaje?: Tipaje; unidades: UnidadReservada[]; faltaParaDespachar?: string;
}

const cliente = () => {
  const c = sb();
  if (!c) throw new Error('La compatibilidad necesita conexión con el servidor del banco de sangre.');
  return c;
};
const err = (e: { message?: string } | null) => new Error(e?.message || 'No pudimos conectar con el servidor.');

export async function listarTransfusiones(): Promise<Transfusion[]> {
  const { data, error } = await cliente().rpc('blud_transfusiones');
  if (error) throw err(error);
  return (data ?? []) as Transfusion[];
}

export async function registrarTipaje(solicitud: string, t: Partial<Tipaje>): Promise<void> {
  const { error } = await cliente().rpc('blud_registrar_tipaje', { p_solicitud: solicitud, p: t });
  if (error) throw err(error);
}

export async function registrarCruzada(
  solicitud: string, unidadId: number,
  c: { mayor: number; menor: number; coombsDirecto: string; coombsIndirecto: string; observaciones?: string },
): Promise<'Compatible' | 'Incompatible'> {
  const { data, error } = await cliente().rpc('blud_registrar_cruzada', { p_solicitud: solicitud, p_unidad: unidadId, p: c });
  if (error) throw err(error);
  return (data as { resultado: 'Compatible' | 'Incompatible' }).resultado;
}

/** Libera una unidad incompatible y reserva otra compatible del stock. */
export async function cambiarUnidad(solicitud: string, unidadId: number): Promise<void> {
  const { error } = await cliente().rpc('blud_cambiar_unidad', { p_solicitud: solicitud, p_unidad: unidadId });
  if (error) throw err(error);
}
