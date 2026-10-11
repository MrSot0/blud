// src/lib/donante.ts
// Módulo de donante: perfil, citas, historial y ajustes.
// Se apoya en lib/db: el perfil alimenta el registro de donantes (lo que el operador verifica)
// y el historial incluye las donaciones que el operador registra a nombre de este donante.

import { centers } from '../data/centers';
import { donaciones, normCedula, registro, upsertDesdePerfil } from './db';

export { uid, esc, toast, fmtFecha, hoyISO, sumarDias, diasDesde } from './ui';

export const centroById = (id: string) => centers.find((c) => c.id === id);
export const SANGRES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export type Kyc = 'none' | 'review' | 'verified';

export interface Donor {
  id: string;
  firstname: string;
  lastname: string;
  email: string;
  telefono: string;
  cedula: string;
  nacimiento: string; // YYYY-MM-DD
  sangre: string;
  ciudad: string;
  since: string; // YYYY-MM-DD
  kyc: Kyc;
  donaciones: number;
}

export interface Cita {
  id: string;
  centroId: string;
  fecha: string; // YYYY-MM-DD
  hora: string; // HH:MM
  creada: string;
}

export interface Donacion {
  id: string;
  centroId: string;
  centroNombre?: string;
  fecha: string; // YYYY-MM-DD
  sangre: string;
  ml: number;
}

export interface Settings {
  recordatorios: boolean;
  urgencias: boolean;
  novedades: boolean;
}

const K_DONOR = 'blud-donor';
const K_CITA = 'blud-donor-cita';
const K_HIST = 'blud-donor-historial';
const K_SET = 'blud-donor-settings';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  // Cada vez que se guarda el perfil, el registro de donantes (lo que ve el operador) se actualiza
  if (key === K_DONOR) { try { upsertDesdePerfil(value as Donor); } catch {} }
  try { window.dispatchEvent(new Event('blud:donor')); } catch {}
}

// ---------- Perfil del donante ----------
function readSession(): Record<string, any> {
  try {
    return JSON.parse(localStorage.getItem('blud-session') || sessionStorage.getItem('blud-session') || 'null') ?? {};
  } catch {
    return {};
  }
}

/** Historial propio + donaciones que los operadores registraron a su nombre (por ID o por cédula). */
function historialDe(id: string, cedula: string): Donacion[] {
  const local = read<Donacion[]>(K_HIST, []);
  const ced = normCedula(cedula);
  const reg = registro.get(id) ?? (ced ? registro.find((r) => r.cedula === ced) : undefined);
  const delOperador: Donacion[] = donaciones.all()
    .filter((d) => d.donanteId === id || (reg && d.donanteId === reg.id) || (ced && normCedula(d.donanteCedula) === ced))
    .map((d) => ({ id: d.id, centroId: d.centroId ?? '', centroNombre: d.centroNombre, fecha: d.fecha, sangre: d.tipoSangre, ml: d.volumenMl }));
  const vistos = new Set(local.map((x) => x.id));
  return [...local, ...delOperador.filter((x) => !vistos.has(x.id))].sort((a, b) => b.fecha.localeCompare(a.fecha));
}

/** Perfil guardado + datos de la sesión como valores iniciales + sello de verificación del operador. */
export function loadDonor(): Donor {
  const s = readSession();
  const parts = String(s.name ?? '').split(/\s+/).filter(Boolean);
  const bloodFromSession = String(s.bloodType ?? '').replace('−', '-');
  const base: Donor = {
    id: 'BLD-' + Math.random().toString(36).slice(2, 8).toUpperCase(),
    firstname: s.firstname ?? parts[0] ?? '',
    lastname: s.lastname ?? parts.slice(1).join(' '),
    email: s.email ?? '',
    telefono: s.telefono ?? '',
    cedula: '',
    nacimiento: '',
    sangre: SANGRES.includes(bloodFromSession) ? bloodFromSession : '',
    ciudad: '',
    since: new Date().toISOString().slice(0, 10),
    kyc: 'none',
    donaciones: 0,
  };
  const saved = read<Partial<Donor>>(K_DONOR, {});
  const donor: Donor = { ...base, ...saved };
  if (!saved.id) write(K_DONOR, donor); // fija el ID desde la primera visita

  const ced = normCedula(donor.cedula);
  const reg = registro.get(donor.id) ?? (ced ? registro.find((r) => r.cedula === ced) : undefined);
  if (reg?.estado === 'verificado') donor.kyc = 'verified';
  donor.donaciones = historialDe(donor.id, donor.cedula).length || donor.donaciones;
  return donor;
}

// TODO: reemplazar por PATCH /api/donante
export function saveDonor(patch: Partial<Donor>): Donor {
  const donor = { ...loadDonor(), ...patch };
  write(K_DONOR, donor);
  return donor;
}

/** Compatibilidad con las páginas que solo necesitan leer el perfil. */
export const getDonor = () => loadDonor();

// ---------- Cita ---------- (TODO: conectar con el agendado real de lib/auth)
export const getCita = () => read<Cita | null>(K_CITA, null);
export const saveCita = (c: Cita) => write(K_CITA, c);
export const cancelCita = () => {
  try { localStorage.removeItem(K_CITA); } catch {}
  try { window.dispatchEvent(new Event('blud:donor')); } catch {}
};

// ---------- Historial ----------
export function getHistorial(): Donacion[] {
  const d = read<Partial<Donor>>(K_DONOR, {});
  return historialDe(d.id ?? '', d.cedula ?? '');
}

export function saveHistorial(list: Donacion[]) {
  write(K_HIST, list);
  write(K_DONOR, { ...loadDonor(), donaciones: list.length }); // contador del carnet
}

export function seedDemo() {
  const d = loadDonor();
  const sangre = d.sangre || 'O+';
  const a = centers[0]?.id ?? '';
  const b = centers[1]?.id ?? a;
  const mk = (id: string, fecha: string, centroId: string): Donacion => ({ id, fecha, centroId, sangre, ml: 450 });
  saveHistorial([mk('seed-1', '2026-06-12', a), mk('seed-2', '2026-02-20', b), mk('seed-3', '2025-10-03', a)]);
}

// ---------- Ajustes ----------
const DEFAULT_SETTINGS: Settings = { recordatorios: true, urgencias: true, novedades: false };
export const getSettings = (): Settings => ({ ...DEFAULT_SETTINGS, ...read<Partial<Settings>>(K_SET, {}) });
export const saveSettings = (s: Settings) => write(K_SET, s);

export function exportMisDatos() {
  return { perfil: loadDonor(), cita: getCita(), historial: getHistorial(), ajustes: getSettings(), exportado: new Date().toISOString() };
}

export function borrarDatosLocales() {
  [K_DONOR, K_CITA, K_HIST, K_SET, 'blud-donar-draft'].forEach((k) => {
    try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch {}
  });
  try { window.dispatchEvent(new Event('blud:donor')); } catch {}
}

// ---------- Fechas ----------
export function edadDe(iso: string): number | null {
  if (!iso) return null;
  const b = new Date(iso + 'T00:00:00');
  if (isNaN(b.getTime())) return null;
  const t = new Date();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
  return a;
}
