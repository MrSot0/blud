// src/lib/etiquetas-pdf.ts
// RF-TR6: etiqueta de compatibilidad para pegar en cada bolsa reservada a un paciente. Una página de
// 10 × 7,5 cm por unidad (tamaño de etiqueta adhesiva), con el paciente, la unidad, el grupo, el resultado de la
// prueba cruzada y la verificación que se hace en cabecera. Se genera en el navegador con pdf-lib.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { C, limpiar, nombrePdf } from './pdf';
import type { Transfusion } from './transfusion';

const W = 283; // 10 cm
const H = 212; // 7,5 cm
const M = 12;

const fecha = (iso?: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

/** Unidades con prueba cruzada compatible (o que no la requieren) y tipaje conforme: las que pueden etiquetarse. */
export function unidadesEtiquetables(t: Transfusion) {
  if (!t.tipaje?.conforme) return [];
  return t.unidades.filter((u) => (t.requiereCruzada ? u.cruzada?.resultado === 'Compatible' : true));
}

export async function pdfEtiquetasCompatibilidad(t: Transfusion): Promise<void> {
  const unidades = unidadesEtiquetables(t);
  if (!unidades.length) throw new Error('Aún no hay unidades compatibles para etiquetar en esta solicitud.');
  const doc = await PDFDocument.create();
  doc.setTitle(limpiar(`Etiquetas de compatibilidad ${t.id} · BLUD`));
  doc.setAuthor('BLUD · Red de donación de sangre');
  doc.setLanguage('es-VE');
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const neg = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);
  const grupoPaciente = t.tipaje?.abo ? `${t.tipaje.abo}${t.tipaje.rh === 'Negativo' || t.tipaje.rh === '-' ? '-' : t.tipaje.rh ? '+' : ''}` : t.tipoSolicitado;

  for (const u of unidades) {
    const p = doc.addPage([W, H]);
    const txt = (s: string, x: number, y: number, size: number, font = reg, color = C.tinta) =>
      p.drawText(limpiar(s), { x, y, size, font, color });
    const corta = (s: string, font: typeof reg, size: number, max: number) => {
      let out = limpiar(s);
      while (out.length > 1 && font.widthOfTextAtSize(out, size) > max) out = out.slice(0, -2) + '…';
      return out;
    };

    // Banda superior roja
    p.drawRectangle({ x: 0, y: H - 26, width: W, height: 26, color: C.rojo });
    txt('BLUD', M, H - 18, 11, neg, C.blanco);
    txt('ETIQUETA DE COMPATIBILIDAD', M + 40, H - 17.5, 8, neg, C.blanco);
    const sol = limpiar(t.id);
    txt(sol, W - M - neg.widthOfTextAtSize(sol, 8), H - 17.5, 8, neg, C.blanco);

    // Paciente
    let y = H - 42;
    txt('PACIENTE', M, y, 6.5, neg, C.tinta3);
    y -= 13;
    txt(corta(t.paciente.nombre, neg, 11, W - 2 * M - 60), M, y, 11, neg);
    txt(corta(t.paciente.cedula, reg, 9, 70), W - M - Math.min(70, reg.widthOfTextAtSize(limpiar(t.paciente.cedula), 9)), y, 9);
    y -= 11;
    txt(corta([t.paciente.historia ? `Historia ${t.paciente.historia}` : '', t.paciente.servicio ?? ''].filter(Boolean).join(' · ') || ' ', reg, 7.5, W - 2 * M), M, y, 7.5, reg, C.tinta2);

    // Grupos grandes: paciente y unidad
    y -= 10;
    p.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: C.linea });
    y -= 30;
    const col = (W - 2 * M) / 2;
    txt('GRUPO PACIENTE', M, y + 20, 6.5, neg, C.tinta3);
    txt(grupoPaciente, M, y, 22, neg, C.rojoOscuro);
    txt('UNIDAD', M + col, y + 20, 6.5, neg, C.tinta3);
    txt(corta(u.codigo, mono, 11, col), M + col, y + 8, 11, mono);
    txt(corta(`${u.componente} · ${u.tipo}`, reg, 7.5, col), M + col, y - 2, 7.5, reg, C.tinta2);

    // Prueba cruzada
    y -= 22;
    const c = u.cruzada;
    const compatible = !t.requiereCruzada || c?.resultado === 'Compatible';
    p.drawRectangle({ x: M, y: y - 6, width: W - 2 * M, height: 20, color: compatible ? C.okSuave : C.rojoSuave });
    txt(t.requiereCruzada ? `PRUEBA CRUZADA: ${(c?.resultado ?? 'PENDIENTE').toUpperCase()}` : 'NO REQUIERE PRUEBA CRUZADA', M + 6, y, 8.5, neg, compatible ? C.ok : C.rojoTinta);
    if (c) {
      const det = limpiar(`Mayor ${c.mayor} · Menor ${c.menor} · ${fecha(c.fecha)}`);
      txt(det, W - M - 6 - reg.widthOfTextAtSize(det, 7), y, 7, reg, C.tinta2);
    }

    // Vence y verificación
    y -= 20;
    txt(`Vence: ${fecha(u.vence)}`, M, y, 7.5, neg);
    txt(`Tipaje: ${fecha(t.tipaje?.fecha)}`, M + col, y, 7.5, reg, C.tinta2);
    y -= 12;
    txt('Antes de transfundir verifica en cabecera: identidad y brazalete, ABO/Rh, DIN y vencimiento.', M, y, 6, reg, C.tinta2);

    // Firmas
    const yf = M + 8;
    p.drawLine({ start: { x: M, y: yf }, end: { x: M + col - 10, y: yf }, thickness: 0.6, color: C.tinta3 });
    p.drawLine({ start: { x: M + col, y: yf }, end: { x: W - M, y: yf }, thickness: 0.6, color: C.tinta3 });
    txt('Analista', M, yf - 8, 6, reg, C.tinta3);
    txt('Verifica en cabecera', M + col, yf - 8, 6, reg, C.tinta3);
    p.drawRectangle({ x: 0.5, y: 0.5, width: W - 1, height: H - 1, borderColor: rgb(0.8, 0.82, 0.85), borderWidth: 0.6 });
  }

  const bytes = await doc.save();
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: nombrePdf(`etiquetas-${t.id}`) });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
