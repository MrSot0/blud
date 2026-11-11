-- BLUD · Vista pública del carnet (cualquiera que escanee el QR).
-- Se aplica después de 20261111120000_blud_carnet_citas.sql. Se puede repetir.
--
-- El QR lleva el ID del carnet y un código secreto por donante (/verificar?id=BLD-000123&t=…). Sin el código no se
-- ve nada: así nadie puede recorrer los IDs consecutivos para sacar las cédulas y teléfonos de todos los donantes.
--
--   donante_qr                     código secreto del QR de cada donante.
--   blud_mi_ficha()                ahora también devuelve el código ('qr') para que el carnet lo incluya.
--   blud_carnet_publico(id, t)     foto, nombre, cédula, ID, teléfono y tipo de sangre; lo puede llamar cualquiera.
--   fotos-donantes                 pasa a lectura pública por enlace: las rutas llevan el UUID de la cuenta y la hora,
--                                  así que solo las conoce quien recibe la ficha. Subir y borrar sigue siendo solo del dueño.

create table if not exists public.donante_qr (
  donanteid integer primary key references public.donante (donanteid) on delete cascade,
  token text not null default encode(extensions.gen_random_bytes(12), 'hex'),
  creado timestamptz not null default now()
);
alter table public.donante_qr enable row level security;
-- Sin políticas a propósito: solo se lee con las funciones de abajo.

-- Código del QR de un donante (lo crea la primera vez).
create or replace function private.qr_token(p_don int) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text;
begin
  if p_don is null then return null; end if;
  select token into v from donante_qr where donanteid = p_don;
  if v is null then
    insert into donante_qr (donanteid) values (p_don) on conflict (donanteid) do nothing;
    select token into v from donante_qr where donanteid = p_don;
  end if;
  return v;
end $$;

-- La ficha propia ahora incluye el código del QR (por eso deja de ser stable: puede crearlo).
create or replace function public.blud_mi_ficha() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid int;
  v_don int;
  v jsonb;
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  select u.usuarioid, d.donanteid into v_uid, v_don
  from usuario u left join donante d on d.usuarioid = u.usuarioid
  where lower(u.correo) = lower(auth.jwt() ->> 'email') limit 1;
  if v_uid is not null then v := private.ficha(v_uid); end if;
  if v is not null and v_don is not null then v := v || jsonb_build_object('qr', private.qr_token(v_don)); end if;
  return coalesce(v, jsonb_strip_nulls(jsonb_build_object('foto', (select path from donante_foto where user_id = auth.uid()))));
end $$;

-- Vista pública: solo con el ID y su código correcto.
create or replace function public.blud_carnet_publico(p_id text, p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_don int := nullif(substring(upper(coalesce(p_id, '')) from 'BLD-(\d{1,9})'), '')::int;
begin
  if v_don is null or coalesce(p_token, '') = '' then return null; end if;
  if not exists (select 1 from donante_qr q where q.donanteid = v_don and q.token = p_token) then return null; end if;
  return (
    select jsonb_strip_nulls(jsonb_build_object(
      'id', 'BLD-' || lpad(d.donanteid::text, 6, '0'),
      'nombres', u.nombres,
      'apellidos', u.apellidos,
      'cedula', private.cedula(u.cedula),
      'telefono', nullif(u.telefono, ''),
      'sangre', private.ts_txt(d.tipo_sangre),
      'verificado', d.verificado_en is not null,
      'foto', private.foto_de(u.correo)
    ))
    from donante d join usuario u on u.usuarioid = d.usuarioid
    where d.donanteid = v_don and u.activo
  );
end $$;

-- Fotos: lectura por enlace (bucket público); escribir sigue limitado a la carpeta propia.
update storage.buckets set public = true where id = 'fotos-donantes';

revoke all on function private.qr_token(int) from public, anon, authenticated;
revoke all on function public.blud_carnet_publico(text, text) from public;
grant execute on function public.blud_carnet_publico(text, text) to anon, authenticated;
grant execute on function public.blud_mi_ficha() to authenticated;
