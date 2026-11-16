// src/lib/citas.ts
// Bandeja de citas del centro (operador). El donante agenda en la app; el operador del centro ve la cita,
// marca la llegada, la atiende (evaluación y extracción en Donaciones) o la marca como ausencia.
// Con base real sale de blud_bandeja_citas(); en modo demo, del libro de citas de este navegador.

import { registro } from './db';
import { sb, usaSupabase } from './supabase';

export type EstadoCita = 'Programada' | 'En espera' | 'Atendida' | 'No apto' | 'No asistió' | 'Cancelada';

export interface CitaCentro {
  id: string;
  fecha: string; // YYYY-MM-DD (hora de Caracas)
  hora: string; // HH:MM
  estado: EstadoCita;
  observaciones?: string;
  donante: {
    id: string; nombre: string; cedula?: string; telefono?: string; sangre?: string; foto?: string;
    verificado?: boolean; cuestionario?: 'apto' | 'alertas';
    diferimiento?: { tipo: 'temporal' | 'permanente'; hasta?: string };
    contactoPendiente?: boolean;
  };
}

export interface Bandeja { centro: string; hoy: string; citas: CitaCentro[] }

const LIBRO = 'blud-appointments';
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

type Libro = Record<string, { id: string; centerName: string; date: string; time: string; estado?: string }[]>;
const leerLibro = (): Libro => { try { return JSON.parse(localStorage.getItem(LIBRO) || '{}'); } catch { return {}; } };

function bandejaDemo(): Bandeja {
  const libro = leerLibro();
  const citas: CitaCentro[] = [];
  for (const [email, lista] of Object.entries(libro)) {
    const r = registro.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    for (const a of lista ?? []) {
      citas.push({
        id: a.id, fecha: a.date, hora: a.time, estado: (a.estado as EstadoCita) || 'Programada',
        donante: {
          id: r?.id ?? email, nombre: r?.nombreCompleto ?? email, cedula: r?.cedula, telefono: r?.telefono,
          sangre: r?.sangre, verificado: r?.estado === 'verificado',
        },
      });
    }
  }
  citas.sort((a, b) => `${a.fecha}${a.hora}`.localeCompare(`${b.fecha}${b.hora}`));
  return { centro: 'Tu centro', hoy: hoyLocal(), citas };
}

export async function bandejaCitas(dias = 14): Promise<Bandeja> {
  if (!usaSupabase()) return bandejaDemo();
  const { data, error } = await sb()!.rpc('blud_bandeja_citas', { p_dias: dias });
  if (error) throw new Error(error.message || 'No pudimos cargar las citas del centro.');
  return data as Bandeja;
}

/** El operador marca la llegada ('En espera'), la ausencia ('No asistió') o la deshace ('Programada'). */
export async function marcarCita(id: string, estado: 'Programada' | 'En espera' | 'No asistió'): Promise<void> {
  if (!usaSupabase()) {
    const libro = leerLibro();
    for (const lista of Object.values(libro)) for (const a of lista ?? []) if (a.id === id) a.estado = estado;
    localStorage.setItem(LIBRO, JSON.stringify(libro));
    return;
  }
  const { error } = await sb()!.rpc('blud_cita_marcar', { p_id: id, p_estado: estado });
  if (error) throw new Error(error.message || 'No pudimos actualizar la cita.');
}

/** Citas de hoy que siguen abiertas (por llegar o en espera): el contador del menú. */
export const abiertasHoy = (b: Bandeja) =>
  b.citas.filter((c) => c.fecha === b.hoy && (c.estado === 'Programada' || c.estado === 'En espera')).length;

/** Modo demo: al guardar la donación o la evaluación desde una cita, se cierra en el libro local (con base real lo hace un trigger). */
export function cerrarCitaDemo(id: string, estado: 'Atendida' | 'No apto'): void {
  if (usaSupabase()) return;
  const libro = leerLibro();
  for (const lista of Object.values(libro)) for (const a of lista ?? []) if (a.id === id) a.estado = estado;
  localStorage.setItem(LIBRO, JSON.stringify(libro));
}
