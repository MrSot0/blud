// src/lib/personal.ts
// Perfil del personal administrativo (operador, laboratorio, director).
// Combina lo que asigna la dirección (nombre, cargo, MPPS, sede: vienen de la sesión)
// con lo que la persona completa ella misma (foto, cédula, tipo de sangre, teléfono).
// TODO: reemplazar por GET/PATCH /api/personal/:id

import { getSession } from './auth';
import { sb, usaSupabase } from './supabase';
import type { Role } from './auth';

export type { Role };
export { toast } from './ui';

export const SANGRES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export const AREA_POR_ROL: Record<string, string> = {
  operador: 'Operación y donaciones',
  laboratorio: 'Laboratorio · tamizaje y fraccionamiento',
  soporte: 'Atención al donante',
  director: 'Dirección general',
};

export interface PerfilPersonal {
  nombre: string;
  email: string;
  cargo: string;
  mpps: string;
  sede: string;
  area: string;
  rol: Role;
  // editables
  foto: string; // foto de perfil (burbuja): data URL JPEG cuadrado o ''
  portada: string; // imagen de fondo a todo el ancho: data URL JPEG o ''
  fotoY: number; // encuadre vertical de la portada, 0-100
  telefono: string;
  cedula: string;
  sangre: string;
  desde: string; // YYYY-MM-DD, primera vez que se abrió el perfil
}

type Editable = Pick<PerfilPersonal, 'foto' | 'portada' | 'fotoY' | 'telefono' | 'cedula' | 'sangre' | 'desde'>;

const KEY = 'blud-staff';

function readAll(): Record<string, Partial<Editable>> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') ?? {}; } catch { return {}; }
}

export const normCedulaPersonal = (v: string) => {
  const m = v.trim().toUpperCase().replace(/[\s.]/g, '').match(/^([VEJ])?-?(\d{5,9})$/);
  return m ? `${m[1] ?? 'V'}-${m[2]}` : '';
};

export function cargarPerfil(role?: Role): PerfilPersonal {
  const s = (getSession() ?? {}) as Record<string, any>;
  const rol = (role ?? s.role ?? 'operador') as Role;
  const email = String(s.email ?? '').toLowerCase();
  const saved = readAll()[email || rol] ?? {};
  const sangreSesion = String(s.bloodType ?? '').replace('−', '-');
  return {
    nombre: String(s.name ?? 'Personal BLUD'),
    email,
    cargo: String(s.cargo ?? ''),
    mpps: String(s.colegiado ?? ''),
    sede: String(s.sede ?? ''),
    area: AREA_POR_ROL[rol] ?? '',
    rol,
    foto: saved.foto ?? '',
    portada: saved.portada ?? '',
    fotoY: typeof saved.fotoY === 'number' ? saved.fotoY : 30,
    // Con base real, teléfono y cédula vienen de la base (se editan en Configuración o los asigna la dirección).
    telefono: usaSupabase() ? String(s.telefono ?? '') : saved.telefono ?? String(s.telefono ?? ''),
    cedula: usaSupabase() ? String(s.cedula ?? '') : saved.cedula ?? '',
    sangre: saved.sangre ?? (SANGRES.includes(sangreSesion) ? sangreSesion : ''),
    desde: saved.desde ?? '',
  };
}

export type Guardado = { ok: true; perfil: PerfilPersonal } | { ok: false; motivo: string };

export function guardarPerfil(patch: Partial<Omit<Editable, 'desde'>>, role?: Role): Guardado {
  const actual = cargarPerfil(role);
  const next: Editable = {
    foto: patch.foto ?? actual.foto,
    portada: patch.portada ?? actual.portada,
    fotoY: Math.min(100, Math.max(0, patch.fotoY ?? actual.fotoY)),
    telefono: (patch.telefono ?? actual.telefono).trim(),
    cedula: patch.cedula ?? actual.cedula,
    sangre: patch.sangre ?? actual.sangre,
    desde: actual.desde || new Date().toISOString().slice(0, 10),
  };
  if (next.cedula.trim()) {
    const c = normCedulaPersonal(next.cedula);
    if (!c) return { ok: false, motivo: 'La cédula debe verse así: V-12345678.' };
    next.cedula = c;
  } else next.cedula = '';
  if (next.sangre && !SANGRES.includes(next.sangre)) return { ok: false, motivo: 'Tipo de sangre no válido.' };
  if (next.telefono && !/^[+\d][\d\s()-]{6,}$/.test(next.telefono)) return { ok: false, motivo: 'Revisa el teléfono.' };

  const email = actual.email || actual.rol;
  const all = readAll();
  all[email] = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    return { ok: false, motivo: 'No hay espacio para guardar la foto. Prueba con una más pequeña.' };
  }
  try { window.dispatchEvent(new Event('blud:staff')); } catch {}
  return { ok: true, perfil: cargarPerfil(role) };
}

/** Portada: reduce la imagen a máx. `ancho` px y devuelve un JPEG data URL liviano. */
export async function procesarFoto(file: File, ancho = 1600): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Usa una imagen JPG, PNG o WebP.');
  if (file.size > 12 * 1024 * 1024) throw new Error('La imagen pesa más de 12 MB.');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, ancho / bmp.width);
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.82);
}

/** Foto de perfil: recorte cuadrado centrado de `lado` px (ligera, apta para localStorage). */
export async function procesarAvatar(file: File, lado = 480): Promise<string> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('Usa una imagen JPG, PNG o WebP.');
  if (file.size > 12 * 1024 * 1024) throw new Error('La imagen pesa más de 12 MB.');
  const bmp = await createImageBitmap(file);
  const m = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = Math.min(lado, m);
  c.getContext('2d')!.drawImage(bmp, (bmp.width - m) / 2, (bmp.height - m) / 2, m, m, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL('image/jpeg', 0.85);
}

export const iniciales = (n: string) =>
  n.replace(/^(Dra?|Lic|Ing)\.?\s+/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
// ------------------------------------------------------------------ Foto de perfil en la base
// Con base real, la foto del personal va al mismo almacenamiento que la del donante (bucket fotos-donantes,
// carpeta de su cuenta) y se enlaza con blud_guardar_foto. La portada es decorativa y queda en este dispositivo.

/** URL de la foto guardada en la base (o null). */
export async function fotoRemota(): Promise<string | null> {
  const c = sb();
  if (!c) return null;
  const { data } = await c.rpc('blud_mi_ficha');
  const path = (data as { foto?: string } | null)?.foto;
  return path ? c.storage.from('fotos-donantes').getPublicUrl(path).data.publicUrl : null;
}

/** Sube la foto (data URL JPEG ya recortada) a la base. */
export async function subirFotoRemota(dataUrl: string): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const c = sb();
  if (!c) return { ok: true };
  const { data: ses } = await c.auth.getSession();
  const uid = ses.session?.user.id;
  if (!uid) return { ok: false, motivo: 'Inicia sesión de nuevo.' };
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${uid}/perfil-${Date.now()}.jpg`;
  const up = await c.storage.from('fotos-donantes').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (up.error) return { ok: false, motivo: `No pudimos subir la foto: ${up.error.message}` };
  const { error } = await c.rpc('blud_guardar_foto', { p_path: path });
  return error ? { ok: false, motivo: error.message } : { ok: true };
}
