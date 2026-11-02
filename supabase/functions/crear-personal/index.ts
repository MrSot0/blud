// supabase/functions/crear-personal/index.ts
// Crea cuentas del personal (operador, laboratorio, soporte o dirección). Solo la dirección puede usarla.
// Crear usuarios en Supabase Auth exige la clave de servicio: vive aquí y nunca llega al navegador.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ROLES = ['operador', 'laboratorio', 'soporte', 'director'];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Misma forma que en src/lib/auth.ts: letras y números sin caracteres que se confunden (0/O, 1/l). */
function claveTemporal() {
  const letras = 'abcdefghjkmnpqrstuvwxyz';
  const digitos = '23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const parte = Array.from(bytes.slice(0, 4), (b) => letras[b % letras.length]).join('');
  const num = Array.from(bytes.slice(4), (b) => digitos[b % digitos.length]).join('');
  return `Blud-${parte}${num}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Quién llama se decide con su token y su perfil en la base, nunca con lo que diga el cuerpo.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: quien } = await admin.auth.getUser(token);
  if (!quien.user) return json({ error: 'Tu sesión expiró. Inicia sesión de nuevo.' }, 401);
  const { data: perfil } = await admin.from('profiles').select('role, active').eq('id', quien.user.id).maybeSingle();
  if (perfil?.role !== 'director' || !perfil.active) {
    return json({ error: 'Solo la dirección puede crear cuentas del personal.' }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Datos no válidos.' }, 400);
  }
  const texto = (k: string) => String(body[k] ?? '').trim();
  const name = texto('name');
  const email = texto('email').toLowerCase();
  const role = texto('role');
  if (name.length < 3) return json({ error: 'Escribe el nombre completo.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Escribe un correo válido.' }, 400);
  if (!ROLES.includes(role)) return json({ error: 'Elige un rol del personal.' }, 400);

  const password = claveTemporal();
  const { data: creado, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !creado.user) {
    const existe = /already|exists|registered/i.test(error?.message ?? '');
    return json({ error: existe ? 'Ya existe una cuenta con este correo.' : 'No se pudo crear la cuenta.' }, existe ? 409 : 500);
  }

  // El trigger de la base creó el perfil como donante; aquí recibe su rol y los datos del cargo.
  const { error: errPerfil } = await admin
    .from('profiles')
    .update({ role, cargo: texto('cargo') || null, sede: texto('sede') || null, colegiado: texto('colegiado') || null })
    .eq('id', creado.user.id);
  if (errPerfil) {
    await admin.auth.admin.deleteUser(creado.user.id); // sin rol no sirve: se deshace para poder reintentar
    return json({ error: 'No se pudo asignar el rol. Inténtalo de nuevo.' }, 500);
  }
  return json({ password });
});
