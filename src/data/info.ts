// Temas de la sección "Infórmate". Alimenta el menú, el índice, el footer
// y la navegación anterior/siguiente entre páginas.
import type { IconName } from '../lib/icons';

export interface InfoTopic {
  slug: string;
  title: string;
  short: string;
  icon: IconName;
}

export const infoTopics: InfoTopic[] = [
  {
    slug: 'tipos-de-donacion',
    title: 'Tipos de donación',
    short: 'Sangre total, plaquetas, plasma y glóbulos rojos: cuál conviene según tu tipo.',
    icon: 'drop-half',
  },
  {
    slug: 'primera-donacion',
    title: 'Tu primera donación',
    short: 'Qué pasa paso a paso, cómo prepararte y los mitos más comunes.',
    icon: 'calendar-check',
  },
  {
    slug: 'viaje-de-tu-sangre',
    title: 'El viaje de tu sangre',
    short: 'Del brazo al hospital en siete etapas, y cómo te avisamos al llegar.',
    icon: 'truck',
  },
  {
    slug: 'sangre-artificial',
    title: 'Sangre artificial en Japón',
    short: 'Cómo funcionan los glóbulos rojos artificiales que ya se prueban en personas.',
    icon: 'atom',
  },
  {
    slug: 'beneficios',
    title: 'Beneficios de donar',
    short: 'Lo que ganas tú, lo que gana tu ciudad y lo que dice la evidencia.',
    icon: 'hand-heart',
  },
];

export const infoHref = (slug: string) => `/informate/${slug}`;
