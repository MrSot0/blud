// src/lib/transfusion.ts
// Compatibilidad antes de transfundir (RF-TR2, RF-TR3, RF-TR4, RF-TR7). Solo con la base conectada:
// el operador registra la solicitud de su hospital (se reservan unidades de su sede, sin pasar por la dirección),
// el laboratorio hace el tipaje de la muestra del paciente y la prueba cruzada de cada unidad, y el operador
// despacha cuando todo es compatible. Las que esperan stock ya aparecen para adelantar el tipaje.

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
  id: string; estado: 'pendiente' | 'aprobado' | 'despachado'; prioridad: 'normal' | 'urgente' | 'critica'; fecha: string;
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

// ------------------------------------------------------------------ RF-TR7 · Incompatibilidades y aviso al médico tratante
export interface Incompatibilidad {
  solicitud: string; fecha: string; unidadId?: number; unidadCodigo?: string;
  paciente: { nombre: string; cedula: string; servicio?: string };
  medico?: { nombre: string; correo?: string; telefono?: string };
  aviso?: { fecha: string; nota?: string; por?: string };
}

/** Pruebas cruzadas incompatibles de la sede en los últimos `dias` días, con el aviso al médico si ya se dio. */
export async function listarIncompatibilidades(dias = 30): Promise<Incompatibilidad[]> {
  const c = sb();
  if (!c) return [];
  const { data, error } = await c.rpc('blud_incompatibilidades', { p_dias: dias });
  if (error) {
    if (error.code === 'PGRST202') return [];
    throw err(error);
  }
  return (data ?? []) as Incompatibilidad[];
}

/** Deja constancia de que se avisó al médico tratante (cómo y a quién). */
export async function avisarMedico(solicitud: string, nota: string): Promise<void> {
  if (nota.trim().length < 10) throw new Error('Escribe cómo y a quién avisaste (mínimo 10 caracteres).');
  const { error } = await cliente().rpc('blud_avisar_medico', { p_solicitud: solicitud, p_nota: nota.trim() });
  if (error) throw err(error);
}

// ------------------------------------------------------------------ RF-DS5 · Verificación antes del despacho local
export interface VerificacionDespacho { brazalete: boolean; din: boolean; etiqueta: boolean; recibe: string }

export function validarVerificacion(v: VerificacionDespacho): string | null {
  if (!(v.brazalete && v.din && v.etiqueta)) return 'Verifica el brazalete del paciente, el DIN de cada bolsa y la etiqueta de compatibilidad.';
  if (v.recibe.trim().length < 3) return 'Indica quién recibe las unidades en el servicio.';
  return null;
}

/** Deja la verificación en la bitácora; la base la exige (2 horas) para despachar. */
export async function verificarDespacho(solicitud: string, v: VerificacionDespacho): Promise<void> {
  const e = validarVerificacion(v);
  if (e) throw new Error(e);
  const c = sb();
  if (!c) return; // modo demo: solo se valida en la pantalla
  const { error } = await c.rpc('blud_verificar_despacho', { p_solicitud: solicitud, p: v });
  if (error) throw err(error);
}
