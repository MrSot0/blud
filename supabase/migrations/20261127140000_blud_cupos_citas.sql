-- BLUD · RF-D7: la base valida el horario y los cupos de cada sede al agendar una cita. Se puede repetir.
--
--   sede.dias_atencion (0 = domingo … 6 = sábado), hora_apertura, hora_cierre y cupos_por_hora (citas por franja de 1 h).
--   blud_cupos(centro, fecha): franjas de la jornada con los cupos libres (para el formulario de agendar).
--   blud_agendar_cita valida día, horario, fecha futura y cupo antes de crear la cita.
-- Horarios iniciales tomados de src/data/centers.ts (los mismos que muestra /centros).

alter table public.sede
  add column if not exists dias_atencion smallint[] not null default '{1,2,3,4,5}',
  add column if not exists hora_apertura time not null default '07:00',
  add column if not exists hora_cierre time not null default '15:00',
  add column if not exists cupos_por_hora smallint not null default 4;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sede_horario_chk') then
    alter table public.sede add constraint sede_horario_chk check (hora_apertura < hora_cierre and cupos_por_hora between 1 and 50);
  end if;
end $$;

-- Solo la primera vez (las sedes con el horario por defecto): luego cada sede mantiene el suyo.
update public.sede s set dias_atencion = h.dias, hora_apertura = h.abre, hora_cierre = h.cierra
from (values
  ('Banco de Sangre del Zulia', '{1,2,3,4,5,6}'::smallint[], '07:00'::time, '15:00'::time),
  ('Hospital Universitario de Maracaibo', '{0,1,2,3,4,5,6}', '07:00', '19:00'),
  ('Policlínica Amado', '{1,2,3,4,5}', '08:00', '16:00'),
  ('Hospital Coromoto', '{1,2,3,4,5,6}', '07:30', '17:00'),
  ('Hospital Central Dr. Urquinaona', '{0,1,2,3,4,5,6}', '07:00', '18:00'),
  ('Hospital Chiquinquirá', '{1,2,3,4,5}', '07:00', '15:00'),
  ('Hospital General del Sur Dr. Pedro Iturbe', '{1,2,3,4,5,6}', '07:00', '16:00'),
  ('Hospital Dr. Manuel Noriega Trigo', '{1,2,3,4,5}', '07:00', '15:00')
) h(nombre, dias, abre, cierra)
where s.nombre = h.nombre and s.dias_atencion = '{1,2,3,4,5}' and s.hora_apertura = '07:00' and s.hora_cierre = '15:00';

-- Franjas de una hora de la jornada de la sede, con los cupos libres. Pública: la usan el donante y el operador.
create or replace function public.blud_cupos(p_centro text, p_fecha date) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('hora', to_char(f.h, 'HH24:MI'), 'libres', greatest(s.cupos_por_hora - (
           select count(*) from cita c where c.sedeid = s.sedeid and c.estado not in ('Cancelada', 'No asistió')
             and c.fecha_hora_cita >= (p_fecha + f.h) at time zone 'America/Caracas'
             and c.fecha_hora_cita < (p_fecha + f.h + interval '1 hour') at time zone 'America/Caracas'), 0))
         order by f.h), '[]')
  from sede s
  cross join lateral (select s.hora_apertura + make_interval(hours => n) h
                      from generate_series(0, floor(extract(epoch from s.hora_cierre - s.hora_apertura) / 3600)::int - 1) n) f
  where s.nombre = p_centro and s.recibe_citas and extract(dow from p_fecha)::smallint = any (s.dias_atencion)
    and (p_fecha + f.h) at time zone 'America/Caracas' > now()
$$;

create or replace function public.blud_agendar_cita(p_centro text, p_fecha date, p_hora text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s sede;
  v_hora time;
  v_inicio timestamptz;
  v_ocupados int;
begin
  select * into s from sede where nombre = p_centro;
  if s.sedeid is null or not s.recibe_citas then raise exception 'Ese centro todavía no recibe citas en línea.'; end if;
  begin v_hora := p_hora::time; exception when others then raise exception 'Elige una hora válida.'; end;
  v_inicio := (p_fecha + v_hora) at time zone 'America/Caracas';
  if v_inicio <= now() then raise exception 'Elige una fecha y hora futuras.'; end if;
  if not (extract(dow from p_fecha)::smallint = any (s.dias_atencion)) then
    raise exception 'El centro no atiende ese día. Elige otra fecha.';
  end if;
  if v_hora < s.hora_apertura or v_hora >= s.hora_cierre then
    raise exception 'El centro atiende de % a %. Elige una hora dentro de ese horario.', to_char(s.hora_apertura, 'HH24:MI'), to_char(s.hora_cierre, 'HH24:MI');
  end if;
  select count(*) into v_ocupados from cita c
  where c.sedeid = s.sedeid and c.estado not in ('Cancelada', 'No asistió')
    and c.fecha_hora_cita >= date_trunc('hour', v_inicio at time zone 'America/Caracas') at time zone 'America/Caracas'
    and c.fecha_hora_cita < (date_trunc('hour', v_inicio at time zone 'America/Caracas') + interval '1 hour') at time zone 'America/Caracas';
  if v_ocupados >= s.cupos_por_hora then raise exception 'Esa hora ya no tiene cupos. Elige otra.'; end if;
  return 'CITA-' || public.agendar_cita(s.sedeid, v_inicio, null);
end $$;

revoke all on function public.blud_cupos(text, date) from public;
grant execute on function public.blud_cupos(text, date) to anon, authenticated;
