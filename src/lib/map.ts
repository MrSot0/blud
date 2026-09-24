// Utilidades de Leaflet compartidas por el mapa de la portada y la página /centros.
// Leaflet se carga bajo demanda desde unpkg (con SRI) solo cuando hace falta.
import { directionsUrl, hoursLabel, type HealthCenter } from '../data/centers';

declare global {
  interface Window {
    L?: any;
  }
}

const LEAFLET_CSS = {
  href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  integrity: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};
const LEAFLET_JS = {
  src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  integrity: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
};

let loading: Promise<any> | null = null;

export function loadLeaflet(): Promise<any> {
  if (window.L) return Promise.resolve(window.L);
  if (loading) return loading;

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = LEAFLET_CSS.href;
  css.integrity = LEAFLET_CSS.integrity;
  css.crossOrigin = '';
  document.head.appendChild(css);

  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LEAFLET_JS.src;
    script.integrity = LEAFLET_JS.integrity;
    script.crossOrigin = '';
    script.onload = () => resolve(window.L);
    script.onerror = () => {
      loading = null;
      reject(new Error('Leaflet no cargó'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/** Ejecuta `start` cuando el elemento está por entrar en pantalla. */
export function whenNearViewport(el: Element, start: () => void) {
  if (!('IntersectionObserver' in window)) return start();
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        start();
      }
    },
    { rootMargin: '400px 0px' }
  );
  io.observe(el);
}

export const MARACAIBO: [number, number] = [10.655, -71.625];

export function createMap(L: any, el: HTMLElement, options: { zoom?: number; attribution?: string } = {}) {
  const map = L.map(el, { scrollWheelZoom: false, zoomControl: true, attributionControl: false }).setView(
    MARACAIBO,
    options.zoom ?? 13
  );
  L.control.attribution({ position: options.attribution ?? 'bottomright', prefix: false }).addTo(map);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // La rueda del ratón solo hace zoom después de interactuar con el mapa.
  map.once('focus click', () => map.scrollWheelZoom.enable());
  return map;
}

export const centerIcon = (L: any) =>
  L.divIcon({
    className: '',
    html: `<div class="blud-pin"><span></span></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -10],
  });

export const userIcon = (L: any) =>
  L.divIcon({
    className: '',
    html: `<div class="blud-user-pin"><span></span></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Contenido del globo del mapa: datos del centro y las dos acciones. */
export function popupHtml(center: HealthCenter): string {
  return `
    <div class="blud-popup">
      <h4>${escapeHtml(center.name)}</h4>
      <p>${escapeHtml(center.type)}</p>
      <p class="blud-popup-meta">${escapeHtml(hoursLabel(center.hours))}</p>
      <p class="blud-popup-meta">${escapeHtml(center.phone)}</p>
      <div class="blud-popup-actions">
        <a class="blud-popup-btn" href="${escapeHtml(directionsUrl(center))}" target="_blank" rel="noopener noreferrer">
          Cómo llegar<span class="sr-only"> (abre Google Maps en otra pestaña)</span>
        </a>
        <button type="button" class="blud-popup-btn is-primary" data-schedule="${escapeHtml(center.id)}">Agendar aquí</button>
      </div>
    </div>
  `;
}

export const popupOptions = { minWidth: 240, maxWidth: 290, autoPanPadding: [24, 24] };

/** Distancia en km entre dos coordenadas (fórmula del haverseno). */
export function distanceKm([lat1, lon1]: [number, number], [lat2, lon2]: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export const formatKm = (km: number) =>
  km < 1 ? `${Math.round(km * 1000)} m` : `${km.toLocaleString('es-VE', { maximumFractionDigits: km < 10 ? 1 : 0 })} km`;

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Estado de apertura según la hora local del visitante. */
export function openStatus(center: HealthCenter, now = new Date()): { open: boolean; label: string } {
  const { days, open, close } = center.hours;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const clock = (t: string) => t.replace(/^0/, '');

  if (days.includes(today) && minutes >= toMinutes(open) && minutes < toMinutes(close)) {
    return { open: true, label: `Abierto · cierra a las ${clock(close)}` };
  }
  if (days.includes(today) && minutes < toMinutes(open)) {
    return { open: false, label: `Cerrado · abre a las ${clock(open)}` };
  }
  const names = ['el domingo', 'el lunes', 'el martes', 'el miércoles', 'el jueves', 'el viernes', 'el sábado'];
  for (let i = 1; i <= 7; i++) {
    const day = (today + i) % 7;
    if (days.includes(day)) {
      return { open: false, label: `Cerrado · abre ${i === 1 ? 'mañana' : names[day]} a las ${clock(open)}` };
    }
  }
  return { open: false, label: 'Cerrado' };
}
