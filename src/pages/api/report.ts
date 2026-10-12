// POST /api/report - Reporte de una respuesta de Bluddie que no fue correcta o adecuada.
// Por ahora queda registrado en los logs del servidor (Vercel → Logs, buscar "bluddie-report").
// No se guarda la IP ni datos de la cuenta: solo la pregunta, la respuesta y el motivo.
import type { APIRoute } from 'astro';

export const prerender = false;

const REASONS = ['incorrecta', 'peligrosa', 'ofensiva', 'otra'] as const;
type Reason = (typeof REASONS)[number];

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (rateLimited(clientAddress ?? 'desconocida')) {
    return json({ error: 'Ya recibimos varios reportes tuyos. Inténtalo en un minuto.' }, 429);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {}

  const reason = body.reason as Reason;
  const answer = text(body.answer, 2000);
  if (!REASONS.includes(reason) || !answer) {
    return json({ error: 'Reporte no válido.' }, 400);
  }

  const report = {
    at: new Date().toISOString(),
    reason,
    comment: text(body.comment, 500),
    question: text(body.question, 800),
    answer,
    page: text(body.page, 200),
  };

  console.warn('[bluddie-report]', JSON.stringify(report));
  return json({ ok: true });
};
