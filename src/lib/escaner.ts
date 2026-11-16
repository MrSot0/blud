// src/lib/escaner.ts
// Lector del QR del carnet con la cámara del equipo, dentro de la página (Operador → Donantes).
// Usa BarcodeDetector cuando el navegador lo trae y, si no, jsQR. Devuelve el texto del QR
// (el enlace /verificar?id=BLD-…&t=…), que buscarDonante() ya sabe leer.

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

export interface Escaner { detener: () => void }

export async function escanearQR(
  video: HTMLVideoElement,
  alLeer: (texto: string) => void,
  alFallar: (motivo: string) => void,
): Promise<Escaner> {
  let stream: MediaStream | null = null;
  let vivo = true;
  const detener = () => {
    vivo = false;
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };

  if (!navigator.mediaDevices?.getUserMedia) {
    alFallar('Este navegador no permite usar la cámara. Escribe la cédula o el ID del carnet.');
    return { detener };
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    const n = (e as DOMException).name;
    alFallar(n === 'NotAllowedError' ? 'No diste permiso para usar la cámara.' : n === 'NotFoundError' ? 'No encontramos una cámara en este equipo.' : 'No pudimos abrir la cámara.');
    return { detener };
  }
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play().catch(() => {});

  const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  let detector: Detector | null = null;
  if (BD) { try { detector = new BD({ formats: ['qr_code'] }); } catch { detector = null; } }
  const jsQR = detector ? null : (await import('jsqr')).default;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const ciclo = async () => {
    if (!vivo) return;
    if (video.readyState >= 2 && video.videoWidth) {
      try {
        let texto = '';
        if (detector) {
          texto = (await detector.detect(video))[0]?.rawValue ?? '';
        } else if (jsQR && ctx) {
          const w = Math.min(640, video.videoWidth);
          const h = Math.round((video.videoHeight / video.videoWidth) * w);
          canvas.width = w; canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          texto = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? '';
        }
        if (texto && vivo) { detener(); alLeer(texto); return; }
      } catch {}
    }
    window.setTimeout(() => requestAnimationFrame(ciclo), 120);
  };
  ciclo();
  return { detener };
}
