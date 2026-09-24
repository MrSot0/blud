// Cuentas y sesión de demostración guardadas en el navegador (localStorage).
// Sustituir por la API real cuando exista: aquí nada sale del dispositivo.

export interface Session {
  email: string;
  name: string;
  bloodType: string;
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
  { name: 'María Fernández', email: 'maria@blud.app', password: 'Donante2026', bloodType: 'O+' },
  { name: 'Carlos Pérez', email: 'carlos@blud.app', password: 'Sangre2026', bloodType: 'A-' },
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
  return read<Session | null>(local(), SESSION_KEY, null) ?? read<Session | null>(session(), SESSION_KEY, null);
}

function startSession(user: Session, remember: boolean) {
  const data: Session = { email: user.email, name: user.name, bloodType: user.bloodType };
  remove(local(), SESSION_KEY);
  remove(session(), SESSION_KEY);
  write(remember ? local() : session(), SESSION_KEY, data);
  document.documentElement.dataset.auth = 'in';
  window.dispatchEvent(new CustomEvent('blud:auth'));
}

export function logout() {
  remove(local(), SESSION_KEY);
  remove(session(), SESSION_KEY);
  delete document.documentElement.dataset.auth;
  window.dispatchEvent(new CustomEvent('blud:auth'));
}

export type LoginResult = { ok: true; user: Session } | { ok: false; error: string };

export async function login(email: string, password: string, remember: boolean): Promise<LoginResult> {
  const target = normalize(email);
  const demo = demoUsers.find((u) => u.email === target);
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
    bloodType: input.bloodType,
    salt,
    hash: await hashPassword(input.password, salt),
    createdAt: new Date().toISOString(),
  };
  write(local(), USERS_KEY, [...storedUsers(), user]);
  startSession(user, true);
  return { ok: true, user };
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
