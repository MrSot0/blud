// Cuentas y sesión de demostración guardadas en el navegador (localStorage).
// Sustituir por la API real cuando exista: aquí nada sale del dispositivo.

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
  };
  remove(local(), SESSION_KEY);
  remove(session(), SESSION_KEY);
  write(remember ? local() : session(), SESSION_KEY, data);
  document.documentElement.dataset.auth = 'in';
  document.documentElement.dataset.role = data.role;
  window.dispatchEvent(new CustomEvent('blud:auth'));
}

export function logout() {
  remove(local(), SESSION_KEY);
  remove(session(), SESSION_KEY);
  delete document.documentElement.dataset.auth;
  delete document.documentElement.dataset.role;
  window.dispatchEvent(new CustomEvent('blud:auth'));
}

export type LoginResult = { ok: true; user: Session } | { ok: false; error: string };

export async function login(email: string, password: string, remember: boolean): Promise<LoginResult> {
  const target = normalize(email);
  // Si la cuenta tiene copia guardada (cambió su clave o sus datos), manda esa copia.
  const demo = storedUsers().some((u) => u.email === target) ? undefined : demoUsers.find((u) => u.email === target);
  if (demo) {
    if (demo.password !== password) return { ok: false, error: 'Correo o contraseña incorrectos.' };
    startSession(demo, remember);
    return { ok: true, user: demo };
  }

  const user = storedUsers().find((u) => u.email === target);
  if (!user || (await hashPassword(password, user.salt)) !== user.hash) {
    return { ok: false, error: 'Correo o contraseña incorrectos.' };
  }
  startSession(user, remember);
  return { ok: true, user };
}

export type RegisterInput = { name: string; email: string; password: string; bloodType: string };

export async function register(input: RegisterInput): Promise<LoginResult> {
  const email = normalize(input.email);
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

  // TODO: PATCH /api/cuenta
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
  const stored = await ensureStored(s.email);
  if (!stored) return { ok: false, error: 'No encontramos tu cuenta.' };
  if ((await hashPassword(currentPassword, stored.salt)) !== stored.hash) return { ok: false, error: 'La contraseña actual no es correcta.' };
  if (currentPassword === newPassword) return { ok: false, error: 'La nueva contraseña debe ser distinta de la actual.' };
  // TODO: POST /api/auth/cambiar-clave
  const salt = randomSalt();
  saveStored({ ...stored, salt, hash: await hashPassword(newPassword, salt) }, s.email);
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
  window.dispatchEvent(new CustomEvent('blud:auth'));
  return appointment;
}

/** Próxima cita futura del usuario, si la hay. */
export function nextAppointment(email: string): Appointment | null {
  const today = new Date();
  const todayKey = toDateKey(today);
  return getAppointments(email).find((a) => a.date >= todayKey) ?? null;
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

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

/** Solo permite volver a rutas internas del sitio. */
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/';
}