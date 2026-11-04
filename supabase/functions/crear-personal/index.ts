// supabase/functions/crear-personal/index.ts
// Crea cuentas del personal (operador, laboratorio, soporte o dirección) en Bloodonor. Solo la dirección puede usarla.
// Crear usuarios en Supabase Auth exige la clave de servicio: vive aquí y nunca llega al navegador.
// La cuenta queda en auth.users + usuario (rol PersonalSalud) + personalsalud (cargo y sede de quien la crea).
import { createClient } from 'npm:@supabase/supabase-js@2';

const CARGO: Record<string, string> = { operador: 'Enfermero', laboratorio: 'Laboratista', soporte: 'TecnicoSoporte', director: 'Director' };
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

/** V12345678 / 12345678 / v-12345678 → V-12345678 (igual que normCedula del front). */
function cedula(c: string) {
  const s = c.toUpperCase().replace(/[\s.]/g, '');
  const m = s.match(/^([VEJ])?-?(\d{5,9})$/);
  return m ? `${m[1] ?? 'V'}-${m[2]}` : '';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  // Quién llama se decide con su sesión y su perfil en la base, nunca con lo que diga el cuerpo.
  const comoUsuario = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: perfil } = await comoUsuario.rpc('blud_mi_perfil');
  if (!perfil) return json({ error: 'Tu sesión expiró. Inicia sesión de nuevo.' }, 401);
  if (perfil.role !== 'director' || !perfil.active) return json({ error: 'Solo la dirección puede crear cuentas del personal.' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Datos no válidos.' }, 400);
  }
  const texto = (k: string) => String(body[k] ?? '').trim();
  const nombre = texto('name').replace(/\s+/g, ' ');
  const email = texto('email').toLowerCase();
  const role = texto('role');
  const ced = cedula(texto('cedula'));
  const sexo = texto('sexo');
  const nacimiento = texto('nacimiento');
  // Los títulos (Dr., Lic.) no van en el nombre legal.
  const partes = nombre.replace(/^(dra?|lic|ing|msc|tsu)\.?\s+/i, '').split(' ');
  if (partes.length < 2) return json({ error: 'Escribe nombre y apellido.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Escribe un correo válido.' }, 400);
  if (!CARGO[role]) return json({ error: 'Elige un rol del personal.' }, 400);
  if (!ced) return json({ error: 'La cédula debe verse así: V-12345678.' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nacimiento) || !['M', 'F'].includes(sexo)) {
    return json({ error: 'Indica la fecha de nacimiento y el sexo.' }, 400);
  }

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [porCorreo, porCedula] = await Promise.all([
    admin.from('usuario').select('usuarioid').ilike('correo', email).limit(1),
    admin.from('usuario').select('usuarioid').eq('cedula', ced).limit(1),
  ]);
  if (porCorreo.data?.length || porCedula.data?.length) return json({ error: 'Ya existe una cuenta con ese correo o esa cédula.' }, 409);

  const password = claveTemporal();
  const { data: creado, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: nombre },
  });
  if (error || !creado.user) {
    const repetido = /already|exists|registered/i.test(error?.message ?? '');
    return json({ error: repetido ? 'Ya existe una cuenta con este correo.' : 'No se pudo crear la cuenta.' }, repetido ? 409 : 500);
  }

  // La cuenta nueva trabaja en la misma sede que la dirección que la crea.
  const deshacer = async (msg: string) => {
    await admin.auth.admin.deleteUser(creado.user.id);
    return json({ error: msg }, 500);
  };
  const { data: usuario, error: e1 } = await admin.from('usuario').insert({
    cedula: ced, nombres: partes[0], apellidos: partes.slice(1).join(' '), fechanacimiento: nacimiento, sexo,
    telefono: texto('telefono'), correo: email, password_hash: 'supabase-auth', rol: 'PersonalSalud', sederegistroid: perfil.sede_id,
  }).select('usuarioid').single();
  if (e1 || !usuario) return deshacer('No se pudo registrar a la persona. Inténtalo de nuevo.');
  const cargo = role === 'operador' && /m[eé]dic/i.test(texto('cargo')) ? 'Medico' : CARGO[role];
  const { error: e2 } = await admin.from('personalsalud').insert({
    usuarioid: usuario.usuarioid, cargo, sedeid: perfil.sede_id, colegiado: texto('colegiado') || null,
  });
  if (e2) {
    await admin.from('usuario').delete().eq('usuarioid', usuario.usuarioid);
    return deshacer('No se pudo asignar el rol. Inténtalo de nuevo.');
  }
  return json({ password });
});
