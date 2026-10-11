// src/lib/db.ts
// "Base de datos" local única del sitio: colecciones tipadas sobre localStorage con eventos de cambio.
// Donante, operador y director leen y escriben AQUÍ, así lo que hace uno lo ve el otro.
// Para pasar a backend, solo hay que reemplazar el interior de `collection()` por llamadas a la API.

import { hoyISO } from './ui';

export interface Collection<T extends { id: string }> {
  all(): T[];
  get(id: string): T | undefined;
  find(pred: (item: T) => boolean): T | undefined;
  upsert(item: T): T;
  remove(id: string): void;
}

const notify = (key: string) => {
  try { window.dispatchEvent(new CustomEvent('blud:db', { detail: { key } })); } catch {}
};

export function collection<T extends { id: string }>(key: string): Collection<T> {
  const read = (): T[] => {
    try { return JSON.parse(localStorage.getItem(key) || '[]') as T[]; } catch { return []; }
  };
  const write = (list: T[]) => {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch {}
    notify(key);
  };
  return {
    all: read,
    get: (id) => read().find((x) => x.id === id),
    find: (pred) => read().find(pred),
    upsert(item) {
      const list = read();
      const i = list.findIndex((x) => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
      write(list);
      return item;
    },
    remove(id) { write(read().filter((x) => x.id !== id)); },
  };
}

/** Ejecuta cb cuando cambia cualquier colección (misma pestaña u otra pestaña). Devuelve la función para cancelar. */
export function onDb(cb: () => void): () => void {
  const a = () => cb();
  const b = (e: StorageEvent) => { if (e.key === null || e.key.startsWith('blud-')) cb(); };
  window.addEventListener('blud:db', a);
  window.addEventListener('storage', b);
  return () => {
    window.removeEventListener('blud:db', a);
    window.removeEventListener('storage', b);
  };
}

// ---------------------------------------------------------------- Tipos
export const BLOOD_TYPES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const COMPONENTES = ['Sangre Total', 'Concentrado Globular', 'Plaquetas', 'Plasma Fresco Congelado', 'Crioprecipitado'] as const;
export type Hemocomponente = (typeof COMPONENTES)[number];
export type Estado = 'preregistrado' | 'verificado';

export interface RegistroDonante {
  id: string; // = id del carnet (BLD-XXXXXX) si vino de la app
  cedula: string; // normalizada: V-12345678
  nombreCompleto: string;
  sangre: string;
  telefono?: string;
  email?: string;
  fechaRegistro: string;
  estado: Estado;
  origen: 'app' | 'operador';
  operadorId?: string; // quién lo verificó o lo registró
  fechaVerificacion?: string;
  /** Diferido por el laboratorio. El motivo NUNCA se guarda aquí: vive solo en los casos del laboratorio. */
  diferido?: { desde: string };
}

export interface DonacionOp {
  id: string;
  donanteId: string;
  donanteNombre: string;
  donanteCedula: string;
  tipoSangre: string;
  tipoHemocomponente: Hemocomponente;
  volumenMl: number;
  fecha: string;
  operadorId: string;
  centroId?: string;
  centroNombre?: string;
  /** Estado en laboratorio. Sin valor = liberada (datos anteriores al módulo de laboratorio). */
  estadoLab?: EstadoLab;
}

export type EstadoPedido = 'pendiente' | 'despachado';

export interface PedidoOp {
  id: string;
  pacienteNombre: string;
  pacienteCedula: string;
  tipoSangre: string;
  tipoHemocomponente: Hemocomponente;
  unidades: number;
  hospitalDestino: string;
  fecha: string;
  estado: EstadoPedido;
  creadoPor?: string;
  entregaId?: string;
}

export interface EntregaOp {
  id: string;
  pedidoId?: string;
  pacienteNombre: string;
  pacienteCedula: string;
  tipoSangre: string;
  tipoHemocomponente: Hemocomponente;
  unidades: number;
  hospitalDestino: string;
  fecha: string;
  operadorId: string;
}

// ---------------------------------------------------------------- Laboratorio
// Panel de tamizaje. AJÚSTALO a la norma técnica vigente de tu banco de sangre (añadir/quitar una línea basta).
export const PRUEBAS = [
  { id: 'vih', nombre: 'VIH 1/2' },
  { id: 'hbsag', nombre: 'Hepatitis B (HBsAg)' },
  { id: 'hbcore', nombre: 'Hepatitis B (anti-HBc)' },
  { id: 'hcv', nombre: 'Hepatitis C (anti-VHC)' },
  { id: 'sifilis', nombre: 'Sífilis' },
  { id: 'chagas', nombre: 'Chagas' },
  { id: 'htlv', nombre: 'HTLV I/II' },
  { id: 'malaria', nombre: 'Malaria' },
] as const;
export type PruebaId = (typeof PRUEBAS)[number]['id'];

export type ResultadoPrueba = 'no_reactivo' | 'reactivo' | 'indeterminado';
export type ResultadoGlobal = 'negativo' | 'positivo' | 'indeterminado';
export type EstadoLab = 'pendiente' | 'liberada' | 'descartada';

export interface PruebaLab {
  id: string;
  donacionId: string;
  codigo: string; // código de donación (no lleva el nombre del donante)
  fecha: string;
  resultados: Record<string, ResultadoPrueba>;
  resultadoGlobal: ResultadoGlobal;
  tipoSangreConfirmado: string;
  lote?: string;
  observaciones?: string;
  laboratoristaId: string;
}

export interface ProductoFraccion {
  componente: Hemocomponente;
  unidades: number;
  volumenMl: number;
}

export interface Fraccionamiento {
  id: string;
  donacionId: string;
  codigo: string;
  fecha: string;
  productos: ProductoFraccion[];
  observaciones?: string;
  laboratoristaId: string;
}

export interface CasoPositivo {
  id: string;
  pruebaId: string;
  donacionId: string;
  donanteId: string;
  codigo: string;
  prueba: string; // id de la prueba reactiva
  enfermedad: string; // nombre legible
  fecha: string;
  estado: 'pendiente' | 'notificado';
  notificadoA?: string;
  referencia?: string;
  fechaNotificacion?: string;
  notificadoPor?: string;
}

/** DON-AB12CD: identifica la bolsa sin exponer datos del donante */
export const codigoDonacion = (id: string) => 'DON-' + id.replace(/^demo-/, '').replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase();

// ---------------------------------------------------------------- Colecciones
export const registro = collection<RegistroDonante>('blud-db-donantes');
export const donaciones = collection<DonacionOp>('blud-db-donaciones');
export const pedidos = collection<PedidoOp>('blud-db-pedidos');
export const entregas = collection<EntregaOp>('blud-db-entregas');
export const pruebas = collection<PruebaLab>('blud-db-pruebas');
export const fracciones = collection<Fraccionamiento>('blud-db-fracciones');
export const positivos = collection<CasoPositivo>('blud-db-positivos');

// ---------------------------------------------------------------- Registro de donantes
/** V12345678 / 12345678 / v-12345678 → V-12345678 */
export function normCedula(c: string): string {
  const s = String(c ?? '').toUpperCase().replace(/[\s.]/g, '');
  if (!s) return '';
  const m = s.match(/^([VEJ])?-?(\d{5,9})$/);
  return m ? `${m[1] ?? 'V'}-${m[2]}` : s;
}

/** El perfil del donante alimenta el registro: aparece como "preregistrado" hasta que un operador lo verifique. */
export function upsertDesdePerfil(p: { id: string; firstname: string; lastname: string; cedula: string; sangre: string; telefono?: string; email?: string }) {
  const ced = normCedula(p.cedula);
  if (!ced || !p.firstname) return;
  const prev = registro.get(p.id) ?? registro.find((r) => r.cedula === ced);
  registro.upsert({
    ...(prev ?? {}),
    id: prev?.id ?? p.id,
    cedula: ced,
    nombreCompleto: `${p.firstname} ${p.lastname}`.trim(),
    sangre: p.sangre || prev?.sangre || '',
    telefono: p.telefono,
    email: p.email,
    fechaRegistro: prev?.fechaRegistro ?? hoyISO(),
    estado: prev?.estado ?? 'preregistrado',
    origen: prev?.origen ?? 'app',
  });
}

/** Acepta cédula, ID del carnet (BLD-XXXXXX) o el contenido JSON del QR. */
export function buscarRegistro(query: string): RegistroDonante | undefined {
  const q = query.trim();
  if (!q) return undefined;
  let id = '';
  try {
    const j = JSON.parse(q);
    if (j && typeof j.id === 'string') id = j.id;
  } catch {}
  if (!id && /^BLD-[A-Z0-9]{4,}$/i.test(q)) id = q.toUpperCase();
  if (id) return registro.get(id);
  const ced = normCedula(q);
  return registro.find((r) => r.cedula === ced);
}

/** Marca verificado y, si el donante usa este mismo navegador (demo), refleja el sello en su carnet. */
export function verificarRegistro(id: string, operadorId: string): RegistroDonante | undefined {
  const reg = registro.get(id);
  if (!reg) return undefined;
  const out = registro.upsert({ ...reg, estado: 'verificado', operadorId, fechaVerificacion: hoyISO() });
  try {
    const raw = localStorage.getItem('blud-donor');
    if (raw) {
      const d = JSON.parse(raw);
      if (d.id === out.id || normCedula(d.cedula) === out.cedula) {
        localStorage.setItem('blud-donor', JSON.stringify({ ...d, kyc: 'verified' }));
        window.dispatchEvent(new Event('blud:donor'));
      }
    }
  } catch {}
  return out;
}