// Cuentas y sesión. Dos modos:
//  - Demo (sin variables de Supabase): todo vive en este navegador (localStorage), con cuentas de prueba.
//  - Supabase: el acceso lo valida Supabase Auth y el rol sale de la tabla profiles (lo asigna la dirección).
// En ambos, la sesión se resume en 'blud-session' para que la interfaz la lea sin esperar a la red.

import { PERFILES_KEY, limpiarCache, sb, sincronizar, usaSupabase } from './supabase';

/** Rol del usuario. Lo asigna el sistema, NUNCA el formulario de registro público. */
export type Role = 'donante' | 'operador' | 'laboratorio' | 'soporte' | 'director';

export interface Session {
  email: string;
  name: string;
  role: Role;
  bloodType: string;
  telefono?: string;
  colegiado?: string;
  cargo?: string;
  sede?: string;
  /** id del usuario en Supabase Auth (solo con base real). */
  userId?: string;
}

interface StoredUser extends Session {
  salt: string;
  hash: string;
  createdAt: string;
}

export interface Appointment {
  id: string;
  centerId: string;
  centerName: string;
  /** Fecha local YYYY-MM-DD. */
  date: string;
  /** Hora HH:MM. */
  time: string;
  createdAt: string;
  /** Estado en la base (Programada, Atendida…). En modo demo no se usa. */
  estado?: string;
}

const USERS_KEY = 'blud-users';
const SESSION_KEY = 'blud-session';
const APPOINTMENTS_KEY = 'blud-appointments';

/** Cuentas de prueba: siempre disponibles para demostrar el acceso. */
export const demoUsers: (Session & { password: string })[] = [
  { name: 'María Fernández', email: 'maria@blud.app', password: 'Donante2026', role: 'director', bloodType: 'O+', telefono: '+58 414 1234567', colegiado: 'MPPS-84920', cargo: 'Director General de Banco de Sangre', sede: 'Hospital Central Maracaibo' },
  { name: 'Carlos Pérez', email: 'carlos@blud.app', password: 'Sangre2026', role: 'donante', bloodType: 'A-', telefono: '+58 414 7654321' },
  { name: 'Dra. María Colina', email: 'operador@blud.app', password: 'Operador2026', role: 'operador', bloodType: 'B+', telefono: '+58 414 5550123', colegiado: 'MPPS-51230', cargo: 'Operador de Banco de Sangre', sede: 'Hospital Central Maracaibo' },
  { name: 'Lic. Andrea Vargas', email: 'laboratorio@blud.app', password: 'Laboratorio2026', role: 'laboratorio', bloodType: 'O-', telefono: '+58 414 5550456', colegiado: 'MPPS-60721', cargo: 'Bioanalista', sede: 'Hospital Central Maracaibo' },
  { name: 'Lic. Daniela Ríos', email: 'soporte@blud.app', password: 'Soporte2026', role: 'soporte', bloodType: 'A+', telefono: '+58 414 5550789', colegiado: 'BLUD-SOP-014', cargo: 'Especialista de Soporte al Donante', sede: 'Hospital Central Maracaibo' },
];

// ---------- Almacenamiento seguro (puede fallar en modo privado) ----------

function read<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(storage: Storage | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {}
}

function remove(storage: Storage | undefined, key: string) {
  try {
    storage?.removeItem(key);
  } catch {}
}

const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage);
const session = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);

// ---------- Contraseñas ----------

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 si el navegador lo permite (https o localhost); si no, un hash simple de respaldo. */
async function hashPassword(password: string, salt: string): Promise<string> {
  const input = `${salt}:${password}`;
  if (crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 0x01000193);
  return `fnv-${(h >>> 0).toString(16)}`;
}

const normalize = (email: string) => email.trim().toLowerCase();

const storedUsers = () => read<StoredUser[]>(local(), USERS_KEY, []);

export function emailExists(email: string): boolean {
  const target = normalize(email);
  return demoUsers.some((u) => u.email === target) || storedUsers().some((u) => u.email === target);
}

// ---------- Sesión ----------

export function getSession(): Session | null {
  const s = read<Session | null>(local(), SESSION_KEY, null) ?? read<Session | null>(session(), SESSION_KEY, null);
  return s ? { ...s, role: s.role ?? 'donante' } : null;
}

function startSession(user: Session, remember: boolean) {
  const data: Session = {
    email: user.email,
    name: user.name,
    role: user.role ?? 'donante',
    bloodType: user.bloodType,
    telefono: user.telefono,
    colegiado: user.colegiado,
    sede: user.sede,
    cargo: user.cargo,
    userId: user.userId,
  };
  remove(local(), SESSION_KEY);
  remove(session(), SESSION_KEY);
  write(remember ? local() : session(), SESSION_KEY, data);
  document.documentElement.dataset.auth = 'in';
  document.documentElement.dataset.role = data.role;
  window.dispatchEvent(new CustomEvent('blud:auth'));
}

/** Cierre de sesión en curso: un login inmediato lo espera para que no le borre la sesión nueva. */
let cerrando: Promise<unknown> | null = null;

export function logout() {
  if (usaSupabase()) {
    cerrando = sb()?.auth.signOut().finally(() => { cerrando = null; }) ?? null;
    limpiarCache();
  }
  remove(local(), SESSION_KEY);
  remove(session(), SESSION_KEY);
  delete document.documentElement.dataset.auth;
  delete document.documentElement.dataset.role;
  window.dispatchEvent(new CustomEvent('blud:auth'));
}

export type LoginResult = { ok: true; user: Session; confirmar?: boolean } | { ok: false; error: string };

// ---------- Supabase ----------
interface PerfilRemoto {
  id: string; email: string; full_name: string; role: Role; blood_type: string | null; phone: string | null;
  cargo: string | null; sede: string | null; colegiado: string | null; active: boolean;
}
const sesionDePerfil = (p: PerfilRemoto): Session => ({
  userId: p.id, email: p.email, name: p.full_name || p.email, role: p.role, bloodType: p.blood_type ?? '',
  telefono: p.phone ?? undefined, cargo: p.cargo ?? undefined, sede: p.sede ?? undefined, colegiado: p.colegiado ?? undefined,
});

/** Perfil de quien inició sesión (rol incluido), según la base. */
async function perfilRemoto(): Promise<PerfilRemoto | null> {
  const { data } = await sb()!.rpc('blud_mi_perfil');
  return (data as PerfilRemoto | null) ?? null;
}

/** Traduce un error de Supabase Auth a algo que la persona pueda entender y actuar. */
function mensajeAuth(error: { message?: string; status?: number; code?: string; name?: string } | null | undefined): string {
  const msg = error?.message ?? '';
  if (error?.code === 'email_not_confirmed' || msg.includes('Email not confirmed')) return 'Confirma tu correo antes de entrar: revisa tu bandeja de entrada.';
  if (error?.status === 429 || /rate.?limit/i.test(error?.code ?? '') || /rate limit|too many/i.test(msg)) return 'Demasiados intentos. Espera un par de minutos e inténtalo de nuevo.';
  if (error?.name === 'AuthRetryableFetchError' || error?.status === 0 || (error?.status ?? 0) >= 500 || /fetch|network/i.test(msg)) return 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
  return 'Correo o contraseña incorrectos.';
}

async function loginRemoto(email: string, password: string, remember: boolean): Promise<LoginResult> {
  const c = sb()!;
  try {
    await cerrando;
    const { data, error } = await c.auth.signInWithPassword({ email, password });
    if (error || !data.user) return { ok: false, error: mensajeAuth(error) };
    const perfil = await perfilRemoto();
    if (!perfil) {
      await c.auth.signOut();
      return { ok: false, error: 'Tu cuenta no tiene perfil todavía. Escribe a soporte@blud.app.' };
    }
    if (!perfil.active) {
      await c.auth.signOut();
      return { ok: false, error: CUENTA_INACTIVA };
    }
    const user = sesionDePerfil(perfil);
    startSession(user, remember);
    await sincronizar();
    return { ok: true, user };
  } catch (e) {
    return { ok: false, error: mensajeAuth({ message: String((e as Error)?.message ?? e), status: 0 }) };
  }
}

// ---------- Recuperar contraseña ----------

/** Envía el enlace de recuperación. Siempre responde igual, exista o no el correo (no revela qué cuentas hay). */
export async function solicitarRecuperacion(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!usaSupabase()) return { ok: true };
  try {
    const { error } = await sb()!.auth.resetPasswordForEmail(normalize(email), { redirectTo: `${location.origin}/recuperar` });
    if (error && (error.status === 429 || /rate limit|too many/i.test(error.message))) return { ok: false, error: 'Pediste demasiados enlaces. Espera unos minutos e inténtalo otra vez.' };
    if (error && ((error.status ?? 0) >= 500 || error.name === 'AuthRetryableFetchError')) return { ok: false, error: 'No pudimos conectar con el servidor. Inténtalo de nuevo.' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'No pudimos conectar con el servidor. Inténtalo de nuevo.' };
  }
}

/** Avisa cuando el visitante llega desde el enlace del correo (sesión temporal de recuperación). */
export function alLlegarDeRecuperacion(cb: () => void): void {
  const c = sb();
  if (!c) return;
  c.auth.onAuthStateChange((evento) => { if (evento === 'PASSWORD_RECOVERY') cb(); });
}

/** Guarda la contraseña nueva y cierra la sesión temporal: después se entra con ella de forma normal. */
export async function guardarClaveNueva(password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (password.length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' };
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return { ok: false, error: 'Usa letras y al menos un número.' };
  const c = sb();
  if (!c) return { ok: false, error: 'La recuperación solo está disponible con la base de datos conectada.' };
  const { error } = await c.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: /same|different/i.test(error.message) ? 'La contraseña nueva debe ser distinta de la anterior.' : 'El enlace venció o ya se usó. Pide uno nuevo.' };
  }
  await c.auth.signOut();
  limpiarCache();
  return { ok: true };
}

/**
 * Comprueba que la sesión de Supabase siga viva y refresca rol y datos (la dirección puede cambiarlos).
 * Devuelve false si ya no hay sesión válida (expiró o la cuenta se desactivó).
 */
export async function verificarSesionRemota(): Promise<boolean> {
  const c = sb();
  if (!c) return true;
  const { data } = await c.auth.getSession();
  const uid = data.session?.user.id;
  const perfil = uid ? await perfilRemoto() : null;
  if (!perfil?.active) {
    logout();
    return false;
  }
  const actual = getSession();
  const nueva = sesionDePerfil(perfil);
  if (!actual || actual.role !== nueva.role || actual.name !== nueva.name) startSession(nueva, read(local(), SESSION_KEY, null) !== null);
  await sincronizar();
  return true;
}

export async function login(email: string, password: string, remember: boolean): Promise<LoginResult> {
  const target = normalize(email);
  if (usaSupabase()) return loginRemoto(target, password, remember);
  // Si la cuenta tiene copia guardada (cambió su clave o sus datos), manda esa copia.
  const demo = storedUsers().some((u) => u.email === target) ? undefined : demoUsers.find((u) => u.email === target);
  if (demo) {
    if (demo.password !== password) return { ok: false, error: 'Correo o contraseña incorrectos.' };
    if (personalInactivo(target)) return { ok: false, error: CUENTA_INACTIVA };
    startSession(demo, remember);
    return { ok: true, user: demo };
  }

  const user = storedUsers().find((u) => u.email === target);
  if (!user || (await hashPassword(password, user.salt)) !== user.hash) {
    return { ok: false, error: 'Correo o contraseña incorrectos.' };
  }
  if (personalInactivo(target)) return { ok: false, error: CUENTA_INACTIVA };
  startSession(user, remember);
  return { ok: true, user };
}

export type RegisterInput = { name: string; email: string; password: string; bloodType: string };

export async function register(input: RegisterInput): Promise<LoginResult> {
  const email = normalize(input.email);
  if (usaSupabase()) {
    // El rol lo pone la base (siempre "donante"); los metadatos solo llevan nombre y tipo de sangre.
    const { data, error } = await sb()!.auth.signUp({
      email, password: input.password,
      options: { data: { full_name: input.name.trim(), blood_type: input.bloodType } },
    });
    if (error) {
      return { ok: false, error: /registered|exists/i.test(error.message) ? 'Ya existe una cuenta con este correo.' : `No pudimos crear la cuenta: ${error.message}` };
    }
    const user: Session = { email, name: input.name.trim(), role: 'donante', bloodType: input.bloodType, userId: data.user?.id };
    if (!data.session) return { ok: true, user, confirmar: true }; // el proyecto pide confirmar el correo
    startSession(user, true);
    await sincronizar();
    return { ok: true, user };
  }
  if (emailExists(email)) return { ok: false, error: 'Ya existe una cuenta con este correo.' };

  const salt = randomSalt();
  const user: StoredUser = {
    name: input.name.trim(),
    email,
    role: 'donante', // los operadores y directores los crea la dirección, no el registro público
    bloodType: input.bloodType,
    salt,
    hash: await hashPassword(input.password, salt),
    createdAt: new Date().toISOString(),
  };
  write(local(), USERS_KEY, [...storedUsers(), user]);
  startSession(user, true);
  return { ok: true, user };
}

// ---------- Cuenta: datos y contraseña ----------

const STAFF_KEY = 'blud-staff'; // perfil del personal (lib/personal), indexado por correo

/** Devuelve el registro guardado de la cuenta; si es una cuenta demo, crea su copia editable. */
async function ensureStored(email: string): Promise<StoredUser | null> {
  const key = normalize(email);
  const found = storedUsers().find((u) => u.email === key);
  if (found) return found;
  const demo = demoUsers.find((u) => u.email === key);
  if (!demo) return null;
  const salt = randomSalt();
  const { password, ...data } = demo;
  const user: StoredUser = { ...data, salt, hash: await hashPassword(password, salt), createdAt: new Date().toISOString() };
  write(local(), USERS_KEY, [...storedUsers(), user]);
  return user;
}

function saveStored(user: StoredUser, oldEmail: string) {
  write(local(), USERS_KEY, storedUsers().map((u) => (u.email === normalize(oldEmail) ? user : u)));
}

export type AccountResult = { ok: true; user: Session } | { ok: false; error: string };

/** Actualiza nombre, correo y teléfono de la sesión actual. */
export async function updateAccount(patch: { name: string; email: string; telefono: string }): Promise<AccountResult> {
  const current = getSession();
  if (!current) return { ok: false, error: 'Tu sesión expiró. Vuelve a entrar.' };
  const name = patch.name.trim().replace(/\s+/g, ' ');
  const email = normalize(patch.email);
  const telefono = patch.telefono.trim();
  if (name.length < 3) return { ok: false, error: 'Escribe tu nombre completo.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Revisa el correo electrónico.' };
  if (telefono && !/^[+\d][\d\s()-]{6,}$/.test(telefono)) return { ok: false, error: 'Revisa el teléfono.' };
  if (email !== normalize(current.email) && emailExists(email)) return { ok: false, error: 'Ya existe una cuenta con ese correo.' };

  if (usaSupabase()) {
    if (email !== normalize(current.email)) return { ok: false, error: 'Para cambiar el correo escribe a soporte@blud.app.' };
    const { error } = await sb()!.rpc('blud_actualizar_cuenta', { p_nombre: name, p_telefono: telefono || null });
    if (error) return { ok: false, error: 'No pudimos guardar tus datos. Inténtalo de nuevo.' };
    const next: Session = { ...current, name, telefono };
    const store = read(local(), SESSION_KEY, null) ? local() : session();
    write(store, SESSION_KEY, next);
    window.dispatchEvent(new CustomEvent('blud:auth'));
    return { ok: true, user: next };
  }
  const stored = await ensureStored(current.email);
  if (stored) saveStored({ ...stored, name, email, telefono }, current.email);

  // El perfil del personal se indexa por correo: lo movemos para no perder foto ni cédula.
  if (email !== normalize(current.email)) {
    const staff = read<Record<string, unknown>>(local(), STAFF_KEY, {});
    const old = normalize(current.email);
    if (staff[old]) { staff[email] = staff[old]; delete staff[old]; write(local(), STAFF_KEY, staff); }
  }

  const next: Session = { ...current, name, email, telefono };
  const store = read(local(), SESSION_KEY, null) ? local() : session();
  write(store, SESSION_KEY, next);
  window.dispatchEvent(new CustomEvent('blud:auth'));
  window.dispatchEvent(new Event('blud:staff'));
  return { ok: true, user: next };
}

/** Cambia la contraseña de la sesión actual verificando la anterior. */
export async function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = getSession();
  if (!s) return { ok: false, error: 'Tu sesión expiró. Vuelve a entrar.' };
  if (newPassword.length < 8) return { ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) return { ok: false, error: 'Usa letras y al menos un número.' };
  if (usaSupabase()) return cambiarClaveRemota(s.email, currentPassword, newPassword);
  const stored = await ensureStored(s.email);
  if (!stored) return { ok: false, error: 'No encontramos tu cuenta.' };
  if ((await hashPassword(currentPassword, stored.salt)) !== stored.hash) return { ok: false, error: 'La contraseña actual no es correcta.' };
  if (currentPassword === newPassword) return { ok: false, error: 'La nueva contraseña debe ser distinta de la actual.' };
  const salt = randomSalt();
  saveStored({ ...stored, salt, hash: await hashPassword(newPassword, salt) }, s.email);
  return { ok: true };
}

// ---------- Personal (lo gestiona la dirección) ----------

export const STAFF_ROLES: Role[] = ['operador', 'laboratorio', 'soporte', 'director'];
const INACTIVE_KEY = 'blud-staff-inactive';
const CUENTA_INACTIVA = 'Tu cuenta está desactivada. Habla con la dirección del banco de sangre.';

export interface CuentaPersonal {
  email: string;
  name: string;
  role: Role;
  cargo?: string;
  sede?: string;
  colegiado?: string;
  telefono?: string;
  /** Cuenta de prueba incluida en el sitio. */
  demo: boolean;
  activo: boolean;
}

const inactivos = () => new Set(read<string[]>(local(), INACTIVE_KEY, []));
export const personalInactivo = (email: string) => inactivos().has(normalize(email));

/** Cuentas con rol de personal (las de prueba y las que creó la dirección). */
export function listarPersonal(): CuentaPersonal[] {
  if (usaSupabase()) {
    return read<PerfilRemoto[]>(local(), PERFILES_KEY, [])
      .filter((p) => STAFF_ROLES.includes(p.role))
      .map((p) => ({
        email: p.email, name: p.full_name || p.email, role: p.role, cargo: p.cargo ?? undefined, sede: p.sede ?? undefined,
        colegiado: p.colegiado ?? undefined, telefono: p.phone ?? undefined, demo: false, activo: p.active,
      }))
      .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
  }
  const off = inactivos();
  const out = new Map<string, CuentaPersonal>();
  const add = (u: Session, demo: boolean) => {
    if (!STAFF_ROLES.includes(u.role)) return;
    out.set(u.email, {
      email: u.email, name: u.name, role: u.role, cargo: u.cargo, sede: u.sede, colegiado: u.colegiado,
      telefono: u.telefono, demo: demo || out.get(u.email)?.demo === true, activo: !off.has(u.email),
    });
  };
  demoUsers.forEach((u) => add(u, true));
  storedUsers().forEach((u) => add(u, false));
  return [...out.values()].sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name));
}

/** Clave temporal legible: letras y números, sin caracteres que se confunden (0/O, 1/l). */
function claveTemporal() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const digitos = '23456789';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const parte = Array.from(bytes.slice(0, 4), (b) => letras[b % letras.length]).join('');
  const num = Array.from(bytes.slice(4), (b) => digitos[b % digitos.length]).join('');
  return `Blud-${parte}${num}`;
}

export type NuevaCuenta = {
  name: string; email: string; role: Role; cargo?: string; sede?: string; colegiado?: string;
  /** Con base real el esquema los exige para toda cuenta (tabla usuario). */
  cedula?: string; telefono?: string; nacimiento?: string; sexo?: 'M' | 'F';
};

/** La dirección crea cuentas del personal. Devuelve la clave temporal para entregarla a la persona. */
export async function crearCuentaPersonal(input: NuevaCuenta): Promise<{ ok: true; password: string } | { ok: false; error: string }> {
  if (getSession()?.role !== 'director') return { ok: false, error: 'Solo la dirección puede crear cuentas del personal.' };
  if (usaSupabase()) {
    // Crear usuarios exige la clave de servicio: lo hace la función del servidor supabase/functions/crear-personal.
    const { data, error } = await sb()!.functions.invoke('crear-personal', { body: input });
    if (error) {
      // En las respuestas 4xx/5xx el motivo viene en el cuerpo (error.context es la Response de la función).
      const motivo = await error.context?.json?.().then((b: { error?: string }) => b.error).catch(() => undefined);
      return { ok: false, error: motivo ?? 'No se pudo crear la cuenta. ¿Está desplegada la función crear-personal?' };
    }
    await sincronizar();
    return { ok: true, password: String(data.password) };
  }
  const name = input.name.trim().replace(/\s+/g, ' ');
  const email = normalize(input.email);
  if (name.length < 3) return { ok: false, error: 'Escribe el nombre completo.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'Revisa el correo electrónico.' };
  if (!STAFF_ROLES.includes(input.role)) return { ok: false, error: 'Elige un rol del personal.' };
  if (emailExists(email)) return { ok: false, error: 'Ya existe una cuenta con ese correo.' };

  const password = claveTemporal();
  const salt = randomSalt();
  const user: StoredUser = {
    name, email, role: input.role, bloodType: '',
    cargo: input.cargo?.trim() || undefined, sede: input.sede?.trim() || undefined, colegiado: input.colegiado?.trim() || undefined,
    salt, hash: await hashPassword(password, salt), createdAt: new Date().toISOString(),
  };
  write(local(), USERS_KEY, [...storedUsers(), user]);
  window.dispatchEvent(new CustomEvent('blud:auth'));
  return { ok: true, password };
}

/** Activa o desactiva una cuenta del personal (la persona desactivada ya no puede entrar). */
export function setPersonalActivo(email: string, activo: boolean): { ok: true } | { ok: false; error: string } {
  const actor = getSession();
  if (actor?.role !== 'director') return { ok: false, error: 'Solo la dirección puede cambiar el estado del personal.' };
  const key = normalize(email);
  if (key === normalize(actor.email)) return { ok: false, error: 'No puedes desactivar tu propia cuenta.' };
  if (usaSupabase()) {
    // La caché se actualiza al instante; la base confirma y, si se negara, la próxima sincronización lo corrige.
    write(local(), PERFILES_KEY, read<PerfilRemoto[]>(local(), PERFILES_KEY, []).map((p) => (p.email === key ? { ...p, active: activo } : p)));
    sb()!.rpc('blud_personal_activo', { p_email: key, p_activo: activo }).then(({ error }) => {
      if (error) window.dispatchEvent(new CustomEvent('blud:sync-error', { detail: { mensaje: error.message } }));
      sincronizar();
    });
    window.dispatchEvent(new CustomEvent('blud:auth'));
    return { ok: true };
  }
  const off = inactivos();
  if (activo) off.delete(key); else off.add(key);
  write(local(), INACTIVE_KEY, [...off]);
  window.dispatchEvent(new CustomEvent('blud:auth'));
  return { ok: true };
}

// ---------- Citas ----------

type AppointmentBook = Record<string, Appointment[]>;

export function getAppointments(email: string): Appointment[] {
  const book = read<AppointmentBook>(local(), APPOINTMENTS_KEY, {});
  return (book[normalize(email)] ?? []).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

export function addAppointment(email: string, data: Omit<Appointment, 'id' | 'createdAt'>): Appointment {
  const book = read<AppointmentBook>(local(), APPOINTMENTS_KEY, {});
  const key = normalize(email);
  const appointment: Appointment = { ...data, id: randomSalt().slice(0, 8), createdAt: new Date().toISOString() };
  book[key] = [...(book[key] ?? []), appointment];
  write(local(), APPOINTMENTS_KEY, book);
  if (usaSupabase()) {
    // La base valida el plazo entre donaciones y que no haya otra cita activa; si la rechaza, la caché se corrige.
    sb()!.rpc('blud_agendar_cita', { p_centro: data.centerName, p_fecha: data.date, p_hora: data.time }).then(({ error }) => {
      if (error) window.dispatchEvent(new CustomEvent('blud:sync-error', { detail: { mensaje: error.message } }));
      sincronizar();
    });
  }
  window.dispatchEvent(new CustomEvent('blud:auth'));
  return appointment;
}

/**
 * Agenda una cita y espera la respuesta de la base (con Supabase), para poder mostrar su motivo si la rechaza
 * (plazo entre donaciones, otra cita activa…). Si `reemplazar` trae una cita, primero se cancela.
 */
export async function agendarCita(
  email: string, data: Omit<Appointment, 'id' | 'createdAt'>, reemplazar?: string,
): Promise<{ ok: true; appointment: Appointment } | { ok: false; error: string }> {
  if (reemplazar) {
    const c = await cancelarCita(email, reemplazar);
    if (!c.ok) return c;
  }
  if (!usaSupabase()) return { ok: true, appointment: addAppointment(email, data) };
  const { data: id, error } = await sb()!.rpc('blud_agendar_cita', { p_centro: data.centerName, p_fecha: data.date, p_hora: data.time });
  if (error) return { ok: false, error: error.message };
  await sincronizar();
  window.dispatchEvent(new CustomEvent('blud:auth'));
  const appointment = getAppointments(email).find((a) => a.id === id)
    ?? { ...data, id: String(id), createdAt: new Date().toISOString() };
  return { ok: true, appointment };
}

/** Cancela una cita del donante (en la base, si está conectada). */
export async function cancelarCita(email: string, id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (usaSupabase()) {
    const { error } = await sb()!.rpc('blud_cancelar_cita', { p_id: id });
    if (error) return { ok: false, error: error.message };
    await sincronizar();
  } else {
    const book = read<AppointmentBook>(local(), APPOINTMENTS_KEY, {});
    const key = normalize(email);
    book[key] = (book[key] ?? []).filter((a) => a.id !== id);
    write(local(), APPOINTMENTS_KEY, book);
  }
  window.dispatchEvent(new CustomEvent('blud:auth'));
  return { ok: true };
}

/** Cita activa: futura y sin atender ni cancelar. */
export const citaActiva = (a: Appointment, hoy = toDateKey(new Date())) =>
  a.date >= hoy && (!a.estado || a.estado === 'Programada');

/** Próxima cita futura del usuario, si la hay. */
export function nextAppointment(email: string): Appointment | null {
  return getAppointments(email).find((a) => citaActiva(a)) ?? null;
}

export const toDateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** "jue 25 sep · 9:30" */
export function appointmentLabel(a: Pick<Appointment, 'date' | 'time'>): string {
  const [y, m, d] = a.date.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.toLocaleDateString('es-VE', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '');
  return `${day} · ${a.time.replace(/^0/, '')}`;
}

/** "Dra. María Colina" → "María Colina": los títulos no cuentan para el saludo ni las iniciales. */
export const sinTitulo = (name: string) => name.replace(/^(?:(?:Dra?|Lic|Licda|Ing|Prof)\.?\s+)+/i, '').trim() || name;

export const initials = (name: string) =>
  sinTitulo(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** Solo permite volver a rutas internas del sitio. */
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}
async function cambiarClaveRemota(email: string, actual: string, nueva: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = sb()!;
  if (actual === nueva) return { ok: false, error: 'La nueva contraseña debe ser distinta de la actual.' };
  const check = await c.auth.signInWithPassword({ email, password: actual });
  if (check.error) return { ok: false, error: 'La contraseña actual no es correcta.' };
  const { error } = await c.auth.updateUser({ password: nueva });
  return error ? { ok: false, error: 'No pudimos cambiar la contraseña. Inténtalo de nuevo.' } : { ok: true };
}
