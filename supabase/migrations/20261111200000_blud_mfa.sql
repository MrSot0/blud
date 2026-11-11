-- BLUD · RF-T6: verificación en dos pasos (TOTP con app de autenticación, Supabase Auth MFA).
-- Es opcional por usuario (se activa en Configuración → Seguridad). Si la cuenta la tiene activada, la base
-- no reconoce a quien llama hasta que la sesión pase el segundo paso (aal2): _uid() y mi_rol() devuelven null,
-- así que ninguna función de negocio responde aunque alguien se salte la pantalla del código.
-- Se aplica después de 20261111190000. Se puede repetir.

create or replace function public._falta_segundo_paso() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
     and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
$$;

create or replace function public._uid() returns integer
language sql stable security definer set search_path = public, pg_temp as $$
  select usuarioid from public.usuario
  where lower(correo) = lower(auth.jwt() ->> 'email') and activo and not public._falta_segundo_paso()
  limit 1
$$;

create or replace function public.mi_rol() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when u.rol = 'Administrador' then 'director'
    when u.rol = 'PersonalSalud' then
      case p.cargo::text
        when 'Director' then 'director'
        when 'Laboratista' then 'laboratorio'
        when 'TecnicoSoporte' then 'soporte'
        else 'operador'
      end
    else 'donante'
  end
  from public.usuario u
  left join public.personalsalud p on p.usuarioid = u.usuarioid
  where lower(u.correo) = lower(auth.jwt() ->> 'email') and u.activo and not public._falta_segundo_paso()
  limit 1
$$;

revoke all on function public._falta_segundo_paso() from public, anon;
grant execute on function public._falta_segundo_paso() to authenticated;
