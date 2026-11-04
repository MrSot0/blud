-- BLUD · Adaptador entre el front y el esquema de Bloodonor
-- (usuario, donante, donacion, unidadsangre, solicitudtransfusion, prueba_serologica, fraccionamiento, cita…).
--
-- El front trabaja con colecciones (donantes, donaciones, solicitudes, tickets…) en una caché local.
-- Aquí se traducen en los dos sentidos:
--   blud_panel()                  lee las tablas y devuelve lo que el rol puede ver, con la forma del front.
--   blud_guardar(coleccion, item) recibe un cambio del front y lo aplica con las funciones del esquema
--                                 (evaluar_donante, registrar_donacion, registrar_serologia, fraccionar_donacion,
--                                 liberar_unidades, crear_solicitud, reservar_unidades, rechazar_solicitud…),
--                                 que siguen validando el rol y las reglas clínicas.
--
-- No borra ni reescribe datos ni cambia las funciones existentes. Añade: dos columnas opcionales, las tablas
-- de soporte, el paso de despacho y funciones nuevas. En BLUD el operador carga la orden médica y la dirección
-- la aprueba (reservar_unidades): para eso se usa una copia privada de crear_solicitud que acepta también al operador.

-- ============================================================ Columnas nuevas (opcionales)
alter table public.donante
  add column if not exists verificado_en timestamptz,
  add column if not exists verificado_por integer references public.personalsalud (personalid);
alter table public.personalsalud add column if not exists colegiado varchar;

-- ============================================================ Soporte al donante
create table if not exists public.ticket_soporte (
  ticket_id text primary key,
  codigo varchar not null unique,
  dueno_correo varchar not null,
  donante_ref text,
  donante_nombre varchar not null,
  asunto varchar not null,
  estado varchar not null default 'abierto' check (estado in ('abierto', 'en_proceso', 'resuelto')),
  prioridad varchar not null default 'normal' check (prioridad in ('normal', 'alta')),
  asignado_a jsonb,
  mensajes jsonb not null default '[]',
  creado timestamptz not null default clock_timestamp(),
  actualizado timestamptz not null default clock_timestamp(),
  resuelto_en timestamptz
);
create index if not exists ticket_soporte_dueno_idx on public.ticket_soporte (lower(dueno_correo));

-- Notas internas aparte, para que el donante nunca las reciba.
create table if not exists public.ticket_nota (
  ticket_id text primary key references public.ticket_soporte (ticket_id) on delete cascade,
  notas jsonb not null default '[]'
);

-- Sin políticas a propósito: solo se leen y escriben con blud_panel y blud_guardar, que filtran por rol.
alter table public.ticket_soporte enable row level security;
alter table public.ticket_nota enable row level security;
revoke all on public.ticket_soporte, public.ticket_nota from anon, authenticated;

-- ============================================================ Ayudas (esquema privado, no expuesto en la API)
create schema if not exists private;

-- Copia de crear_solicitud (misma validación) que acepta también al operador. La original no se toca.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.crear_solicitud(jsonb, text, jsonb, enum_nivel_urgencia, text, boolean, boolean, timestamptz)'::regprocedure);
  v_def := replace(v_def, 'FUNCTION public.crear_solicitud(', 'FUNCTION private.crear_solicitud(');
  v_def := replace(v_def, 'array[''director'']', 'array[''director'', ''operador'']');
  execute v_def;
end $$;

create or replace function private.cedula(p text) returns text
language sql immutable set search_path = '' as $$
  select case when s ~ '^[VEJ]?-?\d{5,9}$'
    then coalesce(substring(s from '^([VEJ])'), 'V') || '-' || substring(s from '(\d{5,9})$')
    else s end
  from (select upper(regexp_replace(coalesce(p, ''), '[\s.]', '', 'g')) as s) x
$$;

create or replace function private.ts_id(p text) returns smallint
language sql stable set search_path = '' as $$
  select tiposangreid from public.tiposangre
  where grupoabo::text = regexp_replace(upper(replace(coalesce(p, ''), '−', '-')), '[+-]$', '')
    and factorrh::text = right(replace(coalesce(p, ''), '−', '-'), 1)
$$;

create or replace function private.ts_txt(p smallint) returns text
language sql stable set search_path = '' as $$
  select grupoabo::text || factorrh::text from public.tiposangre where tiposangreid = p
$$;

-- Nombres del front ↔ catálogo hemocomponente
create or replace function private.comp_front(p text) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'Concentrado de hematíes/ plaquetas' then 'Concentrado Globular'
    when 'Concentrado de plaquetas' then 'Plaquetas'
    when 'Plasma fresco congelado' then 'Plasma Fresco Congelado'
    else p end
$$;

create or replace function private.comp_id(p text) returns smallint
language sql stable set search_path = '' as $$
  select componenteid from public.hemocomponente
  where tipo::text = case p
    when 'Concentrado Globular' then 'Concentrado de hematíes/ plaquetas'
    when 'Plaquetas' then 'Concentrado de plaquetas'
    when 'Plasma Fresco Congelado' then 'Plasma fresco congelado'
    else p end
$$;

create or replace function private.rol_de(p_rol text, p_cargo text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_rol = 'Administrador' then 'director'
    when p_rol = 'PersonalSalud' then
      case p_cargo when 'Director' then 'director' when 'Laboratista' then 'laboratorio' when 'TecnicoSoporte' then 'soporte' else 'operador' end
    else 'donante' end
$$;

create or replace function private.cargo_label(p text) returns text
language sql immutable set search_path = '' as $$
  select case p when 'Medico' then 'Médico' when 'Laboratista' then 'Bioanalista' when 'TecnicoSoporte' then 'Técnico de soporte' else p end
$$;

create or replace function private.res_front(p text) returns text
language sql immutable set search_path = '' as $$
  select case p when 'Negativo' then 'no_reactivo' when 'Positivo' then 'reactivo' when 'Indeterminado' then 'indeterminado' end
$$;

create or replace function private.res_back(p text) returns text
language sql immutable set search_path = '' as $$
  select case p when 'no_reactivo' then 'Negativo' when 'reactivo' then 'Positivo' when 'indeterminado' then 'Indeterminado' end
$$;

create or replace function private.urgencia(p text) returns public.enum_nivel_urgencia
language sql immutable set search_path = '' as $$
  select (case p when 'urgente' then 'Urgente' when 'critica' then 'Emergencia' else 'Programada' end)::public.enum_nivel_urgencia
$$;

-- "12,5 g/dL" → "12.5"
create or replace function private.num(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(regexp_replace(replace(coalesce(p, ''), ',', '.'), '[^0-9.]', '', 'g'), '')
$$;

create or replace function private.correo_personal(p integer) returns text
language sql stable set search_path = '' as $$
  select lower(u.correo) from public.personalsalud ps join public.usuario u on u.usuarioid = ps.usuarioid where ps.personalid = p
$$;

create or replace function private.dia(p timestamptz) returns date
language sql stable set search_path = '' as $$ select (p at time zone 'America/Caracas')::date $$;

create or replace function private.sede_por_defecto() returns integer
language sql stable set search_path = '' as $$
  select min(sedeid) from public.sede where tipo = 'BancoSangre'
$$;

-- Rol de quien llama. null = cuenta desactivada. Sin ficha todavía = donante (acaba de registrarse).
create or replace function private.rol_actual() returns text
language sql stable set search_path = '' as $$
  select coalesce(public.mi_rol(), case when exists (
    select 1 from public.usuario where lower(correo) = lower(auth.jwt() ->> 'email') and not activo
  ) then null else 'donante' end)
$$;

-- ============================================================ Perfil de quien inició sesión
create or replace function public.blud_mi_perfil() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v jsonb;
begin
  if v_email is null then return null; end if;
  select jsonb_build_object(
    'id', u.usuarioid::text, 'email', lower(u.correo), 'full_name', trim(u.nombres || ' ' || u.apellidos),
    'role', private.rol_de(u.rol::text, p.cargo::text), 'blood_type', private.ts_txt(d.tipo_sangre),
    'phone', nullif(u.telefono, ''), 'cargo', private.cargo_label(p.cargo::text),
    'sede', coalesce(s.nombre, sr.nombre), 'sede_id', coalesce(p.sedeid, u.sederegistroid),
    'colegiado', p.colegiado, 'active', u.activo)
  into v
  from usuario u
  left join personalsalud p on p.usuarioid = u.usuarioid
  left join donante d on d.usuarioid = u.usuarioid
  left join sede s on s.sedeid = p.sedeid
  left join sede sr on sr.sedeid = u.sederegistroid
  where lower(u.correo) = v_email
  limit 1;
  -- Cuenta recién creada que aún no completa su ficha de donante.
  return coalesce(v, (
    select jsonb_build_object('id', id::text, 'email', v_email, 'full_name', coalesce(raw_user_meta_data ->> 'full_name', v_email),
      'role', 'donante', 'blood_type', raw_user_meta_data ->> 'blood_type', 'active', true)
    from auth.users where id = auth.uid()));
end $$;

-- ============================================================ Lectura: lo que cada rol puede ver
create or replace function public.blud_panel() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rol text := private.rol_actual();
  v_email text := lower(auth.jwt() ->> 'email');
  v_don int := public._donante_id();
  v_staff boolean;
  v_lab boolean;
  o jsonb := '{}';
begin
  if v_email is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  if v_rol is null then raise exception 'Tu cuenta está desactivada. Escribe a soporte@blud.app.' using errcode = '42501'; end if;
  v_staff := v_rol in ('operador', 'laboratorio', 'soporte', 'director');
  v_lab := v_rol = 'laboratorio';

  -- Donantes: el personal ve el registro completo; el donante, solo su ficha.
  o := o || jsonb_build_object('blud-db-donantes', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', 'BLD-' || lpad(d.donanteid::text, 6, '0'),
      'userId', case when d.donanteid = v_don then auth.uid()::text end,
      'cedula', private.cedula(u.cedula),
      'nombreCompleto', trim(u.nombres || ' ' || u.apellidos),
      'sangre', private.ts_txt(d.tipo_sangre),
      'telefono', nullif(u.telefono, ''),
      'email', case when u.correo not like '%@presencial.blud' then lower(u.correo) end,
      'nacimiento', u.fechanacimiento,
      'sexo', u.sexo,
      'fechaRegistro', private.dia(u.fecharegistro),
      'estado', case when d.verificado_en is not null or exists (select 1 from donacion x where x.donanteid = d.donanteid)
        then 'verificado' else 'preregistrado' end,
      'origen', case when u.correo like '%@presencial.blud' then 'operador' else 'app' end,
      'operadorId', private.correo_personal(d.verificado_por),
      'fechaVerificacion', private.dia(d.verificado_en),
      -- Diferido: solo la fecha. El motivo queda en la evaluación o en el laboratorio.
      'diferido', (select jsonb_build_object('desde', private.dia(min(f))) from (
          select e.fecha_evaluacion f from evaluacion_donante e
          where e.donante_id = d.donanteid and not e.apto_para_donar
            and e.evaluacion_id = (select max(evaluacion_id) from evaluacion_donante where donante_id = d.donanteid)
          union all
          select ps.fecha_analisis from prueba_serologica ps join donacion x on x.donacionid = ps.donacion_id
          where x.donanteid = d.donanteid and ps.resultado_global = 'Positivo'
        ) q having count(*) > 0)
    )))
    from donante d join usuario u on u.usuarioid = d.usuarioid
    where v_staff or d.donanteid = v_don), '[]'));

  -- Donaciones (el donante ve las suyas, sin el estado del laboratorio)
  o := o || jsonb_build_object('blud-db-donaciones', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', x.din_codigo,
      'donanteId', 'BLD-' || lpad(x.donanteid::text, 6, '0'),
      'donanteNombre', trim(u.nombres || ' ' || u.apellidos),
      'donanteCedula', private.cedula(u.cedula),
      'tipoSangre', private.ts_txt(d.tipo_sangre),
      'tipoHemocomponente', case when x.tipo_donacion = 'Aferesis' then 'Plaquetas' else 'Sangre Total' end,
      'volumenMl', x.volumenml,
      'fecha', private.dia(x.fechadonacion),
      'operadorId', private.correo_personal(x.personalid),
      'centroNombre', s.nombre,
      'estadoLab', case when not v_staff then null
        when not x.apta or sero.g = 'Positivo' then 'descartada'
        when sero.g = 'Negativo' then 'liberada' else 'pendiente' end
    )) order by x.fechadonacion desc)
    from donacion x
    join donante d on d.donanteid = x.donanteid
    join usuario u on u.usuarioid = d.usuarioid
    join sede s on s.sedeid = x.sedeid
    left join lateral (
      select resultado_global g from prueba_serologica where donacion_id = x.donacionid
      order by fecha_analisis desc, prueba_id desc limit 1
    ) sero on true
    where x.din_codigo is not null and (v_staff or x.donanteid = v_don)), '[]'));

  -- Solicitudes y entregas: operador y dirección
  if v_rol in ('operador', 'director') then
    o := o || jsonb_build_object('blud-db-pedidos', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', 'REQ-' || lpad(st.solicitudid::text, 6, '0'),
        'pacienteNombre', trim(pa.nombres || ' ' || pa.apellidos),
        'pacienteCedula', private.cedula(pa.cedula),
        'tipoSangre', private.ts_txt(st.tiposangreid),
        'tipoHemocomponente', private.comp_front(hc.tipo::text),
        'unidades', st.cantidadunidades,
        'hospitalDestino', s.nombre,
        'fecha', private.dia(st.fechasolicitud),
        'estado', case st.estado when 'Aprobada' then 'aprobado' when 'Rechazada' then 'rechazado' when 'Despachada' then 'despachado' else 'pendiente' end,
        'prioridad', case st.urgencia when 'Urgente' then 'urgente' when 'Emergencia' then 'critica' else 'normal' end,
        'servicio', pa.servicio_area,
        'diagnostico', st.indicacion_clinica,
        'medico', med.nombre,
        'clinica', nullif(jsonb_strip_nulls(jsonb_build_object(
          'Hb', pa.hb_g_dl::text, 'Hcto', pa.hcto_porcentaje::text, 'Plaquetas', pa.plaquetas_conteo::text,
          'TP', pa.tp_segundos::text, 'TPT', pa.tpp_segundos::text,
          'consentimiento', case when st.consentimiento_informado_firmado then 'si' end)), '{}'),
        'creadoPor', med.correo,
        'creadoPorNombre', med.nombre,
        'revisadoPor', rev.correo,
        'revisadoPorNombre', rev.nombre,
        'fechaRevision', rev.fecha,
        'motivoRechazo', rev.motivo,
        'entregaId', case when st.estado = 'Despachada' then 'ENT-' || lpad(st.solicitudid::text, 6, '0') end
      )) order by st.fechasolicitud desc)
      from solicitudtransfusion st
      join paciente pa on pa.pacienteid = st.pacienteid
      join hemocomponente hc on hc.componenteid = st.componenteid
      join sede s on s.sedeid = st.sedesolicitanteid
      left join lateral (
        select lower(u.correo) correo, trim(u.nombres || ' ' || u.apellidos) nombre
        from personalsalud p join usuario u on u.usuarioid = p.usuarioid where p.personalid = st.medico_solicitante_id
      ) med on true
      left join lateral (
        select lower(u.correo) correo, trim(u.nombres || ' ' || u.apellidos) nombre, private.dia(b.fecha_hora) fecha,
               b.valores_nuevos ->> 'motivo' motivo
        from bitacora_auditoria b left join usuario u on u.usuarioid = b.usuario_id
        where (b.tabla_afectada = 'solicitudtransfusion' and b.registro_id = st.solicitudid and b.operacion = 'RECHAZO')
           or (b.tabla_afectada = 'unidadsangre' and b.operacion = 'RESERVA' and (b.valores_nuevos ->> 'solicitud_id')::int = st.solicitudid)
        order by b.auditoria_id desc limit 1
      ) rev on true), '[]'));

    o := o || jsonb_build_object('blud-db-entregas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'ENT-' || lpad(st.solicitudid::text, 6, '0'),
        'pedidoId', 'REQ-' || lpad(st.solicitudid::text, 6, '0'),
        'pacienteNombre', trim(pa.nombres || ' ' || pa.apellidos),
        'pacienteCedula', private.cedula(pa.cedula),
        'tipoSangre', private.ts_txt(st.tiposangreid),
        'tipoHemocomponente', private.comp_front(hc.tipo::text),
        'unidades', st.cantidadunidades,
        'hospitalDestino', s.nombre,
        'fecha', coalesce(desp.fecha, private.dia(st.fechasolicitud)),
        'operadorId', coalesce(desp.correo, '')
      ) order by desp.fecha desc nulls last)
      from solicitudtransfusion st
      join paciente pa on pa.pacienteid = st.pacienteid
      join hemocomponente hc on hc.componenteid = st.componenteid
      join sede s on s.sedeid = st.sedesolicitanteid
      left join lateral (
        select private.dia(b.fecha_hora) fecha, lower(u.correo) correo
        from bitacora_auditoria b left join usuario u on u.usuarioid = b.usuario_id
        where b.tabla_afectada = 'solicitudtransfusion' and b.registro_id = st.solicitudid and b.operacion = 'DESPACHO'
        order by b.auditoria_id desc limit 1
      ) desp on true
      where st.estado = 'Despachada'), '[]'));
  end if;

  -- Laboratorio: detalle completo. La dirección recibe solo el resumen (sin resultados por prueba ni enfermedad).
  if v_rol in ('laboratorio', 'director') then
    o := o || jsonb_build_object('blud-db-pruebas', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', 'PS-' || ps.prueba_id,
        'donacionId', x.din_codigo,
        'codigo', x.din_codigo,
        'fecha', private.dia(ps.fecha_analisis),
        'resultados', case when v_lab then jsonb_strip_nulls(jsonb_build_object(
          'vih', private.res_front(ps.vih_1_2), 'hbsag', private.res_front(ps.hepatitis_b_hbsag),
          'hbcore', private.res_front(ps.hepatitis_b_antihbc), 'hcv', private.res_front(ps.hepatitis_c_antihcv),
          'sifilis', private.res_front(ps.sifilis_vdrl), 'chagas', private.res_front(ps.chagas),
          'htlv', private.res_front(ps.htlv_i_ii))) else '{}'::jsonb end,
        'resultadoGlobal', lower(ps.resultado_global),
        'tipoSangreConfirmado', private.ts_txt(d.tipo_sangre),
        'laboratoristaId', private.correo_personal(ps.analista_id)
      )) order by ps.fecha_analisis desc)
      from prueba_serologica ps
      join donacion x on x.donacionid = ps.donacion_id
      join donante d on d.donanteid = x.donanteid), '[]'));

    o := o || jsonb_build_object('blud-db-positivos', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', 'CP-' || ps.prueba_id || '-' || m.k,
        'pruebaId', 'PS-' || ps.prueba_id,
        'donacionId', x.din_codigo,
        'donanteId', 'BLD-' || lpad(x.donanteid::text, 6, '0'),
        'codigo', x.din_codigo,
        'prueba', case when v_lab then m.k end,
        'enfermedad', case when v_lab then m.n end,
        'fecha', private.dia(ps.fecha_analisis),
        'estado', case when nt.id is not null then 'notificado' else 'pendiente' end,
        'notificadoA', case when v_lab then nt.ente end,
        'referencia', case when v_lab then nt.ref end,
        'fechaNotificacion', nt.fecha,
        'notificadoPor', nt.correo
      )))
      from prueba_serologica ps
      join donacion x on x.donacionid = ps.donacion_id
      cross join lateral (values
        ('vih', 'VIH 1/2', ps.vih_1_2), ('hbsag', 'Hepatitis B (HBsAg)', ps.hepatitis_b_hbsag),
        ('hbcore', 'Hepatitis B (anti-HBc)', ps.hepatitis_b_antihbc), ('hcv', 'Hepatitis C (anti-VHC)', ps.hepatitis_c_antihcv),
        ('sifilis', 'Sífilis', ps.sifilis_vdrl), ('chagas', 'Chagas', ps.chagas), ('htlv', 'HTLV I/II', ps.htlv_i_ii)
      ) m (k, n, v)
      left join lateral (
        select b.auditoria_id id, b.valores_nuevos ->> 'ente' ente, b.valores_nuevos ->> 'referencia' ref,
               private.dia(b.fecha_hora) fecha, lower(u.correo) correo
        from bitacora_auditoria b left join usuario u on u.usuarioid = b.usuario_id
        where b.tabla_afectada = 'prueba_serologica' and b.registro_id = ps.prueba_id
          and b.operacion = 'NOTIFICACION' and b.valores_nuevos ->> 'prueba' = m.k
        order by b.auditoria_id desc limit 1
      ) nt on true
      where m.v = 'Positivo'), '[]'));
  end if;

  if v_rol in ('laboratorio', 'operador', 'director') then
    o := o || jsonb_build_object('blud-db-fracciones', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', 'FR-' || f.fraccionamiento_id,
        'donacionId', x.din_codigo,
        'codigo', x.din_codigo,
        'fecha', private.dia(f.fecha_hora_fraccionamiento),
        'productos', (select coalesce(jsonb_agg(jsonb_build_object('componente', private.comp_front(hc.tipo::text), 'unidades', g.n, 'volumenMl', 0)), '[]')
                      from (select componenteid, count(*) n from unidadsangre where fraccionamiento_id = f.fraccionamiento_id group by componenteid) g
                      join hemocomponente hc on hc.componenteid = g.componenteid),
        'observaciones', f.observaciones,
        'laboratoristaId', private.correo_personal(f.analista_id)
      )) order by f.fecha_hora_fraccionamiento desc)
      from fraccionamiento f join donacion x on x.donacionid = f.donacion_id), '[]'));

    -- Inventario: unidades disponibles (las reservadas ya están comprometidas con una solicitud aprobada).
    o := o || jsonb_build_object('blud-db-unidades', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'U-' || un.unidadid,
        'codigo', un.codigolote,
        'donacionId', x.din_codigo,
        'componente', private.comp_front(hc.tipo::text),
        'tipoSangre', private.ts_txt(un.tiposangreid),
        'extraccion', private.dia(x.fechadonacion),
        'vence', private.dia(un.fechavencimiento)
      ) order by un.fechavencimiento)
      from unidadsangre un
      join donacion x on x.donacionid = un.donacionid
      join hemocomponente hc on hc.componenteid = un.componenteid
      where un.estado = 'Disponible'), '[]'));
  end if;

  -- Soporte: el donante ve sus tickets; soporte y dirección, todos. Las notas internas, solo soporte.
  o := o || jsonb_build_object('blud-db-tickets', coalesce((
    select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id', t.ticket_id, 'codigo', t.codigo, 'donanteId', coalesce(t.donante_ref, ''), 'donanteNombre', t.donante_nombre,
      'donanteEmail', t.dueno_correo, 'asunto', t.asunto, 'estado', t.estado, 'prioridad', t.prioridad,
      'creado', t.creado, 'actualizado', t.actualizado, 'asignadoA', t.asignado_a, 'mensajes', t.mensajes,
      'resueltoEn', t.resuelto_en
    )) order by t.actualizado desc)
    from ticket_soporte t
    where v_rol in ('soporte', 'director') or lower(t.dueno_correo) = v_email), '[]'));

  if v_rol = 'soporte' then
    o := o || jsonb_build_object('blud-db-ticket-notas', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.ticket_id, 'notas', n.notas)) from ticket_nota n), '[]'));
  end if;

  -- Personal (solo la dirección)
  if v_rol = 'director' then
    o := o || jsonb_build_object('perfiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', u.usuarioid::text, 'email', lower(u.correo), 'full_name', trim(u.nombres || ' ' || u.apellidos),
        'role', private.rol_de(u.rol::text, p.cargo::text), 'blood_type', null, 'phone', nullif(u.telefono, ''),
        'cargo', private.cargo_label(p.cargo::text), 'sede', s.nombre, 'colegiado', p.colegiado, 'active', u.activo))
      from usuario u
      left join personalsalud p on p.usuarioid = u.usuarioid
      left join sede s on s.sedeid = p.sedeid
      where u.rol <> 'Donante'), '[]'));
  end if;

  -- Citas propias del donante
  if v_rol = 'donante' then
    o := o || jsonb_build_object('citas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', 'CITA-' || c.citaid, 'centerName', s.nombre, 'date', private.dia(c.fecha_hora_cita),
        'time', to_char(c.fecha_hora_cita at time zone 'America/Caracas', 'HH24:MI'), 'estado', c.estado
      ) order by c.fecha_hora_cita desc)
      from cita c join sede s on s.sedeid = c.sedeid
      where c.donanteid = v_don and c.estado <> 'Cancelada'), '[]'));
  end if;

  return o;
end $$;

-- ============================================================ Escritura: un cambio del front → funciones del esquema
create or replace function private.g_donante(p jsonb, v_rol text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_ced text := private.cedula(p ->> 'cedula');
  v_email text := lower(auth.jwt() ->> 'email');
  v_nombre text := regexp_replace(trim(coalesce(p ->> 'nombreCompleto', '')), '\s+', ' ', 'g');
  v_nombres text := split_part(v_nombre, ' ', 1);
  v_apellidos text := trim(substr(v_nombre, length(v_nombres) + 1));
  v_nac date := nullif(p ->> 'nacimiento', '')::date;
  v_sexo enum_sexo := nullif(upper(left(coalesce(p ->> 'sexo', ''), 1)), '')::enum_sexo;
  v_ts smallint := private.ts_id(p ->> 'sangre');
  v_tel text := coalesce(nullif(trim(p ->> 'telefono'), ''), '');
  u record;
  v_uid int;
begin
  if v_ced !~ '^[VEJ]-\d{5,9}$' then raise exception 'La cédula debe verse así: V-12345678.'; end if;
  select us.usuarioid, us.correo, us.fechanacimiento, d.donanteid into u
  from usuario us left join donante d on d.usuarioid = us.usuarioid
  where private.cedula(us.cedula) = v_ced limit 1;

  if v_rol = 'donante' then
    select usuarioid into v_uid from usuario where lower(correo) = v_email;
    if v_uid is null then
      if u.usuarioid is not null then
        -- Lo registró un operador en persona: se une a su cuenta si coincide también la fecha de nacimiento.
        if u.correo like '%@presencial.blud' and v_nac is not null and v_nac = u.fechanacimiento then
          update usuario set correo = v_email where usuarioid = u.usuarioid;
          return jsonb_build_object('aviso', 'Encontramos tu registro del banco de sangre y lo unimos a tu cuenta.');
        end if;
        raise exception 'Esa cédula ya está registrada. Si es tuya, escribe a soporte@blud.app.';
      end if;
      if v_nac is null or v_sexo is null then
        raise exception 'Completa tu fecha de nacimiento y tu sexo en el perfil para quedar registrado como donante.';
      end if;
      if v_ts is null then raise exception 'Indica tu tipo de sangre en el perfil.'; end if;
      if v_apellidos = '' then raise exception 'Escribe tu nombre y tu apellido.'; end if;
      insert into usuario (cedula, nombres, apellidos, fechanacimiento, sexo, telefono, correo, password_hash, rol, sederegistroid)
      values (v_ced, v_nombres, v_apellidos, v_nac, v_sexo, v_tel, v_email, 'supabase-auth', 'Donante', private.sede_por_defecto())
      returning usuarioid into v_uid;
      insert into donante (usuarioid, tipo_sangre) values (v_uid, v_ts);
      return '{}';
    end if;
    if u.usuarioid is not null and u.usuarioid <> v_uid then
      raise exception 'Esa cédula pertenece a otra cuenta. Escribe a soporte@blud.app.';
    end if;
    update usuario set
      nombres = coalesce(nullif(v_nombres, ''), nombres),
      apellidos = coalesce(nullif(v_apellidos, ''), apellidos),
      telefono = coalesce(nullif(v_tel, ''), telefono),
      fechanacimiento = coalesce(v_nac, fechanacimiento),
      sexo = coalesce(v_sexo, sexo),
      cedula = case when u.usuarioid is null then v_ced else cedula end
    where usuarioid = v_uid;
    insert into donante (usuarioid, tipo_sangre)
    select v_uid, v_ts where v_ts is not null and not exists (select 1 from donante where usuarioid = v_uid);
    -- El tipo de sangre lo puede corregir el donante solo mientras el banco no lo haya confirmado (sin donaciones).
    update donante dn set tipo_sangre = v_ts
    where dn.usuarioid = v_uid and v_ts is not null and dn.tipo_sangre <> v_ts
      and not exists (select 1 from donacion x where x.donanteid = dn.donanteid);
    return '{}';
  end if;

  if v_rol in ('operador', 'director') then
    if u.usuarioid is null then
      -- Registro en persona (sin cuenta en la app): correo de marcador hasta que el donante se una.
      if v_nac is null or v_sexo is null then raise exception 'Indica la fecha de nacimiento y el sexo del donante.'; end if;
      if v_ts is null then raise exception 'Elige el tipo de sangre.'; end if;
      if v_apellidos = '' then raise exception 'Escribe nombre y apellido del donante.'; end if;
      insert into usuario (cedula, nombres, apellidos, fechanacimiento, sexo, telefono, correo, password_hash, rol, sederegistroid)
      values (v_ced, v_nombres, v_apellidos, v_nac, v_sexo, v_tel, lower(replace(v_ced, '-', '')) || '@presencial.blud',
              'presencial', 'Donante', coalesce(public._sede_id(), private.sede_por_defecto()))
      returning usuarioid into v_uid;
      insert into donante (usuarioid, tipo_sangre, verificado_en, verificado_por) values (v_uid, v_ts, now(), public._personal_id());
      return '{}';
    end if;
    if u.donanteid is null then
      if v_ts is null then raise exception 'Elige el tipo de sangre.'; end if;
      insert into donante (usuarioid, tipo_sangre) values (u.usuarioid, v_ts);
    end if;
    update donante set
      verificado_en = coalesce(verificado_en, case when p ->> 'estado' = 'verificado' then now() end),
      verificado_por = coalesce(verificado_por, case when p ->> 'estado' = 'verificado' then public._personal_id() end),
      tipo_sangre = coalesce(v_ts, tipo_sangre)
    where usuarioid = u.usuarioid;
  end if;
  -- Laboratorio y soporte no editan el registro: lo que muestran (diferido, grupo confirmado) sale de sus propias acciones.
  return '{}';
end $$;

create or replace function private.g_donacion(p jsonb, v_rol text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_ev jsonb := p -> 'evaluacion';
  v_ts smallint := private.ts_id(p ->> 'tipoSangre');
  v_don int;
  r record;
begin
  select donanteid into v_don from donacion where din_codigo = p ->> 'id';
  if v_don is not null then
    -- Ya existe: su estado de laboratorio se deriva de la serología. El laboratorio sí confirma el grupo sanguíneo.
    if v_rol = 'laboratorio' and v_ts is not null then
      update donante set tipo_sangre = v_ts where donanteid = v_don and tipo_sangre <> v_ts;
    end if;
    return '{}';
  end if;

  select d.donanteid into v_don from donante d join usuario u on u.usuarioid = d.usuarioid
  where private.cedula(u.cedula) = private.cedula(p ->> 'donanteCedula');
  if v_don is null then raise exception 'No encontramos a ese donante. Regístralo primero en Donantes.'; end if;
  if private.num(v_ev ->> 'peso') is null or coalesce(v_ev ->> 'presion', '') = ''
     or private.num(v_ev ->> 'hb') is null or private.num(v_ev ->> 'temperatura') is null then
    raise exception 'Registra el peso, la presión arterial, la hemoglobina y la temperatura del donante.';
  end if;

  select * into r from public.evaluar_donante(
    v_don, private.num(v_ev ->> 'peso')::numeric, trim(v_ev ->> 'presion'), private.num(v_ev ->> 'hb')::numeric,
    private.num(v_ev ->> 'temperatura')::numeric, private.num(v_ev ->> 'fc')::smallint, null, null, null, null);
  if not r.o_apto then
    -- Se devuelve en vez de lanzar el error para que la evaluación (el diferimiento) quede guardada.
    return jsonb_build_object('error', 'No apto para donar: ' || r.o_motivo
      || coalesce('. Podrá donar desde el ' || to_char(r.o_proxima_aptitud, 'DD/MM/YYYY'), '') || '.');
  end if;

  if v_ts is not null then update donante set tipo_sangre = v_ts where donanteid = v_don and tipo_sangre <> v_ts; end if;
  select * into r from public.registrar_donacion(
    v_don, (p ->> 'volumenMl')::smallint,
    (case when p ->> 'tipoHemocomponente' = 'Plaquetas' then 'Aferesis' else 'Voluntaria' end)::enum_tipo_donacion,
    null, null);
  return jsonb_build_object('aviso', 'Donación ' || r.o_din || ' registrada: queda en cuarentena hasta el análisis del laboratorio.');
end $$;

create or replace function private.g_prueba(p jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := coalesce(p -> 'resultados', '{}');
  v_id int;
  v_global text;
begin
  if p ->> 'id' like 'PS-%' then return '{}'; end if;
  select donacionid into v_id from donacion where din_codigo = p ->> 'donacionId';
  if v_id is null then raise exception 'No encontramos esa donación.'; end if;
  v_global := public.registrar_serologia(v_id,
    private.res_back(v ->> 'vih'), private.res_back(v ->> 'hbsag'), private.res_back(v ->> 'hbcore'),
    private.res_back(v ->> 'hcv'), private.res_back(v ->> 'chagas'), private.res_back(v ->> 'sifilis'), private.res_back(v ->> 'htlv'));
  -- Si ya estaba fraccionada, las unidades salen de cuarentena en el mismo paso.
  if v_global = 'Negativo' and exists (select 1 from unidadsangre where donacionid = v_id and estado = 'Cuarentena') then
    perform public.liberar_unidades(v_id);
  end if;
  return '{}';
end $$;

create or replace function private.g_fraccion(p jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_id int;
  v_ids int[];
  v_sero text;
begin
  if p ->> 'id' like 'FR-%' then return '{}'; end if;
  select donacionid into v_id from donacion where din_codigo = p ->> 'donacionId';
  if v_id is null then raise exception 'No encontramos esa donación.'; end if;
  select array_agg(distinct private.comp_id(e ->> 'componente')::int) into v_ids
  from jsonb_array_elements(coalesce(p -> 'productos', '[]')) e where coalesce((e ->> 'unidades')::int, 0) > 0;
  if v_ids is null or array_position(v_ids, null) is not null then raise exception 'Hemocomponente no válido.'; end if;
  -- shortcut: el esquema registra una unidad por hemocomponente; las cantidades mayores del front se ignoran.
  perform public.fraccionar_donacion(v_id, v_ids, null, null, null, p ->> 'observaciones');
  select resultado_global into v_sero from prueba_serologica where donacion_id = v_id order by fecha_analisis desc, prueba_id desc limit 1;
  if v_sero = 'Negativo' then perform public.liberar_unidades(v_id); end if;
  return '{}';
end $$;

create or replace function private.g_caso(p jsonb, v_rol text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_pid bigint;
  v_k text;
begin
  if p ->> 'id' !~ '^CP-\d+-[a-z]+$' or p ->> 'estado' <> 'notificado' then return '{}'; end if;
  if v_rol <> 'laboratorio' then raise exception 'No tienes permiso para realizar esta acción.' using errcode = '42501'; end if;
  v_pid := split_part(p ->> 'id', '-', 2)::bigint;
  v_k := split_part(p ->> 'id', '-', 3);
  if not exists (select 1 from bitacora_auditoria where tabla_afectada = 'prueba_serologica' and registro_id = v_pid
                 and operacion = 'NOTIFICACION' and valores_nuevos ->> 'prueba' = v_k) then
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('prueba_serologica', v_pid, 'NOTIFICACION', public._uid(), public._sede_id(),
            jsonb_build_object('prueba', v_k, 'ente', p ->> 'notificadoA', 'referencia', p ->> 'referencia'));
  end if;
  return '{}';
end $$;

-- Despacho: las unidades reservadas salen hacia el centro solicitante.
create or replace function private.despachar(p_sid int) returns void
language plpgsql set search_path = public, pg_temp as $$
declare v_estado text;
begin
  perform public._exigir_rol(array['operador', 'director']);
  select estado into v_estado from solicitudtransfusion where solicitudid = p_sid for update;
  if v_estado = 'Despachada' then return; end if;
  if v_estado is distinct from 'Aprobada' then
    raise exception '%', case when v_estado = 'Pendiente' then 'La dirección aún no aprueba esa solicitud.' else 'Esa solicitud no se puede despachar.' end;
  end if;
  update unidadsangre set estado = 'EnTransito'
  where estado = 'Reservado' and unidadid in (select o_unidad_id from public.unidades_de_solicitud(p_sid));
  update solicitudtransfusion set estado = 'Despachada' where solicitudid = p_sid;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('solicitudtransfusion', p_sid, 'DESPACHO', public._uid(), public._sede_id(), '{}');
end $$;

create or replace function private.g_pedido(p jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_sid int;
  v_estado text;
  v_meta text := p ->> 'estado';
  v_cli jsonb := coalesce(p -> 'clinica', '{}');
  v_consent boolean := coalesce(p -> 'clinica' ->> 'consentimiento', '') = 'si';
  v_nombre text := regexp_replace(trim(coalesce(p ->> 'pacienteNombre', '')), '\s+', ' ', 'g');
  v_nombres text := split_part(v_nombre, ' ', 1);
  v_apellidos text := trim(substr(v_nombre, length(v_nombres) + 1));
  v_indicacion text := coalesce(nullif(trim(p ->> 'diagnostico'), ''), nullif(trim(p ->> 'servicio'), ''));
  v_comp smallint := private.comp_id(p ->> 'tipoHemocomponente');
begin
  if p ->> 'id' ~ '^REQ-\d+$' then v_sid := substring(p ->> 'id' from '\d+')::int; end if;
  select estado into v_estado from solicitudtransfusion where solicitudid = v_sid for update;

  if v_estado is null then
    if v_comp is null then raise exception 'La sangre total no se despacha: elige un hemocomponente.'; end if;
    if v_apellidos = '' then raise exception 'Escribe nombre y apellido del paciente.'; end if;
    select o_solicitud_id into v_sid from private.crear_solicitud(
      jsonb_build_object(
        'cedula', p ->> 'pacienteCedula', 'nombres', v_nombres, 'apellidos', v_apellidos,
        'servicio_area', p ->> 'servicio', 'diagnostico', p ->> 'diagnostico',
        'hb_g_dl', private.num(v_cli ->> 'Hb'), 'hcto_porcentaje', private.num(v_cli ->> 'Hcto'),
        'plaquetas_conteo', private.num(v_cli ->> 'Plaquetas'), 'tp_segundos', private.num(v_cli ->> 'TP'),
        'tpp_segundos', private.num(v_cli ->> 'TPT')),
      p ->> 'tipoSangre',
      jsonb_build_array(jsonb_build_object('componente', v_comp, 'unidades', (p ->> 'unidades')::int)),
      private.urgencia(p ->> 'prioridad'), v_indicacion, false, v_consent, null)
    limit 1;
    -- La dirección la crea ya aprobada: se reservan las unidades. Si no alcanza el stock, queda por aprobar.
    if v_meta = 'aprobado' then
      begin
        perform public.reservar_unidades(v_sid);
      exception when others then
        return jsonb_build_object('aviso', 'Quedó por aprobar: ' || sqlerrm);
      end;
    end if;
    return '{}';
  end if;

  if v_estado = 'Pendiente' then
    if v_meta = 'aprobado' then
      perform public.reservar_unidades(v_sid);
    elsif v_meta = 'rechazado' then
      perform public.rechazar_solicitud(v_sid, p ->> 'motivoRechazo');
    elsif v_meta = 'pendiente' then
      perform public._exigir_rol(array['director']);
      if v_comp is null then raise exception 'La sangre total no se despacha: elige un hemocomponente.'; end if;
      update solicitudtransfusion set
        componenteid = v_comp,
        tiposangreid = coalesce(private.ts_id(p ->> 'tipoSangre'), tiposangreid),
        cantidadunidades = (p ->> 'unidades')::smallint,
        urgencia = private.urgencia(p ->> 'prioridad'),
        indicacion_clinica = coalesce(v_indicacion, indicacion_clinica),
        consentimiento_informado_firmado = consentimiento_informado_firmado or v_consent
      where solicitudid = v_sid;
      update paciente set
        nombres = coalesce(nullif(v_nombres, ''), nombres),
        apellidos = coalesce(nullif(v_apellidos, ''), apellidos),
        servicio_area = coalesce(p ->> 'servicio', servicio_area),
        diagnostico = coalesce(p ->> 'diagnostico', diagnostico)
      where pacienteid = (select pacienteid from solicitudtransfusion where solicitudid = v_sid);
    end if;
  elsif v_estado = 'Aprobada' and v_meta = 'despachado' then
    perform private.despachar(v_sid);
  end if;
  return '{}';
end $$;

create or replace function private.g_entrega(p jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
begin
  if p ->> 'id' like 'ENT-%' then return '{}'; end if;
  if coalesce(p ->> 'pedidoId', '') !~ '^REQ-\d+$' then
    raise exception 'Cada salida debe venir de una solicitud aprobada por la dirección.';
  end if;
  perform private.despachar(substring(p ->> 'pedidoId' from '\d+')::int);
  return '{}';
end $$;

create or replace function private.g_ticket(p jsonb, v_rol text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v_prev ticket_soporte;
  v_msgs jsonb := coalesce(p -> 'mensajes', '[]');
begin
  if coalesce(p ->> 'id', '') = '' then raise exception 'Ticket sin identificador.'; end if;
  select * into v_prev from ticket_soporte where ticket_id = p ->> 'id';

  if v_rol = 'soporte' then
    insert into ticket_soporte (ticket_id, codigo, dueno_correo, donante_ref, donante_nombre, asunto, estado, prioridad,
                                asignado_a, mensajes, actualizado, resuelto_en)
    values (p ->> 'id', coalesce(p ->> 'codigo', p ->> 'id'), lower(coalesce(p ->> 'donanteEmail', '')), p ->> 'donanteId',
            coalesce(p ->> 'donanteNombre', ''), coalesce(p ->> 'asunto', 'Otro'), coalesce(p ->> 'estado', 'abierto'),
            coalesce(p ->> 'prioridad', 'normal'), p -> 'asignadoA', v_msgs, now(), (p ->> 'resueltoEn')::timestamptz)
    on conflict (ticket_id) do update set
      estado = excluded.estado, prioridad = excluded.prioridad, asignado_a = excluded.asignado_a,
      mensajes = excluded.mensajes, actualizado = now(), resuelto_en = excluded.resuelto_en;
    return '{}';
  end if;

  if v_rol = 'donante' then
    if v_prev.ticket_id is not null then
      if lower(v_prev.dueno_correo) <> v_email then raise exception 'No tienes permiso para realizar esta acción.' using errcode = '42501'; end if;
      -- El donante solo añade mensajes suyos: no puede borrar ni escribir como soporte.
      if not (v_msgs @> v_prev.mensajes) or exists (
        select 1 from jsonb_array_elements(v_msgs) e
        where e ->> 'autor' <> 'donante' and not (v_prev.mensajes @> jsonb_build_array(e))) then
        raise exception 'No tienes permiso para realizar esta acción.' using errcode = '42501';
      end if;
      update ticket_soporte set mensajes = v_msgs, actualizado = now(),
        estado = case when estado = 'resuelto' then 'abierto' else estado end, resuelto_en = null
      where ticket_id = v_prev.ticket_id;
      return '{}';
    end if;
    if exists (select 1 from jsonb_array_elements(v_msgs) e where e ->> 'autor' <> 'donante') then
      raise exception 'No tienes permiso para realizar esta acción.' using errcode = '42501';
    end if;
    insert into ticket_soporte (ticket_id, codigo, dueno_correo, donante_ref, donante_nombre, asunto, mensajes)
    values (p ->> 'id', coalesce(p ->> 'codigo', p ->> 'id'), v_email, p ->> 'donanteId',
            coalesce(p ->> 'donanteNombre', v_email), coalesce(p ->> 'asunto', 'Otro'), v_msgs);
    return '{}';
  end if;

  raise exception 'No tienes permiso para realizar esta acción.' using errcode = '42501';
end $$;

create or replace function public.blud_guardar(p_coleccion text, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rol text := private.rol_actual();
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  if v_rol is null then raise exception 'Tu cuenta está desactivada. Escribe a soporte@blud.app.' using errcode = '42501'; end if;
  return case p_coleccion
    when 'blud-db-donantes' then private.g_donante(p_item, v_rol)
    when 'blud-db-donaciones' then private.g_donacion(p_item, v_rol)
    when 'blud-db-pruebas' then private.g_prueba(p_item)
    when 'blud-db-fracciones' then private.g_fraccion(p_item)
    when 'blud-db-positivos' then private.g_caso(p_item, v_rol)
    when 'blud-db-pedidos' then private.g_pedido(p_item)
    when 'blud-db-entregas' then private.g_entrega(p_item)
    when 'blud-db-tickets' then private.g_ticket(p_item, v_rol)
    when 'blud-db-ticket-notas' then (
      case when v_rol <> 'soporte' then private.sin_permiso() else private.g_notas(p_item) end)
    else '{}'::jsonb end;
end $$;

create or replace function private.sin_permiso() returns jsonb
language plpgsql set search_path = '' as $$
begin
  raise exception 'No tienes permiso para realizar esta acción.' using errcode = '42501';
end $$;

create or replace function private.g_notas(p jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
begin
  insert into ticket_nota (ticket_id, notas) values (p ->> 'id', coalesce(p -> 'notas', '[]'))
  on conflict (ticket_id) do update set notas = excluded.notas;
  return '{}';
end $$;

create or replace function public.blud_borrar(p_coleccion text, p_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_coleccion = 'blud-db-pedidos' and p_id ~ '^REQ-\d+$' then
    perform public._exigir_rol(array['director']);
    delete from solicitudtransfusion where solicitudid = substring(p_id from '\d+')::int and estado = 'Pendiente';
    if not found then raise exception 'Solo se pueden borrar solicitudes que siguen por aprobar.'; end if;
    return;
  end if;
  raise exception 'Ese registro no se puede borrar.';
end $$;

-- ============================================================ Cuenta, personal y citas
create or replace function public.blud_actualizar_cuenta(p_nombre text, p_telefono text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_nombre text := regexp_replace(trim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_nombres text := split_part(v_nombre, ' ', 1);
begin
  if auth.jwt() ->> 'email' is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  if length(v_nombre) < 3 then raise exception 'Escribe tu nombre completo.'; end if;
  update usuario set
    nombres = v_nombres,
    apellidos = coalesce(nullif(trim(substr(v_nombre, length(v_nombres) + 1)), ''), apellidos),
    telefono = coalesce(nullif(trim(p_telefono), ''), telefono)
  where lower(correo) = lower(auth.jwt() ->> 'email');
end $$;

create or replace function public.blud_personal_activo(p_email text, p_activo boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._exigir_rol(array['director']);
  if lower(p_email) = lower(auth.jwt() ->> 'email') then raise exception 'No puedes desactivar tu propia cuenta.'; end if;
  update usuario set activo = p_activo where lower(correo) = lower(p_email) and rol <> 'Donante';
  if not found then raise exception 'No encontramos esa cuenta del personal.'; end if;
end $$;

create or replace function public.blud_agendar_cita(p_centro text, p_fecha date, p_hora text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sede int;
begin
  select sedeid into v_sede from sede where nombre = p_centro;
  if v_sede is null then raise exception 'Ese centro todavía no recibe citas en línea.'; end if;
  return 'CITA-' || public.agendar_cita(v_sede, (p_fecha + p_hora::time) at time zone 'America/Caracas', null);
end $$;

-- ============================================================ Permisos
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.blud_mi_perfil(), public.blud_panel(), public.blud_guardar(text, jsonb),
  public.blud_borrar(text, text), public.blud_actualizar_cuenta(text, text), public.blud_personal_activo(text, boolean),
  public.blud_agendar_cita(text, date, text) from public, anon;
grant execute on function public.blud_mi_perfil(), public.blud_panel(), public.blud_guardar(text, jsonb),
  public.blud_borrar(text, text), public.blud_actualizar_cuenta(text, text), public.blud_personal_activo(text, boolean),
  public.blud_agendar_cita(text, date, text) to authenticated;
