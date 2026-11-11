-- BLUD · Datos completos del donante, cuestionario, diferimientos, contacto del laboratorio y chat en tiempo real.
-- Se aplica después de 20261111150000_blud_carnet_publico.sql. Se puede repetir.
--
--   RF-D11  dirección, ocupación y contacto de emergencia del donante      → blud_guardar_datos_extra
--   RF-D4   cuestionario de autoexclusión guardado para el enfermero      → cuestionario_autoexclusion, blud_guardar_cuestionario
--   RF-D6   fecha desde la que puede volver a donar (90 días H / 120 M)   → private.ficha: proximaDonacion
--   RF-O5   diferimientos de toda la red (evaluación y laboratorio)        → private.ficha: diferimiento (sin el motivo)
--   RF-D10  el banco de sangre pide contactar al donante (sin resultados)  → private.ficha: contactoPendiente, blud_registrar_contacto
--   Chat    personal (operador, soporte, dirección) ↔ donante             → chat_conversacion, chat_mensaje, blud_chat_*
--           Tiempo real con Supabase Realtime Broadcast en canales privados (políticas sobre realtime.messages):
--             chat:<conversación>        mensajes de una conversación
--             buzon:donante:<donanteid>  avisos para el donante
--             buzon:personal             avisos para el personal

-- ============================================================ RF-D11: datos del donante
alter table public.donante add column if not exists direccion text;
alter table public.donante add column if not exists contacto_emergencia_telefono varchar(30);
alter table public.donante add column if not exists contacto_emergencia_parentesco varchar(40);
-- donante.ocupacion y donante.contacto_emergencia (nombre) ya existen en el esquema.

create or replace function public.blud_guardar_datos_extra(p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_don int := public._donante_id();
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  if v_don is null then raise exception 'Guarda primero tus datos personales para quedar registrado como donante.'; end if;
  update donante set
    direccion = nullif(trim(p ->> 'direccion'), ''),
    ocupacion = left(nullif(trim(p ->> 'ocupacion'), ''), 100),
    contacto_emergencia = left(nullif(trim(p ->> 'contactoNombre'), ''), 150),
    contacto_emergencia_telefono = left(nullif(trim(p ->> 'contactoTelefono'), ''), 30),
    contacto_emergencia_parentesco = left(nullif(trim(p ->> 'contactoParentesco'), ''), 40)
  where donanteid = v_don;
end $$;

-- ============================================================ RF-D4: cuestionario de autoexclusión
create table if not exists public.cuestionario_autoexclusion (
  id bigint generated always as identity primary key,
  donanteid integer not null references public.donante (donanteid) on delete cascade,
  respuestas jsonb not null,          -- [{ id, pregunta, respuesta, alerta }]
  alertas jsonb not null default '[]', -- [{ pregunta, motivo, plazo, permanente }]
  apto boolean not null,
  creado timestamptz not null default now()
);
create index if not exists cuestionario_donante_idx on public.cuestionario_autoexclusion (donanteid, creado desc);
alter table public.cuestionario_autoexclusion enable row level security;
-- Sin políticas: se escribe con blud_guardar_cuestionario y lo lee el personal con la ficha.

create or replace function public.blud_guardar_cuestionario(p_respuestas jsonb, p_alertas jsonb, p_apto boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_don int := public._donante_id();
  v_id bigint;
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  if v_don is null then raise exception 'Guarda primero tus datos personales para quedar registrado como donante.'; end if;
  if jsonb_typeof(p_respuestas) <> 'array' or jsonb_array_length(p_respuestas) = 0 then raise exception 'Responde el cuestionario completo.'; end if;
  insert into cuestionario_autoexclusion (donanteid, respuestas, alertas, apto)
  values (v_don, p_respuestas, coalesce(p_alertas, '[]'), coalesce(p_apto, false))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'fecha', now());
end $$;

-- ============================================================ RF-D6 / RF-O5 / RF-D10: estado para donar
-- Diferimiento vigente en toda la red, sin el motivo: evaluación no apta (temporal o definitiva) o serología reactiva.
create or replace function private.diferimiento(p_don int) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    -- El laboratorio encontró una prueba reactiva: no puede volver a donar hasta que el banco lo indique.
    (select jsonb_build_object('tipo', 'permanente', 'origen', 'laboratorio', 'desde', private.dia(max(ps.fecha_analisis)))
       from prueba_serologica ps join donacion x on x.donacionid = ps.donacion_id
      where x.donanteid = p_don and ps.resultado_global = 'Positivo'
     having count(*) > 0),
    (select case
       when e.tipo_rechazo = 'Definitivo' then
         jsonb_build_object('tipo', 'permanente', 'origen', 'evaluacion', 'desde', private.dia(e.fecha_evaluacion), 'sede', s.nombre)
       when e.fecha_proxima_aptitud is not null and e.fecha_proxima_aptitud > current_date then
         jsonb_build_object('tipo', 'temporal', 'origen', 'evaluacion', 'desde', private.dia(e.fecha_evaluacion),
                            'hasta', e.fecha_proxima_aptitud, 'sede', s.nombre)
     end
       from evaluacion_donante e
       left join personalsalud p on p.personalid = e.personal_salud_id
       left join sede s on s.sedeid = p.sedeid
      where e.donante_id = p_don and not e.apto_para_donar
        and e.evaluacion_id = (select max(evaluacion_id) from evaluacion_donante where donante_id = p_don))
  )
$$;

-- Fecha desde la que puede volver a donar: última donación + 90 días (hombres) o 120 (mujeres), o el fin del diferimiento.
create or replace function private.proxima_donacion(p_don int) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select nullif(greatest(
    coalesce((select private.dia(max(x.fechadonacion)) + case when u.sexo = 'F' then 120 else 90 end
                from donacion x where x.donanteid = d.donanteid), '-infinity'::date),
    coalesce((select (private.diferimiento(d.donanteid) ->> 'hasta')::date), '-infinity'::date)
  ), '-infinity'::date)
  from donante d join usuario u on u.usuarioid = d.usuarioid where d.donanteid = p_don
$$;

-- El laboratorio encontró algo y nadie ha contactado todavía al donante.
create or replace function private.contacto_pendiente(p_don int) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from prueba_serologica ps join donacion x on x.donacionid = ps.donacion_id
    where x.donanteid = p_don and ps.resultado_global = 'Positivo'
      and not exists (
        select 1 from bitacora_auditoria b
        where b.tabla_afectada = 'donante' and b.registro_id = p_don and b.operacion = 'CONTACTO_DONANTE'
          and b.fecha_hora >= ps.fecha_analisis)
  )
$$;

-- El personal deja constancia de que contactó al donante (sin detalles clínicos).
create or replace function public.blud_registrar_contacto(p_donante text, p_medio text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_don int := nullif(substring(upper(coalesce(p_donante, '')) from 'BLD-(\d{1,9})'), '')::int;
begin
  perform public._exigir_rol(array['operador', 'laboratorio', 'soporte', 'director']);
  if v_don is null or not exists (select 1 from donante where donanteid = v_don) then raise exception 'No encontramos a ese donante.'; end if;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('donante', v_don, 'CONTACTO_DONANTE', public._uid(), public._sede_id(),
          jsonb_build_object('medio', left(coalesce(p_medio, 'chat'), 40)));
end $$;

-- ============================================================ Ficha (amplía la de 20261111120000)
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
    'direccion', d.direccion,
    'ocupacion', d.ocupacion,
    'contactoEmergencia', case when d.contacto_emergencia is not null then jsonb_strip_nulls(jsonb_build_object(
      'nombre', d.contacto_emergencia, 'telefono', d.contacto_emergencia_telefono, 'parentesco', d.contacto_emergencia_parentesco)) end,
    'donaciones', (select count(*) from donacion x where x.donanteid = d.donanteid),
    'ultimaDonacion', (select private.dia(max(x.fechadonacion)) from donacion x where x.donanteid = d.donanteid),
    'proximaDonacion', private.proxima_donacion(d.donanteid),
    'diferimiento', private.diferimiento(d.donanteid),
    'contactoPendiente', private.contacto_pendiente(d.donanteid),
    'cuestionario', (select jsonb_build_object('fecha', c.creado, 'apto', c.apto, 'alertas', c.alertas, 'respuestas', c.respuestas)
                       from cuestionario_autoexclusion c where c.donanteid = d.donanteid order by c.creado desc limit 1),
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

-- ============================================================ Chat
create table if not exists public.chat_conversacion (
  id uuid primary key default gen_random_uuid(),
  donanteid integer not null references public.donante (donanteid) on delete cascade,
  asunto text not null check (length(asunto) between 1 and 120),
  motivo text not null default 'general' check (motivo in ('general', 'contacto_laboratorio', 'cita', 'verificacion')),
  estado text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  creada_por integer references public.usuario (usuarioid),
  creada timestamptz not null default now(),
  actualizada timestamptz not null default now(),
  leido_donante timestamptz,
  leido_personal timestamptz
);
create index if not exists chat_conv_donante_idx on public.chat_conversacion (donanteid, actualizada desc);

create table if not exists public.chat_mensaje (
  id bigint generated always as identity primary key,
  conversacion_id uuid not null references public.chat_conversacion (id) on delete cascade,
  autor_tipo text not null check (autor_tipo in ('donante', 'personal')),
  autor_usuarioid integer references public.usuario (usuarioid),
  autor_nombre text not null,
  autor_rol text,
  texto text not null check (length(texto) between 1 and 2000),
  creado timestamptz not null default now()
);
create index if not exists chat_msg_conv_idx on public.chat_mensaje (conversacion_id, creado);

alter table public.chat_conversacion enable row level security;
alter table public.chat_mensaje enable row level security;
-- Sin políticas: se lee y escribe con las funciones blud_chat_*; el tiempo real va por Broadcast.

create or replace function private.es_personal_chat() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.mi_rol() in ('operador', 'soporte', 'director', 'laboratorio'), false)
$$;

-- ¿Puede quien llama ver esta conversación? (el donante dueño o el personal)
create or replace function private.puede_ver_chat(p_conv uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select private.es_personal_chat()
      or exists (select 1 from chat_conversacion c where c.id = p_conv and c.donanteid = public._donante_id())
$$;

create or replace function private.chat_json(c chat_conversacion, p_personal boolean) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', c.id, 'asunto', c.asunto, 'motivo', c.motivo, 'estado', c.estado,
    'creada', c.creada, 'actualizada', c.actualizada,
    'donante', (select jsonb_build_object('id', 'BLD-' || lpad(d.donanteid::text, 6, '0'),
                  'nombre', trim(u.nombres || ' ' || u.apellidos), 'sangre', private.ts_txt(d.tipo_sangre),
                  'foto', private.foto_de(u.correo))
                from donante d join usuario u on u.usuarioid = d.usuarioid where d.donanteid = c.donanteid),
    'creadaPor', (select trim(u.nombres || ' ' || u.apellidos) from usuario u where u.usuarioid = c.creada_por),
    'ultimo', (select jsonb_build_object('texto', m.texto, 'autorTipo', m.autor_tipo, 'creado', m.creado)
                 from chat_mensaje m where m.conversacion_id = c.id order by m.creado desc, m.id desc limit 1),
    'noLeidos', (select count(*) from chat_mensaje m where m.conversacion_id = c.id
                   and m.autor_tipo = case when p_personal then 'donante' else 'personal' end
                   and m.creado > coalesce(case when p_personal then c.leido_personal else c.leido_donante end, '-infinity'))
  ))
$$;

create or replace function private.msg_json(m chat_mensaje) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', m.id, 'conversacion', m.conversacion_id, 'autorTipo', m.autor_tipo,
    'autorNombre', m.autor_nombre, 'autorRol', m.autor_rol, 'texto', m.texto, 'creado', m.creado)
$$;

-- El personal abre (o retoma) la conversación abierta con un donante.
create or replace function public.blud_chat_abrir(p_donante text, p_asunto text, p_motivo text default 'general') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_don int;
  c chat_conversacion;
begin
  perform public._exigir_rol(array['operador', 'soporte', 'director', 'laboratorio']);
  v_don := nullif(substring(upper(coalesce(p_donante, '')) from 'BLD-(\d{1,9})'), '')::int;
  if v_don is null then
    select d.donanteid into v_don from donante d join usuario u on u.usuarioid = d.usuarioid
    where private.cedula(u.cedula) = private.cedula(p_donante) limit 1;
  end if;
  if v_don is null or not exists (select 1 from donante where donanteid = v_don) then raise exception 'No encontramos a ese donante.'; end if;
  select * into c from chat_conversacion where donanteid = v_don and estado = 'abierta' order by actualizada desc limit 1;
  if not found then
    insert into chat_conversacion (donanteid, asunto, motivo, creada_por)
    values (v_don, left(coalesce(nullif(trim(p_asunto), ''), 'Mensaje del banco de sangre'), 120),
            case when p_motivo in ('general', 'contacto_laboratorio', 'cita', 'verificacion') then p_motivo else 'general' end,
            public._uid())
    returning * into c;
  end if;
  return private.chat_json(c, true);
end $$;

create or replace function public.blud_chat_conversaciones() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_personal boolean := private.es_personal_chat();
  v_don int := public._donante_id();
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(private.chat_json(c, v_personal) order by c.actualizada desc)
    from chat_conversacion c
    where (v_personal or c.donanteid = v_don)
  ), '[]');
end $$;

-- Mensajes de una conversación; marca como leídos los del otro lado.
create or replace function public.blud_chat_mensajes(p_conv uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_personal boolean := private.es_personal_chat();
begin
  if not private.puede_ver_chat(p_conv) then raise exception 'No tienes acceso a esta conversación.' using errcode = '42501'; end if;
  if v_personal then update chat_conversacion set leido_personal = now() where id = p_conv;
  else update chat_conversacion set leido_donante = now() where id = p_conv; end if;
  return jsonb_build_object(
    'conversacion', (select private.chat_json(c, v_personal) from chat_conversacion c where c.id = p_conv),
    'mensajes', coalesce((select jsonb_agg(private.msg_json(m) order by m.creado, m.id) from chat_mensaje m where m.conversacion_id = p_conv), '[]'));
end $$;

create or replace function public.blud_chat_enviar(p_conv uuid, p_texto text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_personal boolean := private.es_personal_chat();
  c chat_conversacion;
  u usuario;
  m chat_mensaje;
  v_texto text := trim(coalesce(p_texto, ''));
  v_rol text := public.mi_rol();
begin
  if not private.puede_ver_chat(p_conv) then raise exception 'No tienes acceso a esta conversación.' using errcode = '42501'; end if;
  if v_texto = '' then raise exception 'Escribe un mensaje.'; end if;
  if length(v_texto) > 2000 then raise exception 'El mensaje es demasiado largo (máximo 2000 caracteres).'; end if;
  select * into c from chat_conversacion where id = p_conv;
  if c.estado <> 'abierta' then raise exception 'Esta conversación está cerrada.'; end if;
  select * into u from usuario where lower(correo) = lower(auth.jwt() ->> 'email') limit 1;
  insert into chat_mensaje (conversacion_id, autor_tipo, autor_usuarioid, autor_nombre, autor_rol, texto)
  values (p_conv, case when v_personal then 'personal' else 'donante' end, u.usuarioid,
          coalesce(trim(u.nombres || ' ' || u.apellidos), 'Donante'), case when v_personal then v_rol end, v_texto)
  returning * into m;
  update chat_conversacion set actualizada = m.creado,
    leido_personal = case when v_personal then m.creado else leido_personal end,
    leido_donante = case when v_personal then leido_donante else m.creado end
  where id = p_conv;
  -- Tiempo real: a la conversación y a los buzones de ambos lados.
  perform realtime.send(private.msg_json(m), 'mensaje', 'chat:' || p_conv, true);
  perform realtime.send(jsonb_build_object('conversacion', p_conv), 'novedad', 'buzon:donante:' || c.donanteid, true);
  perform realtime.send(jsonb_build_object('conversacion', p_conv), 'novedad', 'buzon:personal', true);
  return private.msg_json(m);
end $$;

create or replace function public.blud_chat_cerrar(p_conv uuid, p_abrir boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c chat_conversacion;
begin
  perform public._exigir_rol(array['operador', 'soporte', 'director', 'laboratorio']);
  update chat_conversacion set estado = case when p_abrir then 'abierta' else 'cerrada' end, actualizada = now()
  where id = p_conv returning * into c;
  if not found then raise exception 'No encontramos esa conversación.'; end if;
  perform realtime.send(jsonb_build_object('conversacion', p_conv, 'estado', c.estado), 'estado', 'chat:' || p_conv, true);
  perform realtime.send(jsonb_build_object('conversacion', p_conv), 'novedad', 'buzon:donante:' || c.donanteid, true);
end $$;

-- Quién puede escuchar cada canal privado.
create or replace function public.blud_chat_canal_ok(p_topic text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_topic like 'chat:%' then
    return private.puede_ver_chat(nullif(substring(p_topic from 6), '')::uuid);
  elsif p_topic like 'buzon:donante:%' then
    return substring(p_topic from 15)::int = public._donante_id();
  elsif p_topic = 'buzon:personal' then
    return private.es_personal_chat();
  end if;
  return false;
exception when others then
  return false;
end $$;

drop policy if exists "blud: escuchar canales del chat" on realtime.messages;
create policy "blud: escuchar canales del chat" on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.blud_chat_canal_ok(realtime.topic()));

-- ============================================================ Permisos
revoke all on function private.diferimiento(int), private.proxima_donacion(int), private.contacto_pendiente(int),
  private.es_personal_chat(), private.puede_ver_chat(uuid), private.chat_json(chat_conversacion, boolean),
  private.msg_json(chat_mensaje) from public, anon, authenticated;
revoke all on function public.blud_guardar_datos_extra(jsonb), public.blud_guardar_cuestionario(jsonb, jsonb, boolean),
  public.blud_registrar_contacto(text, text), public.blud_chat_abrir(text, text, text), public.blud_chat_conversaciones(),
  public.blud_chat_mensajes(uuid), public.blud_chat_enviar(uuid, text), public.blud_chat_cerrar(uuid, boolean),
  public.blud_chat_canal_ok(text) from public, anon;
grant execute on function public.blud_guardar_datos_extra(jsonb), public.blud_guardar_cuestionario(jsonb, jsonb, boolean),
  public.blud_registrar_contacto(text, text), public.blud_chat_abrir(text, text, text), public.blud_chat_conversaciones(),
  public.blud_chat_mensajes(uuid), public.blud_chat_enviar(uuid, text), public.blud_chat_cerrar(uuid, boolean),
  public.blud_chat_canal_ok(text) to authenticated;
