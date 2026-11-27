-- BLUD · RF-I2 y RF-DIR3: historial de movimientos de las unidades del inventario. Se puede repetir.
--
-- El disparador aud_unidad (registrar_auditoria) ya guarda en bitacora_auditoria cada alta y cambio de unidadsangre
-- con los valores anteriores y nuevos, el usuario y la hora. Esta función lo lee como movimientos:
--   Ingreso (alta de la unidad) · Estado (de → a; con la causa si es una baja) · Ubicación (de → a) · Traslado (sede de → a).
-- Dirección y laboratorio; ven las unidades de su sede (las que se movieron allí o desde allí). Pagina por cursor
-- como blud_bitacora: 25 por página, por defecto el último año, como máximo dos años por consulta.

create index if not exists idx_bitacora_unidad on public.bitacora_auditoria (auditoria_id desc)
  where tabla_afectada = 'unidadsangre';

create or replace function public.blud_movimientos(
  p_q text default null, p_tipo text default null, p_desde date default null, p_hasta date default null,
  p_cursor bigint default null, p_limite int default 25)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_sede int := public._sede_id();
  v_lim int := least(greatest(coalesce(p_limite, 25), 1), 100);
  v_q text := case when length(trim(coalesce(p_q, ''))) >= 3 then lower(trim(p_q)) end;
  v_desde timestamptz := coalesce(p_desde, (now() - interval '1 year')::date);
  v_hasta timestamptz := coalesce(p_hasta, now()::date) + interval '1 day';
  v_items jsonb;
  v_hay_mas boolean;
begin
  perform public._exigir_rol(array['director', 'laboratorio']);
  if v_hasta - v_desde > interval '2 years 1 day' then raise exception 'Consulta como máximo dos años a la vez.'; end if;
  if p_tipo is not null and p_tipo not in ('Ingreso', 'Estado', 'Ubicación', 'Traslado') then raise exception 'Tipo de movimiento no válido.'; end if;

  with base as (
    select b.auditoria_id, b.fecha_hora, b.usuario_id, b.registro_id, b.valores_anteriores a, b.valores_nuevos n,
           case
             when b.operacion = 'INSERT' then 'Ingreso'
             when b.valores_anteriores ->> 'sedeid' is distinct from b.valores_nuevos ->> 'sedeid' then 'Traslado'
             when b.valores_anteriores ->> 'estado' is distinct from b.valores_nuevos ->> 'estado' then 'Estado'
             when b.valores_anteriores ->> 'ubicacion_fisica' is distinct from b.valores_nuevos ->> 'ubicacion_fisica' then 'Ubicación'
           end tipo
    from bitacora_auditoria b
    where b.tabla_afectada = 'unidadsangre' and b.operacion in ('INSERT', 'UPDATE')
      and (p_cursor is null or b.auditoria_id < p_cursor)
      and b.fecha_hora >= v_desde and b.fecha_hora < v_hasta
      and (b.sede_id = v_sede or (b.valores_nuevos ->> 'sedeid')::int = v_sede or (b.valores_anteriores ->> 'sedeid')::int = v_sede)
  ), pagina as (
    select x.* from base x
    where x.tipo is not null and (p_tipo is null or x.tipo = p_tipo)
      and (v_q is null or lower(coalesce(x.n ->> 'codigolote', '')) like '%' || v_q || '%' or x.registro_id::text = v_q
           or exists (select 1 from usuario u where u.usuarioid = x.usuario_id and lower(u.nombres || ' ' || u.apellidos) like '%' || v_q || '%'))
    order by x.auditoria_id desc
    limit v_lim + 1
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'id', p.auditoria_id, 'fecha', p.fecha_hora, 'tipo', p.tipo, 'unidad', 'U-' || p.registro_id,
           'codigo', p.n ->> 'codigolote', 'componente', private.comp_front(hc.tipo::text), 'sangre', private.ts_txt((p.n ->> 'tiposangreid')::smallint),
           'de', case p.tipo when 'Estado' then p.a ->> 'estado' when 'Ubicación' then p.a ->> 'ubicacion_fisica' when 'Traslado' then sa.nombre end,
           'a', case p.tipo when 'Ingreso' then p.n ->> 'estado' when 'Estado' then p.n ->> 'estado'
                            when 'Ubicación' then p.n ->> 'ubicacion_fisica' when 'Traslado' then sn.nombre end,
           'causa', case when p.tipo = 'Estado' and p.n ->> 'estado' = 'Descartado' then p.n ->> 'causa_baja' end,
           'usuario', nullif(trim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '')
         )) order by p.auditoria_id desc) filter (where p.k <= v_lim), '[]'),
         count(*) > v_lim
    into v_items, v_hay_mas
  from (select pagina.*, row_number() over (order by auditoria_id desc) k from pagina) p
  left join hemocomponente hc on hc.componenteid = (p.n ->> 'componenteid')::smallint
  left join sede sa on sa.sedeid = (p.a ->> 'sedeid')::int
  left join sede sn on sn.sedeid = (p.n ->> 'sedeid')::int
  left join usuario u on u.usuarioid = p.usuario_id;

  return jsonb_build_object('items', v_items,
    'siguiente', case when v_hay_mas then (v_items -> (jsonb_array_length(v_items) - 1) ->> 'id') end);
end $$;

revoke all on function public.blud_movimientos(text, text, date, date, bigint, int) from public, anon;
grant execute on function public.blud_movimientos(text, text, date, date, bigint, int) to authenticated;
