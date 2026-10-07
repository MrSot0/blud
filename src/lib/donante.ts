// src/lib/donante.ts
// Utilidades compartidas del módulo de donante (centros, citas, historial, toast).
// Todo se guarda en localStorage por ahora; cada función marcada con TODO es el punto de cambio al backend.

export interface Centro {
  id: string;
  nombre: string;
  zona: string;
  lat: number;
  lng: number;
  horario: string;
  /** Tipos de sangre que el centro necesita con urgencia */
  necesita: string[];
}

// DATOS DE EJEMPLO: reemplazar por la misma fuente que usa el componente Map (nombres, coordenadas y horarios reales).
export const CENTROS: Centro[] = [
  { id: 'hcm', nombre: 'Hospital Central Maracaibo', zona: 'Maracaibo, Zulia', lat: 10.6606, lng: -71.6165, horario: 'Lun–Vie · 7:00 a 15:00', necesita: ['O-', 'A-'] },
  { id: 'hum', nombre: 'Hospital Universitario de Maracaibo', zona: 'Maracaibo, Zulia', lat: 10.6667, lng: -71.6081, horario: 'Lun–Sáb · 7:00 a 14:00', necesita: ['O+', 'B-'] },
  { id: 'hchiq', nombre: 'Hospital Chiquinquirá', zona: 'Maracaibo, Zulia', lat: 10.6736, lng: -71.6224, horario: 'Lun–Vie · 8:00 a 16:00', necesita: ['AB-'] },
  { id: 'hcor', nombre: 'Hospital Coromoto', zona: 'Maracaibo, Zulia', lat: 10.6512, lng: -71.6358, horario: 'Lun–Vie · 7:30 a 15:30', necesita: [] },
];

export const centroById = (id: string) => CENTROS.find((c) => c.id === id);

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
  fecha: string; // YYYY-MM-DD
  sangre: string;
  ml: number;
}

const K_DONOR = 'blud-donor';
const K_CITA = 'blud-donor-cita';
const K_HIST = 'blud-donor-historial';

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
}

export const uid = () => Math.random().toString(36).slice(2, 10);

// ---- Donante (lo escribe /donante/perfil) ----
export const getDonor = () => read<Record<string, any>>(K_DONOR, {});

// ---- Cita ---- TODO: reemplazar por API
export const getCita = () => read<Cita | null>(K_CITA, null);
export const saveCita = (c: Cita) => write(K_CITA, c);
export const cancelCita = () => { try { localStorage.removeItem(K_CITA); } catch {} };

// ---- Historial ---- TODO: reemplazar por API
export const getHistorial = () =>
  read<Donacion[]>(K_HIST, []).sort((a, b) => b.fecha.localeCompare(a.fecha));

export function saveHistorial(list: Donacion[]) {
  write(K_HIST, list);
  // Mantiene sincronizado el contador del carnet en /donante/perfil
  write(K_DONOR, { ...getDonor(), donaciones: list.length });
}

export function seedDemo() {
  const d = getDonor();
  const sangre = d.sangre || 'O+';
  const mk = (fecha: string, centroId: string): Donacion => ({ id: uid(), fecha, centroId, sangre, ml: 450 });
  saveHistorial([mk('2026-06-12', 'hcm'), mk('2026-02-20', 'hum'), mk('2025-10-03', 'hcm')]);
}

// ---- Formato ----
export function fmtFecha(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' }) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('es-VE', opts);
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---- Toast ----
let toastTimer: number | undefined;
export function toast(msg: string) {
  let el = document.getElementById('blud-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'blud-toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText =
      'position:fixed;left:50%;bottom:1.5rem;z-index:80;padding:.75rem 1.25rem;border-radius:9999px;' +
      'background:var(--ink);color:var(--surface);font-size:.875rem;font-weight:600;pointer-events:none;' +
      'box-shadow:0 12px 30px -10px rgb(0 0 0/.5);transition:transform 300ms ease,opacity 300ms ease;' +
      'transform:translate(-50%,20px);opacity:0';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  requestAnimationFrame(() => {
    el!.style.transform = 'translate(-50%,0)';
    el!.style.opacity = '1';
  });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el!.style.transform = 'translate(-50%,20px)';
    el!.style.opacity = '0';
  }, 3200);
}