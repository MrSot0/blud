-- BLUD · Administración técnica, equipos y trazabilidad.
--
--   RF-A1  Cuentas: soporte busca cualquier cuenta, la activa o desactiva, cambia rol y sede del personal, quita la
--          verificación en dos pasos y deja constancia de restablecer el acceso. Todo con motivo y en la bitácora.
--   RF-A2  Incidencias técnicas: registro, asignación, seguimiento y cierre (tabla incidencia_tecnica).
--   RF-A3  Corrección de estados: unidad, tamizaje de una donación o muestra de tipaje, con justificación.
--   RF-I4  Equipos de almacenamiento y lecturas de temperatura, con rango, alertas y calibración.
--   RF-H5  Trazabilidad donante ↔ receptor: desde un DIN, una bolsa, una cédula o una solicitud.
--
-- Se aplica DESPUÉS de 20261125120000_blud_roles_pendientes (usa hemo_vigilancia.folio). Se puede repetir.

-- ============================================================ Ayudas
-- Motivo obligatorio para toda acción administrativa.
create or replace function private.exigir_motivo(p text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if length(trim(coalesce(p, ''))) < 10 then raise exception 'Escribe el motivo (mínimo 10 caracteres): queda en la bitácora.'; end if;
  return trim(p);
end $$;

create or replace function private.auditar(p_tabla text, p_registro bigint, p_op text, p_datos jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values (p_tabla, p_registro, p_op, public._uid(), public._sede_id(), p_datos);
$$;

-- ============================================================ RF-A1 · Cuentas
create or replace function private.cuenta_json(u public.usuario) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', u.usuarioid,
    'email', lower(u.correo),
    'nombre', trim(u.nombres || ' ' || u.apellidos),
    'cedula', private.cedula(u.cedula),
    'rol', private.rol_de(u.rol::text, p.cargo::text),
    'cargo', private.cargo_label(p.cargo::text),
    'sede', case when coalesce(p.sedeid, u.sederegistroid) is not null then jsonb_build_object('id', coalesce(p.sedeid, u.sederegistroid),
              'nombre', (select nombre from sede where sedeid = coalesce(p.sedeid, u.sederegistroid))) end,
    'activo', u.activo,
    'registrado', u.fecharegistro,
    'ultimoAcceso', au.last_sign_in_at,
    'confirmado', au.email_confirmed_at is not null,
    'dosPasos', exists (select 1 from auth.mfa_factors f where f.user_id = au.id and f.status = 'verified'),
    'presencial', lower(u.correo) like '%@presencial.blud'
  ))
  from (select 1) x
  left join personalsalud p on p.usuarioid = u.usuarioid
  left join auth.users au on lower(au.email) = lower(u.correo)
$$;

-- Página de cuentas por cursor (usuarioid descendente). p_rol: donante | personal | operador | laboratorio | soporte | director.
create or replace function public.blud_cuentas(
  p_q text default null, p_rol text default null, p_activo boolean default null, p_cursor int default null, p_limite int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_lim int := least(greatest(coalesce(p_limite, 25), 1), 100);
  v_q text := case when length(trim(coalesce(p_q, ''))) >= 3 then lower(trim(p_q)) end;
  v_items jsonb;
  v_mas boolean;
begin
  perform public._exigir_rol(array['soporte']);
  with pagina as (
    select u.usuarioid from usuario u
    left join personalsalud p on p.usuarioid = u.usuarioid
    where (p_cursor is null or u.usuarioid < p_cursor)
      and (p_activo is null or u.activo = p_activo)
      and (p_rol is null
           or (p_rol = 'donante' and u.rol = 'Donante')
           or (p_rol = 'personal' and u.rol <> 'Donante')
           or private.rol_de(u.rol::text, p.cargo::text) = p_rol)
      and (v_q is null or lower(u.correo) like '%' || v_q || '%' or lower(u.nombres || ' ' || u.apellidos) like '%' || v_q || '%'
           or replace(lower(coalesce(u.cedula, '')), '-', '') like '%' || replace(v_q, '-', '') || '%')
    order by u.usuarioid desc
    limit v_lim + 1
  )
  select coalesce(jsonb_agg(private.cuenta_json(u) order by u.usuarioid desc) filter (where z.n <= v_lim), '[]'), count(*) > v_lim
    into v_items, v_mas
  from (select usuarioid, row_number() over (order by usuarioid desc) n from pagina) z
  join usuario u on u.usuarioid = z.usuarioid;
  return jsonb_build_object('items', v_items,
    'siguiente', case when v_mas then (v_items -> (jsonb_array_length(v_items) - 1) ->> 'id') end);
end $$;

create or replace function private.cuenta_ajena(p_id int) returns usuario
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u usuario;
begin
  select * into u from usuario where usuarioid = p_id;
  if not found then raise exception 'No encontramos esa cuenta.'; end if;
  if u.usuarioid = public._uid() then raise exception 'No puedes cambiar tu propia cuenta desde aquí.'; end if;
  return u;
end $$;

create or replace function public.blud_cuenta_activo(p_id int, p_activo boolean, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare u usuario; v_motivo text := private.exigir_motivo(p_motivo);
begin
  perform public._exigir_rol(array['soporte']);
  u := private.cuenta_ajena(p_id);
  update usuario set activo = p_activo where usuarioid = p_id;
  perform private.auditar('usuario', p_id, case when p_activo then 'CUENTA_ACTIVADA' else 'CUENTA_DESACTIVADA' end,
    jsonb_build_object('correo', lower(u.correo), 'motivo', v_motivo));
  return (select private.cuenta_json(x) from usuario x where usuarioid = p_id);
end $$;

-- Cambia el rol y la sede de una cuenta del personal (no convierte donantes en personal ni toca administradores).
create or replace function public.blud_cuenta_rol(p_id int, p_rol text, p_sede int, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u usuario;
  v_motivo text := private.exigir_motivo(p_motivo);
  v_cargo text := case p_rol when 'operador' then 'Enfermero' when 'laboratorio' then 'Laboratista'
                             when 'soporte' then 'TecnicoSoporte' when 'director' then 'Director' end;
  v_antes jsonb;
begin
  perform public._exigir_rol(array['soporte']);
  u := private.cuenta_ajena(p_id);
  if u.rol::text <> 'PersonalSalud' then raise exception 'Solo se cambia el rol de cuentas del personal de salud.'; end if;
  if v_cargo is null then raise exception 'Rol no válido.'; end if;
  if not exists (select 1 from sede where sedeid = p_sede) then raise exception 'Elige una sede válida.'; end if;
  select jsonb_build_object('cargo', cargo::text, 'sede', sedeid) into v_antes from personalsalud where usuarioid = p_id;
  -- Un operador con cargo de médico conserva su cargo.
  if p_rol = 'operador' and (v_antes ->> 'cargo') in ('Enfermero', 'Medico') then v_cargo := v_antes ->> 'cargo'; end if;
  execute format('update personalsalud set cargo = %L, sedeid = %s where usuarioid = %s', v_cargo, p_sede, p_id);
  perform private.auditar('personalsalud', p_id, 'CUENTA_ROL',
    jsonb_build_object('correo', lower(u.correo), 'antes', v_antes, 'rol', p_rol, 'sede', p_sede, 'motivo', v_motivo));
  return (select private.cuenta_json(x) from usuario x where usuarioid = p_id);
end $$;

-- Quita la verificación en dos pasos (la persona perdió el teléfono). Al entrar podrá activarla de nuevo.
create or replace function public.blud_cuenta_quitar_2fa(p_id int, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp, auth as $$
declare u usuario; v_motivo text := private.exigir_motivo(p_motivo); v_n int;
begin
  perform public._exigir_rol(array['soporte']);
  u := private.cuenta_ajena(p_id);
  delete from auth.mfa_factors f using auth.users au where f.user_id = au.id and lower(au.email) = lower(u.correo);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Esa cuenta no tiene verificación en dos pasos.'; end if;
  perform private.auditar('usuario', p_id, 'CUENTA_2FA_QUITADA', jsonb_build_object('correo', lower(u.correo), 'motivo', v_motivo));
  return (select private.cuenta_json(x) from usuario x where usuarioid = p_id);
end $$;

-- El correo de recuperación lo envía Supabase Auth desde el navegador; aquí solo queda la constancia.
create or replace function public.blud_cuenta_constancia(p_id int, p_accion text, p_motivo text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare u usuario; v_motivo text := private.exigir_motivo(p_motivo);
begin
  perform public._exigir_rol(array['soporte']);
  u := private.cuenta_ajena(p_id);
  if p_accion not in ('RESTABLECER_ACCESO', 'REENVIAR_CONFIRMACION') then raise exception 'Acción no válida.'; end if;
  perform private.auditar('usuario', p_id, p_accion, jsonb_build_object('correo', lower(u.correo), 'motivo', v_motivo));
end $$;

-- ============================================================ RF-A2 · Incidencias técnicas
create table if not exists public.incidencia_tecnica (
  incidencia_id bigint generated always as identity primary key,
  codigo varchar not null unique,
  titulo varchar not null,
  descripcion text not null,
  categoria varchar not null default 'Plataforma'
    check (categoria in ('Plataforma', 'Cuentas', 'Inventario', 'Laboratorio', 'Equipos', 'Integraciones', 'Otro')),
  severidad varchar not null default 'Media' check (severidad in ('Baja', 'Media', 'Alta', 'Crítica')),
  estado varchar not null default 'abierta' check (estado in ('abierta', 'en_proceso', 'resuelta', 'descartada')),
  sede_id integer references public.sede (sedeid),
  reportado_por integer references public.usuario (usuarioid),
  asignado_a integer references public.usuario (usuarioid),
  ticket_id text references public.ticket_soporte (ticket_id) on delete set null,
  seguimiento jsonb not null default '[]',
  resolucion text,
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  resuelto_en timestamptz
);
create index if not exists incidencia_estado_idx on public.incidencia_tecnica (estado, incidencia_id desc);
create index if not exists incidencia_sede_idx on public.incidencia_tecnica (sede_id);
create index if not exists incidencia_reportado_idx on public.incidencia_tecnica (reportado_por);
create index if not exists incidencia_asignado_idx on public.incidencia_tecnica (asignado_a);
create index if not exists incidencia_ticket_idx on public.incidencia_tecnica (ticket_id);
alter table public.incidencia_tecnica enable row level security;
revoke all on public.incidencia_tecnica from anon, authenticated;

create or replace function private.incidencia_json(i public.incidencia_tecnica) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', i.codigo, 'titulo', i.titulo, 'descripcion', i.descripcion, 'categoria', i.categoria, 'severidad', i.severidad,
    'estado', i.estado, 'sede', (select nombre from sede where sedeid = i.sede_id),
    'reportadoPor', (select trim(nombres || ' ' || apellidos) from usuario where usuarioid = i.reportado_por),
    'asignadoA', (select jsonb_build_object('id', usuarioid, 'nombre', trim(nombres || ' ' || apellidos)) from usuario where usuarioid = i.asignado_a),
    'ticketId', i.ticket_id, 'ticketCodigo', (select codigo from ticket_soporte where ticket_id = i.ticket_id),
    'seguimiento', i.seguimiento, 'resolucion', i.resolucion,
    'creado', i.creado, 'actualizado', i.actualizado, 'resueltoEn', i.resuelto_en))
$$;

create or replace function public.blud_incidencias(p_estado text default null, p_q text default null, p_cursor text default null, p_limite int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_lim int := least(greatest(coalesce(p_limite, 25), 1), 100);
  v_q text := case when length(trim(coalesce(p_q, ''))) >= 3 then lower(trim(p_q)) end;
  v_cur bigint := (select incidencia_id from incidencia_tecnica where codigo = p_cursor);
  v_items jsonb; v_mas boolean;
begin
  perform public._exigir_rol(array['soporte']);
  with pagina as (
    select i.incidencia_id from incidencia_tecnica i
    where (v_cur is null or i.incidencia_id < v_cur)
      and (p_estado is null or (p_estado = 'activas' and i.estado in ('abierta', 'en_proceso')) or i.estado = p_estado)
      and (v_q is null or lower(i.titulo || ' ' || i.descripcion || ' ' || i.codigo) like '%' || v_q || '%')
    order by i.incidencia_id desc limit v_lim + 1)
  select coalesce(jsonb_agg(private.incidencia_json(i) order by i.incidencia_id desc) filter (where z.n <= v_lim), '[]'), count(*) > v_lim
    into v_items, v_mas
  from (select incidencia_id, row_number() over (order by incidencia_id desc) n from pagina) z
  join incidencia_tecnica i on i.incidencia_id = z.incidencia_id;
  return jsonb_build_object('items', v_items,
    'siguiente', case when v_mas then (v_items -> (jsonb_array_length(v_items) - 1) ->> 'id') end,
    'resumen', (select jsonb_build_object(
      'abiertas', count(*) filter (where estado = 'abierta'), 'enProceso', count(*) filter (where estado = 'en_proceso'),
      'criticas', count(*) filter (where estado in ('abierta', 'en_proceso') and severidad in ('Alta', 'Crítica')))
      from incidencia_tecnica));
end $$;

-- Crear (sin id) o actualizar: estado, asignación, severidad, nota de seguimiento y resolución.
create or replace function public.blud_incidencia_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  i incidencia_tecnica;
  v_estado text := nullif(p ->> 'estado', '');
  v_nota text := nullif(trim(coalesce(p ->> 'nota', '')), '');
  v_yo text := (select trim(nombres || ' ' || apellidos) from usuario where usuarioid = public._uid());
begin
  perform public._exigir_rol(array['soporte']);
  if coalesce(p ->> 'id', '') = '' then
    if length(trim(coalesce(p ->> 'titulo', ''))) < 5 then raise exception 'Escribe un título claro (mínimo 5 caracteres).'; end if;
    if length(trim(coalesce(p ->> 'descripcion', ''))) < 15 then raise exception 'Describe la falla (mínimo 15 caracteres).'; end if;
    insert into incidencia_tecnica (codigo, titulo, descripcion, categoria, severidad, sede_id, reportado_por, asignado_a, ticket_id, seguimiento)
    values ('INC-' || to_char(now(), 'YYYY') || '-' || lpad((coalesce((select max(incidencia_id) from incidencia_tecnica), 0) + 1)::text, 4, '0'),
            trim(p ->> 'titulo'), trim(p ->> 'descripcion'), coalesce(nullif(p ->> 'categoria', ''), 'Plataforma'),
            coalesce(nullif(p ->> 'severidad', ''), 'Media'), coalesce(nullif(p ->> 'sedeId', '')::int, public._sede_id()), public._uid(),
            public._uid(), nullif(p ->> 'ticketId', ''),
            jsonb_build_array(jsonb_build_object('fecha', now(), 'autor', v_yo, 'texto', 'Incidencia registrada.', 'estado', 'abierta')))
    returning * into i;
    perform private.auditar('incidencia_tecnica', i.incidencia_id, 'INCIDENCIA_CREADA', jsonb_build_object('codigo', i.codigo, 'severidad', i.severidad));
    return private.incidencia_json(i);
  end if;

  select * into i from incidencia_tecnica where codigo = p ->> 'id' for update;
  if not found then raise exception 'No encontramos esa incidencia.'; end if;
  if v_estado is not null and v_estado not in ('abierta', 'en_proceso', 'resuelta', 'descartada') then raise exception 'Estado no válido.'; end if;
  if v_estado in ('resuelta', 'descartada') and length(trim(coalesce(p ->> 'resolucion', i.resolucion, ''))) < 10 then
    raise exception 'Explica cómo se resolvió o por qué se descarta (mínimo 10 caracteres).';
  end if;
  if v_estado is null and v_nota is null and p -> 'asignarme' is null and p ->> 'severidad' is null then
    raise exception 'No hay cambios que guardar.';
  end if;
  update incidencia_tecnica set
    estado = coalesce(v_estado, estado),
    severidad = coalesce(nullif(p ->> 'severidad', ''), severidad),
    asignado_a = case when (p ->> 'asignarme')::boolean then public._uid() else asignado_a end,
    resolucion = coalesce(nullif(trim(p ->> 'resolucion'), ''), resolucion),
    resuelto_en = case when coalesce(v_estado, estado) in ('resuelta', 'descartada') then coalesce(resuelto_en, now()) else null end,
    actualizado = now(),
    seguimiento = seguimiento || case when v_nota is not null or v_estado is distinct from null then jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'fecha', now(), 'autor', v_yo, 'texto', coalesce(v_nota, 'Cambio de estado.'), 'estado', v_estado))) else '[]'::jsonb end
  where incidencia_id = i.incidencia_id
  returning * into i;
  if v_estado is not null then
    perform private.auditar('incidencia_tecnica', i.incidencia_id, 'INCIDENCIA_' || upper(v_estado), jsonb_build_object('codigo', i.codigo));
  end if;
  return private.incidencia_json(i);
end $$;

-- ============================================================ RF-A3 · Corrección de estados
-- Consulta el estado actual de un registro antes de corregirlo.
--   unidad:  código de la bolsa (codigolote) o U-<id>
--   prueba:  código de la donación (DON-…) o DIN ISBT → último tamizaje
--   tipaje:  solicitud REQ-… → última muestra de tipaje
create or replace function public.blud_registro_estado(p_tipo text, p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ref text := trim(coalesce(p_ref, '')); v jsonb;
begin
  perform public._exigir_rol(array['soporte']);
  if p_tipo = 'unidad' then
    select jsonb_build_object('tipo', 'unidad', 'id', u.unidadid, 'ref', u.codigolote, 'estado', u.estado::text,
             'detalle', concat_ws(' · ', private.comp_front(hc.tipo::text), private.ts_txt(u.tiposangreid), 'vence ' || private.dia(u.fechavencimiento), s.nombre),
             'opciones', '["Cuarentena","Disponible","Reservado","EnTransito","Descartado","Transfundido"]'::jsonb)
      into v
    from unidadsangre u join hemocomponente hc on hc.componenteid = u.componenteid left join sede s on s.sedeid = u.sedeid
    where u.codigolote = v_ref or ('U-' || u.unidadid) = upper(v_ref) limit 1;
  elsif p_tipo = 'prueba' then
    select jsonb_build_object('tipo', 'prueba', 'id', ps.prueba_id, 'ref', x.din_codigo, 'estado', ps.resultado_global::text,
             'detalle', concat_ws(' · ', x.din_isbt, 'analizada ' || private.dia(ps.fecha_analisis)),
             'opciones', '["Negativo","Positivo","Indeterminado"]'::jsonb)
      into v
    from donacion x join prueba_serologica ps on ps.donacion_id = x.donacionid
    where upper(x.din_codigo) = upper(v_ref) or upper(x.din_isbt) = upper(replace(v_ref, ' ', ''))
    order by ps.prueba_id desc limit 1;
  elsif p_tipo = 'tipaje' then
    select jsonb_build_object('tipo', 'tipaje', 'id', t.tipaje_id, 'ref', 'REQ-' || lpad(t.solicitud_id::text, 6, '0'),
             'estado', case when t.muestra_conforme then 'Conforme' else 'Rechazada' end,
             'detalle', concat_ws(' · ', 'tubo ' || t.codigo_tubo_muestra, t.grupo_abo_determinado::text || coalesce(t.factor_rh_determinado::text, '')),
             'opciones', '["Conforme","Rechazada"]'::jsonb)
      into v
    from prueba_tipaje_muestra t
    where t.solicitud_id = substring(v_ref from '\d+')::int
    order by t.tipaje_id desc limit 1;
  else
    raise exception 'Tipo de registro no válido.';
  end if;
  if v is null then raise exception 'No encontramos ese registro.'; end if;
  return v;
end $$;

create or replace function public.blud_corregir_estado(p_tipo text, p_id bigint, p_nuevo text, p_motivo text, p_incidencia text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_motivo text := private.exigir_motivo(p_motivo);
  v_antes text;
  v_tabla text;
begin
  perform public._exigir_rol(array['soporte']);
  if p_incidencia is not null and not exists (select 1 from incidencia_tecnica where codigo = p_incidencia) then
    raise exception 'No encontramos la incidencia %.', p_incidencia;
  end if;
  begin
    if p_tipo = 'unidad' then
      v_tabla := 'unidadsangre';
      select estado::text into v_antes from unidadsangre where unidadid = p_id for update;
      if not found then raise exception 'No encontramos esa unidad.'; end if;
      execute format('update unidadsangre set estado = %L where unidadid = %s', p_nuevo, p_id);
    elsif p_tipo = 'prueba' then
      v_tabla := 'prueba_serologica';
      select resultado_global::text into v_antes from prueba_serologica where prueba_id = p_id for update;
      if not found then raise exception 'No encontramos ese tamizaje.'; end if;
      execute format('update prueba_serologica set resultado_global = %L where prueba_id = %s', p_nuevo, p_id);
    elsif p_tipo = 'tipaje' then
      v_tabla := 'prueba_tipaje_muestra';
      select case when muestra_conforme then 'Conforme' else 'Rechazada' end into v_antes from prueba_tipaje_muestra where tipaje_id = p_id for update;
      if not found then raise exception 'No encontramos esa muestra.'; end if;
      if p_nuevo not in ('Conforme', 'Rechazada') then raise exception 'Estado no válido.'; end if;
      update prueba_tipaje_muestra set muestra_conforme = (p_nuevo = 'Conforme') where tipaje_id = p_id;
    else
      raise exception 'Tipo de registro no válido.';
    end if;
  exception when invalid_text_representation then
    raise exception 'El estado «%» no existe para ese registro.', p_nuevo;
  end;
  if v_antes = p_nuevo then raise exception 'El registro ya tiene ese estado.'; end if;
  perform private.auditar(v_tabla, p_id, 'CORRECCION_ESTADO',
    jsonb_strip_nulls(jsonb_build_object('antes', v_antes, 'despues', p_nuevo, 'motivo', v_motivo, 'incidencia', p_incidencia)));
  if p_incidencia is not null then
    update incidencia_tecnica set actualizado = now(), seguimiento = seguimiento || jsonb_build_array(jsonb_build_object(
      'fecha', now(), 'autor', (select trim(nombres || ' ' || apellidos) from usuario where usuarioid = public._uid()),
      'texto', format('Corrección: %s #%s de %s a %s. %s', p_tipo, p_id, v_antes, p_nuevo, v_motivo)))
    where codigo = p_incidencia;
  end if;
  return jsonb_build_object('antes', v_antes, 'despues', p_nuevo);
end $$;

-- Últimas correcciones (para la pantalla).
create or replace function public.blud_correcciones(p_limite int default 20) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.mi_rol() = 'soporte' then coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', b.auditoria_id, 'fecha', b.fecha_hora, 'tabla', b.tabla_afectada,
             'registro', b.registro_id, 'usuario', trim(u.nombres || ' ' || u.apellidos), 'detalle', b.valores_nuevos)) order by b.auditoria_id desc)
    from (select * from bitacora_auditoria where operacion = 'CORRECCION_ESTADO' order by auditoria_id desc
          limit least(greatest(coalesce(p_limite, 20), 1), 100)) b
    left join usuario u on u.usuarioid = b.usuario_id), '[]') end
$$;
create index if not exists idx_bitacora_operacion on public.bitacora_auditoria (operacion, auditoria_id desc);

-- ============================================================ RF-I4 · Equipos y temperatura
create table if not exists public.equipo_almacenamiento (
  equipo_id integer generated always as identity primary key,
  sede_id integer not null references public.sede (sedeid),
  nombre varchar not null,
  tipo varchar not null check (tipo in ('Cámara fría', 'Refrigerador', 'Congelador', 'Agitador de plaquetas', 'Otro')),
  temp_min numeric(5, 1) not null,
  temp_max numeric(5, 1) not null,
  ubicacion varchar,
  serial varchar,
  ultima_calibracion date,
  proxima_calibracion date,
  activo boolean not null default true,
  creado timestamptz not null default now(),
  check (temp_min < temp_max)
);
create index if not exists equipo_sede_idx on public.equipo_almacenamiento (sede_id);

create table if not exists public.lectura_temperatura (
  lectura_id bigint generated always as identity primary key,
  equipo_id integer not null references public.equipo_almacenamiento (equipo_id) on delete cascade,
  temperatura numeric(5, 1) not null,
  fecha_hora timestamptz not null default now(),
  registrado_por integer references public.usuario (usuarioid),
  nota text
);
create index if not exists lectura_equipo_fecha_idx on public.lectura_temperatura (equipo_id, fecha_hora desc);
create index if not exists lectura_registrado_idx on public.lectura_temperatura (registrado_por);
alter table public.equipo_almacenamiento enable row level security;
alter table public.lectura_temperatura enable row level security;
revoke all on public.equipo_almacenamiento, public.lectura_temperatura from anon, authenticated;

create or replace function private.equipo_json(e public.equipo_almacenamiento) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', e.equipo_id, 'nombre', e.nombre, 'tipo', e.tipo, 'min', e.temp_min, 'max', e.temp_max, 'ubicacion', e.ubicacion,
    'serial', e.serial, 'ultimaCalibracion', e.ultima_calibracion, 'proximaCalibracion', e.proxima_calibracion, 'activo', e.activo,
    'sede', (select nombre from sede where sedeid = e.sede_id),
    'ultima', (select jsonb_build_object('temperatura', l.temperatura, 'fecha', l.fecha_hora, 'nota', l.nota,
                 'por', (select trim(nombres || ' ' || apellidos) from usuario where usuarioid = l.registrado_por))
               from lectura_temperatura l where l.equipo_id = e.equipo_id order by l.fecha_hora desc limit 1),
    'lecturas', (select coalesce(jsonb_agg(jsonb_build_object('t', z.temperatura, 'f', z.fecha_hora) order by z.fecha_hora), '[]')
                 from (select temperatura, fecha_hora from lectura_temperatura where equipo_id = e.equipo_id
                       and fecha_hora > now() - interval '7 days' order by fecha_hora desc limit 60) z)))
$$;

create or replace function public.blud_equipos() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._exigir_rol(array['laboratorio', 'director', 'operador']);
  return coalesce((select jsonb_agg(private.equipo_json(e) order by e.activo desc, e.nombre)
                   from equipo_almacenamiento e where e.sede_id = public._sede_id()), '[]');
end $$;

create or replace function public.blud_equipo_guardar(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e equipo_almacenamiento; v_sede int := public._sede_id();
begin
  perform public._exigir_rol(array['laboratorio', 'director']);
  if length(trim(coalesce(p ->> 'nombre', ''))) < 3 then raise exception 'Escribe el nombre del equipo.'; end if;
  if (p ->> 'min')::numeric >= (p ->> 'max')::numeric then raise exception 'La temperatura mínima debe ser menor que la máxima.'; end if;
  if coalesce(p ->> 'id', '') = '' then
    insert into equipo_almacenamiento (sede_id, nombre, tipo, temp_min, temp_max, ubicacion, serial, ultima_calibracion, proxima_calibracion)
    values (v_sede, trim(p ->> 'nombre'), p ->> 'tipo', (p ->> 'min')::numeric, (p ->> 'max')::numeric, nullif(trim(p ->> 'ubicacion'), ''),
            nullif(trim(p ->> 'serial'), ''), nullif(p ->> 'ultimaCalibracion', '')::date, nullif(p ->> 'proximaCalibracion', '')::date)
    returning * into e;
  else
    update equipo_almacenamiento set nombre = trim(p ->> 'nombre'), tipo = p ->> 'tipo', temp_min = (p ->> 'min')::numeric,
      temp_max = (p ->> 'max')::numeric, ubicacion = nullif(trim(p ->> 'ubicacion'), ''), serial = nullif(trim(p ->> 'serial'), ''),
      ultima_calibracion = nullif(p ->> 'ultimaCalibracion', '')::date, proxima_calibracion = nullif(p ->> 'proximaCalibracion', '')::date,
      activo = coalesce((p ->> 'activo')::boolean, activo)
    where equipo_id = (p ->> 'id')::int and sede_id = v_sede
    returning * into e;
    if not found then raise exception 'No encontramos ese equipo en tu sede.'; end if;
  end if;
  perform private.auditar('equipo_almacenamiento', e.equipo_id, case when p ->> 'id' is null then 'EQUIPO_CREADO' else 'EQUIPO_EDITADO' end,
    jsonb_build_object('nombre', e.nombre, 'rango', e.temp_min || ' a ' || e.temp_max));
  return private.equipo_json(e);
end $$;

create or replace function public.blud_registrar_temperatura(p_equipo int, p_temperatura numeric, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e equipo_almacenamiento;
begin
  perform public._exigir_rol(array['laboratorio', 'director', 'operador']);
  select * into e from equipo_almacenamiento where equipo_id = p_equipo and sede_id = public._sede_id() and activo;
  if not found then raise exception 'No encontramos ese equipo activo en tu sede.'; end if;
  if p_temperatura < -90 or p_temperatura > 60 then raise exception 'Revisa la temperatura: % °C no es una lectura posible.', p_temperatura; end if;
  if (p_temperatura < e.temp_min or p_temperatura > e.temp_max) and length(trim(coalesce(p_nota, ''))) < 10 then
    raise exception 'La lectura está fuera de rango: describe qué se hizo (mínimo 10 caracteres).';
  end if;
  insert into lectura_temperatura (equipo_id, temperatura, registrado_por, nota) values (p_equipo, p_temperatura, public._uid(), nullif(trim(p_nota), ''));
  if p_temperatura < e.temp_min or p_temperatura > e.temp_max then
    perform private.auditar('equipo_almacenamiento', p_equipo, 'TEMPERATURA_FUERA_DE_RANGO',
      jsonb_build_object('equipo', e.nombre, 'temperatura', p_temperatura, 'rango', e.temp_min || ' a ' || e.temp_max, 'nota', p_nota));
  end if;
  return private.equipo_json(e);
end $$;

-- ============================================================ RF-H5 · Trazabilidad donante ↔ receptor
-- Solicitud a la que se reservó una unidad (último registro de reserva en la bitácora).
create or replace function private.solicitud_de_unidad(p_unidad int) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select (b.valores_nuevos ->> 'solicitud_id')::int from bitacora_auditoria b
  where b.tabla_afectada = 'unidadsangre' and b.registro_id = p_unidad and b.operacion = 'RESERVA' and b.valores_nuevos ? 'solicitud_id'
  order by b.auditoria_id desc limit 1
$$;

create or replace function public.blud_trazabilidad(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_q text := upper(trim(coalesce(p_q, '')));
  v_ced text := private.cedula(p_q);
  v_ids int[];
  v_por text;
begin
  perform public._exigir_rol(array['director', 'laboratorio']);
  if length(v_q) < 4 then raise exception 'Escribe un DIN, código de bolsa, cédula o solicitud (REQ-…).'; end if;

  -- 1. Donación por código interno o DIN ISBT.
  select array_agg(donacionid), 'donacion' into v_ids, v_por from donacion
  where upper(din_codigo) = v_q or upper(din_isbt) = replace(v_q, ' ', '');
  -- 2. Bolsa (unidad) por su código.
  if v_ids is null then
    select array_agg(distinct donacionid), 'unidad' into v_ids, v_por from unidadsangre where upper(codigolote) = v_q or ('U-' || unidadid) = v_q;
  end if;
  -- 3. Solicitud de transfusión: las donaciones de las unidades que recibió.
  if v_ids is null and v_q like 'REQ-%' then
    select array_agg(distinct u.donacionid), 'solicitud' into v_ids, v_por
    from unidadsangre u where private.solicitud_de_unidad(u.unidadid) = substring(v_q from '\d+')::int;
  end if;
  -- 4. Cédula: del donante (sus donaciones) o del paciente (lo que recibió).
  if v_ids is null and v_ced ~ '^[VEJ]-\d+$' then
    select array_agg(x.donacionid), 'donante' into v_ids, v_por
    from donacion x join donante d on d.donanteid = x.donanteid join usuario u on u.usuarioid = d.usuarioid
    where private.cedula(u.cedula) = v_ced;
    if v_ids is null then
      select array_agg(distinct un.donacionid), 'paciente' into v_ids, v_por
      from paciente pa join solicitudtransfusion st on st.pacienteid = pa.pacienteid
      join unidadsangre un on private.solicitud_de_unidad(un.unidadid) = st.solicitudid
      where private.cedula(pa.cedula) = v_ced;
    end if;
  end if;
  if v_ids is null then return jsonb_build_object('por', null, 'donaciones', '[]'::jsonb); end if;

  perform private.auditar('donacion', v_ids[1], 'CONSULTA_TRAZABILIDAD', jsonb_build_object('busqueda', v_q, 'por', v_por));
  return jsonb_build_object('por', v_por, 'donaciones', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'din', x.din_codigo, 'dinIsbt', x.din_isbt, 'fecha', private.dia(x.fechadonacion),
      'sede', (select nombre from sede where sedeid = x.sedeid),
      'donante', jsonb_build_object('id', 'BLD-' || lpad(d.donanteid::text, 6, '0'), 'nombre', trim(u.nombres || ' ' || u.apellidos),
                                    'cedula', private.cedula(u.cedula), 'sangre', private.ts_txt(d.tipo_sangre)),
      'tamizaje', (select jsonb_build_object('resultado', ps.resultado_global::text, 'fecha', private.dia(ps.fecha_analisis))
                   from prueba_serologica ps where ps.donacion_id = x.donacionid order by ps.prueba_id desc limit 1),
      'unidades', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', un.unidadid, 'codigo', un.codigolote, 'componente', private.comp_front(hc.tipo::text), 'tipo', private.ts_txt(un.tiposangreid),
          'estado', un.estado::text, 'vence', private.dia(un.fechavencimiento), 'sede', (select nombre from sede where sedeid = un.sedeid),
          'destino', (select jsonb_strip_nulls(jsonb_build_object(
              'solicitud', 'REQ-' || lpad(st.solicitudid::text, 6, '0'), 'estado', st.estado::text, 'fecha', private.dia(st.fechasolicitud),
              'sede', (select nombre from sede where sedeid = st.sedesolicitanteid),
              'paciente', jsonb_build_object('nombre', trim(pa.nombres || ' ' || pa.apellidos), 'cedula', pa.cedula, 'servicio', pa.servicio_area),
              'hemovigilancia', (select jsonb_strip_nulls(jsonb_build_object('folio', h.folio, 'estado', h.estado_registro, 'tipoEvento', h.tipo_evento,
                                   'categoria', h.categoria_reaccion, 'severidad', h.severidad_reaccion))
                                 from hemo_vigilancia h where h.unidad_id = un.unidadid and h.solicitud_id = st.solicitudid limit 1)))
            from solicitudtransfusion st join paciente pa on pa.pacienteid = st.pacienteid
            where st.solicitudid = private.solicitud_de_unidad(un.unidadid))
        )) order by un.unidadid), '[]')
        from unidadsangre un join hemocomponente hc on hc.componenteid = un.componenteid where un.donacionid = x.donacionid)
    )) order by x.fechadonacion desc)
    from donacion x join donante d on d.donanteid = x.donanteid join usuario u on u.usuarioid = d.usuarioid
    where x.donacionid = any (v_ids[1:20])), '[]'));
end $$;

-- ============================================================ Permisos
revoke all on function private.exigir_motivo(text), private.auditar(text, bigint, text, jsonb), private.cuenta_json(public.usuario),
  private.cuenta_ajena(int), private.incidencia_json(public.incidencia_tecnica), private.equipo_json(public.equipo_almacenamiento),
  private.solicitud_de_unidad(int) from public, anon, authenticated;
revoke all on function
  public.blud_cuentas(text, text, boolean, int, int), public.blud_cuenta_activo(int, boolean, text), public.blud_cuenta_rol(int, text, int, text),
  public.blud_cuenta_quitar_2fa(int, text), public.blud_cuenta_constancia(int, text, text),
  public.blud_incidencias(text, text, text, int), public.blud_incidencia_guardar(jsonb),
  public.blud_registro_estado(text, text), public.blud_corregir_estado(text, bigint, text, text, text), public.blud_correcciones(int),
  public.blud_equipos(), public.blud_equipo_guardar(jsonb), public.blud_registrar_temperatura(int, numeric, text),
  public.blud_trazabilidad(text) from public, anon;
grant execute on function
  public.blud_cuentas(text, text, boolean, int, int), public.blud_cuenta_activo(int, boolean, text), public.blud_cuenta_rol(int, text, int, text),
  public.blud_cuenta_quitar_2fa(int, text), public.blud_cuenta_constancia(int, text, text),
  public.blud_incidencias(text, text, text, int), public.blud_incidencia_guardar(jsonb),
  public.blud_registro_estado(text, text), public.blud_corregir_estado(text, bigint, text, text, text), public.blud_correcciones(int),
  public.blud_equipos(), public.blud_equipo_guardar(jsonb), public.blud_registrar_temperatura(int, numeric, text),
  public.blud_trazabilidad(text) to authenticated;
