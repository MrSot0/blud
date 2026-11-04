// POST /api/chat - Bluddie, el asistente de BLUD, con Gemini 3.1 Flash-Lite.
// Se ejecuta en el servidor para que la clave de Gemini nunca llegue al navegador.
import type { APIRoute } from 'astro';
import { GEMINI_API_KEY } from 'astro:env/server';
import { centers, hoursLabel, prettyBloodType } from '../../data/centers';
import { infoTopics, infoHref } from '../../data/info';
import { questions } from '../../data/eligibility';

export const prerender = false;

// Primero el Flash-Lite más barato (retiro anunciado: 7 may 2027). Cuando Google lo satura (503 o sin respuesta),
// se pasa a modelos de otra familia, que no suelen saturarse a la vez. Cada intento tiene su propio límite de tiempo.
const ATTEMPTS: { model: string; ms: number }[] = [
  { model: 'gemini-3.1-flash-lite', ms: 5_000 },
  // shortcut: modelo preview, el más estable en las pruebas (3 nov 2026); cambiarlo si Google lo retira.
  { model: 'gemini-3-flash-preview', ms: 10_000 },
  { model: 'gemini-3.5-flash', ms: 12_000 },
  { model: 'gemini-3-flash-preview', ms: 10_000 },
];
const endpoint = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

const MAX_MESSAGES = 16;
const MAX_CHARS = 800;

const centerLines = centers
  .map((c) => {
    const needs = c.needs.length ? ` Necesita: ${c.needs.map(prettyBloodType).join(', ')}.` : '';
    return `- ${c.name} (${c.type}), ${c.address}. Horario: ${hoursLabel(c.hours)}. Tel: ${c.phone}.${needs}`;
  })
  .join('\n');

// Mismos criterios que el test de /elegibilidad, para que Bluddie no se contradiga con él.
const eligibilityLines = questions
  .map((q) => {
    const deferrals = q.options
      .filter((o) => !o.eligible && o.timeframe)
      .map((o) => `${o.label}: ${o.timeframe}`)
      .join(' / ');
    return deferrals ? `- ${q.title} ${deferrals}` : null;
  })
  .filter(Boolean)
  .join('\n');

const topicLines = infoTopics.map((t) => `- ${t.title}: ${infoHref(t.slug)}`).join('\n');

const SYSTEM_PROMPT = `Eres Bluddie, el asistente de BLUD, una red de donación de sangre en Maracaibo y San Francisco (Zulia, Venezuela).

Tu trabajo: resolver dudas sobre donación de sangre, requisitos, preparación, compatibilidad de tipos de sangre y los centros de la red, y guiar a la persona dentro del sitio.

Reglas:
- Responde siempre en español, con tono cercano y claro, en 2 a 5 frases. Usa listas cortas con guiones solo si ayudan.
- Escribe texto plano: sin Markdown, sin asteriscos ni encabezados.
- No diagnosticas ni reemplazas al personal médico. Sobre si alguien puede donar, usa los criterios de abajo, sé coherente (si hay que esperar, dilo claramente sin decir "sí puedes") y aclara que la decisión final la toma el banco de sangre. Sugiere el test de /elegibilidad cuando ayude.
- Ante una emergencia médica, indica llamar al 911 o acudir al centro más cercano.
- La orientación sexual o la identidad de género nunca son, por sí solas, motivo para no donar: se evalúan conductas de riesgo individuales (ver criterios). Responde siempre con respeto, sin juicios.
- Si preguntan algo ajeno a la donación de sangre o a BLUD, dilo con amabilidad y vuelve al tema.
- No inventes centros, horarios ni teléfonos: usa solo los datos de abajo.

Páginas útiles del sitio:
- Test de elegibilidad (20 preguntas): /elegibilidad
- Mapa de centros y agenda de citas («Agendar aquí»): /centros
- Crear cuenta: /register · Iniciar sesión: /login
${topicLines}

Criterios de elegibilidad (pregunta del test y plazos de espera):
${eligibilityLines}

Centros de la red:
${centerLines}`;

// Límite simple por IP (por instancia del servidor): frena abusos que gastarían la cuota.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > MAX_PER_WINDOW;
}

type ChatMessage = { role: 'user' | 'model'; text: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function parseMessages(body: unknown): ChatMessage[] | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { messages?: unknown }).messages)) return null;
  const messages = (body as { messages: unknown[] }).messages.slice(-MAX_MESSAGES);
  const clean: ChatMessage[] = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') return null;
    const { role, text } = m as { role?: unknown; text?: unknown };
    if ((role !== 'user' && role !== 'model') || typeof text !== 'string' || !text.trim()) return null;
    clean.push({ role, text: text.trim().slice(0, MAX_CHARS) });
  }
  return clean.length && clean[clean.length - 1].role === 'user' ? clean : null;
}

// Presupuesto total para no pasar el límite de la función serverless (maxDuration en astro.config).
const TOTAL_BUDGET_MS = 45_000;

/** El código ayuda a diagnosticar desde la consola del navegador sin exponer detalles internos. */
type ErrorCode = 'not_configured' | 'rate_limited' | 'invalid' | 'busy' | 'auth' | 'timeout' | 'upstream' | 'empty';
const fail = (code: ErrorCode, error: string, status: number) => json({ error, code }, status);

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!GEMINI_API_KEY) {
    return fail('not_configured', 'Bluddie aún no está configurado en este servidor.', 503);
  }
  if (rateLimited(clientAddress ?? 'desconocida')) {
    return fail('rate_limited', 'Vas muy rápido. Espera un momento y vuelve a intentarlo.', 429);
  }

  let messages: ChatMessage[] | null = null;
  try {
    messages = parseMessages(await request.json());
  } catch {}
  if (!messages) return fail('invalid', 'Mensaje no válido.', 400);

  const payload = JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
    // Sin "pensar": el razonamiento gasta el límite de tokens (respuestas cortadas) y a veces se cuela en el texto.
    generationConfig: { temperature: 0.4, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: 'minimal' } },
  });

  const started = Date.now();
  let lastStatus = 0;
  let timedOut = false;
  for (const [i, { model, ms }] of ATTEMPTS.entries()) {
    const left = TOTAL_BUDGET_MS - (Date.now() - started);
    if (left < 3_000) break; // no alcanza para otro intento
    if (i > 0) await new Promise((r) => setTimeout(r, 600));
    try {
      const res = await fetch(endpoint(model), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': GEMINI_API_KEY,
          // Sin compresión: evita respuestas gzip que algunos entornos no descomprimen.
          'Accept-Encoding': 'identity',
        },
        body: payload,
        signal: AbortSignal.timeout(Math.min(ms, left)),
      });

      if (!res.ok) {
        lastStatus = res.status;
        console.error(`Gemini (${model}) respondió`, res.status, await res.text());
        // 400/401/403: clave inválida, sin permisos o API desactivada. Reintentar no sirve.
        if ([400, 401, 403].includes(res.status)) {
          return fail('auth', 'Bluddie no puede conectarse con su servicio de IA. Avísanos a soporte@blud.app.', 502);
        }
        // Saturado o modelo no disponible: probamos el siguiente intento.
        if ([404, 429, 500, 503].includes(res.status)) continue;
        break;
      }

      const data = await res.json();
      const reply: string = (data?.candidates?.[0]?.content?.parts ?? [])
        .filter((p: { thought?: boolean }) => !p.thought)
        .map((p: { text?: string }) => p.text ?? '')
        .join('')
        .trim();

      if (!reply) return fail('empty', 'No tengo una respuesta para eso. ¿Puedes reformular la pregunta?', 502);
      return json({ reply });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') timedOut = true;
      console.error(`Error al llamar a Gemini (${model})`, error);
    }
  }

  if (lastStatus === 429 || lastStatus === 503) {
    return fail('busy', 'Bluddie está atendiendo a mucha gente. Inténtalo en un minuto.', 429);
  }
  if (timedOut) return fail('timeout', 'Bluddie tardó demasiado en responder. Inténtalo de nuevo.', 504);
  return fail('upstream', 'No pude responder ahora. Inténtalo de nuevo.', 502);
};
