// POST /api/chat - Bluddie, el asistente de BLUD, con Gemini 2.5 Flash-Lite.
// Se ejecuta en el servidor para que la clave de Gemini nunca llegue al navegador.
import type { APIRoute } from 'astro';
import { GEMINI_API_KEY } from 'astro:env/server';
import { centers, hoursLabel, prettyBloodType } from '../../data/centers';
import { infoTopics, infoHref } from '../../data/info';

export const prerender = false;

const MODEL = 'gemini-2.5-flash-lite';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_MESSAGES = 16;
const MAX_CHARS = 800;

const centerLines = centers
  .map((c) => {
    const needs = c.needs.length ? ` Necesita: ${c.needs.map(prettyBloodType).join(', ')}.` : '';
    return `- ${c.name} (${c.type}), ${c.address}. Horario: ${hoursLabel(c.hours)}. Tel: ${c.phone}.${needs}`;
  })
  .join('\n');

const topicLines = infoTopics.map((t) => `- ${t.title}: ${infoHref(t.slug)}`).join('\n');

const SYSTEM_PROMPT = `Eres Bluddie, el asistente de BLUD, una red de donación de sangre en Maracaibo y San Francisco (Zulia, Venezuela).

Tu trabajo: resolver dudas sobre donación de sangre, requisitos, preparación, compatibilidad de tipos de sangre y los centros de la red, y guiar a la persona dentro del sitio.

Reglas:
- Responde siempre en español, con tono cercano y claro, en 2 a 5 frases. Usa listas cortas con guiones solo si ayudan.
- Escribe texto plano: sin Markdown, sin asteriscos ni encabezados.
- No diagnosticas ni reemplazas al personal médico. Sobre si alguien puede donar, orienta con criterios generales (18 a 65 años, más de 50 kg, buena salud, haber comido y dormido) y aclara que la decisión final la toma el banco de sangre.
- Ante una emergencia médica, indica llamar al 911 o acudir al centro más cercano.
- Si preguntan algo ajeno a la donación de sangre o a BLUD, dilo con amabilidad y vuelve al tema.
- No inventes centros, horarios ni teléfonos: usa solo los datos de abajo.

Páginas útiles del sitio:
- Test de elegibilidad (20 preguntas): /elegibilidad
- Mapa de centros y agenda de citas («Agendar aquí»): /centros
- Crear cuenta: /register · Iniciar sesión: /login
${topicLines}

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

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!GEMINI_API_KEY) {
    return json({ error: 'Bluddie aún no está configurado en este servidor.' }, 503);
  }
  if (rateLimited(clientAddress ?? 'desconocida')) {
    return json({ error: 'Vas muy rápido. Espera un momento y vuelve a intentarlo.' }, 429);
  }

  let messages: ChatMessage[] | null = null;
  try {
    messages = parseMessages(await request.json());
  } catch {}
  if (!messages) return json({ error: 'Mensaje no válido.' }, 400);

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: messages.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
        generationConfig: { temperature: 0.4, maxOutputTokens: 400 },
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      console.error('Gemini respondió', res.status, await res.text());
      const busy = res.status === 429;
      return json(
        { error: busy ? 'Bluddie está atendiendo a mucha gente. Inténtalo en un minuto.' : 'No pude responder ahora. Inténtalo de nuevo.' },
        busy ? 429 : 502
      );
    }

    const data = await res.json();
    const reply: string = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: { text?: string }) => p.text ?? '')
      .join('')
      .trim();

    if (!reply) return json({ error: 'No tengo una respuesta para eso. ¿Puedes reformular la pregunta?' }, 502);
    return json({ reply });
  } catch (error) {
    console.error('Error al llamar a Gemini', error);
    return json({ error: 'No pude responder ahora. Inténtalo de nuevo.' }, 502);
  }
};
