-- BLUD · Carnet con foto, ficha completa para el QR y gestión de citas.
-- Se aplica después de 20261102120000_blud_adaptador.sql. Se puede repetir.
--
--   donante_foto                 ruta de la foto del donante en Storage (bucket privado fotos-donantes).
--   blud_mi_ficha()              todo lo que el donante tiene guardado en la base (rellena su perfil y su carnet).
--   blud_guardar_foto(path)      enlaza la foto que el donante acaba de subir a su carpeta.
--   blud_donante_ficha(q)        el personal consulta un donante por el contenido del QR, el ID BLD-… o la cédula.
--   blud_cancelar_cita(id)       el donante cancela su cita (CITA-123).

-- ============================================================ Foto del donante
create table if not exists public.donante_foto (
  user_id uuid primary key references auth.users (id) on delete cascade,
  path text not null,
  actualizado timestamptz not null default now()
);
alter table public.donante_foto enable row level security;
-- Sin políticas a propósito: se lee y escribe solo con las funciones de abajo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-donantes', 'fotos-donantes', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Cada donante solo toca su carpeta (<auth.uid()>/…). El personal puede ver todas las fotos (para identificar al donante).
drop policy if exists "fotos: el donante sube la suya" on storage.objects;
create policy "fotos: el donante sube la suya" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos-donantes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fotos: el donante cambia la suya" on storage.objects;
create policy "fotos: el donante cambia la suya" on storage.objects for update to authenticated
  using (bucket_id = 'fotos-donantes' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'fotos-donantes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fotos: el donante borra la suya" on storage.objects;
create policy "fotos: el donante borra la suya" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos-donantes' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "fotos: ver la propia o como personal" on storage.objects;
create policy "fotos: ver la propia o como personal" on storage.objects for select to authenticated
  using (bucket_id = 'fotos-donantes' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.mi_rol() in ('operador', 'laboratorio', 'soporte', 'director')
  ));

-- Ruta de la foto de un usuario de la tabla usuario (la cuenta de Auth se reconoce por el correo).
create or replace function private.foto_de(p_correo text) returns text
language sql stable security definer set search_path = '' as $$
  select f.path from public.donante_foto f join auth.users au on au.id = f.user_id
  where lower(au.email) = lower(p_correo) limit 1
$$;

create or replace function public.blud_guardar_foto(p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> auth.uid()::text then
    raise exception 'Esa foto no es tuya.' using errcode = '42501';
  end if;
  insert into donante_foto (user_id, path) values (auth.uid(), p_path)
  on conflict (user_id) do update set path = excluded.path, actualizado = now();
end $$;

-- ============================================================ Ficha completa (donante y personal)
create or replace function private.ficha(p_usuarioid int) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', 'BLD-' || lpad(d.donanteid::text, 6, '0'),
    'nombres', u.nombres,
    'apellidos', u.apellidos,
    'cedula', private.cedula(u.cedula),
    'telefono', nullif(u.telefono, ''),
    'email', case when u.correo not like '%@presencial.blud' then lower(u.correo) end,
    'nacimiento', u.fechanacimiento,
    'sexo', u.sexo::text,
    'sangre', private.ts_txt(d.tipo_sangre),
    'registrado', private.dia(u.fecharegistro),
    'verificado', d.verificado_en is not null,
    'verificadoEn', private.dia(d.verificado_en),
    'foto', private.foto_de(u.correo),
    'donaciones', (select count(*) from donacion x where x.donanteid = d.donanteid),
    'ultimaDonacion', (select private.dia(max(x.fechadonacion)) from donacion x where x.donanteid = d.donanteid),
    'proximaCita', (
      select jsonb_build_object('centro', s.nombre, 'date', private.dia(c.fecha_hora_cita),
        'time', to_char(c.fecha_hora_cita at time zone 'America/Caracas', 'HH24:MI'))
      from cita c join sede s on s.sedeid = c.sedeid
      where c.donanteid = d.donanteid and c.estado = 'Programada' and c.fecha_hora_cita >= now()
      order by c.fecha_hora_cita limit 1),
    'activo', u.activo
  ))
  from usuario u join donante d on d.usuarioid = u.usuarioid
  where u.usuarioid = p_usuarioid
$$;

-- El donante: su propia ficha (null si todavía no completó su registro).
create or replace function public.blud_mi_ficha() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid int;
  v jsonb;
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  select usuarioid into v_uid from usuario where lower(correo) = lower(auth.jwt() ->> 'email') limit 1;
  if v_uid is not null then v := private.ficha(v_uid); end if;
  -- Aunque no tenga ficha todavía, la foto puede estar subida.
  return coalesce(v, jsonb_strip_nulls(jsonb_build_object('foto', (select path from donante_foto where user_id = auth.uid()))));
end $$;

-- El personal: busca por el contenido del QR (URL o JSON), el ID del carnet o la cédula.
create or replace function public.blud_donante_ficha(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := trim(coalesce(p_q, ''));
  v_id text;
  v_uid int;
begin
  perform public._exigir_rol(array['operador', 'laboratorio', 'soporte', 'director']);
  v_id := upper(substring(v_q from '(?i)BLD-(\d{1,9})'));
  if v_id is not null then
    select d.usuarioid into v_uid from donante d where d.donanteid = v_id::int;
  else
    select u.usuarioid into v_uid from usuario u join donante d on d.usuarioid = u.usuarioid
    where private.cedula(u.cedula) = private.cedula(v_q) limit 1;
  end if;
  if v_uid is null then return null; end if;
  return private.ficha(v_uid);
end $$;

-- ============================================================ Citas
create or replace function public.blud_cancelar_cita(p_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint := nullif(substring(coalesce(p_id, '') from '(\d+)$'), '')::bigint;
begin
  if v_id is null then raise exception 'No encontramos una cita activa para cancelar.'; end if;
  perform public.cancelar_cita(v_id);
end $$;

-- ============================================================ Permisos
revoke all on function private.foto_de(text), private.ficha(int) from public, anon, authenticated;
revoke all on function public.blud_guardar_foto(text), public.blud_mi_ficha(), public.blud_donante_ficha(text),
  public.blud_cancelar_cita(text) from public, anon;
grant execute on function public.blud_guardar_foto(text), public.blud_mi_ficha(), public.blud_donante_ficha(text),
  public.blud_cancelar_cita(text) to authenticated;
