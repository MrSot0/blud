-- BLUD · Bandeja de citas del centro para el operador.
-- El donante agenda una cita en un centro; el operador de ese centro la ve en su bandeja, marca la llegada,
-- la atiende (evaluación + extracción) o la marca como ausencia. Se puede repetir.
--
--   Estados de cita: Programada → En espera (llegó) → Atendida | No apto     ·   No asistió   ·   Cancelada (donante)

-- Al guardar una donación o una evaluación no apta, la cita del día de ese donante se cierra sola.
create or replace function private.cerrar_cita_donacion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update cita set estado = 'Atendida'
  where donanteid = new.donanteid and estado in ('Programada', 'En espera')
    and (fecha_hora_cita at time zone 'America/Caracas')::date
        between (new.fechadonacion at time zone 'America/Caracas')::date - 1 and (new.fechadonacion at time zone 'America/Caracas')::date + 1;
  return new;
end $$;

create or replace function private.cerrar_cita_evaluacion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not new.apto_para_donar then
    update cita set estado = 'No apto',
      observaciones = concat_ws(' · ', observaciones, 'Evaluación: ' || coalesce(new.motivo_rechazo, 'no apto'))
    where donanteid = new.donante_id and estado in ('Programada', 'En espera')
      and (fecha_hora_cita at time zone 'America/Caracas')::date
          between (coalesce(new.fecha_evaluacion, now()) at time zone 'America/Caracas')::date - 1
              and (coalesce(new.fecha_evaluacion, now()) at time zone 'America/Caracas')::date + 1;
  end if;
  return new;
end $$;

drop trigger if exists cerrar_cita_donacion on public.donacion;
create trigger cerrar_cita_donacion after insert on public.donacion
  for each row execute function private.cerrar_cita_donacion();
drop trigger if exists cerrar_cita_evaluacion on public.evaluacion_donante;
create trigger cerrar_cita_evaluacion after insert on public.evaluacion_donante
  for each row execute function private.cerrar_cita_evaluacion();

-- Bandeja: citas del centro del operador, desde hace 7 días hasta dentro de p_dias.
create or replace function public.blud_bandeja_citas(p_dias int default 14) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_sede int := public._sede_id();
  v_hoy date := (now() at time zone 'America/Caracas')::date;
begin
  perform public._exigir_rol(array['operador', 'director']);
  if v_sede is null then raise exception 'Tu cuenta no tiene un centro asignado.'; end if;
  return jsonb_build_object(
    'centro', (select nombre from sede where sedeid = v_sede),
    'hoy', v_hoy,
    'citas', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'id', 'CITA-' || c.citaid,
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
      join donante d on d.donanteid = c.donanteid
      join usuario u on u.usuarioid = d.usuarioid
      where c.sedeid = v_sede
        and (c.fecha_hora_cita at time zone 'America/Caracas')::date between v_hoy - 7 and v_hoy + greatest(coalesce(p_dias, 14), 0)
    ), '[]'));
end $$;

-- El operador marca la llegada, la ausencia o deshace la marca. Atendida y No apto las pone el sistema.
create or replace function public.blud_cita_marcar(p_id text, p_estado text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id bigint := nullif(substring(coalesce(p_id, '') from '(\d+)$'), '')::bigint;
  v_actual text;
begin
  perform public._exigir_rol(array['operador']);
  if p_estado not in ('Programada', 'En espera', 'No asistió') then raise exception 'Ese cambio de estado no está permitido.'; end if;
  select estado into v_actual from cita where citaid = v_id and sedeid = public._sede_id() for update;
  if v_actual is null then raise exception 'Esa cita no es de tu centro.'; end if;
  if v_actual not in ('Programada', 'En espera', 'No asistió') then
    raise exception 'La cita ya está cerrada (%).', lower(v_actual);
  end if;
  update cita set estado = p_estado where citaid = v_id;
  insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
  values ('cita', v_id, 'ESTADO', public._uid(), public._sede_id(), jsonb_build_object('de', v_actual, 'a', p_estado));
end $$;

revoke all on function private.cerrar_cita_donacion(), private.cerrar_cita_evaluacion() from public, anon, authenticated;
revoke all on function public.blud_bandeja_citas(int), public.blud_cita_marcar(text, text) from public, anon;
grant execute on function public.blud_bandeja_citas(int), public.blud_cita_marcar(text, text) to authenticated;
