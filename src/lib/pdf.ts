// src/lib/pdf.ts
// Kit de PDF con la identidad de BLUD, generado en el navegador con pdf-lib (sin servidor).
// Cada reporte arma su documento con estas piezas: encabezado con la gota de Sangrito y el logotipo,
// bloque de título con metadatos, tarjetas de cifras, secciones, párrafos, tablas que saltan de página,
// barras, mapa de calor, firmas y pie con «Página x de n».

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont, PDFPage, RGB } from 'pdf-lib';

// ------------------------------------------------------------------ Marca
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
export const C = {
  rojo: hex('#CA2B2B'), rojoOscuro: hex('#A30008'), rojoTinta: hex('#B42121'), rojoSuave: hex('#FBEAEA'),
  tinta: hex('#151A23'), tinta2: hex('#434C5A'), tinta3: hex('#616B7C'),
  linea: hex('#DEE2E8'), hundido: hex('#F1F3F6'), blanco: rgb(1, 1, 1),
  ok: hex('#1D7F3E'), okSuave: hex('#E3F4E8'), aviso: hex('#975400'), avisoSuave: hex('#FCF0DC'),
};
export type Tono = 'neutro' | 'ok' | 'aviso' | 'rojo';
const TONO: Record<Tono, { fondo: RGB; texto: RGB }> = {
  neutro: { fondo: C.hundido, texto: C.tinta2 }, ok: { fondo: C.okSuave, texto: C.ok },
  aviso: { fondo: C.avisoSuave, texto: C.aviso }, rojo: { fondo: C.rojoSuave, texto: C.rojoTinta },
};

// Las fuentes estándar de PDF usan WinAnsi: se traducen los caracteres que no tiene.
const MAPA: Record<string, string> = { '→': '->', '←': '<-', '−': '-', '≤': '<=', '≥': '>=', '×': 'x', ' ': ' ', ' ': ' ', '✓': 'Sí' };
const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
export const limpiar = (s: unknown) =>
  String(s ?? '').replace(/[^\x00-\xFF]/g, (ch) => MAPA[ch] ?? (WINANSI_EXTRA.has(ch) ? ch : '')).replace(/[\x00-\x09\x0B-\x1F]/g, '');

// ------------------------------------------------------------------ Tipos
export interface Columna { titulo: string; ancho: number; alinear?: 'izq' | 'der' | 'centro'; mono?: boolean }
export interface Kpi { label: string; valor: string; nota?: string; tono?: Tono }
export interface OpcionesDoc {
  /** Tipo de documento, arriba a la derecha (p. ej. «Reporte consolidado»). */
  tipo: string;
  titulo: string;
  subtitulo?: string;
  meta?: [string, string][];
  horizontal?: boolean;
}

const MARGEN = 40;
const ALTO_ENCABEZADO = 62;
const ALTO_PIE = 36;

export interface Pdf {
  ancho: number;
  seccion(titulo: string, nota?: string): void;
  parrafos(lineas: string[], opts?: { tamano?: number; color?: RGB; vinetas?: boolean }): void;
  kpis(items: Kpi[]): void;
  tabla(columnas: Columna[], filas: (string | { texto: string; tono?: Tono })[][], opts?: { vacio?: string }): void;
  barras(items: { k: string; v: number }[], fmt?: (n: number) => string): void;
  heatmap(d: { filas: string[]; columnas: string[]; valores: number[][]; max: number; fmt?: (n: number) => string; totales?: boolean }): void;
  fichas(pares: [string, string][], columnas?: number): void;
  aviso(texto: string, tono?: Tono): void;
  firmas(roles: string[]): void;
  espacio(pt: number): void;
  descargar(nombre: string): Promise<void>;
  bytes(): Promise<Uint8Array>;
}

// ------------------------------------------------------------------ Documento
export async function nuevoPdf(o: OpcionesDoc): Promise<Pdf> {
  const doc = await PDFDocument.create();
  doc.setTitle(limpiar(`${o.titulo} · BLUD`));
  doc.setAuthor('BLUD · Red de donación de sangre');
  doc.setCreator('BLUD');
  doc.setProducer('BLUD');
  doc.setSubject(limpiar(o.tipo));
  doc.setLanguage('es-VE');
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const neg = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const [W, H] = o.horizontal ? [842, 595] : [595, 842];
  const util = W - MARGEN * 2;
  let page!: PDFPage;
  let y = 0;

  const ancho = (t: string, f: PDFFont, s: number) => f.widthOfTextAtSize(limpiar(t), s);
  const texto = (t: string, x: number, yy: number, s: number, f: PDFFont = reg, color: RGB = C.tinta) =>
    page.drawText(limpiar(t), { x, y: yy, size: s, font: f, color });
  const recortar = (t: string, f: PDFFont, s: number, max: number) => {
    let out = limpiar(t);
    if (f.widthOfTextAtSize(out, s) <= max) return out;
    while (out.length > 1 && f.widthOfTextAtSize(out + '…', s) > max) out = out.slice(0, -1);
    return out.trimEnd() + '…';
  };
  const partir = (t: string, f: PDFFont, s: number, max: number): string[] => {
    const lineas: string[] = [];
    for (const parrafo of limpiar(t).split('\n')) {
      let actual = '';
      for (const p of parrafo.split(/\s+/)) {
        const prueba = actual ? `${actual} ${p}` : p;
        if (f.widthOfTextAtSize(prueba, s) <= max) actual = prueba;
        else { if (actual) lineas.push(actual); actual = p; }
      }
      lineas.push(actual);
    }
    return lineas;
  };

  /** La gota de Sangrito (mismo trazo que components/Logo.astro), en vector. */
  const gota = (x: number, top: number, alto: number) => {
    const k = alto / 48;
    page.drawSvgPath('M24 3.5c-1.2 1.6-14 17-14 27.2A14 14 0 0 0 24 44.7a14 14 0 0 0 14-14C38 20.5 25.2 5.1 24 3.5Z', { x, y: top, scale: k, color: C.rojo });
    page.drawEllipse({ x: x + 17.6 * k, y: top - 20 * k, xScale: 2.4 * k, yScale: 4.2 * k, color: C.blanco, opacity: 0.35, rotate: { type: 'degrees', angle: -28 } as never });
    page.drawEllipse({ x: x + 19 * k, y: top - 29.5 * k, xScale: 2 * k, yScale: 2.7 * k, color: hex('#1A202C') });
    page.drawEllipse({ x: x + 29 * k, y: top - 29.5 * k, xScale: 2 * k, yScale: 2.7 * k, color: hex('#1A202C') });
    page.drawSvgPath('M19.5 35.2c2.6 2.4 6.4 2.4 9 0', { x, y: top, scale: k, borderColor: hex('#1A202C'), borderWidth: 1.6 * k });
  };

  const encabezado = () => {
    page.drawRectangle({ x: 0, y: H - 5, width: W, height: 5, color: C.rojo });
    const top = H - 18;
    gota(MARGEN - 2, top, 26);
    texto('BLUD', MARGEN + 24, top - 18, 17, neg, C.tinta);
    page.drawCircle({ x: MARGEN + 24 + ancho('BLUD', neg, 17) + 3.2, y: top - 16.6, size: 2.4, color: C.rojo });
    const tipo = limpiar(o.tipo).toUpperCase();
    texto(tipo, W - MARGEN - ancho(tipo, neg, 7.5), top - 9, 7.5, neg, C.rojoTinta);
    const red = 'Red de donación de sangre';
    texto(red, W - MARGEN - ancho(red, reg, 8), top - 20, 8, reg, C.tinta3);
    page.drawLine({ start: { x: MARGEN, y: H - ALTO_ENCABEZADO + 8 }, end: { x: W - MARGEN, y: H - ALTO_ENCABEZADO + 8 }, thickness: 0.6, color: C.linea });
    y = H - ALTO_ENCABEZADO - 8;
  };
  const nuevaPagina = () => { page = doc.addPage([W, H]); encabezado(); };
  const asegurar = (alto: number) => { if (y - alto < ALTO_PIE + 14) nuevaPagina(); };

  // Portada: título, subtítulo y metadatos.
  nuevaPagina();
  for (const l of partir(o.titulo, neg, 22, util)) { texto(l, MARGEN, y - 20, 22, neg); y -= 27; }
  if (o.subtitulo) for (const l of partir(o.subtitulo, reg, 10.5, util)) { texto(l, MARGEN, y - 12, 10.5, reg, C.tinta2); y -= 15; }
  y -= 8;
  if (o.meta?.length) {
    const cols = o.horizontal ? 4 : 3;
    const w = util / cols;
    const filasMeta = Math.ceil(o.meta.length / cols);
    const alto = filasMeta * 30 + 12;
    page.drawRectangle({ x: MARGEN, y: y - alto, width: util, height: alto, color: C.hundido });
    o.meta.forEach(([k, v], i) => {
      const cx = MARGEN + 12 + (i % cols) * w, cy = y - 18 - Math.floor(i / cols) * 30;
      texto(k.toUpperCase(), cx, cy, 6.5, neg, C.tinta3);
      texto(recortar(v, neg, 9.5, w - 18), cx, cy - 12, 9.5, neg, C.tinta);
    });
    y -= alto + 18;
  }

  const api: Pdf = {
    ancho: util,
    espacio(pt) { y -= pt; },

    seccion(titulo, nota) {
      // Un título nunca queda solo al pie: pide espacio para él y para el comienzo de su contenido.
      asegurar(96);
      y -= 8;
      page.drawRectangle({ x: MARGEN, y: y - 13, width: 3, height: 13, color: C.rojo });
      texto(titulo, MARGEN + 10, y - 11, 12.5, neg);
      if (nota) texto(recortar(nota, reg, 8.5, util - ancho(titulo, neg, 12.5) - 30), MARGEN + 18 + ancho(titulo, neg, 12.5), y - 11, 8.5, reg, C.tinta3);
      y -= 24;
    },

    parrafos(lineas, opts = {}) {
      const s = opts.tamano ?? 10;
      const sangria = opts.vinetas ? 12 : 0;
      for (const p of lineas) {
        const ls = partir(p, reg, s, util - sangria);
        asegurar(ls.length * (s + 4) + 4);
        ls.forEach((l, i) => {
          if (opts.vinetas && i === 0) page.drawCircle({ x: MARGEN + 3, y: y - s + 3.2, size: 1.8, color: C.rojo });
          texto(l, MARGEN + sangria, y - s, s, reg, opts.color ?? C.tinta2);
          y -= s + 4;
        });
        y -= 5;
      }
    },

    kpis(items) {
      const n = items.length;
      const gap = 8;
      const w = (util - gap * (n - 1)) / n;
      const alto = 58;
      asegurar(alto + 10);
      items.forEach((k, i) => {
        const x = MARGEN + i * (w + gap);
        page.drawRectangle({ x, y: y - alto, width: w, height: alto, color: C.blanco, borderColor: C.linea, borderWidth: 0.8 });
        page.drawRectangle({ x, y: y - alto, width: 2.5, height: alto, color: k.tono ? TONO[k.tono].texto : C.rojo });
        texto(recortar(k.label.toUpperCase(), neg, 6.5, w - 18), x + 10, y - 15, 6.5, neg, C.tinta3);
        // El valor se achica hasta 11 pt para caber (p. ej. el nombre de un centro) antes de recortarse.
        let tam = 18;
        while (tam > 11 && ancho(k.valor, neg, tam) > w - 18) tam -= 1;
        texto(recortar(k.valor, neg, tam, w - 18), x + 10, y - 36, tam, neg, k.tono ? TONO[k.tono].texto : C.tinta);
        if (k.nota) texto(recortar(k.nota, reg, 7.5, w - 18), x + 10, y - 49, 7.5, reg, C.tinta3);
      });
      y -= alto + 14;
    },

    tabla(columnas, filas, opts = {}) {
      const total = columnas.reduce((a, c) => a + c.ancho, 0);
      const ws = columnas.map((c) => (c.ancho / total) * util);
      const cabecera = () => {
        page.drawRectangle({ x: MARGEN, y: y - 18, width: util, height: 18, color: C.tinta });
        let x = MARGEN;
        columnas.forEach((c, i) => {
          const t = recortar(c.titulo.toUpperCase(), neg, 6.8, ws[i] - 10);
          const tx = c.alinear === 'der' ? x + ws[i] - 6 - ancho(t, neg, 6.8) : c.alinear === 'centro' ? x + (ws[i] - ancho(t, neg, 6.8)) / 2 : x + 6;
          texto(t, tx, y - 12, 6.8, neg, C.blanco);
          x += ws[i];
        });
        y -= 18;
      };
      asegurar(40);
      cabecera();
      if (!filas.length) {
        texto(opts.vacio ?? 'Sin registros.', MARGEN + 6, y - 15, 9, reg, C.tinta3);
        y -= 26;
        return;
      }
      filas.forEach((fila, r) => {
        // Alto de fila según la celda que más líneas necesita (máx. 3).
        const lineas = fila.map((c, i) => {
          const t = typeof c === 'string' ? c : c.texto;
          return typeof c === 'string' && !columnas[i].mono ? partir(t, reg, 8.5, ws[i] - 12).slice(0, 3) : [t];
        });
        const alto = Math.max(...lineas.map((l) => l.length)) * 11 + 9;
        if (y - alto < ALTO_PIE + 14) { nuevaPagina(); cabecera(); }
        if (r % 2) page.drawRectangle({ x: MARGEN, y: y - alto, width: util, height: alto, color: C.hundido });
        let x = MARGEN;
        fila.forEach((c, i) => {
          const col = columnas[i];
          if (typeof c !== 'string') {
            const t = recortar(c.texto, neg, 7.2, ws[i] - 14);
            const tw = ancho(t, neg, 7.2) + 10;
            const tono = TONO[c.tono ?? 'neutro'];
            const bx = col.alinear === 'der' ? x + ws[i] - 6 - tw : col.alinear === 'centro' ? x + (ws[i] - tw) / 2 : x + 6;
            page.drawRectangle({ x: bx, y: y - 16, width: tw, height: 11, color: tono.fondo });
            texto(t, bx + 5, y - 13.2, 7.2, neg, tono.texto);
          } else {
            const f = col.mono ? mono : reg, s = col.mono ? 7.8 : 8.5;
            lineas[i].forEach((l, j) => {
              const t = recortar(l, f, s, ws[i] - 12);
              const tx = col.alinear === 'der' ? x + ws[i] - 6 - ancho(t, f, s) : col.alinear === 'centro' ? x + (ws[i] - ancho(t, f, s)) / 2 : x + 6;
              texto(t, tx, y - 13 - j * 11, s, f, j === 0 && i === 0 ? C.tinta : C.tinta2);
            });
          }
          x += ws[i];
        });
        y -= alto;
      });
      page.drawLine({ start: { x: MARGEN, y }, end: { x: MARGEN + util, y }, thickness: 0.6, color: C.linea });
      y -= 14;
    },

    barras(items, fmt = (n) => String(n)) {
      const max = Math.max(1, ...items.map((i) => i.v));
      const etiqueta = Math.min(170, util * 0.34);
      if (!items.length) { this.parrafos(['Sin datos en el periodo.']); return; }
      for (const it of items) {
        asegurar(18);
        texto(recortar(it.k, reg, 8.5, etiqueta - 8), MARGEN, y - 10, 8.5, reg, C.tinta);
        const anchoBarra = util - etiqueta - 52;
        page.drawRectangle({ x: MARGEN + etiqueta, y: y - 11, width: anchoBarra, height: 7, color: C.hundido });
        page.drawRectangle({ x: MARGEN + etiqueta, y: y - 11, width: Math.max(2, (it.v / max) * anchoBarra), height: 7, color: C.rojo });
        const v = fmt(it.v);
        texto(v, MARGEN + util - ancho(v, neg, 8.5), y - 10, 8.5, neg, C.tinta);
        y -= 17;
      }
      y -= 6;
    },

    heatmap({ filas, columnas, valores, max, fmt = (n) => String(n), totales = true }) {
      const etiqueta = 128;
      const colTotal = totales ? 44 : 0;
      const minCelda = 26;
      const porBloque = Math.max(1, Math.floor((util - etiqueta - colTotal) / minCelda));
      // Escala de una sola tonalidad: del blanco al rojo de la marca, 6 pasos.
      const PASOS = [0.1, 0.24, 0.4, 0.56, 0.74, 0.92];
      const color = (v: number) => {
        if (!v || !max) return C.hundido;
        const a = PASOS[Math.min(PASOS.length - 1, Math.floor((v / max) * PASOS.length - 1e-9))];
        return rgb(1 - (1 - C.rojo.red) * a, 1 - (1 - C.rojo.green) * a, 1 - (1 - C.rojo.blue) * a);
      };
      const oscura = (v: number) => !!v && max > 0 && v / max > 0.55;
      for (let b = 0; b < columnas.length; b += porBloque) {
        const cols = columnas.slice(b, b + porBloque);
        const ultimo = b + porBloque >= columnas.length;
        const w = Math.min(46, (util - etiqueta - (ultimo ? colTotal : 0)) / cols.length);
        const alto = 20;
        asegurar(28 + Math.min(filas.length, 4) * alto);
        cols.forEach((c, j) => {
          const t = recortar(c, neg, 6.5, w - 2);
          texto(t, MARGEN + etiqueta + j * w + (w - ancho(t, neg, 6.5)) / 2, y - 9, 6.5, neg, C.tinta3);
        });
        if (ultimo && totales) texto('TOTAL', MARGEN + etiqueta + cols.length * w + 6, y - 9, 6.5, neg, C.tinta3);
        y -= 16;
        filas.forEach((f, i) => {
          asegurar(alto + 2);
          texto(recortar(f, reg, 8, etiqueta - 8), MARGEN, y - 13, 8, reg, C.tinta);
          cols.forEach((_, j) => {
            const v = valores[i][b + j];
            const x = MARGEN + etiqueta + j * w;
            page.drawRectangle({ x: x + 1, y: y - alto + 1, width: w - 2, height: alto - 2, color: color(v) });
            if (v) {
              const t = fmt(v);
              texto(t, x + (w - ancho(t, neg, 7.5)) / 2, y - 13, 7.5, neg, oscura(v) ? C.blanco : C.tinta);
            }
          });
          if (ultimo && totales) {
            const t = fmt(valores[i].reduce((a, n) => a + n, 0));
            texto(t, MARGEN + etiqueta + cols.length * w + 6, y - 13, 8, neg, C.tinta);
          }
          y -= alto;
        });
        y -= 10;
      }
      // Leyenda de la escala.
      asegurar(22);
      texto('Menos', MARGEN + etiqueta, y - 8, 7, reg, C.tinta3);
      PASOS.forEach((a, i) => {
        const c = rgb(1 - (1 - C.rojo.red) * a, 1 - (1 - C.rojo.green) * a, 1 - (1 - C.rojo.blue) * a);
        page.drawRectangle({ x: MARGEN + etiqueta + 28 + i * 16, y: y - 10, width: 14, height: 9, color: c });
      });
      texto(`Más (máx. ${fmt(max)})`, MARGEN + etiqueta + 28 + PASOS.length * 16 + 4, y - 8, 7, reg, C.tinta3);
      y -= 24;
    },

    fichas(pares, columnas = 2) {
      const w = util / columnas;
      for (let i = 0; i < pares.length; i += columnas) {
        const fila = pares.slice(i, i + columnas);
        const lineas = fila.map(([, v]) => partir(v || '—', reg, 9.5, w - 16).slice(0, 4));
        const alto = Math.max(...lineas.map((l) => l.length)) * 12 + 20;
        asegurar(alto);
        fila.forEach(([k], j) => {
          const x = MARGEN + j * w;
          texto(k.toUpperCase(), x, y - 9, 6.5, neg, C.tinta3);
          lineas[j].forEach((l, n) => texto(l, x, y - 22 - n * 12, 9.5, reg, C.tinta));
        });
        y -= alto;
        page.drawLine({ start: { x: MARGEN, y: y + 4 }, end: { x: MARGEN + util, y: y + 4 }, thickness: 0.4, color: C.linea });
      }
      y -= 8;
    },

    aviso(t, tono = 'aviso') {
      const ls = partir(t, reg, 9, util - 24);
      const alto = ls.length * 12 + 14;
      asegurar(alto + 6);
      page.drawRectangle({ x: MARGEN, y: y - alto, width: util, height: alto, color: TONO[tono].fondo });
      page.drawRectangle({ x: MARGEN, y: y - alto, width: 2.5, height: alto, color: TONO[tono].texto });
      ls.forEach((l, i) => texto(l, MARGEN + 12, y - 15 - i * 12, 9, reg, TONO[tono].texto));
      y -= alto + 12;
    },

    firmas(roles) {
      asegurar(80);
      y -= 34;
      const w = util / roles.length;
      roles.forEach((r, i) => {
        const x = MARGEN + i * w + 14;
        page.drawLine({ start: { x, y }, end: { x: x + w - 28, y }, thickness: 0.7, color: C.tinta3 });
        texto(r, x + (w - 28 - ancho(r, reg, 8)) / 2, y - 12, 8, reg, C.tinta3);
      });
      y -= 30;
    },

    async bytes() {
      const paginas = doc.getPages();
      const generado = new Date().toLocaleString('es-VE', { dateStyle: 'long', timeStyle: 'short' });
      paginas.forEach((p, i) => {
        page = p;
        p.drawLine({ start: { x: MARGEN, y: ALTO_PIE }, end: { x: W - MARGEN, y: ALTO_PIE }, thickness: 0.5, color: C.linea });
        texto(`BLUD · Documento de uso interno · Generado el ${generado}`, MARGEN, ALTO_PIE - 13, 7, reg, C.tinta3);
        const n = `Página ${i + 1} de ${paginas.length}`;
        texto(n, W - MARGEN - ancho(n, neg, 7), ALTO_PIE - 13, 7, neg, C.tinta2);
      });
      return doc.save();
    },

    async descargar(nombre) {
      const data = await api.bytes();
      const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/pdf' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    },
  };
  return api;
}

/** Nombre de archivo seguro: blud-<tipo>-<fecha>.pdf */
export const nombrePdf = (tipo: string, sufijo = new Date().toISOString().slice(0, 10)) =>
  `blud-${tipo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${sufijo}.pdf`;
