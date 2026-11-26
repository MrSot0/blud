-- BLUD · Pantallas pendientes de los roles del personal.
--
--   1. Reportar un problema (RF-T…, ayuda a soporte): el operador, el laboratorio y la dirección crean tickets
--      igual que el donante. blud_panel ya les devuelve los suyos (filtra por dueno_correo); solo falta que
--      private.g_ticket acepte esos roles. El ticket se marca con donante_ref = 'personal:<rol>'.
--   2. Hemovigilancia (RF-H1, H2, H4): el operador registra cada unidad despachada (doble verificación, tiempos,
--      signos vitales, reacción adversa y acciones); el laboratorio y la dirección consultan. Usa hemo_vigilancia.
--   3. Bitácora (T9, I2, A4): consulta paginada de bitacora_auditoria para la dirección (su sede) y soporte (red).
--
-- Se puede repetir. hemo_vigilancia ya existía (fuera de las migraciones): se reutilizan sus columnas hora_inicio,
-- hora_fin, signos_vitales_monitoreo, signos_vitales_post_transfision, sintomas_presentados, acciones_tomadas,
-- categoria_reaccion, tipo_reaccion y las banderas consentimiento_informado_ok, orden_medica_verificada y
-- doble_chequeo_camilla_ok (verificado contra la base el 26-11-2026).

-- ============================================================ 1. Reportes del personal a soporte
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.g_ticket(jsonb, text)'::regprocedure);
  if position('if v_rol = ''donante'' then' in v_def) > 0 then
    v_def := replace(v_def, 'if v_rol = ''donante'' then',
                     'if v_rol in (''donante'', ''operador'', ''laboratorio'', ''director'') then');
    execute v_def;
  end if;
end $$;

-- ============================================================ 2. Hemovigilancia
alter table public.hemo_vigilancia
  add column if not exists folio varchar,
  add column if not exists sede_id integer references public.sede (sedeid),
  add column if not exists registrado_por integer references public.usuario (usuarioid),
  add column if not exists registrado_en timestamptz default now(),
  add column if not exists actualizado_en timestamptz default now(),
  add column if not exists estado_registro varchar default 'en_curso',
  add column if not exists verificacion jsonb default '{}',
  add column if not exists volumen_infundido_ml smallint,
  add column if not exists tipo_evento varchar,
  add column if not exists severidad_reaccion varchar,
  add column if not exists imputabilidad varchar,
  add column if not exists medico_nombre varchar,
  add column if not exists ubicacion_paciente varchar;

create unique index if not exists hemo_vigilancia_folio on public.hemo_vigilancia (folio);
create index if not exists hemo_vigilancia_sede_fecha on public.hemo_vigilancia (sede_id, registrado_en desc);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hemo_vigilancia_estado_registro_chk') then
    alter table public.hemo_vigilancia add constraint hemo_vigilancia_estado_registro_chk
      check (estado_registro in ('en_curso', 'cerrado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'hemo_vigilancia_tipo_evento_chk') then
    alter table public.hemo_vigilancia add constraint hemo_vigilancia_tipo_evento_chk
      check (tipo_evento is null or tipo_evento in ('sin_reaccion', 'reaccion', 'incidente'));
  end if;
end $$;

alter table public.hemo_vigilancia enable row level security;
revoke all on public.hemo_vigilancia from anon, authenticated;

create sequence if not exists private.hemo_folio_seq;

-- Un registro con la forma del front (src/lib/hemovigilancia.ts).
create or replace function private.hv_json(h public.hemo_vigilancia) returns jsonb
language sql stable set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', h.folio,
    'estado', h.estado_registro,
    'solicitudId', 'REQ-' || lpad(h.solicitud_id::text, 6, '0'),
    'unidadId', h.unidad_id,
    'unidadCodigo', (select u.o_codigo from public.unidades_de_solicitud(h.solicitud_id) u where u.o_unidad_id = h.unidad_id limit 1),
    'componente', (select private.comp_front(u.o_componente) from public.unidades_de_solicitud(h.solicitud_id) u where u.o_unidad_id = h.unidad_id limit 1),
    'tipoSangre', (select u.o_tipo_sangre from public.unidades_de_solicitud(h.solicitud_id) u where u.o_unidad_id = h.unidad_id limit 1),
    'paciente', (select jsonb_build_object('nombre', trim(pa.nombres || ' ' || pa.apellidos), 'cedula', pa.cedula,
                                           'servicio', pa.servicio_area, 'historia', pa.numero_historia)
                 from paciente pa where pa.pacienteid = h.paciente_id),
    'ubicacion', h.ubicacion_paciente,
    'medico', h.medico_nombre,
    'sede', jsonb_build_object('id', h.sede_id, 'nombre', (select nombre from sede where sedeid = h.sede_id)),
    'registradoPor', (select trim(u.nombres || ' ' || u.apellidos) from usuario u where u.usuarioid = h.registrado_por),
    'registrado', h.registrado_en,
    'actualizado', h.actualizado_en,
    'verificacion', h.verificacion,
    'signos', coalesce(h.signos_vitales_monitoreo, '{}'),
    'inicio', h.hora_inicio,
    'fin', h.hora_fin,
    'volumenMl', h.volumen_infundido_ml,
    'tipoEvento', h.tipo_evento,
    'categoria', h.categoria_reaccion,
    'severidad', h.severidad_reaccion,
    'imputabilidad', h.imputabilidad,
    'sintomas', h.sintomas_presentados,
    'acciones', h.acciones_tomadas
  ))
$$;

-- Lista: registros (operador y laboratorio, su sede; dirección, su sede o toda la red) y, para el operador,
-- las unidades despachadas en 30 días que aún no tienen registro.
create or replace function public.blud_hemovigilancia(p_desde date default null, p_hasta date default null, p_red boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rol text := public.mi_rol();
  v_sede int := public._sede_id();
  v_red boolean := coalesce(p_red, false) and v_rol = 'director';
  v_desde timestamptz := coalesce(p_desde, (now() - interval '1 year')::date);
  v_hasta timestamptz := coalesce(p_hasta, now()::date) + interval '1 day';
begin
  perform public._exigir_rol(array['operador', 'laboratorio', 'director']);
  return jsonb_build_object(
    'registros', coalesce((
      select jsonb_agg(private.hv_json(h) order by h.registrado_en desc)
      from hemo_vigilancia h
      where h.folio is not null and h.registrado_en >= v_desde and h.registrado_en < v_hasta
        and (v_red or h.sede_id = v_sede)), '[]'),
    'pendientes', case when v_rol = 'operador' then coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'solicitudId', 'REQ-' || lpad(st.solicitudid::text, 6, '0'),
        'unidadId', u.o_unidad_id, 'unidadCodigo', u.o_codigo, 'componente', private.comp_front(u.o_componente),
        'tipoSangre', u.o_tipo_sangre,
        'paciente', jsonb_build_object('nombre', trim(pa.nombres || ' ' || pa.apellidos), 'cedula', pa.cedula,
                                       'servicio', pa.servicio_area, 'historia', pa.numero_historia),
        'despachado', (select b.fecha_hora from bitacora_auditoria b where b.tabla_afectada = 'solicitudtransfusion'
                         and b.registro_id = st.solicitudid and b.operacion = 'DESPACHO' order by b.auditoria_id desc limit 1),
        'cruzada', (select c.resultado from prueba_cruzada c where c.solicitud_id = st.solicitudid and c.unidad_id = u.o_unidad_id
                    order by c.prueba_cruzada_id desc limit 1)
      )) order by st.fechasolicitud desc)
      from solicitudtransfusion st
      join paciente pa on pa.pacienteid = st.pacienteid
      cross join lateral public.unidades_de_solicitud(st.solicitudid) u
      where st.estado = 'Despachada' and st.sedesolicitanteid = v_sede
        and st.fechasolicitud > now() - interval '30 days'
        and not exists (select 1 from hemo_vigilancia h where h.solicitud_id = st.solicitudid and h.unidad_id = u.o_unidad_id)
    ), '[]') else '[]'::jsonb end
  );
end $$;

-- Guardar (crear o actualizar mientras siga en curso). Solo el operador de la sede que despachó.
create or replace function public.blud_registrar_hemovigilancia(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sede int := public._sede_id();
  v_sid int := substring(coalesce(p ->> 'solicitudId', '') from '\d+')::int;
  v_uni int := (p ->> 'unidadId')::int;
  v_prev hemo_vigilancia;
  v_st solicitudtransfusion;
  v_folio text;
  v_tipo text := p ->> 'tipoEvento';
  v_cerrar boolean := coalesce((p ->> 'cerrar')::boolean, false);
  v_ver jsonb := coalesce(p -> 'verificacion', '{}');
begin
  perform public._exigir_rol(array['operador']);
  if v_sede is null then raise exception 'Tu cuenta no tiene un centro asignado.'; end if;

  if coalesce(p ->> 'id', '') <> '' then
    select * into v_prev from hemo_vigilancia where folio = p ->> 'id' for update;
    if not found then raise exception 'No encontramos ese registro de hemovigilancia.'; end if;
    if v_prev.sede_id is distinct from v_sede then raise exception 'Ese registro es de otra sede.' using errcode = '42501'; end if;
    if v_prev.estado_registro = 'cerrado' then raise exception 'El registro ya está cerrado: no se puede modificar.'; end if;
    v_sid := v_prev.solicitud_id;
    v_uni := v_prev.unidad_id;
  end if;

  select * into v_st from solicitudtransfusion where solicitudid = v_sid;
  if not found or v_st.estado <> 'Despachada' then raise exception 'La unidad no figura como despachada.'; end if;
  if v_st.sedesolicitanteid is distinct from v_sede then raise exception 'Esa transfusión es de otra sede.' using errcode = '42501'; end if;
  if not exists (select 1 from public.unidades_de_solicitud(v_sid) u where u.o_unidad_id = v_uni) then
    raise exception 'Esa unidad no pertenece a la solicitud.';
  end if;

  -- RF-H1: la doble verificación en cabecera es obligatoria antes de iniciar.
  if not (coalesce((v_ver ->> 'identidad')::boolean, false) and coalesce((v_ver ->> 'grupo')::boolean, false)
          and coalesce((v_ver ->> 'etiqueta')::boolean, false) and coalesce((v_ver ->> 'consentimiento')::boolean, false)
          and coalesce((v_ver ->> 'ordenMedica')::boolean, false)) then
    raise exception 'Completa la doble verificación en cabecera (incluida la orden médica escrita) antes de registrar la transfusión.';
  end if;
  if coalesce(trim(v_ver ->> 'segundoVerificador'), '') = '' then
    raise exception 'Indica quién hizo la segunda verificación.';
  end if;
  if v_tipo is not null and v_tipo not in ('sin_reaccion', 'reaccion', 'incidente') then raise exception 'Tipo de evento no válido.'; end if;
  if v_cerrar and v_tipo is null then raise exception 'Indica cómo terminó la transfusión antes de cerrarla.'; end if;
  if v_tipo in ('reaccion', 'incidente') and (coalesce(trim(p ->> 'categoria'), '') = '' or coalesce(trim(p ->> 'severidad'), '') = '') then
    raise exception 'Indica la categoría y la severidad del evento.';
  end if;
  if v_tipo in ('reaccion', 'incidente') and v_cerrar and coalesce(trim(p ->> 'acciones'), '') = '' then
    raise exception 'Describe las acciones tomadas ante el evento.';
  end if;

  if v_prev.folio is null then
    if exists (select 1 from hemo_vigilancia where solicitud_id = v_sid and unidad_id = v_uni) then
      raise exception 'Esa unidad ya tiene un registro de hemovigilancia.';
    end if;
    v_folio := 'HV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.hemo_folio_seq')::text, 4, '0');
    insert into hemo_vigilancia (folio, solicitud_id, unidad_id, paciente_id, sede_id, registrado_por, registrado_en, actualizado_en,
                                 estado_registro, verificacion, consentimiento_informado_ok, orden_medica_verificada, doble_chequeo_camilla_ok,
                                 reaccion_adversa_observada, tipo_reaccion, signos_vitales_monitoreo, signos_vitales_post_transfision,
                                 hora_inicio, hora_fin, volumen_infundido_ml, tipo_evento,
                                 categoria_reaccion, severidad_reaccion, imputabilidad, sintomas_presentados, acciones_tomadas, medico_nombre,
                                 ubicacion_paciente)
    values (v_folio, v_sid, v_uni, v_st.pacienteid, v_sede, public._uid(), now(), now(),
            case when v_cerrar then 'cerrado' else 'en_curso' end, v_ver, true, true, true,
            v_tipo = 'reaccion', case when v_tipo in ('reaccion', 'incidente') then nullif(trim(p ->> 'categoria'), '') end,
            coalesce(p -> 'signos', '{}'), p -> 'signos' -> 'despues',
            coalesce((p ->> 'inicio')::timestamptz, now()), (p ->> 'fin')::timestamptz, nullif(p ->> 'volumenMl', '')::smallint, v_tipo,
            nullif(trim(p ->> 'categoria'), ''), nullif(trim(p ->> 'severidad'), ''), nullif(trim(p ->> 'imputabilidad'), ''),
            nullif(trim(p ->> 'sintomas'), ''), nullif(trim(p ->> 'acciones'), ''), nullif(trim(p ->> 'medico'), ''),
            nullif(trim(p ->> 'ubicacion'), ''));
  else
    v_folio := v_prev.folio;
    update hemo_vigilancia set
      actualizado_en = now(), estado_registro = case when v_cerrar then 'cerrado' else 'en_curso' end,
      verificacion = v_ver, signos_vitales_monitoreo = coalesce(p -> 'signos', '{}'), signos_vitales_post_transfision = p -> 'signos' -> 'despues',
      reaccion_adversa_observada = v_tipo = 'reaccion',
      tipo_reaccion = case when v_tipo in ('reaccion', 'incidente') then nullif(trim(p ->> 'categoria'), '') end,
      hora_inicio = coalesce((p ->> 'inicio')::timestamptz, hora_inicio), hora_fin = (p ->> 'fin')::timestamptz,
      volumen_infundido_ml = nullif(p ->> 'volumenMl', '')::smallint, tipo_evento = v_tipo,
      categoria_reaccion = nullif(trim(p ->> 'categoria'), ''), severidad_reaccion = nullif(trim(p ->> 'severidad'), ''),
      imputabilidad = nullif(trim(p ->> 'imputabilidad'), ''), sintomas_presentados = nullif(trim(p ->> 'sintomas'), ''),
      acciones_tomadas = nullif(trim(p ->> 'acciones'), ''), medico_nombre = nullif(trim(p ->> 'medico'), ''),
      ubicacion_paciente = nullif(trim(p ->> 'ubicacion'), '')
    where folio = v_folio;
  end if;

  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('hemo_vigilancia', v_sid, case when v_prev.folio is null then 'HEMOVIGILANCIA' when v_cerrar then 'HV_CIERRE' else 'HV_EDICION' end,
          public._uid(), v_sede, jsonb_build_object('folio', v_folio, 'unidad_id', v_uni, 'tipo_evento', v_tipo, 'severidad', p ->> 'severidad'));

  return (select private.hv_json(h) from hemo_vigilancia h where h.folio = v_folio);
end $$;

-- ============================================================ 3. Bitácora
-- Una página de la bitácora por cursor (auditoria_id descendente). Dirección: su sede. Soporte: toda la red.
-- Para no sobrecargar la base: páginas de 25 (máximo 100), sin conteo total, ventana de un año si no se indica
-- «desde», búsqueda solo con 3 letras o más, y se lee una fila de más para saber si hay página siguiente.
create or replace function public.blud_bitacora(
  p_q text default null, p_tabla text default null, p_desde date default null, p_hasta date default null,
  p_cursor bigint default null, p_limite int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rol text := public.mi_rol();
  v_sede int := public._sede_id();
  v_lim int := least(greatest(coalesce(p_limite, 25), 1), 100);
  v_q text := case when length(trim(coalesce(p_q, ''))) >= 3 then lower(trim(p_q)) end;
  v_desde timestamptz := coalesce(p_desde, (now() - interval '1 year')::date);
  v_hasta timestamptz := coalesce(p_hasta, now()::date) + interval '1 day';
  v_items jsonb;
  v_hay_mas boolean;
begin
  perform public._exigir_rol(array['director', 'soporte']);
  if v_hasta - v_desde > interval '2 years 1 day' then
    raise exception 'Consulta como máximo dos años de bitácora a la vez.';
  end if;

  with pagina as (
    select b.auditoria_id, b.fecha_hora, b.tabla_afectada, b.registro_id, b.operacion, b.valores_nuevos, b.usuario_id, b.sede_id
    from bitacora_auditoria b
    where (v_rol = 'soporte' or b.sede_id = v_sede)
      and (p_cursor is null or b.auditoria_id < p_cursor)
      and (p_tabla is null or b.tabla_afectada = p_tabla)
      and b.fecha_hora >= v_desde and b.fecha_hora < v_hasta
      and (v_q is null or lower(b.operacion) like '%' || v_q || '%' or b.registro_id::text = v_q
           or exists (select 1 from usuario u where u.usuarioid = b.usuario_id
                        and (lower(u.correo) like '%' || v_q || '%' or lower(u.nombres || ' ' || u.apellidos) like '%' || v_q || '%')))
    order by b.auditoria_id desc
    limit v_lim + 1
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', p.auditoria_id, 'fecha', p.fecha_hora, 'tabla', p.tabla_afectada, 'registro', p.registro_id,
           'operacion', p.operacion, 'usuario', trim(u.nombres || ' ' || u.apellidos), 'correo', lower(u.correo),
           'sede', s.nombre, 'detalle', p.valores_nuevos
         )) order by p.auditoria_id desc) filter (where p.n <= v_lim), '[]'),
         count(*) > v_lim
    into v_items, v_hay_mas
  from (select pagina.*, row_number() over (order by auditoria_id desc) n from pagina) p
  left join usuario u on u.usuarioid = p.usuario_id
  left join sede s on s.sedeid = p.sede_id;

  return jsonb_build_object(
    'items', v_items,
    'siguiente', case when v_hay_mas then (v_items -> (jsonb_array_length(v_items) - 1) ->> 'id') end
  );
end $$;

create index if not exists idx_bitacora_sede_id on public.bitacora_auditoria (sede_id, auditoria_id desc);
create index if not exists idx_bitacora_tabla_id on public.bitacora_auditoria (tabla_afectada, auditoria_id desc);
create index if not exists idx_bitacora_fecha on public.bitacora_auditoria (fecha_hora);

revoke all on function private.hv_json(public.hemo_vigilancia) from public, anon, authenticated;
revoke all on function public.blud_hemovigilancia(date, date, boolean), public.blud_registrar_hemovigilancia(jsonb),
  public.blud_bitacora(text, text, date, date, bigint, int) from public, anon;
grant execute on function public.blud_hemovigilancia(date, date, boolean), public.blud_registrar_hemovigilancia(jsonb),
  public.blud_bitacora(text, text, date, date, bigint, int) to authenticated;
