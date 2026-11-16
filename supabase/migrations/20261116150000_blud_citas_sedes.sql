-- BLUD · Citas y sedes. Se puede repetir.
--   1. sede.recibe_citas: solo las sedes que aparecen en el mapa reciben citas en línea.
--      «Hospital Central Maracaibo» (sede 1, dirección por definir) no está en el mapa: deja de recibir citas.
--   2. El personal de prueba @blud.app pasa de la sede 1 al Banco de Sangre del Zulia (sede 2), que sí está en el mapa.
--      Los registros históricos de la sede 1 (donaciones, unidades, pacientes, CITA-1) se quedan donde están.
--   3. Bandeja con selector: por defecto el centro del operador; puede consultar otra sede o toda la red.
--      Marcar llegada/ausencia sigue limitado a su propio centro (blud_cita_marcar).

alter table public.sede add column if not exists recibe_citas boolean not null default true;
update public.sede set recibe_citas = false where sedeid = 1;

update public.personalsalud p set sedeid = 2
from public.usuario u
where u.usuarioid = p.usuarioid and p.sedeid = 1 and lower(u.correo) like '%@blud.app';

create or replace function public.blud_agendar_cita(p_centro text, p_fecha date, p_hora text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_sede int;
begin
  select sedeid into v_sede from sede where nombre = p_centro and recibe_citas;
  if v_sede is null then raise exception 'Ese centro todavía no recibe citas en línea.'; end if;
  return 'CITA-' || public.agendar_cita(v_sede, (p_fecha + p_hora::time) at time zone 'America/Caracas', null);
end $$;

-- p_sede: null = mi centro · 0 = toda la red · n = esa sede.
drop function if exists public.blud_bandeja_citas(int);
create or replace function public.blud_bandeja_citas(p_dias int default 14, p_sede int default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_mi int := public._sede_id();
  v_ver int := coalesce(p_sede, public._sede_id());
  v_hoy date := (now() at time zone 'America/Caracas')::date;
begin
  perform public._exigir_rol(array['operador', 'director']);
  if v_mi is null then raise exception 'Tu cuenta no tiene un centro asignado.'; end if;
  if v_ver <> 0 and not exists (select 1 from sede where sedeid = v_ver) then raise exception 'Ese centro no existe.'; end if;
  return jsonb_build_object(
    'miSede', v_mi,
    'sedeId', v_ver,
    'centro', case when v_ver = 0 then 'Toda la red' else (select nombre from sede where sedeid = v_ver) end,
    'hoy', v_hoy,
    'sedes', (select jsonb_agg(jsonb_build_object(
                'id', s.sedeid, 'nombre', s.nombre,
                'hoy', (select count(*) from cita c where c.sedeid = s.sedeid and c.estado in ('Programada', 'En espera')
                          and (c.fecha_hora_cita at time zone 'America/Caracas')::date = v_hoy))
              order by s.sedeid = v_mi desc, s.nombre)
              from sede s where s.recibe_citas or s.sedeid = v_mi),
    'citas', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', 'CITA-' || c.citaid,
        'sedeId', c.sedeid,
        'sede', s.nombre,
        'fecha', (c.fecha_hora_cita at time zone 'America/Caracas')::date,
        'hora', to_char(c.fecha_hora_cita at time zone 'America/Caracas', 'HH24:MI'),
        'estado', c.estado,
        'observaciones', c.observaciones,
        'donante', jsonb_strip_nulls(jsonb_build_object(
          'id', 'BLD-' || lpad(d.donanteid::text, 6, '0'),
          'nombre', trim(u.nombres || ' ' || u.apellidos),
          'cedula', private.cedula(u.cedula),
          'telefono', nullif(u.telefono, ''),
          'sangre', private.ts_txt(d.tipo_sangre),
          'foto', private.foto_de(u.correo),
          'verificado', d.verificado_en is not null,
          'diferimiento', private.diferimiento(d.donanteid),
          'cuestionario', (select case when q.apto then 'apto' else 'alertas' end
                             from cuestionario_autoexclusion q where q.donanteid = d.donanteid order by q.creado desc limit 1),
          'contactoPendiente', private.contacto_pendiente(d.donanteid)
        ))
      )) order by c.fecha_hora_cita)
      from cita c
      join sede s on s.sedeid = c.sedeid
      join donante d on d.donanteid = c.donanteid
      join usuario u on u.usuarioid = d.usuarioid
      where (v_ver = 0 or c.sedeid = v_ver)
        and (c.fecha_hora_cita at time zone 'America/Caracas')::date between v_hoy - 7 and v_hoy + greatest(coalesce(p_dias, 14), 0)
    ), '[]'));
end $$;

revoke all on function public.blud_bandeja_citas(int, int) from public, anon;
grant execute on function public.blud_bandeja_citas(int, int) to authenticated;
