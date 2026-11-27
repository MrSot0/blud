-- BLUD · Transfusión segura: completa RF-TR7, RF-H3, RF-H4 y RF-H6. Se aplica después de 20261126100000. Se puede repetir.
--
--   TR7  Incompatibilidades: lista de pruebas cruzadas incompatibles (bitácora INCOMPATIBLE) con el médico tratante y
--        el registro del aviso (AVISO_MEDICO). Operador y laboratorio de la sede.
--   H3   Velocidad de infusión en el registro de hemovigilancia (las alertas de 30 min y 4 h se calculan en la pantalla).
--   H4   Notificación de un evento adverso al comité de hemovigilancia (dirección), con fecha, persona y nota.
--   H6   Devolución de la bolsa al suspender o rechazar la transfusión; el laboratorio confirma que la recibió.

alter table public.hemo_vigilancia
  add column if not exists velocidad_infusion varchar,
  add column if not exists devolucion jsonb,
  add column if not exists comite_notificado_en timestamptz,
  add column if not exists comite_notificado_por integer references public.usuario (usuarioid),
  add column if not exists comite_nota text;
create index if not exists hemo_vigilancia_comite_por on public.hemo_vigilancia (comite_notificado_por);

-- ------------------------------------------------------------ JSON del registro (con los campos nuevos)
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
    'despachado', (select b.fecha_hora from bitacora_auditoria b where b.tabla_afectada = 'solicitudtransfusion'
                     and b.registro_id = h.solicitud_id and b.operacion = 'DESPACHO' order by b.auditoria_id desc limit 1),
    'verificacion', h.verificacion,
    'signos', coalesce(h.signos_vitales_monitoreo, '{}'),
    'inicio', h.hora_inicio,
    'fin', h.hora_fin,
    'volumenMl', h.volumen_infundido_ml,
    'velocidad', h.velocidad_infusion,
    'tipoEvento', h.tipo_evento,
    'categoria', h.categoria_reaccion,
    'severidad', h.severidad_reaccion,
    'imputabilidad', h.imputabilidad,
    'sintomas', h.sintomas_presentados,
    'acciones', h.acciones_tomadas,
    'devolucion', h.devolucion,
    'comite', case when h.comite_notificado_en is not null then jsonb_strip_nulls(jsonb_build_object(
                'fecha', h.comite_notificado_en, 'nota', h.comite_nota,
                'por', (select trim(u.nombres || ' ' || u.apellidos) from usuario u where u.usuarioid = h.comite_notificado_por))) end
  ))
$$;

-- ------------------------------------------------------------ Registro del operador (agrega velocidad y devolución)
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
  v_dev jsonb := case when coalesce((p -> 'devolucion' ->> 'devuelta')::boolean, false) then p -> 'devolucion' end;
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
  if v_dev is not null and length(trim(coalesce(v_dev ->> 'motivo', ''))) < 10 then
    raise exception 'Explica por qué se devuelve la bolsa (mínimo 10 caracteres).';
  end if;
  -- Una devolución ya registrada no se borra ni se cambia (el laboratorio pudo haberla recibido).
  if v_prev.devolucion is not null then v_dev := v_prev.devolucion; end if;
  if v_dev is not null and v_prev.devolucion is null then
    v_dev := jsonb_strip_nulls(jsonb_build_object('devuelta', true, 'motivo', trim(v_dev ->> 'motivo'), 'fecha', now(),
               'por', (select trim(nombres || ' ' || apellidos) from usuario where usuarioid = public._uid())));
  end if;

  if v_prev.folio is null then
    if exists (select 1 from hemo_vigilancia where solicitud_id = v_sid and unidad_id = v_uni) then
      raise exception 'Esa unidad ya tiene un registro de hemovigilancia.';
    end if;
    v_folio := 'HV-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('private.hemo_folio_seq')::text, 4, '0');
    insert into hemo_vigilancia (folio, solicitud_id, unidad_id, paciente_id, sede_id, registrado_por, registrado_en, actualizado_en,
                                 estado_registro, verificacion, consentimiento_informado_ok, orden_medica_verificada, doble_chequeo_camilla_ok,
                                 reaccion_adversa_observada, tipo_reaccion, signos_vitales_monitoreo, signos_vitales_post_transfision,
                                 hora_inicio, hora_fin, volumen_infundido_ml, velocidad_infusion, tipo_evento,
                                 categoria_reaccion, severidad_reaccion, imputabilidad, sintomas_presentados, acciones_tomadas, medico_nombre,
                                 ubicacion_paciente, devolucion)
    values (v_folio, v_sid, v_uni, v_st.pacienteid, v_sede, public._uid(), now(), now(),
            case when v_cerrar then 'cerrado' else 'en_curso' end, v_ver, true, true, true,
            v_tipo = 'reaccion', case when v_tipo in ('reaccion', 'incidente') then nullif(trim(p ->> 'categoria'), '') end,
            coalesce(p -> 'signos', '{}'), p -> 'signos' -> 'despues',
            coalesce((p ->> 'inicio')::timestamptz, now()), (p ->> 'fin')::timestamptz, nullif(p ->> 'volumenMl', '')::smallint,
            nullif(trim(p ->> 'velocidad'), ''), v_tipo,
            nullif(trim(p ->> 'categoria'), ''), nullif(trim(p ->> 'severidad'), ''), nullif(trim(p ->> 'imputabilidad'), ''),
            nullif(trim(p ->> 'sintomas'), ''), nullif(trim(p ->> 'acciones'), ''), nullif(trim(p ->> 'medico'), ''),
            nullif(trim(p ->> 'ubicacion'), ''), v_dev);
  else
    v_folio := v_prev.folio;
    update hemo_vigilancia set
      actualizado_en = now(), estado_registro = case when v_cerrar then 'cerrado' else 'en_curso' end,
      verificacion = v_ver, signos_vitales_monitoreo = coalesce(p -> 'signos', '{}'), signos_vitales_post_transfision = p -> 'signos' -> 'despues',
      reaccion_adversa_observada = v_tipo = 'reaccion',
      tipo_reaccion = case when v_tipo in ('reaccion', 'incidente') then nullif(trim(p ->> 'categoria'), '') end,
      hora_inicio = coalesce((p ->> 'inicio')::timestamptz, hora_inicio), hora_fin = (p ->> 'fin')::timestamptz,
      volumen_infundido_ml = nullif(p ->> 'volumenMl', '')::smallint, velocidad_infusion = nullif(trim(p ->> 'velocidad'), ''),
      tipo_evento = v_tipo,
      categoria_reaccion = nullif(trim(p ->> 'categoria'), ''), severidad_reaccion = nullif(trim(p ->> 'severidad'), ''),
      imputabilidad = nullif(trim(p ->> 'imputabilidad'), ''), sintomas_presentados = nullif(trim(p ->> 'sintomas'), ''),
      acciones_tomadas = nullif(trim(p ->> 'acciones'), ''), medico_nombre = nullif(trim(p ->> 'medico'), ''),
      ubicacion_paciente = nullif(trim(p ->> 'ubicacion'), ''), devolucion = v_dev
    where folio = v_folio;
  end if;

  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('hemo_vigilancia', v_sid, case when v_prev.folio is null then 'HEMOVIGILANCIA' when v_cerrar then 'HV_CIERRE' else 'HV_EDICION' end,
          public._uid(), v_sede, jsonb_build_object('folio', v_folio, 'unidad_id', v_uni, 'tipo_evento', v_tipo, 'severidad', p ->> 'severidad'));
  if v_dev is not null and v_prev.devolucion is null then
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('hemo_vigilancia', v_sid, 'DEVOLUCION_BOLSA', public._uid(), v_sede,
            jsonb_build_object('folio', v_folio, 'unidad_id', v_uni, 'motivo', v_dev ->> 'motivo'));
  end if;

  return (select private.hv_json(h) from hemo_vigilancia h where h.folio = v_folio);
end $$;

-- ------------------------------------------------------------ H4 · Notificar al comité (dirección)
create or replace function public.blud_hv_notificar_comite(p_folio text, p_nota text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare h hemo_vigilancia; v_nota text := private.exigir_motivo(p_nota);
begin
  perform public._exigir_rol(array['director']);
  select * into h from hemo_vigilancia where folio = p_folio for update;
  if not found then raise exception 'No encontramos ese registro de hemovigilancia.'; end if;
  if h.sede_id is distinct from public._sede_id() then raise exception 'Solo la dirección de la sede del registro puede notificarlo.' using errcode = '42501'; end if;
  if coalesce(h.tipo_evento, 'sin_reaccion') = 'sin_reaccion' then raise exception 'Solo se notifican reacciones adversas e incidentes.'; end if;
  if h.comite_notificado_en is not null then raise exception 'Ese evento ya se notificó al comité.'; end if;
  update hemo_vigilancia set comite_notificado_en = now(), comite_notificado_por = public._uid(), comite_nota = v_nota where folio = p_folio
  returning * into h;
  perform private.auditar('hemo_vigilancia', h.solicitud_id, 'HV_COMITE', jsonb_build_object('folio', p_folio, 'nota', v_nota));
  return private.hv_json(h);
end $$;

-- ------------------------------------------------------------ H6 · Devoluciones por recibir (laboratorio)
create or replace function public.blud_hv_devoluciones() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._exigir_rol(array['laboratorio', 'director', 'operador']);
  return coalesce((select jsonb_agg(private.hv_json(h) order by (h.devolucion ->> 'fecha') desc)
                   from hemo_vigilancia h
                   where h.sede_id = public._sede_id() and h.devolucion is not null and h.devolucion ->> 'recibidaEn' is null), '[]');
end $$;

create or replace function public.blud_hv_recibir_devolucion(p_folio text, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare h hemo_vigilancia;
begin
  perform public._exigir_rol(array['laboratorio']);
  select * into h from hemo_vigilancia where folio = p_folio for update;
  if not found or h.devolucion is null then raise exception 'Ese registro no tiene una bolsa devuelta.'; end if;
  if h.sede_id is distinct from public._sede_id() then raise exception 'Esa devolución es de otra sede.' using errcode = '42501'; end if;
  if h.devolucion ->> 'recibidaEn' is not null then raise exception 'Esa bolsa ya se recibió.'; end if;
  update hemo_vigilancia set devolucion = devolucion || jsonb_strip_nulls(jsonb_build_object(
      'recibidaEn', now(), 'recibidaPor', (select trim(nombres || ' ' || apellidos) from usuario where usuarioid = public._uid()),
      'notaRecepcion', nullif(trim(coalesce(p_nota, '')), '')))
  where folio = p_folio returning * into h;
  perform private.auditar('hemo_vigilancia', h.solicitud_id, 'DEVOLUCION_RECIBIDA', jsonb_build_object('folio', p_folio, 'unidad_id', h.unidad_id));
  return private.hv_json(h);
end $$;

-- ------------------------------------------------------------ TR7 · Incompatibilidades y aviso al médico tratante
create or replace function public.blud_incompatibilidades(p_dias int default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._exigir_rol(array['laboratorio', 'operador', 'director']);
  return coalesce((
    select jsonb_agg(x order by x ->> 'fecha' desc) from (
      select jsonb_strip_nulls(jsonb_build_object(
        'solicitud', 'REQ-' || lpad(st.solicitudid::text, 6, '0'),
        'fecha', b.fecha_hora,
        'unidadId', (b.valores_nuevos ->> 'unidad_id')::int,
        'unidadCodigo', (select codigolote from unidadsangre where unidadid = (b.valores_nuevos ->> 'unidad_id')::int),
        'paciente', jsonb_build_object('nombre', trim(pa.nombres || ' ' || pa.apellidos), 'cedula', pa.cedula, 'servicio', pa.servicio_area),
        'medico', (select jsonb_build_object('nombre', trim(u.nombres || ' ' || u.apellidos), 'correo', lower(u.correo), 'telefono', nullif(u.telefono, ''))
                   from personalsalud ps join usuario u on u.usuarioid = ps.usuarioid where ps.personalid = st.medico_solicitante_id),
        'aviso', (select jsonb_build_object('fecha', a.fecha_hora, 'nota', a.valores_nuevos ->> 'nota',
                           'por', (select trim(u.nombres || ' ' || u.apellidos) from usuario u where u.usuarioid = a.usuario_id))
                  from bitacora_auditoria a where a.tabla_afectada = 'solicitudtransfusion' and a.registro_id = st.solicitudid
                    and a.operacion = 'AVISO_MEDICO' and a.fecha_hora >= b.fecha_hora order by a.auditoria_id desc limit 1)
      )) x
      from bitacora_auditoria b
      join solicitudtransfusion st on st.solicitudid = b.registro_id
      join paciente pa on pa.pacienteid = st.pacienteid
      where b.tabla_afectada = 'solicitudtransfusion' and b.operacion = 'INCOMPATIBLE'
        and b.fecha_hora > now() - make_interval(days => least(greatest(coalesce(p_dias, 30), 1), 365))
        and st.sedesolicitanteid = public._sede_id()
    ) q), '[]');
end $$;

create or replace function public.blud_avisar_medico(p_solicitud text, p_nota text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sid int := substring(coalesce(p_solicitud, '') from '\d+')::int; v_nota text := private.exigir_motivo(p_nota); v_sede int;
begin
  perform public._exigir_rol(array['laboratorio', 'operador']);
  select sedesolicitanteid into v_sede from solicitudtransfusion where solicitudid = v_sid;
  if not found then raise exception 'No encontramos esa solicitud.'; end if;
  if v_sede is distinct from public._sede_id() then raise exception 'Esa solicitud es de otra sede.' using errcode = '42501'; end if;
  if not exists (select 1 from bitacora_auditoria where tabla_afectada = 'solicitudtransfusion' and registro_id = v_sid and operacion = 'INCOMPATIBLE') then
    raise exception 'Esa solicitud no tiene pruebas cruzadas incompatibles.';
  end if;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('solicitudtransfusion', v_sid, 'AVISO_MEDICO', public._uid(), v_sede, jsonb_build_object('nota', v_nota));
end $$;

revoke all on function public.blud_hv_notificar_comite(text, text), public.blud_hv_devoluciones(), public.blud_hv_recibir_devolucion(text, text),
  public.blud_incompatibilidades(int), public.blud_avisar_medico(text, text) from public, anon;
grant execute on function public.blud_hv_notificar_comite(text, text), public.blud_hv_devoluciones(), public.blud_hv_recibir_devolucion(text, text),
  public.blud_incompatibilidades(int), public.blud_avisar_medico(text, text) to authenticated;
