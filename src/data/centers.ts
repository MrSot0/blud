// Centros de salud de la red BLUD. Alimenta el mapa de la portada y la página /centros.
// Datos de ejemplo hasta conectar la API: teléfonos ficticios y coordenadas aproximadas.

export type CenterKind = 'banco' | 'hospital' | 'clinica';

export interface CenterHours {
  /** Días de atención: 0 = domingo … 6 = sábado. */
  days: number[];
  /** Hora de apertura y cierre en formato 24 h (HH:MM). */
  open: string;
  close: string;
}

export interface HealthCenter {
  id: string;
  name: string;
  kind: CenterKind;
  type: string;
  address: string;
  city: 'Maracaibo' | 'San Francisco';
  coords: [number, number];
  phone: string;
  hours: CenterHours;
  /** Tipos de sangre que el centro necesita con prioridad. */
  needs: string[];
  /** Enlace directo a Google Maps; si falta, se busca por nombre y dirección. */
  mapsUrl?: string;
}

export const centerKinds: { id: CenterKind; label: string }[] = [
  { id: 'banco', label: 'Bancos de sangre' },
  { id: 'hospital', label: 'Hospitales' },
  { id: 'clinica', label: 'Clínicas' },
];

const weekdays = [1, 2, 3, 4, 5];
const weekdaysAndSaturday = [1, 2, 3, 4, 5, 6];

export const centers: HealthCenter[] = [
  {
    id: 'c1',
    name: 'Banco de Sangre del Zulia',
    kind: 'banco',
    type: 'Banco de sangre principal',
    address: 'Av. 22 con Calle 67, Maracaibo',
    city: 'Maracaibo',
    coords: [10.6698, -71.6285],
    phone: '+58 261-7000001',
    hours: { days: weekdaysAndSaturday, open: '07:00', close: '15:00' },
    needs: ['O-', 'A+'],
    mapsUrl: 'https://maps.app.goo.gl/PA9nwY6t9VGKSuiE6',
  },
  {
    id: 'c2',
    name: 'Hospital Universitario de Maracaibo',
    kind: 'hospital',
    type: 'Hospital general',
    address: 'Av. 16 (Goajira), Maracaibo',
    city: 'Maracaibo',
    coords: [10.6831, -71.6322],
    phone: '+58 261-7000002',
    hours: { days: [0, 1, 2, 3, 4, 5, 6], open: '07:00', close: '19:00' },
    needs: ['O-'],
    mapsUrl: 'https://maps.app.goo.gl/z1jzD6CASFry3Sfi7',
  },
  {
    id: 'c3',
    name: 'Policlínica Amado',
    kind: 'clinica',
    type: 'Clínica privada aliada',
    address: 'Av. 5 de Julio, Maracaibo',
    city: 'Maracaibo',
    coords: [10.6625, -71.615],
    phone: '+58 261-7000003',
    hours: { days: weekdays, open: '08:00', close: '16:00' },
    needs: [],
    mapsUrl: 'https://maps.app.goo.gl/4oMLgab81CbtjLyx7',
  },
  {
    id: 'c4',
    name: 'Hospital Coromoto',
    kind: 'hospital',
    type: 'Hospital general',
    address: 'Av. El Milagro, Maracaibo',
    city: 'Maracaibo',
    coords: [10.6742, -71.6048],
    phone: '+58 261-7000004',
    hours: { days: weekdaysAndSaturday, open: '07:30', close: '17:00' },
    needs: ['B+'],
  },
  {
    id: 'c5',
    name: 'Hospital Central Dr. Urquinaona',
    kind: 'hospital',
    type: 'Hospital general',
    address: 'Casco central, Maracaibo',
    city: 'Maracaibo',
    coords: [10.6493, -71.6068],
    phone: '+58 261-7000005',
    hours: { days: [0, 1, 2, 3, 4, 5, 6], open: '07:00', close: '18:00' },
    needs: ['O+', 'AB-'],
  },
  {
    id: 'c6',
    name: 'Hospital Chiquinquirá',
    kind: 'hospital',
    type: 'Hospital general',
    address: 'Av. Padilla, Maracaibo',
    city: 'Maracaibo',
    coords: [10.6446, -71.6158],
    phone: '+58 261-7000006',
    hours: { days: weekdays, open: '07:00', close: '15:00' },
    needs: [],
  },
  {
    id: 'c7',
    name: 'Hospital General del Sur Dr. Pedro Iturbe',
    kind: 'hospital',
    type: 'Hospital general',
    address: 'Zona sur, Maracaibo',
    city: 'Maracaibo',
    coords: [10.6118, -71.6402],
    phone: '+58 261-7000007',
    hours: { days: weekdaysAndSaturday, open: '07:00', close: '16:00' },
    needs: ['A-'],
  },
  {
    id: 'c8',
    name: 'Hospital Dr. Manuel Noriega Trigo',
    kind: 'hospital',
    type: 'Hospital general',
    address: 'San Francisco, Zulia',
    city: 'San Francisco',
    coords: [10.5693, -71.6362],
    phone: '+58 261-7000008',
    hours: { days: weekdays, open: '07:00', close: '15:00' },
    needs: ['O-', 'B-'],
  },
];

/** Los tres centros que se muestran en la portada. */
export const featuredCenters = centers.slice(0, 3);

const dayShort = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** "7:00" en lugar de "07:00". */
const clock = (hhmm: string) => hhmm.replace(/^0/, '');

/** Resume el horario: "Lun a Vie · 7:00 – 15:00". */
export function hoursLabel({ days, open, close }: CenterHours): string {
  const sorted = [...days].sort((a, b) => a - b);
  let range: string;
  if (sorted.length === 7) range = 'Todos los días';
  else if (sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1))
    range = `${dayShort[sorted[0]]} a ${dayShort[sorted[sorted.length - 1]]}`;
  else range = sorted.map((d) => dayShort[d]).join(', ');
  return `${range} · ${clock(open)} – ${clock(close)}`;
}

/** Enlace de indicaciones en Google Maps. */
export function directionsUrl(center: HealthCenter): string {
  if (center.mapsUrl) return center.mapsUrl;
  const destination = encodeURIComponent(`${center.name}, ${center.address}`);
  return `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
}

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

export const prettyBloodType = (t: string) => t.replace('-', '−');
