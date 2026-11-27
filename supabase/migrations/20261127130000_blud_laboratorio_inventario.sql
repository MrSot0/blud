-- BLUD · Laboratorio e inventario: RF-L4, L7, L8, I3 e I7.
-- Recuperada de la base (migración 20261127140647 blud_laboratorio_inventario): se aplicó sin subir este archivo.

alter table public.prueba_serologica
  add column if not exists abo_confirmado enum_grupo_abo,
  add column if not exists rh_confirmado enum_factor_rh,
  add column if not exists coombs_directo varchar,
  add column if not exists anticuerpos_irregulares enum_rastreo_anticuerpos;
alter table public.unidadsangre add column if not exists hora_congelacion timestamptz;

create or replace function private.g_prueba(p jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v jsonb := coalesce(p -> 'resultados', '{}');
  i jsonb := coalesce(p -> 'inmuno', '{}');
  v_tipo text := replace(coalesce(p ->> 'tipoSangreConfirmado', ''), '−', '-');
  v_id int;
  v_global text;
begin
  if p ->> 'id' like 'PS-%' then return '{}'; end if;
  select donacionid into v_id from donacion where din_codigo = p ->> 'donacionId';
  if v_id is null then raise exception 'No encontramos esa donación.'; end if;
  if v_tipo !~ '^(A|B|AB|O)[+-]$' then raise exception 'Confirma el grupo ABO y el Rh de la donación.'; end if;
  if coalesce(i ->> 'coombs', '') not in ('Negativo', 'Positivo') then raise exception 'Registra el resultado del Coombs directo.'; end if;
  if coalesce(i ->> 'anticuerpos', '') not in ('Negativo', 'Positivo') then raise exception 'Registra el rastreo de anticuerpos irregulares.'; end if;
  v_global := public.registrar_serologia(v_id,
    private.res_back(v ->> 'vih'), private.res_back(v ->> 'hbsag'), private.res_back(v ->> 'hbcore'),
    private.res_back(v ->> 'hcv'), private.res_back(v ->> 'chagas'), private.res_back(v ->> 'sifilis'), private.res_back(v ->> 'htlv'));
  update prueba_serologica set
    abo_confirmado = regexp_replace(v_tipo, '[+-]$', '')::enum_grupo_abo,
    rh_confirmado = right(v_tipo, 1)::enum_factor_rh,
    coombs_directo = i ->> 'coombs',
    anticuerpos_irregulares = (i ->> 'anticuerpos')::enum_rastreo_anticuerpos
  where prueba_id = (select prueba_id from prueba_serologica where donacion_id = v_id order by prueba_id desc limit 1);
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
  c jsonb := coalesce(p -> 'centrifugacion', '{}');
  v_rcf numeric;
  v_min smallint;
  v_temp numeric;
  v_fid bigint;
  e jsonb;
begin
  if p ->> 'id' like 'FR-%' then return '{}'; end if;
  select donacionid into v_id from donacion where din_codigo = p ->> 'donacionId';
  if v_id is null then raise exception 'No encontramos esa donación.'; end if;
  begin
    v_rcf := (c ->> 'rcf')::numeric; v_min := (c ->> 'minutos')::smallint; v_temp := (c ->> 'temperatura')::numeric;
  exception when others then v_rcf := null;
  end;
  if v_rcf is null or v_rcf < 500 or v_rcf > 6000 or v_min is null or v_min < 1 or v_min > 60 or v_temp is null or v_temp < -10 or v_temp > 30 then
    raise exception 'Registra la centrifugación: RCF (500 a 6000 g), tiempo (1 a 60 min) y temperatura (-10 a 30 °C).';
  end if;
  select array_agg(distinct private.comp_id(x ->> 'componente')::int) into v_ids
  from jsonb_array_elements(coalesce(p -> 'productos', '[]')) x where coalesce((x ->> 'unidades')::int, 0) > 0;
  if v_ids is null or array_position(v_ids, null) is not null then raise exception 'Hemocomponente no válido.'; end if;
  for e in select x from jsonb_array_elements(coalesce(p -> 'productos', '[]')) x where coalesce((x ->> 'unidades')::int, 0) > 0 loop
    if e ->> 'componente' = 'Plasma Fresco Congelado' and coalesce(e -> 'variantes' ->> 'horaCongelacion', '') = '' then
      raise exception 'Registra la hora de congelación del plasma.';
    end if;
  end loop;
  perform public.fraccionar_donacion(v_id, v_ids, v_rcf, v_min, v_temp, p ->> 'observaciones');
  select max(fraccionamiento_id) into v_fid from fraccionamiento where donacion_id = v_id;
  for e in select x from jsonb_array_elements(coalesce(p -> 'productos', '[]')) x where coalesce((x ->> 'unidades')::int, 0) > 0 loop
    update unidadsangre set
      leucorreducida = coalesce((e -> 'variantes' ->> 'leucorreducida')::boolean, false),
      lavada = coalesce((e -> 'variantes' ->> 'lavada')::boolean, false),
      irradiada = coalesce((e -> 'variantes' ->> 'irradiada')::boolean, false),
      solucion_aditiva = nullif(trim(coalesce(e -> 'variantes' ->> 'solucion', '')), ''),
      metodo_obtencion = coalesce(nullif(trim(coalesce(e -> 'variantes' ->> 'metodo', '')), ''), 'Fraccionamiento de sangre total'),
      ubicacion_fisica = nullif(trim(coalesce(e -> 'variantes' ->> 'ubicacion', '')), ''),
      hora_congelacion = nullif(e -> 'variantes' ->> 'horaCongelacion', '')::timestamptz
    where fraccionamiento_id = v_fid and componenteid = private.comp_id(e ->> 'componente');
  end loop;
  select resultado_global into v_sero from prueba_serologica where donacion_id = v_id order by fecha_analisis desc, prueba_id desc limit 1;
  if v_sero = 'Negativo' then perform public.liberar_unidades(v_id); end if;
  return '{}';
end $$;

create or replace function public.blud_inventario_detalle() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._exigir_rol(array['operador', 'laboratorio', 'director']);
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', 'U-' || u.unidadid, 'codigo', u.codigolote, 'estado', u.estado::text, 'venceHora', u.fechavencimiento,
    'ubicacion', u.ubicacion_fisica, 'metodo', u.metodo_obtencion, 'solucion', u.solucion_aditiva,
    'leucorreducida', nullif(u.leucorreducida, false), 'lavada', nullif(u.lavada, false), 'irradiada', nullif(u.irradiada, false),
    'horaCongelacion', u.hora_congelacion)))
    from unidadsangre u where u.sedeid = public._sede_id() and u.estado in ('Disponible', 'Reservado', 'Cuarentena')), '[]');
end $$;

create or replace function public.blud_unidad_ubicar(p_unidad text, p_ubicacion text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id int := substring(coalesce(p_unidad, '') from '\d+$')::int; v_antes text;
begin
  perform public._exigir_rol(array['laboratorio', 'director', 'operador']);
  if length(trim(coalesce(p_ubicacion, ''))) < 3 then raise exception 'Indica la ubicación (equipo, estante y posición).'; end if;
  select ubicacion_fisica into v_antes from unidadsangre where unidadid = v_id and sedeid = public._sede_id() for update;
  if not found then raise exception 'No encontramos esa unidad en tu sede.'; end if;
  update unidadsangre set ubicacion_fisica = trim(p_ubicacion) where unidadid = v_id;
  perform private.auditar('unidadsangre', v_id, 'UBICACION', jsonb_build_object('antes', v_antes, 'despues', trim(p_ubicacion)));
end $$;

create or replace function public.blud_unidad_baja(p_unidad text, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id int := substring(coalesce(p_unidad, '') from '\d+$')::int;
  v_estado text;
  v_causa text := p ->> 'causa';
begin
  perform public._exigir_rol(array['laboratorio', 'director']);
  select estado::text into v_estado from unidadsangre where unidadid = v_id and sedeid = public._sede_id() for update;
  if not found then raise exception 'No encontramos esa unidad en tu sede.'; end if;
  if v_estado in ('Descartado', 'Transfundido', 'EnTransito') then raise exception 'Esa unidad no se puede dar de baja (está %).', lower(v_estado); end if;
  if v_causa not in ('Caducidad', 'Serología reactiva', 'Rotura', 'Alteración térmica', 'Hemólisis', 'Otra') then raise exception 'Elige la causa de la baja.'; end if;
  if v_causa = 'Otra' and length(trim(coalesce(p ->> 'detalle', ''))) < 10 then raise exception 'Describe la causa de la baja (mínimo 10 caracteres).'; end if;
  if coalesce(p ->> 'metodo', '') not in ('Incineración', 'Autoclave', 'Gestor externo de desechos', 'Devolución a proveedor') then
    raise exception 'Elige el método de disposición.';
  end if;
  if length(trim(coalesce(p ->> 'firma', ''))) < 5 then raise exception 'Escribe el nombre completo de quien firma la baja.'; end if;
  update unidadsangre set estado = 'Descartado',
    causa_baja = jsonb_strip_nulls(jsonb_build_object('causa', v_causa, 'detalle', nullif(trim(coalesce(p ->> 'detalle', '')), ''),
      'metodo', p ->> 'metodo', 'firma', trim(p ->> 'firma'), 'fecha', now()))::text
  where unidadid = v_id;
  perform private.auditar('unidadsangre', v_id, 'BAJA_UNIDAD',
    jsonb_build_object('causa', v_causa, 'metodo', p ->> 'metodo', 'firma', trim(p ->> 'firma'), 'estado_anterior', v_estado));
end $$;

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.blud_trazabilidad(text)'::regprocedure);
  if position('coombs' in v_def) = 0 then
    v_def := replace(v_def,
      'jsonb_build_object(''resultado'', ps.resultado_global::text, ''fecha'', private.dia(ps.fecha_analisis))',
      'jsonb_strip_nulls(jsonb_build_object(''resultado'', ps.resultado_global::text, ''fecha'', private.dia(ps.fecha_analisis), '
      || '''grupo'', ps.abo_confirmado::text || ps.rh_confirmado::text, ''coombs'', ps.coombs_directo, ''anticuerpos'', ps.anticuerpos_irregulares::text))');
    if position('coombs' in v_def) = 0 then raise exception 'No se pudo actualizar blud_trazabilidad.'; end if;
    execute v_def;
  end if;
end $$;

revoke all on function public.blud_inventario_detalle(), public.blud_unidad_ubicar(text, text), public.blud_unidad_baja(text, jsonb) from public, anon;
grant execute on function public.blud_inventario_detalle(), public.blud_unidad_ubicar(text, text), public.blud_unidad_baja(text, jsonb) to authenticated;
