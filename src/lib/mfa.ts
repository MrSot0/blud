// src/lib/mfa.ts
// RF-T6: verificación en dos pasos con app de autenticación (TOTP: Google Authenticator, Microsoft Authenticator,
// Authy…), sobre Supabase Auth MFA. Es opcional por usuario: se activa en Configuración → Seguridad.
// La base exige el segundo paso a quien lo activó (migración 20261111200000_blud_mfa.sql).

import { sb } from './supabase';

export interface Factor { id: string; nombre: string; creado: string }

const cliente = () => {
  const c = sb();
  if (!c) throw new Error('La verificación en dos pasos necesita conexión con el servidor.');
  return c;
};

/** Mensajes de error en español. */
function motivo(e: { message?: string; code?: string } | null): string {
  const m = `${e?.code ?? ''} ${e?.message ?? ''}`;
  if (/invalid|incorrect|expired/i.test(m)) return 'El código no es correcto o ya venció. Escribe el que muestra ahora tu app.';
  if (/rate|too many/i.test(m)) return 'Demasiados intentos. Espera un minuto.';
  if (/aal2|assurance/i.test(m)) return 'Para hacer este cambio, vuelve a entrar con tu código de verificación.';
  return 'No pudimos completar la verificación. Inténtalo de nuevo.';
}

/** Factores TOTP ya verificados de la cuenta. */
export async function factoresActivos(): Promise<Factor[]> {
  const { data, error } = await cliente().auth.mfa.listFactors();
  if (error) throw new Error(motivo(error));
  return (data?.totp ?? []).filter((f) => f.status === 'verified')
    .map((f) => ({ id: f.id, nombre: f.friendly_name ?? 'App de autenticación', creado: f.created_at }));
}

/** ¿La sesión actual tiene que pasar todavía el segundo paso? */
export async function faltaSegundoPaso(): Promise<boolean> {
  const c = sb();
  if (!c) return false;
  const { data } = await c.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}

/** Paso 1 del alta: crea el factor y devuelve el QR (SVG en data URL) y la clave para escribirla a mano. */
export async function empezarAlta(): Promise<{ factorId: string; qr: string; clave: string }> {
  const c = cliente();
  // Si quedó un alta a medias, se descarta para empezar limpio.
  const { data: lista } = await c.auth.mfa.listFactors();
  for (const f of lista?.all ?? []) if (f.status !== 'verified') await c.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: `BLUD ${new Date().toISOString().slice(0, 10)}`, issuer: 'BLUD' });
  if (error || !data) throw new Error(motivo(error));
  return { factorId: data.id, qr: data.totp.qr_code, clave: data.totp.secret };
}

/** Paso 2 del alta (y también el segundo paso al entrar): valida un código de 6 dígitos. */
export async function verificarCodigo(code: string, factorId?: string): Promise<void> {
  const c = cliente();
  const limpio = code.replace(/\D/g, '');
  if (limpio.length !== 6) throw new Error('El código tiene 6 dígitos.');
  let id = factorId;
  if (!id) {
    const f = await factoresActivos();
    id = f[0]?.id;
    if (!id) throw new Error('Tu cuenta no tiene verificación en dos pasos.');
  }
  const { error } = await c.auth.mfa.challengeAndVerify({ factorId: id, code: limpio });
  if (error) throw new Error(motivo(error));
}

/** Desactiva la verificación (requiere una sesión que ya pasó el segundo paso). */
export async function desactivar(factorId: string): Promise<void> {
  const { error } = await cliente().auth.mfa.unenroll({ factorId });
  if (error) throw new Error(motivo(error));
  await cliente().auth.refreshSession();
}
