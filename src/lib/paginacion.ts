// src/lib/paginacion.ts
// Paginación de listas largas. Ninguna pantalla pinta todo de golpe:
//   1. Lo que ya está en la caché (último año, ver private.ventana_cache) se muestra de a «tam» filas con «Mostrar más».
//   2. Agotada la caché, «Ver registros anteriores» pide a la base páginas de blud_pagina() (cursor por fecha + id).
// Con modo demo (sin base) solo existe el paso 1.

import { sb, usaSupabase } from './supabase';

export interface PaginaRemota<T> { items: T[]; siguiente: string | null; total: number }
export type Coleccion = 'donaciones' | 'donantes' | 'pruebas' | 'fracciones' | 'tickets';

/** Una página de la base. null si no hay base conectada. */
export async function paginaRemota<T>(
  coleccion: Coleccion,
  o: { q?: string; filtros?: Record<string, string | undefined>; limite?: number; cursor?: string | null } = {},
): Promise<PaginaRemota<T> | null> {
  if (!usaSupabase()) return null;
  const filtros = Object.fromEntries(Object.entries(o.filtros ?? {}).filter(([, v]) => v));
  const { data, error } = await sb()!.rpc('blud_pagina', {
    p_coleccion: coleccion, p_q: o.q?.trim() || null, p_filtros: filtros, p_limite: o.limite ?? 25, p_cursor: o.cursor ?? null,
  });
  if (error) throw new Error(error.message || 'No pudimos cargar más registros.');
  const r = (data ?? {}) as { items?: T[]; siguiente?: string | null; total?: number };
  return { items: r.items ?? [], siguiente: r.siguiente ?? null, total: r.total ?? 0 };
}

/** Fecha (YYYY-MM-DD) más antigua de una lista: el límite para pedir «anteriores» a la base. */
export const masAntigua = <T>(items: T[], fecha: (t: T) => string | undefined) =>
  items.reduce<string | undefined>((min, t) => { const f = fecha(t)?.slice(0, 10); return f && (!min || f < min) ? f : min; }, undefined);

export interface OpcionesPaginador<T> {
  /** Donde van las filas (tbody, ul…). */
  lista: HTMLElement;
  /** Contenedor del componente Paginador (estado + botón). */
  pie: HTMLElement;
  /** Filas por tanda. */
  tam?: number;
  render: (items: T[]) => string;
  /** HTML cuando no hay nada que mostrar. */
  vacio: () => string;
  clave: (t: T) => string;
  /** Registros anteriores a la caché. Recibe el cursor (null = primera página remota). */
  remoto?: (cursor: string | null) => Promise<PaginaRemota<T> | null>;
  /** Nombre en plural para el texto de estado («donaciones», «tickets»…). */
  nombre?: string;
}

export class Paginador<T> {
  private o: Required<Omit<OpcionesPaginador<T>, 'remoto'>> & Pick<OpcionesPaginador<T>, 'remoto'>;
  private locales: T[] = [];
  private extra: T[] = [];
  private visibles: number;
  private firma = '\u0000';
  private cursor: string | null = null;
  private remotoAgotado = false;
  private totalRemoto: number | null = null;
  private cargando = false;
  private btn: HTMLButtonElement;
  private estado: HTMLElement;

  constructor(o: OpcionesPaginador<T>) {
    this.o = { tam: 20, nombre: 'registros', ...o };
    this.visibles = this.o.tam;
    this.btn = o.pie.querySelector<HTMLButtonElement>('[data-pag-mas]')!;
    this.estado = o.pie.querySelector<HTMLElement>('[data-pag-estado]')!;
    this.btn.addEventListener('click', () => this.mas());
  }

  /**
   * Pinta la lista ya filtrada. `firma` identifica los filtros vigentes: si cambia, vuelve a la primera tanda
   * y olvida lo traído de la base (que respondía a otros filtros).
   */
  mostrar(items: T[], firma = '') {
    if (firma !== this.firma) {
      this.firma = firma;
      this.visibles = this.o.tam;
      this.extra = [];
      this.cursor = null;
      this.remotoAgotado = !this.o.remoto;
      this.totalRemoto = null;
    }
    this.locales = items;
    this.pintar();
  }

  private todos(): T[] {
    if (!this.extra.length) return this.locales;
    const vistos = new Set(this.locales.map(this.o.clave));
    return this.locales.concat(this.extra.filter((t) => !vistos.has(this.o.clave(t))));
  }

  private pintar() {
    const todos = this.todos();
    const vis = todos.slice(0, this.visibles);
    this.o.lista.innerHTML = vis.length ? this.o.render(vis) : this.o.vacio();
    const quedanLocales = todos.length - vis.length;
    const puedeRemoto = !!this.o.remoto && !this.remotoAgotado;
    const total = this.totalRemoto !== null ? Math.max(this.totalRemoto, todos.length) : todos.length;
    this.estado.textContent = !todos.length ? '' : vis.length < total
      ? `Mostrando ${vis.length} de ${total} ${this.o.nombre}`
      : puedeRemoto ? `${vis.length} ${this.o.nombre} del último año` : `${vis.length} ${this.o.nombre}`;
    this.o.pie.hidden = !todos.length;
    if (quedanLocales > 0) {
      this.btn.hidden = false;
      this.btn.textContent = `Mostrar ${Math.min(this.o.tam, quedanLocales)} más`;
    } else if (puedeRemoto && todos.length) {
      this.btn.hidden = false;
      this.btn.textContent = this.cursor ? 'Cargar más anteriores' : 'Ver registros anteriores';
    } else {
      this.btn.hidden = true;
    }
    this.btn.disabled = this.cargando;
  }

  private async mas() {
    const todos = this.todos();
    if (this.visibles < todos.length) {
      this.visibles += this.o.tam;
      return this.pintar();
    }
    if (!this.o.remoto || this.remotoAgotado || this.cargando) return;
    this.cargando = true;
    const texto = this.btn.textContent;
    this.btn.textContent = 'Cargando…';
    this.btn.disabled = true;
    this.o.lista.setAttribute('aria-busy', 'true');
    try {
      const firma = this.firma;
      const r = await this.o.remoto(this.cursor);
      if (firma !== this.firma) return; // cambiaron los filtros mientras cargaba
      if (!r) { this.remotoAgotado = true; return; }
      this.extra = this.extra.concat(r.items);
      this.cursor = r.siguiente;
      this.remotoAgotado = !r.siguiente;
      // El total de la base es aproximado (puede repetir algo de la caché); agotada la base, cuenta lo que hay.
      this.totalRemoto = this.remotoAgotado ? null : this.locales.length + r.total;
      this.visibles += this.o.tam;
    } catch (e) {
      this.btn.textContent = texto;
      this.estado.textContent = (e as Error).message;
    } finally {
      this.cargando = false;
      this.o.lista.removeAttribute('aria-busy');
      this.pintar();
    }
  }
}
