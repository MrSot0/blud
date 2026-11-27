-- BLUD · Despacho y recepción completos (RF-DS2, DS3, DS4 y DS5). Se aplica después de 20261127100000. Se puede repetir.
--
--   DS2/DS3  Al despachar un pedido entre centros: transporte, chofer, contenedor isotérmico, data logger y temperatura de
--            salida (pedido_entre_centros.traslado).
--   DS4      Al recibirlo: temperatura de llegada e inspección visual (hemólisis, coágulos, turbidez, burbujas, fugas).
--            Si algo no es conforme, las bolsas entran en cuarentena en vez de quedar disponibles (pedido_entre_centros.recepcion).
--   DS5      Antes de despachar una transfusión local, la verificación de brazalete, DIN y etiqueta de compatibilidad
--            (bitácora VERIF_DESPACHO). private.despachar la exige: sin ella la base no deja despachar.

alter table public.pedido_entre_centros
  add column if not exists traslado jsonb,
  add column if not exists recepcion jsonb;

-- ------------------------------------------------------------ JSON del pedido (con traslado y recepción)
create or replace function private.pedido_json(x public.pedido_entre_centros) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', 'PED-' || lpad(x.pedidoid::text, 5, '0'),
    'estado', lower(x.estado),
    'solicitante', jsonb_build_object('id', x.sede_solicitante, 'nombre', (select nombre from sede where sedeid = x.sede_solicitante)),
    'proveedora', jsonb_build_object('id', x.sede_proveedora, 'nombre', (select nombre from sede where sedeid = x.sede_proveedora)),
    'componente', private.comp_front((select tipo::text from hemocomponente where componenteid = x.componenteid)),
    'tipoSangre', private.ts_txt(x.tiposangreid),
    'unidades', x.cantidad,
    'prioridad', case x.urgencia when 'Urgente' then 'urgente' when 'Emergencia' then 'critica' else 'normal' end,
    'motivo', x.motivo,
    'solicitudLocal', case when x.solicitud_local_id is not null then 'REQ-' || lpad(x.solicitud_local_id::text, 6, '0') end,
    'fecha', x.creado_en,
    'creadoPor', (select trim(u.nombres || ' ' || u.apellidos) from personalsalud p join usuario u using (usuarioid) where p.personalid = x.creado_por),
    'revisadoPor', (select trim(u.nombres || ' ' || u.apellidos) from personalsalud p join usuario u using (usuarioid) where p.personalid = x.revisado_por),
    'revisadoEn', x.revisado_en,
    'motivoRechazo', x.motivo_rechazo,
    'despachadoEn', x.despachado_en,
    'recibidoEn', x.recibido_en,
    'traslado', x.traslado,
    'recepcion', x.recepcion,
    'stockProveedor', (select count(*) from unidadsangre u where u.sedeid = x.sede_proveedora and u.componenteid = x.componenteid
                         and u.tiposangreid = x.tiposangreid and u.estado = 'Disponible' and u.fechavencimiento > now()),
    'bolsas', (select jsonb_agg(jsonb_build_object('codigo', b.codigo, 'vence', private.dia(b.vence))) from private.unidades_de_pedido(x.pedidoid) b)
  ))
$$;

-- ------------------------------------------------------------ DS2/DS3 · Despacho con datos del traslado
drop function if exists public.blud_pedido_centro_despachar(text);
create or replace function public.blud_pedido_centro_despachar(p_id text, p_traslado jsonb default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id bigint := nullif(substring(coalesce(p_id, '') from '(\d+)$'), '')::bigint;
  x pedido_entre_centros;
  t jsonb := coalesce(p_traslado, '{}');
  v_temp numeric;
begin
  perform public._exigir_rol(array['operador', 'director']);
  select * into x from pedido_entre_centros where pedidoid = v_id for update;
  if not found then raise exception 'Ese pedido no existe.'; end if;
  if x.sede_proveedora is distinct from public._sede_id() then raise exception 'Este pedido lo despacha el centro proveedor.' using errcode = '42501'; end if;
  if x.estado <> 'Aprobada' then raise exception 'Solo se despachan pedidos aprobados.'; end if;
  if coalesce(trim(t ->> 'transporte'), '') = '' or coalesce(trim(t ->> 'chofer'), '') = '' then
    raise exception 'Indica el transporte y el chofer del traslado.';
  end if;
  if coalesce(trim(t ->> 'contenedor'), '') = '' then raise exception 'Indica el contenedor isotérmico.'; end if;
  begin v_temp := (t ->> 'tempSalida')::numeric; exception when others then v_temp := null; end;
  if v_temp is null or v_temp < -40 or v_temp > 30 then raise exception 'Registra la temperatura de salida del contenedor.'; end if;
  update unidadsangre set estado = 'EnTransito' where estado = 'Reservado' and unidadid in (select unidadid from private.unidades_de_pedido(v_id));
  update pedido_entre_centros set estado = 'Despachada', despachado_por = public._personal_id(), despachado_en = now(),
    traslado = jsonb_strip_nulls(jsonb_build_object('transporte', trim(t ->> 'transporte'), 'chofer', trim(t ->> 'chofer'),
      'contenedor', trim(t ->> 'contenedor'), 'datalogger', nullif(trim(coalesce(t ->> 'datalogger', '')), ''), 'tempSalida', v_temp,
      'horaSalida', now(), 'por', (select trim(nombres || ' ' || apellidos) from usuario where usuarioid = public._uid())))
  where pedidoid = v_id;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('pedido_entre_centros', v_id, 'DESPACHO', public._uid(), x.sede_proveedora,
          jsonb_build_object('transporte', t ->> 'transporte', 'chofer', t ->> 'chofer', 'temp_salida', v_temp));
end $$;

-- ------------------------------------------------------------ DS4 · Recepción con inspección visual
drop function if exists public.blud_pedido_centro_recibir(text);
create or replace function public.blud_pedido_centro_recibir(p_id text, p_recepcion jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id bigint := nullif(substring(coalesce(p_id, '') from '(\d+)$'), '')::bigint;
  x pedido_entre_centros;
  r jsonb := coalesce(p_recepcion, '{}');
  i jsonb := coalesce(p_recepcion -> 'inspeccion', '{}');
  v_temp numeric;
  v_defectos text[];
  v_conforme boolean;
  v_u int;
  v_res int := 0;
begin
  perform public._exigir_rol(array['operador', 'director']);
  select * into x from pedido_entre_centros where pedidoid = v_id for update;
  if not found then raise exception 'Ese pedido no existe.'; end if;
  if x.sede_solicitante is distinct from public._sede_id() then raise exception 'Este pedido lo recibe el centro solicitante.' using errcode = '42501'; end if;
  if x.estado <> 'Despachada' then raise exception 'Solo se reciben pedidos despachados.'; end if;
  begin v_temp := (r ->> 'tempLlegada')::numeric; exception when others then v_temp := null; end;
  if v_temp is null or v_temp < -40 or v_temp > 30 then raise exception 'Registra la temperatura de llegada del contenedor.'; end if;
  if not (i ? 'hemolisis' and i ? 'coagulos' and i ? 'turbidez' and i ? 'burbujas' and i ? 'fugas') then
    raise exception 'Completa la inspección visual de las bolsas.';
  end if;
  select coalesce(array_agg(k), '{}') into v_defectos from jsonb_each_text(i) e(k, v)
  where k in ('hemolisis', 'coagulos', 'turbidez', 'burbujas', 'fugas') and v::boolean;
  v_conforme := cardinality(v_defectos) = 0;
  if not v_conforme and length(trim(coalesce(r ->> 'observaciones', ''))) < 10 then
    raise exception 'Describe lo que encontraste en la inspección (mínimo 10 caracteres).';
  end if;

  for v_u in select unidadid from private.unidades_de_pedido(v_id) where estado = 'EnTransito' loop
    -- Con hallazgos, las bolsas quedan en cuarentena hasta que el laboratorio las revise.
    update unidadsangre set estado = (case when v_conforme then 'Disponible' else 'Cuarentena' end)::enum_estado_unidad, sedeid = x.sede_solicitante where unidadid = v_u;
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('unidadsangre', v_u, 'TRASLADO', public._uid(), x.sede_solicitante,
            jsonb_build_object('pedido_centro_id', v_id, 'desde', x.sede_proveedora, 'conforme', v_conforme));
  end loop;
  update pedido_entre_centros set estado = 'Recibida', recibido_por = public._personal_id(), recibido_en = now(),
    recepcion = jsonb_strip_nulls(jsonb_build_object('tempLlegada', v_temp, 'inspeccion', i, 'conforme', v_conforme,
      'defectos', to_jsonb(v_defectos), 'observaciones', nullif(trim(coalesce(r ->> 'observaciones', '')), ''),
      'hora', now(), 'por', (select trim(nombres || ' ' || apellidos) from usuario where usuarioid = public._uid())))
  where pedidoid = v_id;
  if not v_conforme then
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('pedido_entre_centros', v_id, 'RECEPCION_NO_CONF', public._uid(), x.sede_solicitante,
            jsonb_build_object('defectos', to_jsonb(v_defectos), 'temp_llegada', v_temp, 'observaciones', r ->> 'observaciones'));
  elsif x.solicitud_local_id is not null then
    v_res := private.reservar_local(x.solicitud_local_id);
  end if;
  return jsonb_build_object('estado', 'recibida', 'conforme', v_conforme, 'reservaLocal', v_res);
end $$;

-- ------------------------------------------------------------ DS5 · Verificación antes del despacho local
create or replace function public.blud_verificar_despacho(p_solicitud text, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sid int := substring(coalesce(p_solicitud, '') from '\d+')::int; v_sede int;
begin
  perform public._exigir_rol(array['operador', 'director']);
  select sedesolicitanteid into v_sede from solicitudtransfusion where solicitudid = v_sid;
  if not found then raise exception 'No encontramos esa solicitud.'; end if;
  if v_sede is distinct from public._sede_id() then raise exception 'Esa solicitud es de otra sede.' using errcode = '42501'; end if;
  if not (coalesce((p ->> 'brazalete')::boolean, false) and coalesce((p ->> 'din')::boolean, false) and coalesce((p ->> 'etiqueta')::boolean, false)) then
    raise exception 'Verifica el brazalete del paciente, el DIN de cada bolsa y la etiqueta de compatibilidad.';
  end if;
  if length(trim(coalesce(p ->> 'recibe', ''))) < 3 then raise exception 'Indica quién recibe las unidades en el servicio.'; end if;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('solicitudtransfusion', v_sid, 'VERIF_DESPACHO', public._uid(), v_sede,
          jsonb_build_object('brazalete', true, 'din', true, 'etiqueta', true, 'recibe', trim(p ->> 'recibe')));
end $$;

-- private.despachar exige la verificación de las últimas 2 horas.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.despachar(int)'::regprocedure);
  if position('VERIF_DESPACHO' in v_def) = 0 then
    v_def := replace(v_def,
      E'  update unidadsangre set estado = ''EnTransito''\n  where estado = ''Reservado'' and unidadid in (select o_unidad_id from public.unidades_de_solicitud(p_sid));',
      E'  if not exists (select 1 from bitacora_auditoria where tabla_afectada = ''solicitudtransfusion'' and registro_id = p_sid\n'
      || E'                 and operacion = ''VERIF_DESPACHO'' and fecha_hora > now() - interval ''2 hours'') then\n'
      || E'    raise exception ''Antes de despachar verifica el brazalete del paciente, el DIN y la etiqueta de compatibilidad.'';\n'
      || E'  end if;\n'
      || E'  update unidadsangre set estado = ''EnTransito''\n  where estado = ''Reservado'' and unidadid in (select o_unidad_id from public.unidades_de_solicitud(p_sid));');
    if position('VERIF_DESPACHO' in v_def) = 0 then raise exception 'No se pudo parchar private.despachar: su texto cambió.'; end if;
    execute v_def;
  end if;
end $$;

revoke all on function public.blud_pedido_centro_despachar(text, jsonb), public.blud_pedido_centro_recibir(text, jsonb),
  public.blud_verificar_despacho(text, jsonb) from public, anon;
grant execute on function public.blud_pedido_centro_despachar(text, jsonb), public.blud_pedido_centro_recibir(text, jsonb),
  public.blud_verificar_despacho(text, jsonb) to authenticated;
