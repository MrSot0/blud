-- BLUD · Flujo de solicitudes (decisión del usuario, 19-11-2026). Se puede repetir.
--
--   1. Transfusión LOCAL (paciente del propio hospital): la registra el operador y NO pasa por la dirección.
--      Al registrarla se reservan unidades compatibles del stock de su sede; si no alcanza, queda «en espera
--      de stock» (Pendiente) y el operador puede reintentar la reserva. Luego laboratorio (tipaje + prueba
--      cruzada) y despacho del operador. La dirección solo la consulta.
--   2. Pedido ENTRE CENTROS: el director del hospital que necesita bolsas pide unidades a otro centro;
--      el director del centro proveedor aprueba (reserva de SU stock) o rechaza con motivo; el operador del
--      proveedor despacha; el centro solicitante recibe y las unidades pasan a su stock (Disponible).

-- ============================================================ Reserva local (sin rol de dirección)
create or replace function private.reservar_local(p_sid int) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare s record; v_ids int[]; v_n int; v_id int;
begin
  select st.*, hc.tipo::text ctipo, ts.grupoabo::text pabo, ts.factorrh::text prh into s
  from solicitudtransfusion st
  join hemocomponente hc on hc.componenteid = st.componenteid
  join tiposangre ts on ts.tiposangreid = st.tiposangreid
  where st.solicitudid = p_sid for update of st;
  if not found or s.estado <> 'Pendiente' then return 0; end if;
  select array_agg(c.unidadid) into v_ids from (
    select u.unidadid from unidadsangre u join tiposangre tu on tu.tiposangreid = u.tiposangreid
    where u.estado = 'Disponible' and u.componenteid = s.componenteid and u.sedeid = s.sedesolicitanteid
      and u.fechavencimiento > now() and (not s.requiere_desleucocitado or u.leucorreducida)
      and public._compatible(s.ctipo, tu.grupoabo::text, tu.factorrh::text, s.pabo, s.prh)
    order by (u.tiposangreid = s.tiposangreid) desc, u.fechavencimiento, u.unidadid
    limit s.cantidadunidades for update of u skip locked) c;
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n < s.cantidadunidades then return v_n; end if;
  update unidadsangre set estado = 'Reservado' where unidadid = any (v_ids);
  foreach v_id in array v_ids loop
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('unidadsangre', v_id, 'RESERVA', public._uid(), s.sedesolicitanteid, jsonb_build_object('solicitud_id', p_sid));
  end loop;
  update solicitudtransfusion set estado = 'Aprobada' where solicitudid = p_sid;
  return v_n;
end $$;

-- ============================================================ Solicitud local (operador)
create or replace function private.g_pedido(p jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_sid int;
  v_estado text;
  v_sede int;
  v_meta text := p ->> 'estado';
  v_cli jsonb := coalesce(p -> 'clinica', '{}');
  v_consent boolean := coalesce(p -> 'clinica' ->> 'consentimiento', '') = 'si';
  v_nombre text := regexp_replace(trim(coalesce(p ->> 'pacienteNombre', '')), '\s+', ' ', 'g');
  v_nombres text := split_part(v_nombre, ' ', 1);
  v_apellidos text := trim(substr(v_nombre, length(v_nombres) + 1));
  v_indicacion text := coalesce(nullif(trim(p ->> 'diagnostico'), ''), nullif(trim(p ->> 'servicio'), ''));
  v_comp smallint := private.comp_id(p ->> 'tipoHemocomponente');
  v_falta text;
  v_n int;
begin
  if p ->> 'id' ~ '^REQ-\d+$' then v_sid := substring(p ->> 'id' from '\d+')::int; end if;
  select estado, sedesolicitanteid into v_estado, v_sede from solicitudtransfusion where solicitudid = v_sid for update;

  if v_estado is null then
    -- La registra el operador con la orden médica; no pasa por la dirección.
    if public.mi_rol() is distinct from 'operador' then
      raise exception 'Las solicitudes de transfusión las registra el operador de la sede.' using errcode = '42501';
    end if;
    if v_comp is null then raise exception 'La sangre total no se despacha: elige un hemocomponente.'; end if;
    if v_apellidos = '' then raise exception 'Escribe nombre y apellido del paciente.'; end if;
    if not v_consent and private.urgencia(p ->> 'prioridad') <> 'Emergencia' then
      raise exception 'Falta el consentimiento informado firmado del paciente.';
    end if;
    select o_solicitud_id into v_sid from private.crear_solicitud(
      jsonb_build_object(
        'cedula', p ->> 'pacienteCedula', 'nombres', v_nombres, 'apellidos', v_apellidos,
        'servicio_area', p ->> 'servicio', 'diagnostico', p ->> 'diagnostico',
        'hb_g_dl', private.num(v_cli ->> 'Hb'), 'hcto_porcentaje', private.num(v_cli ->> 'Hcto'),
        'plaquetas_conteo', private.num(v_cli ->> 'Plaquetas'), 'tp_segundos', private.num(v_cli ->> 'TP'),
        'tpp_segundos', private.num(v_cli ->> 'TPT')),
      p ->> 'tipoSangre',
      jsonb_build_array(jsonb_build_object('componente', v_comp, 'unidades', (p ->> 'unidades')::int)),
      private.urgencia(p ->> 'prioridad'), coalesce(v_indicacion, 'Transfusión'), false, v_consent, null) limit 1;
    v_n := private.reservar_local(v_sid);
    if v_n >= (p ->> 'unidades')::int then
      return jsonb_build_object('aviso', 'Solicitud registrada y unidades reservadas: el laboratorio hará el tipaje y la prueba cruzada.');
    end if;
    return jsonb_build_object('aviso', format('Solicitud registrada en espera de stock: hay %s de %s unidades compatibles en tu sede. La dirección puede pedirlas a otro centro.', v_n, (p ->> 'unidades')::int));
  end if;

  if v_estado = 'Pendiente' then
    if v_meta = 'aprobado' then
      -- «Reintentar reserva» (operador o director de la misma sede).
      perform public._exigir_rol(array['operador', 'director']);
      if v_sede is distinct from public._sede_id() then raise exception 'Esa solicitud es de otra sede.'; end if;
      v_n := private.reservar_local(v_sid);
      if (select estado from solicitudtransfusion where solicitudid = v_sid) <> 'Aprobada' then
        raise exception 'Sigue sin stock suficiente: hay % unidad(es) compatibles en tu sede.', v_n;
      end if;
      return jsonb_build_object('aviso', 'Unidades reservadas: pasa al laboratorio.');
    elsif v_meta = 'rechazado' then
      -- Anular (operador o director de la sede), con motivo.
      perform public._exigir_rol(array['operador', 'director']);
      if v_sede is distinct from public._sede_id() then raise exception 'Esa solicitud es de otra sede.'; end if;
      if coalesce(trim(p ->> 'motivoRechazo'), '') = '' then raise exception 'Indica el motivo.'; end if;
      update solicitudtransfusion set estado = 'Rechazada' where solicitudid = v_sid;
      insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
      values ('solicitudtransfusion', v_sid, 'RECHAZO', public._uid(), public._sede_id(), jsonb_build_object('motivo', trim(p ->> 'motivoRechazo')));
    end if;
  elsif v_estado = 'Aprobada' and v_meta = 'despachado' then
    v_falta := private.falta_para_despachar(v_sid);
    if v_falta is not null then raise exception '%', v_falta; end if;
    perform private.despachar(v_sid);
  elsif v_estado = 'Aprobada' and v_meta = 'rechazado' then
    -- Anular una reserva: libera las unidades.
    perform public._exigir_rol(array['operador', 'director']);
    if v_sede is distinct from public._sede_id() then raise exception 'Esa solicitud es de otra sede.'; end if;
    if coalesce(trim(p ->> 'motivoRechazo'), '') = '' then raise exception 'Indica el motivo.'; end if;
    update unidadsangre set estado = 'Disponible' where estado = 'Reservado' and unidadid in (select o_unidad_id from public.unidades_de_solicitud(v_sid));
    update solicitudtransfusion set estado = 'Rechazada' where solicitudid = v_sid;
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('solicitudtransfusion', v_sid, 'RECHAZO', public._uid(), public._sede_id(), jsonb_build_object('motivo', trim(p ->> 'motivoRechazo')));
  end if;
  return '{}';
end $$;

-- Mensaje de despacho sin la dirección.
create or replace function private.despachar(p_sid integer) returns void
language plpgsql set search_path = public, pg_temp as $$
declare v_estado text;
begin
  perform public._exigir_rol(array['operador', 'director']);
  select estado into v_estado from solicitudtransfusion where solicitudid = p_sid for update;
  if v_estado = 'Despachada' then return; end if;
  if v_estado is distinct from 'Aprobada' then
    raise exception '%', case when v_estado = 'Pendiente' then 'Esa solicitud aún no tiene unidades reservadas (en espera de stock).' else 'Esa solicitud no se puede despachar.' end;
  end if;
  update unidadsangre set estado = 'EnTransito'
  where estado = 'Reservado' and unidadid in (select o_unidad_id from public.unidades_de_solicitud(p_sid));
  update solicitudtransfusion set estado = 'Despachada' where solicitudid = p_sid;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('solicitudtransfusion', p_sid, 'DESPACHO', public._uid(), public._sede_id(), '{}');
end $$;

-- ============================================================ Pedidos entre centros
create table if not exists public.pedido_entre_centros (
  pedidoid bigint generated always as identity primary key,
  sede_solicitante int not null references public.sede (sedeid),
  sede_proveedora int not null references public.sede (sedeid),
  componenteid smallint not null references public.hemocomponente (componenteid),
  tiposangreid smallint not null references public.tiposangre (tiposangreid),
  cantidad smallint not null check (cantidad between 1 and 50),
  urgencia public.enum_nivel_urgencia not null default 'Programada',
  motivo text not null,
  solicitud_local_id int references public.solicitudtransfusion (solicitudid),
  estado text not null default 'Pendiente' check (estado in ('Pendiente', 'Aprobada', 'Rechazada', 'Despachada', 'Recibida', 'Cancelada')),
  creado_por int references public.personalsalud (personalid),
  creado_en timestamptz not null default now(),
  revisado_por int references public.personalsalud (personalid),
  revisado_en timestamptz,
  motivo_rechazo text,
  despachado_por int references public.personalsalud (personalid),
  despachado_en timestamptz,
  recibido_por int references public.personalsalud (personalid),
  recibido_en timestamptz,
  check (sede_solicitante <> sede_proveedora)
);
create index if not exists pedido_entre_centros_proveedora on public.pedido_entre_centros (sede_proveedora, estado);
create index if not exists pedido_entre_centros_solicitante on public.pedido_entre_centros (sede_solicitante, estado);
alter table public.pedido_entre_centros enable row level security;
-- Sin políticas: solo se lee y escribe por las funciones de abajo.

-- Unidades reservadas para un pedido (última RESERVA de la unidad apunta al pedido).
create or replace function private.unidades_de_pedido(p_id bigint) returns table (unidadid int, codigo text, vence timestamptz, estado text)
language sql stable security definer set search_path = public, pg_temp as $$
  select u.unidadid, u.codigolote::text, u.fechavencimiento, u.estado::text
  from unidadsangre u
  where u.estado in ('Reservado', 'EnTransito', 'Disponible')
    and (select (b.valores_nuevos ->> 'pedido_centro_id')::bigint from bitacora_auditoria b
         where b.tabla_afectada = 'unidadsangre' and b.registro_id = u.unidadid and b.operacion in ('RESERVA', 'TRASLADO')
         order by b.auditoria_id desc limit 1) = p_id
  order by u.fechavencimiento, u.unidadid
$$;

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
    -- Stock del proveedor del mismo componente y tipo (ayuda a decidir).
    'stockProveedor', (select count(*) from unidadsangre u where u.sedeid = x.sede_proveedora and u.componenteid = x.componenteid
                         and u.tiposangreid = x.tiposangreid and u.estado = 'Disponible' and u.fechavencimiento > now()),
    'bolsas', (select jsonb_agg(jsonb_build_object('codigo', b.codigo, 'vence', private.dia(b.vence))) from private.unidades_de_pedido(x.pedidoid) b)
  ))
$$;

-- Bandeja: pedidos que recibe mi centro (para aprobar o despachar) y los que envía (para seguir o recibir).
create or replace function public.blud_pedidos_centros() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_sede int := public._sede_id();
begin
  perform public._exigir_rol(array['director', 'operador']);
  if v_sede is null then raise exception 'Tu cuenta no tiene un centro asignado.'; end if;
  return jsonb_build_object(
    'miSede', v_sede,
    'centro', (select nombre from sede where sedeid = v_sede),
    'recibidos', coalesce((select jsonb_agg(private.pedido_json(x) order by x.estado <> 'Pendiente', x.urgencia desc, x.creado_en desc)
                           from pedido_entre_centros x where x.sede_proveedora = v_sede and x.creado_en > now() - interval '120 days'), '[]'),
    'enviados', coalesce((select jsonb_agg(private.pedido_json(x) order by x.creado_en desc)
                          from pedido_entre_centros x where x.sede_solicitante = v_sede and x.creado_en > now() - interval '120 days'), '[]'),
    -- Solicitudes locales en espera de stock: candidatas a pedir a otro centro.
    'sinStock', coalesce((select jsonb_agg(jsonb_build_object(
        'id', 'REQ-' || lpad(st.solicitudid::text, 6, '0'), 'paciente', trim(pa.nombres || ' ' || pa.apellidos),
        'componente', private.comp_front(hc.tipo::text), 'tipoSangre', private.ts_txt(st.tiposangreid),
        'unidades', st.cantidadunidades, 'prioridad', case st.urgencia when 'Urgente' then 'urgente' when 'Emergencia' then 'critica' else 'normal' end,
        'fecha', st.fechasolicitud) order by st.fechasolicitud)
      from solicitudtransfusion st join paciente pa using (pacienteid) join hemocomponente hc using (componenteid)
      where st.sedesolicitanteid = v_sede and st.estado = 'Pendiente'
        and not exists (select 1 from pedido_entre_centros x where x.solicitud_local_id = st.solicitudid and x.estado in ('Pendiente', 'Aprobada', 'Despachada'))), '[]')
  );
end $$;

-- Director solicitante: pide unidades a otro centro.
create or replace function public.blud_pedido_centro_crear(p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sede int := public._sede_id();
  v_prov int := nullif(p ->> 'sedeProveedora', '')::int;
  v_comp smallint := private.comp_id(p ->> 'componente');
  v_ts smallint := private.ts_id(p ->> 'tipoSangre');
  v_cant int := nullif(p ->> 'unidades', '')::int;
  v_local int := nullif(substring(coalesce(p ->> 'solicitudLocal', '') from '(\d+)$'), '')::int;
  v_id bigint;
begin
  perform public._exigir_rol(array['director']);
  if v_sede is null then raise exception 'Tu cuenta no tiene un centro asignado.'; end if;
  if v_prov is null or not exists (select 1 from sede where sedeid = v_prov) then raise exception 'Elige el centro al que le pides las unidades.'; end if;
  if v_prov = v_sede then raise exception 'Elige un centro distinto al tuyo.'; end if;
  if v_comp is null then raise exception 'Elige un hemocomponente (la sangre total no se traslada).'; end if;
  if v_ts is null then raise exception 'Elige el tipo de sangre.'; end if;
  if v_cant is null or v_cant not between 1 and 50 then raise exception 'Las unidades van de 1 a 50.'; end if;
  if coalesce(trim(p ->> 'motivo'), '') = '' then raise exception 'Escribe el motivo del pedido.'; end if;
  if v_local is not null and not exists (select 1 from solicitudtransfusion where solicitudid = v_local and sedesolicitanteid = v_sede) then
    raise exception 'Esa solicitud local no es de tu centro.';
  end if;
  insert into pedido_entre_centros (sede_solicitante, sede_proveedora, componenteid, tiposangreid, cantidad, urgencia, motivo, solicitud_local_id, creado_por)
  values (v_sede, v_prov, v_comp, v_ts, v_cant, private.urgencia(p ->> 'prioridad'), trim(p ->> 'motivo'), v_local, public._personal_id())
  returning pedidoid into v_id;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('pedido_entre_centros', v_id, 'PEDIDO', public._uid(), v_sede, jsonb_build_object('proveedora', v_prov, 'unidades', v_cant));
  return 'PED-' || lpad(v_id::text, 5, '0');
end $$;

-- Director del centro proveedor: aprueba (reserva de su stock) o rechaza con motivo.
create or replace function public.blud_pedido_centro_resolver(p_id text, p_aprobar boolean, p_motivo text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id bigint := nullif(substring(coalesce(p_id, '') from '(\d+)$'), '')::bigint;
  x pedido_entre_centros;
  v_ids int[]; v_n int; v_u int;
begin
  perform public._exigir_rol(array['director']);
  select * into x from pedido_entre_centros where pedidoid = v_id for update;
  if not found then raise exception 'Ese pedido no existe.'; end if;
  if x.sede_proveedora is distinct from public._sede_id() then raise exception 'Solo el director del centro proveedor puede resolver este pedido.' using errcode = '42501'; end if;
  if x.estado <> 'Pendiente' then raise exception 'El pedido ya fue resuelto (%).', lower(x.estado); end if;
  if not p_aprobar then
    if coalesce(trim(p_motivo), '') = '' then raise exception 'Indica el motivo del rechazo.'; end if;
    update pedido_entre_centros set estado = 'Rechazada', revisado_por = public._personal_id(), revisado_en = now(), motivo_rechazo = trim(p_motivo) where pedidoid = v_id;
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('pedido_entre_centros', v_id, 'RECHAZO', public._uid(), x.sede_proveedora, jsonb_build_object('motivo', trim(p_motivo)));
    return jsonb_build_object('estado', 'rechazada');
  end if;
  -- Reserva del stock propio: mismo componente y tipo exacto, primero lo que vence antes.
  select array_agg(c.unidadid) into v_ids from (
    select u.unidadid from unidadsangre u
    where u.sedeid = x.sede_proveedora and u.componenteid = x.componenteid and u.tiposangreid = x.tiposangreid
      and u.estado = 'Disponible' and u.fechavencimiento > now()
    order by u.fechavencimiento, u.unidadid limit x.cantidad for update of u skip locked) c;
  v_n := coalesce(cardinality(v_ids), 0);
  if v_n < x.cantidad then raise exception 'Stock insuficiente en tu centro: hay % de % unidades.', v_n, x.cantidad; end if;
  update unidadsangre set estado = 'Reservado' where unidadid = any (v_ids);
  foreach v_u in array v_ids loop
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('unidadsangre', v_u, 'RESERVA', public._uid(), x.sede_proveedora, jsonb_build_object('pedido_centro_id', v_id));
  end loop;
  update pedido_entre_centros set estado = 'Aprobada', revisado_por = public._personal_id(), revisado_en = now() where pedidoid = v_id;
  return jsonb_build_object('estado', 'aprobada', 'unidades', v_n);
end $$;

-- Operador del proveedor: despacha lo aprobado hacia el centro solicitante.
create or replace function public.blud_pedido_centro_despachar(p_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint := nullif(substring(coalesce(p_id, '') from '(\d+)$'), '')::bigint; x pedido_entre_centros;
begin
  perform public._exigir_rol(array['operador', 'director']);
  select * into x from pedido_entre_centros where pedidoid = v_id for update;
  if not found then raise exception 'Ese pedido no existe.'; end if;
  if x.sede_proveedora is distinct from public._sede_id() then raise exception 'Este pedido lo despacha el centro proveedor.' using errcode = '42501'; end if;
  if x.estado <> 'Aprobada' then raise exception 'Solo se despachan pedidos aprobados.'; end if;
  update unidadsangre set estado = 'EnTransito' where estado = 'Reservado' and unidadid in (select unidadid from private.unidades_de_pedido(v_id));
  update pedido_entre_centros set estado = 'Despachada', despachado_por = public._personal_id(), despachado_en = now() where pedidoid = v_id;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('pedido_entre_centros', v_id, 'DESPACHO', public._uid(), x.sede_proveedora, '{}');
end $$;

-- Centro solicitante: recibe; las unidades pasan a su stock y, si el pedido venía de una solicitud local en
-- espera, se intenta su reserva.
create or replace function public.blud_pedido_centro_recibir(p_id text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint := nullif(substring(coalesce(p_id, '') from '(\d+)$'), '')::bigint; x pedido_entre_centros; v_u int; v_res int := 0;
begin
  perform public._exigir_rol(array['operador', 'director']);
  select * into x from pedido_entre_centros where pedidoid = v_id for update;
  if not found then raise exception 'Ese pedido no existe.'; end if;
  if x.sede_solicitante is distinct from public._sede_id() then raise exception 'Este pedido lo recibe el centro solicitante.' using errcode = '42501'; end if;
  if x.estado <> 'Despachada' then raise exception 'Solo se reciben pedidos despachados.'; end if;
  for v_u in select unidadid from private.unidades_de_pedido(v_id) where estado = 'EnTransito' loop
    update unidadsangre set estado = 'Disponible', sedeid = x.sede_solicitante where unidadid = v_u;
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('unidadsangre', v_u, 'TRASLADO', public._uid(), x.sede_solicitante, jsonb_build_object('pedido_centro_id', v_id, 'desde', x.sede_proveedora));
  end loop;
  update pedido_entre_centros set estado = 'Recibida', recibido_por = public._personal_id(), recibido_en = now() where pedidoid = v_id;
  if x.solicitud_local_id is not null then v_res := private.reservar_local(x.solicitud_local_id); end if;
  return jsonb_build_object('estado', 'recibida', 'reservaLocal', v_res);
end $$;

-- Director solicitante: cancela mientras sigue pendiente.
create or replace function public.blud_pedido_centro_cancelar(p_id text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint := nullif(substring(coalesce(p_id, '') from '(\d+)$'), '')::bigint;
begin
  perform public._exigir_rol(array['director']);
  update pedido_entre_centros set estado = 'Cancelada'
  where pedidoid = v_id and sede_solicitante = public._sede_id() and estado = 'Pendiente';
  if not found then raise exception 'Solo puedes cancelar pedidos pendientes de tu centro.'; end if;
end $$;

revoke all on function private.reservar_local(int), private.unidades_de_pedido(bigint), private.pedido_json(public.pedido_entre_centros) from public, anon, authenticated;
revoke all on function public.blud_pedidos_centros(), public.blud_pedido_centro_crear(jsonb), public.blud_pedido_centro_resolver(text, boolean, text),
  public.blud_pedido_centro_despachar(text), public.blud_pedido_centro_recibir(text), public.blud_pedido_centro_cancelar(text) from public, anon;
grant execute on function public.blud_pedidos_centros(), public.blud_pedido_centro_crear(jsonb), public.blud_pedido_centro_resolver(text, boolean, text),
  public.blud_pedido_centro_despachar(text), public.blud_pedido_centro_recibir(text), public.blud_pedido_centro_cancelar(text) to authenticated;

-- ============================================================ Laboratorio: también ve las locales en espera de stock
-- blud_transfusiones lista Pendiente (sin unidades aún: puede adelantar el tipaje) además de Aprobada/Despachada.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.blud_transfusiones()'::regprocedure);
  d := replace(d, $q$where st.estado in ('Aprobada', 'Despachada')$q$, $q$where st.estado in ('Pendiente', 'Aprobada', 'Despachada')$q$);
  d := replace(d, $q$'estado', case st.estado when 'Despachada' then 'despachado' else 'aprobado' end,$q$,
                  $q$'estado', case st.estado when 'Despachada' then 'despachado' when 'Pendiente' then 'pendiente' else 'aprobado' end,$q$);
  d := replace(d, $q$'faltaParaDespachar', case when st.estado = 'Aprobada' then private.falta_para_despachar(st.solicitudid) end$q$,
                  $q$'faltaParaDespachar', case when st.estado = 'Aprobada' then private.falta_para_despachar(st.solicitudid)
                                            when st.estado = 'Pendiente' then 'En espera de stock: aún no hay unidades reservadas.' end$q$);
  execute d;
  d := pg_get_functiondef('public.blud_registrar_tipaje(text, jsonb)'::regprocedure);
  d := replace(d, $q$and estado = 'Aprobada') then$q$, $q$and estado in ('Pendiente', 'Aprobada')) then$q$);
  d := replace(d, $q$'Esa solicitud no está aprobada o ya se despachó.'$q$, $q$'Esa solicitud ya se despachó o fue anulada.'$q$);
  execute d;
end $$;
