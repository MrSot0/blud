-- BLUD · RF-TR1 y RF-H2: documentos de la solicitud de transfusión (orden médica, consentimiento informado e historia
-- clínica). Se puede repetir.
--
--   Bucket privado documentos-clinicos: PDF o imagen de hasta 10 MB, en <sede>/<solicitud>/<archivo>. Solo el personal
--   de la sede solicitante lo sube y lo ve (con URL firmada); nadie lo modifica ni lo borra: es parte del expediente.
--   solicitud_adjunto: qué archivo es, de qué tipo, quién lo subió y cuándo. blud_adjunto_registrar lo valida contra
--   el archivo subido y lo deja en la bitácora (ADJUNTO).
--   blud_verificar_despacho exige la orden médica y el consentimiento adjuntos, salvo en una emergencia (se regularizan
--   después, como dice el formulario de la solicitud).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-clinicos', 'documentos-clinicos', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿La solicitud de la carpeta <sede>/<solicitud>/ es de la sede de quien pide?
create or replace function public._carpeta_de_mi_sede(p_nombre text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.mi_rol() in ('operador', 'laboratorio', 'director')
     and (storage.foldername(p_nombre))[1] = public._sede_id()::text
     and exists (select 1 from solicitudtransfusion st
                 where st.solicitudid::text = (storage.foldername(p_nombre))[2] and st.sedesolicitanteid = public._sede_id())
$$;
-- En public: las políticas de storage se evalúan con los permisos de quien sube, que no ve el esquema private.
revoke all on function public._carpeta_de_mi_sede(text) from public, anon;
grant execute on function public._carpeta_de_mi_sede(text) to authenticated;

drop policy if exists "documentos: el personal de la sede sube" on storage.objects;
create policy "documentos: el personal de la sede sube" on storage.objects for insert to authenticated
  with check (bucket_id = 'documentos-clinicos' and public._carpeta_de_mi_sede(name));
drop policy if exists "documentos: el personal de la sede ve" on storage.objects;
create policy "documentos: el personal de la sede ve" on storage.objects for select to authenticated
  using (bucket_id = 'documentos-clinicos' and public._carpeta_de_mi_sede(name));

create table if not exists public.solicitud_adjunto (
  adjunto_id bigint generated always as identity primary key,
  solicitud_id int not null references public.solicitudtransfusion (solicitudid),
  tipo text not null check (tipo in ('orden', 'consentimiento', 'historia', 'otro')),
  ruta text not null unique,
  nombre text not null,
  mime text,
  bytes bigint,
  subido_por int references public.usuario (usuarioid),
  subido_en timestamptz not null default now()
);
create index if not exists idx_adjunto_solicitud on public.solicitud_adjunto (solicitud_id);
create index if not exists idx_adjunto_subido_por on public.solicitud_adjunto (subido_por);
alter table public.solicitud_adjunto enable row level security;
-- Sin políticas: se lee y se escribe con las funciones de abajo.

create or replace function private.adjunto_json(a public.solicitud_adjunto) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object('id', a.adjunto_id, 'tipo', a.tipo, 'ruta', a.ruta, 'nombre', a.nombre,
    'mime', a.mime, 'bytes', a.bytes, 'fecha', a.subido_en,
    'subidoPor', (select trim(u.nombres || ' ' || u.apellidos) from usuario u where u.usuarioid = a.subido_por)))
$$;

-- Adjuntos de varias solicitudes de mi sede (la lista del operador las pide juntas).
create or replace function public.blud_adjuntos(p_solicitudes text[]) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._exigir_rol(array['operador', 'laboratorio', 'director']);
  return coalesce((
    select jsonb_object_agg('REQ-' || lpad(x.sid::text, 6, '0'), x.l) from (
      select a.solicitud_id sid, jsonb_agg(private.adjunto_json(a) order by a.subido_en) l
      from solicitud_adjunto a join solicitudtransfusion st on st.solicitudid = a.solicitud_id
      where st.sedesolicitanteid = public._sede_id()
        and a.solicitud_id in (select substring(s from '\d+')::int from unnest(p_solicitudes) s)
      group by a.solicitud_id) x), '{}');
end $$;

create or replace function public.blud_adjunto_registrar(p_solicitud text, p_tipo text, p_ruta text, p_nombre text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sid int := substring(coalesce(p_solicitud, '') from '\d+')::int;
  o storage.objects;
  a solicitud_adjunto;
begin
  perform public._exigir_rol(array['operador', 'laboratorio', 'director']);
  if p_tipo not in ('orden', 'consentimiento', 'historia', 'otro') then raise exception 'Elige qué documento es.'; end if;
  if not exists (select 1 from solicitudtransfusion where solicitudid = v_sid and sedesolicitanteid = public._sede_id()) then
    raise exception 'No encontramos esa solicitud en tu sede.';
  end if;
  if coalesce(p_ruta, '') not like public._sede_id()::text || '/' || v_sid::text || '/%' then raise exception 'Ruta de archivo no válida.'; end if;
  select * into o from storage.objects where bucket_id = 'documentos-clinicos' and name = p_ruta;
  if not found then raise exception 'El archivo no se terminó de subir. Inténtalo de nuevo.'; end if;
  insert into solicitud_adjunto (solicitud_id, tipo, ruta, nombre, mime, bytes, subido_por)
  values (v_sid, p_tipo, p_ruta, left(coalesce(nullif(trim(p_nombre), ''), 'documento'), 160),
          o.metadata ->> 'mimetype', (o.metadata ->> 'size')::bigint, public._uid())
  returning * into a;
  perform private.auditar('solicitudtransfusion', v_sid, 'ADJUNTO', jsonb_build_object('tipo', p_tipo, 'nombre', a.nombre));
  return private.adjunto_json(a);
end $$;

revoke all on function public.blud_adjuntos(text[]) from public, anon;
revoke all on function public.blud_adjunto_registrar(text, text, text, text) from public, anon;
grant execute on function public.blud_adjuntos(text[]) to authenticated;
grant execute on function public.blud_adjunto_registrar(text, text, text, text) to authenticated;

create or replace function public.blud_verificar_despacho(p_solicitud text, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sid int := substring(coalesce(p_solicitud, '') from '\d+')::int; v_sede int; v_urg text;
begin
  perform public._exigir_rol(array['operador', 'director']);
  select sedesolicitanteid, urgencia::text into v_sede, v_urg from solicitudtransfusion where solicitudid = v_sid;
  if not found then raise exception 'No encontramos esa solicitud.'; end if;
  if v_sede is distinct from public._sede_id() then raise exception 'Esa solicitud es de otra sede.' using errcode = '42501'; end if;
  if not (coalesce((p ->> 'brazalete')::boolean, false) and coalesce((p ->> 'din')::boolean, false) and coalesce((p ->> 'etiqueta')::boolean, false)) then
    raise exception 'Verifica el brazalete del paciente, el DIN de cada bolsa y la etiqueta de compatibilidad.';
  end if;
  if length(trim(coalesce(p ->> 'recibe', ''))) < 3 then raise exception 'Indica quién recibe las unidades en el servicio.'; end if;
  -- RF-H2: orden médica escrita y consentimiento firmado, adjuntos (en una emergencia se regularizan después).
  if v_urg is distinct from 'Emergencia' then
    if not exists (select 1 from solicitud_adjunto where solicitud_id = v_sid and tipo = 'orden') then
      raise exception 'Adjunta la orden médica escrita antes de despachar (botón «Documentos»).';
    end if;
    if not exists (select 1 from solicitud_adjunto where solicitud_id = v_sid and tipo = 'consentimiento') then
      raise exception 'Adjunta el consentimiento informado firmado antes de despachar (botón «Documentos»).';
    end if;
  end if;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('solicitudtransfusion', v_sid, 'VERIF_DESPACHO', public._uid(), v_sede,
          jsonb_build_object('brazalete', true, 'din', true, 'etiqueta', true, 'recibe', trim(p ->> 'recibe'),
                             'documentos', v_urg is distinct from 'Emergencia'));
end $$;

-- Carpeta donde el navegador sube los documentos de una solicitud de mi sede («<sede>/<solicitud>/»).
create or replace function public.blud_adjunto_carpeta(p_solicitud text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_sid int := substring(coalesce(p_solicitud, '') from '\d+')::int;
begin
  perform public._exigir_rol(array['operador', 'laboratorio', 'director']);
  if not exists (select 1 from solicitudtransfusion where solicitudid = v_sid and sedesolicitanteid = public._sede_id()) then
    raise exception 'No encontramos esa solicitud en tu sede.';
  end if;
  return public._sede_id()::text || '/' || v_sid::text || '/';
end $$;
revoke all on function public.blud_adjunto_carpeta(text) from public, anon;
grant execute on function public.blud_adjunto_carpeta(text) to authenticated;
