// src/lib/menus.ts
// Menú lateral de cada rol en un solo archivo. Añadir una opción = añadir una línea aquí.

import type { Role } from './roles';

export type IconKey =
  | 'user' | 'drop' | 'clock' | 'pin' | 'help' | 'settings'
  | 'dashboard' | 'verify' | 'users' | 'file' | 'truck' | 'package'
  | 'flask' | 'layers' | 'alert' | 'chart';

export interface MenuItem {
  label: string;
  hint: string;
  href: string;
  icon: IconKey;
}

export interface RoleMenu {
  titulo: string;
  items: MenuItem[];
  /** Opciones de cuenta, separadas al final del menú */
  cuenta: MenuItem[];
}

export const ICON_PATHS: Record<IconKey, string> = {
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  drop: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  help: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  dashboard: '<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
  verify: '<path d="m16 11 2 2 4-4"/><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  flask: '<path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2"/><path d="M8.5 2h7"/><path d="M7 16h10"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
};

export const MENUS: Partial<Record<Role, RoleMenu>> = {
  donante: {
    titulo: 'Mi espacio',
    items: [
      { label: 'Mi perfil', hint: 'Tu carnet digital', href: '/donante/perfil', icon: 'user' },
      { label: 'Donar sangre', hint: 'Agenda tu donación', href: '/donante/donar', icon: 'drop' },
      { label: 'Mi historial', hint: 'Tus donaciones pasadas', href: '/donante/historial', icon: 'clock' },
      { label: 'Centros cercanos', hint: 'Dónde puedes donar', href: '/donante/centros', icon: 'pin' },
      { label: 'Soporte', hint: 'Estamos para ayudarte', href: '/donante/soporte', icon: 'help' },
    ],
    cuenta: [
      { label: 'Configuración', hint: 'Tema, avisos y privacidad', href: '/donante/configuracion', icon: 'settings' },
    ],
  },
  operador: {
    titulo: 'Operación',
    items: [
      { label: 'Panel', hint: 'Resumen y stock', href: '/operador/panel', icon: 'dashboard' },
      { label: 'Donantes', hint: 'Verificar y registrar', href: '/operador/donantes', icon: 'verify' },
      { label: 'Donaciones', hint: 'Registrar extracciones', href: '/operador/donaciones', icon: 'drop' },
      { label: 'Prescribir', hint: 'Cargar orden médica', href: '/operador/prescribir', icon: 'file' },
      { label: 'Entregas', hint: 'Despachar pedidos', href: '/operador/entregas', icon: 'truck' },
      { label: 'Historial', hint: 'Toda tu actividad', href: '/operador/historial', icon: 'clock' },
    ],
    cuenta: [
      { label: 'Mi perfil', hint: 'Tu ecard del personal', href: '/operador/perfil', icon: 'user' },
      { label: 'Configuración', hint: 'Datos y contraseña', href: '/operador/configuracion', icon: 'settings' },
    ],
  },
  laboratorio: {
    titulo: 'Laboratorio',
    items: [
      { label: 'Panel', hint: 'Resumen del laboratorio', href: '/laboratorio/panel', icon: 'dashboard' },
      { label: 'Pruebas', hint: 'Tamizaje de donaciones', href: '/laboratorio/pruebas', icon: 'flask' },
      { label: 'Fraccionamiento', hint: 'Hemocomponentes obtenidos', href: '/laboratorio/fraccionamiento', icon: 'layers' },
      { label: 'Casos positivos', hint: 'Reportar y notificar', href: '/laboratorio/positivos', icon: 'alert' },
      { label: 'Reportes', hint: 'Estadísticas y exportación', href: '/laboratorio/reportes', icon: 'chart' },
      { label: 'Registros', hint: 'Toda tu actividad', href: '/laboratorio/registros', icon: 'clock' },
    ],
    cuenta: [
      { label: 'Mi perfil', hint: 'Tu ecard del personal', href: '/laboratorio/perfil', icon: 'user' },
      { label: 'Configuración', hint: 'Datos y contraseña', href: '/laboratorio/configuracion', icon: 'settings' },
    ],
  },
};