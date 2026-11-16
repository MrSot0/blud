-- BLUD · Evaluación médica completa (RF-O7), datos de la extracción (RF-O8) y DIN ISBT 128 (RF-O6).
-- Se aplica después de 20261111200000_blud_mfa.sql. Se puede repetir.
--
-- RF-O6: además del código interno (din_codigo, DON-AA000123), cada donación tiene su DIN ISBT 128:
--   FIN (5) + año (2) + secuencia (6) + carácter de control ISO 7064 Mod 37-2  →  V0001 26 000014 K
-- El FIN (Facility Identification Number) lo asigna ICCBBA a cada centro. Mientras no se tenga, se usa uno
-- provisional por sede (V + id de la sede). Cámbialo en sede.fin_isbt cuando ICCBBA lo asigne.

alter table public.donacion add column if not exists din_isbt text;
alter table public.donacion add column if not exists inicio_extraccion timestamptz;
alter table public.donacion add column if not exists fin_extraccion timestamptz;
alter table public.sede add column if not exists fin_isbt varchar(5);
update public.sede set fin_isbt = 'V' || lpad(sedeid::text, 4, '0') where fin_isbt is null;

-- Carácter de control ISO 7064 Mod 37-2 (el que usa ISBT 128 para el DIN).
create or replace function private.isbt_mod37(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  a constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ*';
  s int := 0;
  c text;
begin
  foreach c in array regexp_split_to_array(upper(p), '') loop
    s := ((s + strpos(a, c) - 1) * 2) % 37;
  end loop;
  return substr(a, ((38 - s) % 37) + 1, 1);
end $$;

create or replace function private.din_isbt(p_sede int, p_fecha timestamptz, p_id int) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select d || private.isbt_mod37(d)
  from (select coalesce((select fin_isbt from sede where sedeid = p_sede), 'V' || lpad(p_sede::text, 4, '0'))
               || to_char(coalesce(p_fecha, now()), 'YY') || lpad((p_id % 1000000)::text, 6, '0') as d) x
$$;

create or replace function private.poner_din_isbt() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.din_isbt is null and new.donacionid is not null then
    new.din_isbt := private.din_isbt(new.sedeid, new.fechadonacion, new.donacionid);
  end if;
  return new;
end $$;
drop trigger if exists din_isbt_donacion on public.donacion;
create trigger din_isbt_donacion before insert or update on public.donacion
  for each row execute function private.poner_din_isbt();
update public.donacion set din_isbt = private.din_isbt(sedeid, fechadonacion, donacionid) where din_isbt is null;

-- Formato legible: V0001 26 000014 K
create or replace function private.din_legible(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then null
    else substr(p, 1, 5) || ' ' || substr(p, 6, 2) || ' ' || substr(p, 8, 6) || ' ' || substr(p, 14, 1) end
$$;

-- ============================================================ g_donacion con evaluación y extracción completas
create or replace function private.g_donacion(p jsonb, v_rol text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_ev jsonb := p -> 'evaluacion';
  v_ts smallint := private.ts_id(p ->> 'tipoSangre');
  v_don int;
  v_dict text := coalesce(v_ev ->> 'dictamen', 'apto');
  v_tipo_rechazo enum_tipo_rechazo;
  v_tipo_don enum_tipo_donacion;
  v_inicio timestamptz;
  v_fin timestamptz;
  r record;
  v_din text;
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

  -- RF-O7: dictamen del profesional. Un rechazo se guarda como evaluación no apta (difiere al donante).
  if v_dict in ('temporal', 'definitivo') then
    if coalesce(trim(v_ev ->> 'motivo'), '') = '' then raise exception 'Escribe el motivo del rechazo.'; end if;
    v_tipo_rechazo := case v_dict when 'definitivo' then 'Definitivo' else 'Temporal' end;
  end if;

  select * into r from public.evaluar_donante(
    v_don, private.num(v_ev ->> 'peso')::numeric, trim(v_ev ->> 'presion'), private.num(v_ev ->> 'hb')::numeric,
    private.num(v_ev ->> 'temperatura')::numeric, private.num(v_ev ->> 'fc')::smallint,
    private.num(v_ev ->> 'talla')::numeric, private.num(v_ev ->> 'hcto')::numeric, v_tipo_rechazo, v_ev ->> 'motivo');
  if v_tipo_rechazo is not null then
    return jsonb_build_object('aviso', 'Evaluación guardada: el donante quedó '
      || case when v_tipo_rechazo = 'Definitivo' then 'excluido de forma permanente.'
              else 'diferido' || coalesce(' hasta el ' || to_char(r.o_proxima_aptitud, 'DD/MM/YYYY'), '') || '.' end);
  end if;
  if not r.o_apto then
    -- Se devuelve en vez de lanzar el error para que la evaluación (el diferimiento) quede guardada.
    return jsonb_build_object('error', 'No apto para donar: ' || r.o_motivo
      || coalesce('. Podrá donar desde el ' || to_char(r.o_proxima_aptitud, 'DD/MM/YYYY'), '') || '.');
  end if;

  -- RF-O8: datos de la extracción.
  v_tipo_don := case p ->> 'tipoDonacion'
    when 'Reposicion' then 'Reposicion' when 'Autologa' then 'Autologa' when 'Aferesis' then 'Aferesis'
    when 'Voluntaria' then 'Voluntaria'
    else case when p ->> 'tipoHemocomponente' = 'Plaquetas' then 'Aferesis' else 'Voluntaria' end end;
  if coalesce(p ->> 'inicio', '') ~ '^\d{2}:\d{2}$' then v_inicio := (current_date + (p ->> 'inicio')::time) at time zone 'America/Caracas'; end if;
  if coalesce(p ->> 'fin', '') ~ '^\d{2}:\d{2}$' then v_fin := (current_date + (p ->> 'fin')::time) at time zone 'America/Caracas'; end if;
  if v_inicio is not null and v_fin is not null and v_fin <= v_inicio then raise exception 'La hora de fin debe ser posterior a la de inicio.'; end if;

  if v_ts is not null then update donante set tipo_sangre = v_ts where donanteid = v_don and tipo_sangre <> v_ts; end if;
  select * into r from public.registrar_donacion(
    v_don, (p ->> 'volumenMl')::smallint, v_tipo_don, nullif(trim(p ->> 'bolsa'), ''), nullif(trim(p ->> 'reacciones'), ''));
  update donacion set inicio_extraccion = v_inicio, fin_extraccion = v_fin where donacionid = r.o_donacion_id
  returning din_isbt into v_din;
  return jsonb_build_object('aviso', 'Donación registrada · DIN ' || private.din_legible(v_din)
    || '. Queda en cuarentena hasta el análisis del laboratorio.');
end $$;

-- ============================================================ El panel incluye el DIN ISBT 128 y la extracción
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.blud_panel'::regproc) into v_def;
  if position('dinIsbt' in v_def) = 0 then
    v_def := replace(v_def, $r$'centroNombre', s.nombre,$r$,
      $r$'centroNombre', s.nombre,
      'dinIsbt', private.din_legible(x.din_isbt),
      'tipoDonacion', case when v_staff then x.tipo_donacion::text end,
      'bolsa', case when v_staff then x.tipo_bolsa_anticoagulante end,
      'reacciones', case when v_staff then x.reacciones_adversas_donacion end,
      'inicio', case when v_staff then to_char(x.inicio_extraccion at time zone 'America/Caracas', 'HH24:MI') end,
      'fin', case when v_staff then to_char(x.fin_extraccion at time zone 'America/Caracas', 'HH24:MI') end,$r$);
    execute v_def;
  end if;
end $$;

-- ============================================================ Criterios del documento de requerimientos (RF-O7)
-- Hemoglobina mínima en hombres 13,5 g/dL (el esquema usaba 13,0) y hematocrito mínimo 38 %.
do $$
declare v_def text;
begin
  select pg_get_functiondef('public.evaluar_donante'::regproc) into v_def;
  if position('else 13.5 end' in v_def) = 0 then
    v_def := replace(v_def, 'else 13.0 end', 'else 13.5 end');
    v_def := replace(v_def, '  if p_temp > 37.5 then', $r$  if p_hcto is not null and p_hcto < 38 then
    v_motivos := array_append(v_motivos, format('Hematocrito bajo (%s %%)', p_hcto));
    v_f := current_date + 30; v_prox := greatest(coalesce(v_prox, v_f), v_f);
  end if;

  if p_temp > 37.5 then$r$);
    execute v_def;
  end if;
end $$;

revoke all on function private.isbt_mod37(text), private.din_isbt(int, timestamptz, int), private.poner_din_isbt(),
  private.din_legible(text) from public, anon, authenticated;
