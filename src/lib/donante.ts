// src/lib/donante.ts
// Módulo de donante: perfil, citas, historial y ajustes.
// Se apoya en lib/db: el perfil alimenta el registro de donantes (lo que el operador verifica)
// y el historial incluye las donaciones que el operador registra a nombre de este donante.

import { centers } from '../data/centers';
import { donaciones, normCedula, registro, upsertDesdePerfil } from './db';
import { cancelarCita, getAppointments, nextAppointment, type Appointment } from './auth';
import { sb, sincronizar, usaSupabase } from './supabase';

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
  sexo?: 'M' | 'F';
  kyc: Kyc;
  donaciones: number;
  /** Foto del carnet: ruta en Storage (con base real) o imagen comprimida en data URL (modo demo). */
  foto?: string;
  /** Código secreto del QR (con base real): sin él, la vista pública del carnet no muestra nada. */
  qr?: string;
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
const K_FOTO = 'blud-donor-foto'; // caché de la URL firmada de la foto (con base real)

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
  if (key === K_DONOR && !usaSupabase()) {
    try {
      const userId = readSession().userId;
      upsertDesdePerfil({ ...(value as Donor), userId: typeof userId === 'string' ? userId : undefined });
    } catch {}
  }
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

  // Con base real, el registro del donante se reconoce por su cuenta aunque este navegador no tenga su cédula.
  const userId = typeof s.userId === 'string' ? s.userId : undefined;
  const email = String(s.email ?? '').toLowerCase();
  const propio = (userId ? registro.find((r) => r.userId === userId) : undefined)
    ?? (usaSupabase() && email ? registro.find((r) => r.email === email) : undefined);
  if (propio && usaSupabase()) donor.id = propio.id;
  if (propio && !donor.cedula) {
    donor.cedula = propio.cedula;
    donor.sangre = donor.sangre || propio.sangre;
  }
  if (!saved.id) write(K_DONOR, donor); // fija el ID desde la primera visita

  const ced = normCedula(donor.cedula);
  const reg = registro.get(donor.id) ?? (ced ? registro.find((r) => r.cedula === ced) : undefined) ?? propio;
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

// ---------- Cita ----------
// Una sola fuente de citas: el libro de lib/auth (que con base real se sincroniza con la tabla cita).
const aCita = (a: Appointment): Cita => ({
  id: a.id,
  centroId: a.centerId || centers.find((c) => c.name === a.centerName)?.id || '',
  fecha: a.date,
  hora: a.time,
  creada: a.createdAt,
});
const correo = () => String(readSession().email ?? '');

/** Próxima cita activa del donante. */
export const getCita = (): Cita | null => {
  const a = nextAppointment(correo());
  return a ? aCita(a) : null;
};
/** Todas las citas del donante (con su estado en la base, si hay). */
export const getCitas = (): (Cita & { centroNombre: string; estado?: string })[] =>
  getAppointments(correo()).map((a) => ({ ...aCita(a), centroNombre: a.centerName, estado: a.estado }));
export const cancelCita = (id?: string) => {
  const c = id ?? getCita()?.id;
  return c ? cancelarCita(correo(), c) : Promise.resolve({ ok: true as const });
};

// ---------- Base de datos (Supabase) ----------
interface FichaRemota {
  id?: string; nombres?: string; apellidos?: string; cedula?: string; telefono?: string; email?: string;
  nacimiento?: string; sexo?: 'M' | 'F'; sangre?: string; registrado?: string; verificado?: boolean;
  foto?: string; donaciones?: number; qr?: string;
}

/** Guarda el perfil local sin pasar por el registro (la base ya tiene la versión buena). */
function guardarLocal(d: Donor) {
  try { localStorage.setItem(K_DONOR, JSON.stringify(d)); } catch {}
  try { window.dispatchEvent(new Event('blud:donor')); } catch {}
}

/**
 * Con base real, trae la ficha del donante (blud_mi_ficha) y la vuelca en el perfil: la base manda.
 * En modo demo devuelve el perfil local.
 */
export async function cargarFicha(): Promise<Donor> {
  const c = sb();
  if (!c) return loadDonor();
  const { data, error } = await c.rpc('blud_mi_ficha');
  const local = loadDonor();
  if (error || !data) return local;
  const f = data as FichaRemota;
  const d: Donor = {
    ...local,
    id: f.id ?? local.id,
    firstname: f.nombres ?? local.firstname,
    lastname: f.apellidos ?? local.lastname,
    cedula: f.cedula ?? local.cedula,
    telefono: f.telefono ?? local.telefono,
    email: f.email ?? local.email,
    nacimiento: f.nacimiento ?? local.nacimiento,
    sexo: f.sexo ?? local.sexo,
    sangre: f.sangre ?? local.sangre,
    since: f.registrado ?? local.since,
    kyc: f.verificado ? 'verified' : local.kyc === 'verified' ? 'none' : local.kyc,
    donaciones: Math.max(f.donaciones ?? 0, local.donaciones),
    foto: f.foto ?? local.foto,
    qr: f.qr ?? local.qr,
  };
  guardarLocal(d);
  return d;
}

/**
 * Guarda los datos personales. Con base real espera a que la base los acepte (blud_guardar → g_donante),
 * así el donante ve el motivo si algo falla (cédula repetida, falta el sexo…).
 */
export async function guardarPerfil(patch: Partial<Donor>): Promise<{ ok: true; donor: Donor; aviso?: string } | { ok: false; error: string }> {
  const donor = { ...loadDonor(), ...patch };
  const c = sb();
  if (!c) {
    write(K_DONOR, donor);
    return { ok: true, donor };
  }
  const s = readSession();
  const item = {
    id: donor.id, cedula: normCedula(donor.cedula), nombreCompleto: `${donor.firstname} ${donor.lastname}`.trim(),
    sangre: donor.sangre, telefono: donor.telefono, email: donor.email, nacimiento: donor.nacimiento, sexo: donor.sexo,
    userId: s.userId, estado: 'preregistrado', origen: 'app', fechaRegistro: donor.since,
  };
  const { data, error } = await c.rpc('blud_guardar', { p_coleccion: 'blud-db-donantes', p_item: item });
  const res = (data ?? {}) as { error?: string; aviso?: string };
  if (error || res.error) return { ok: false, error: error?.message ?? res.error! };
  guardarLocal(donor);
  await sincronizar();
  return { ok: true, donor: await cargarFicha(), aviso: res.aviso };
}

// ---------- Foto ----------
/** Recorta al centro y comprime la foto a un JPEG cuadrado (por defecto 480 px). */
export async function comprimirFoto(file: File, lado = 480): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = lado;
  canvas.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, lado, lado);
  bmp.close?.();
  return new Promise((ok, ko) => canvas.toBlob((b) => (b ? ok(b) : ko(new Error('No se pudo procesar la foto.'))), 'image/jpeg', 0.85));
}

const aDataURL = (b: Blob) =>
  new Promise<string>((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result));
    r.onerror = () => ko(r.error);
    r.readAsDataURL(b);
  });

/** Sube la foto del carnet. Con base real va al bucket privado fotos-donantes, en la carpeta del donante. */
export async function subirFoto(file: File): Promise<{ ok: true; donor: Donor } | { ok: false; error: string }> {
  if (!file.type.startsWith('image/')) return { ok: false, error: 'Elige una imagen (JPG o PNG).' };
  if (file.size > 15 * 1024 * 1024) return { ok: false, error: 'La foto pesa demasiado (máximo 15 MB).' };
  let blob: Blob;
  try {
    blob = await comprimirFoto(file);
  } catch {
    return { ok: false, error: 'No pudimos leer esa imagen. Prueba con otra.' };
  }
  const c = sb();
  if (!c) {
    const donor = { ...loadDonor(), foto: await aDataURL(await comprimirFoto(file, 256)) };
    write(K_DONOR, donor);
    return { ok: true, donor };
  }
  const { data: ses } = await c.auth.getSession();
  const uidAuth = ses.session?.user.id;
  if (!uidAuth) return { ok: false, error: 'Inicia sesión de nuevo.' };
  const path = `${uidAuth}/carnet-${Date.now()}.jpg`;
  const up = await c.storage.from('fotos-donantes').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (up.error) return { ok: false, error: `No pudimos subir la foto: ${up.error.message}` };
  const { error } = await c.rpc('blud_guardar_foto', { p_path: path });
  if (error) return { ok: false, error: error.message };
  // Borra la foto anterior para no acumular archivos.
  const previa = loadDonor().foto;
  if (previa && previa !== path && previa.startsWith(uidAuth + '/')) c.storage.from('fotos-donantes').remove([previa]);
  try { sessionStorage.removeItem(K_FOTO); } catch {}
  const donor = { ...loadDonor(), foto: path };
  guardarLocal(donor);
  return { ok: true, donor };
}

/** URL para mostrar una foto: data URL (demo) o URL firmada de 1 hora (base real), con caché por sesión. */
export async function urlFoto(foto?: string): Promise<string | null> {
  if (!foto) return null;
  if (foto.startsWith('data:')) return foto;
  const c = sb();
  if (!c) return null;
  try {
    const cache = JSON.parse(sessionStorage.getItem(K_FOTO) || 'null');
    if (cache?.path === foto && cache.exp > Date.now()) return cache.url;
  } catch {}
  const { data } = await c.storage.from('fotos-donantes').createSignedUrl(foto, 3600);
  if (!data?.signedUrl) return null;
  try { sessionStorage.setItem(K_FOTO, JSON.stringify({ path: foto, url: data.signedUrl, exp: Date.now() + 50 * 60000 })); } catch {}
  return data.signedUrl;
}

// ---------- QR del carnet ----------
/**
 * Contenido del QR: un enlace a /verificar con el ID del carnet. Con la cámara del teléfono abre la ficha del donante
 * (solo el personal ve los datos); pegado o leído con un lector en el buscador del operador, también funciona.
 */
export const qrDe = (d: Pick<Donor, 'id' | 'qr'>) =>
  `${location.origin}/verificar?id=${encodeURIComponent(d.id)}${d.qr ? `&t=${encodeURIComponent(d.qr)}` : ''}`;

// ---------- Requisitos para donar ----------
export interface Requisito { key: string; label: string; ok: boolean }

/** Datos que el banco de sangre necesita antes de que el donante pueda agendar. */
export function requisitos(d: Donor): Requisito[] {
  const edad = edadDe(d.nacimiento);
  return [
    { key: 'foto', label: 'Foto para tu carnet', ok: !!d.foto },
    { key: 'firstname', label: 'Nombres', ok: !!d.firstname.trim() },
    { key: 'lastname', label: 'Apellidos', ok: !!d.lastname.trim() },
    { key: 'cedula', label: 'Cédula', ok: /^[VEJ]-\d{5,9}$/.test(normCedula(d.cedula)) },
    { key: 'telefono', label: 'Teléfono', ok: d.telefono.replace(/\D/g, '').length >= 10 },
    { key: 'nacimiento', label: 'Fecha de nacimiento (18 a 65 años)', ok: edad !== null && edad >= 18 && edad <= 65 },
    { key: 'sexo', label: 'Sexo', ok: d.sexo === 'M' || d.sexo === 'F' },
    { key: 'sangre', label: 'Tipo de sangre', ok: SANGRES.includes(d.sangre) },
    // Con base real, además, la ficha tiene que estar guardada en el banco de sangre (ID BLD-000123).
    ...(usaSupabase() ? [{ key: 'registro', label: 'Datos guardados en el banco de sangre', ok: /^BLD-\d+$/.test(d.id) }] : []),
  ];
}
export const faltantes = (d: Donor) => requisitos(d).filter((r) => !r.ok);
/** true cuando el perfil tiene todo lo necesario para agendar una donación. */
export const puedeDonar = (d: Donor = loadDonor()) => faltantes(d).length === 0;

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
  return { perfil: loadDonor(), citas: getCitas(), historial: getHistorial(), ajustes: getSettings(), exportado: new Date().toISOString() };
}

export function borrarDatosLocales() {
  [K_DONOR, K_CITA, K_HIST, K_SET, K_FOTO, 'blud-donar-draft'].forEach((k) => {
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
