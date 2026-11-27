-- BLUD · RF-I1: la unidad pasa a «Transfundido» cuando el operador registra su transfusión en hemovigilancia.
-- Se puede repetir.
--
-- Hasta ahora la bolsa quedaba «EnTransito» después de despachar. Con el registro de hemovigilancia (que exige la doble
-- verificación en cabecera y la hora de inicio) la unidad queda transfundida; si luego se devuelve por una reacción,
-- sigue sin poder volver al inventario. El cambio lo guarda la auditoría de unidadsangre con el usuario y la hora (RF-I2).

-- Las unidades de una solicitud incluyen también las ya transfundidas: la hemovigilancia las sigue mostrando y editando.
-- (despachar y g_pedido filtran por 'Reservado' por su cuenta.)
create or replace function public.unidades_de_solicitud(p_solicitud integer)
returns table (o_unidad_id integer, o_codigo text, o_componente text, o_tipo_sangre text, o_vence timestamptz, o_estado text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._exigir_rol(array['director', 'operador', 'laboratorio']);
  return query
    select u.unidadid, u.codigolote::text, hc.tipo::text, (ts.grupoabo::text || ts.factorrh::text), u.fechavencimiento, u.estado::text
    from public.unidadsangre u
    join public.hemocomponente hc on hc.componenteid = u.componenteid
    join public.tiposangre ts on ts.tiposangreid = u.tiposangreid
    where u.estado in ('Reservado', 'EnTransito', 'Transfundido')
      and (select (b.valores_nuevos ->> 'solicitud_id')::int
           from public.bitacora_auditoria b
           where b.tabla_afectada = 'unidadsangre' and b.registro_id = u.unidadid and b.operacion = 'RESERVA'
           order by b.auditoria_id desc limit 1) = p_solicitud
    order by u.fechavencimiento, u.unidadid;
end $$;

create or replace function private.hv_marcar_transfundida() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.unidad_id is not null and new.hora_inicio is not null then
    update unidadsangre set estado = 'Transfundido' where unidadid = new.unidad_id and estado = 'EnTransito';
  end if;
  return null;
end $$;

drop trigger if exists hv_transfundida on public.hemo_vigilancia;
create trigger hv_transfundida after insert or update of unidad_id, hora_inicio on public.hemo_vigilancia
  for each row execute function private.hv_marcar_transfundida();

-- Unidades con transfusión ya registrada que seguían en tránsito.
update public.unidadsangre u set estado = 'Transfundido'
where u.estado = 'EnTransito' and exists (select 1 from public.hemo_vigilancia h where h.unidad_id = u.unidadid and h.hora_inicio is not null);

-- Cambiar la unidad de una solicitud solo antes de despachar: antes, una bolsa despachada (y ahora transfundida)
-- podía volver a «Disponible».
create or replace function public.blud_cambiar_unidad(p_solicitud text, p_unidad integer) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sid int := nullif(substring(coalesce(p_solicitud, '') from '(\d+)$'), '')::int;
  s record;
  v_nueva int;
begin
  perform public._exigir_rol(array['laboratorio']);
  if not exists (select 1 from public.unidades_de_solicitud(v_sid) where o_unidad_id = p_unidad) then
    raise exception 'Esa unidad no está reservada para esta solicitud.';
  end if;
  if not exists (select 1 from unidadsangre where unidadid = p_unidad and estado = 'Reservado') then
    raise exception 'Esa unidad ya se despachó: no se puede cambiar.';
  end if;
  select st.*, hc.tipo::text ctipo, ts.grupoabo::text pabo, ts.factorrh::text prh into s
  from solicitudtransfusion st join hemocomponente hc on hc.componenteid = st.componenteid
  join tiposangre ts on ts.tiposangreid = st.tiposangreid where st.solicitudid = v_sid;
  select u.unidadid into v_nueva
  from unidadsangre u join tiposangre tu on tu.tiposangreid = u.tiposangreid
  where u.estado = 'Disponible' and u.componenteid = s.componenteid and u.fechavencimiento > now()
    and (not s.requiere_desleucocitado or u.leucorreducida)
    and public._compatible(s.ctipo, tu.grupoabo::text, tu.factorrh::text, s.pabo, s.prh)
    and not exists (select 1 from prueba_cruzada c where c.solicitud_id = v_sid and c.unidad_id = u.unidadid)
  order by (u.tiposangreid = s.tiposangreid) desc, u.fechavencimiento, u.unidadid
  limit 1 for update of u skip locked;
  if v_nueva is null then raise exception 'No hay otra unidad compatible disponible en el stock.'; end if;
  update unidadsangre set estado = 'Disponible' where unidadid = p_unidad;
  update unidadsangre set estado = 'Reservado' where unidadid = v_nueva;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('unidadsangre', p_unidad, 'LIBERA_RESERVA', public._uid(), public._sede_id(), jsonb_build_object('solicitud_id', v_sid)),
         ('unidadsangre', v_nueva, 'RESERVA', public._uid(), public._sede_id(), jsonb_build_object('solicitud_id', v_sid));
  return jsonb_build_object('unidadId', v_nueva);
end $$;
