-- BLUD · Transfusión: solicitud del operador, aprobación del director, tipaje del paciente y pruebas cruzadas.
-- Se aplica después de 20261116120000_blud_evaluacion_extraccion.sql. Se puede repetir.
--
--   Decisión: la solicitud de transfusión la registra el OPERADOR y la aprueba el DIRECTOR (ya no la crea la dirección).
--   RF-TR2  el laboratorio registra la muestra del paciente: grupo ABO, Rh, Du, prueba directa e inversa, anticuerpos.
--   RF-TR3  el laboratorio registra la prueba cruzada de cada unidad reservada: Coombs directo e indirecto,
--           prueba mayor y menor (0 = sin aglutinación … 4), con fecha, hora y analista.
--   RF-TR4  la reserva queda vinculada al paciente (unidades de la solicitud con su resultado de compatibilidad).
--   RF-TR7  una prueba incompatible queda marcada y bloquea el despacho; se avisa en la solicitud.
--   Despacho: solo con tipaje conforme y, para hematíes y sangre total, prueba cruzada compatible en cada unidad.

-- ============================================================ Solicitud: la crea el operador
create or replace function private.g_pedido(p jsonb) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare
  v_sid int;
  v_estado text;
  v_meta text := p ->> 'estado';
  v_cli jsonb := coalesce(p -> 'clinica', '{}');
  v_consent boolean := coalesce(p -> 'clinica' ->> 'consentimiento', '') = 'si';
  v_nombre text := regexp_replace(trim(coalesce(p ->> 'pacienteNombre', '')), '\s+', ' ', 'g');
  v_nombres text := split_part(v_nombre, ' ', 1);
  v_apellidos text := trim(substr(v_nombre, length(v_nombres) + 1));
  v_indicacion text := coalesce(nullif(trim(p ->> 'diagnostico'), ''), nullif(trim(p ->> 'servicio'), ''));
  v_comp smallint := private.comp_id(p ->> 'tipoHemocomponente');
  v_falta text;
begin
  if p ->> 'id' ~ '^REQ-\d+$' then v_sid := substring(p ->> 'id' from '\d+')::int; end if;
  select estado into v_estado from solicitudtransfusion where solicitudid = v_sid for update;

  if v_estado is null then
    -- La registra el operador (con la orden médica); la dirección solo aprueba o rechaza.
    if public.mi_rol() is distinct from 'operador' then
      raise exception 'Las solicitudes de transfusión las registra el operador; la dirección las aprueba.' using errcode = '42501';
    end if;
    if v_comp is null then raise exception 'La sangre total no se despacha: elige un hemocomponente.'; end if;
    if v_apellidos = '' then raise exception 'Escribe nombre y apellido del paciente.'; end if;
    if not v_consent then raise exception 'Falta el consentimiento informado firmado del paciente.'; end if;
    perform private.crear_solicitud(
      jsonb_build_object(
        'cedula', p ->> 'pacienteCedula', 'nombres', v_nombres, 'apellidos', v_apellidos,
        'servicio_area', p ->> 'servicio', 'diagnostico', p ->> 'diagnostico',
        'hb_g_dl', private.num(v_cli ->> 'Hb'), 'hcto_porcentaje', private.num(v_cli ->> 'Hcto'),
        'plaquetas_conteo', private.num(v_cli ->> 'Plaquetas'), 'tp_segundos', private.num(v_cli ->> 'TP'),
        'tpp_segundos', private.num(v_cli ->> 'TPT')),
      p ->> 'tipoSangre',
      jsonb_build_array(jsonb_build_object('componente', v_comp, 'unidades', (p ->> 'unidades')::int)),
      private.urgencia(p ->> 'prioridad'), v_indicacion, false, v_consent, null);
    return jsonb_build_object('aviso', 'Solicitud registrada: queda pendiente de aprobación de la dirección.');
  end if;

  if v_estado = 'Pendiente' then
    if v_meta = 'aprobado' then
      perform public.reservar_unidades(v_sid);
    elsif v_meta = 'rechazado' then
      perform public.rechazar_solicitud(v_sid, p ->> 'motivoRechazo');
    elsif v_meta = 'pendiente' then
      -- Corrección antes de aprobar (dirección).
      perform public._exigir_rol(array['director']);
      if v_comp is null then raise exception 'La sangre total no se despacha: elige un hemocomponente.'; end if;
      update solicitudtransfusion set
        componenteid = v_comp,
        tiposangreid = coalesce(private.ts_id(p ->> 'tipoSangre'), tiposangreid),
        cantidadunidades = (p ->> 'unidades')::smallint,
        urgencia = private.urgencia(p ->> 'prioridad'),
        indicacion_clinica = coalesce(v_indicacion, indicacion_clinica),
        consentimiento_informado_firmado = consentimiento_informado_firmado or v_consent
      where solicitudid = v_sid;
      update paciente set
        nombres = coalesce(nullif(v_nombres, ''), nombres),
        apellidos = coalesce(nullif(v_apellidos, ''), apellidos),
        servicio_area = coalesce(p ->> 'servicio', servicio_area),
        diagnostico = coalesce(p ->> 'diagnostico', diagnostico)
      where pacienteid = (select pacienteid from solicitudtransfusion where solicitudid = v_sid);
    end if;
  elsif v_estado = 'Aprobada' and v_meta = 'despachado' then
    v_falta := private.falta_para_despachar(v_sid);
    if v_falta is not null then raise exception '%', v_falta; end if;
    perform private.despachar(v_sid);
  end if;
  return '{}';
end $$;

-- ============================================================ Compatibilidad
-- ¿El componente necesita prueba cruzada? Hematíes y sangre total, sí; plasma, plaquetas y crio, no.
create or replace function private.requiere_cruzada(p_comp text) returns boolean
language sql immutable set search_path = '' as $$
  select p_comp ilike '%hemat%' or p_comp ilike '%sangre total%'
$$;

-- Qué falta para despachar una solicitud aprobada (null = lista).
create or replace function private.falta_para_despachar(p_sid int) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_comp text;
  t record;
  u record;
  c record;
begin
  select hc.tipo::text into v_comp from solicitudtransfusion st join hemocomponente hc on hc.componenteid = st.componenteid
  where st.solicitudid = p_sid;
  select * into t from prueba_tipaje_muestra where solicitud_id = p_sid order by tipaje_id desc limit 1;
  if not found then return 'Falta el tipaje de la muestra del paciente (laboratorio).'; end if;
  if not t.muestra_conforme then return 'La muestra del paciente fue rechazada: el laboratorio necesita una nueva.'; end if;
  if not private.requiere_cruzada(v_comp) then return null; end if;
  for u in select o_unidad_id from public.unidades_de_solicitud(p_sid) loop
    select * into c from prueba_cruzada where solicitud_id = p_sid and unidad_id = u.o_unidad_id order by prueba_cruzada_id desc limit 1;
    if not found then return 'Faltan pruebas cruzadas de una o más unidades (laboratorio).'; end if;
    if c.resultado <> 'Compatible' then return 'Hay una unidad incompatible: el laboratorio debe cambiarla antes del despacho.'; end if;
  end loop;
  return null;
end $$;

-- Lista para laboratorio, operador y dirección: solicitudes aprobadas o despachadas con su compatibilidad.
create or replace function public.blud_transfusiones() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._exigir_rol(array['laboratorio', 'operador', 'director']);
  return coalesce((
    select jsonb_agg(x order by (x ->> 'estado') = 'despachado', x ->> 'prioridadOrden', x ->> 'fecha' desc)
    from (
      select jsonb_strip_nulls(jsonb_build_object(
        'id', 'REQ-' || lpad(st.solicitudid::text, 6, '0'),
        'estado', case st.estado when 'Despachada' then 'despachado' else 'aprobado' end,
        'prioridad', case st.urgencia when 'Emergencia' then 'critica' when 'Urgente' then 'urgente' else 'normal' end,
        'prioridadOrden', case st.urgencia when 'Emergencia' then 0 when 'Urgente' then 1 else 2 end,
        'fecha', private.dia(st.fechasolicitud),
        'paciente', jsonb_build_object('nombre', trim(pa.nombres || ' ' || pa.apellidos), 'cedula', pa.cedula,
                                       'servicio', pa.servicio_area, 'historia', pa.numero_historia),
        'componente', private.comp_front(hc.tipo::text),
        'requiereCruzada', private.requiere_cruzada(hc.tipo::text),
        'tipoSolicitado', private.ts_txt(st.tiposangreid),
        'unidadesSolicitadas', st.cantidadunidades,
        'consentimiento', st.consentimiento_informado_firmado,
        'tipaje', (select jsonb_build_object('fecha', t.fecha_analisis, 'tubo', t.codigo_tubo_muestra, 'conforme', t.muestra_conforme,
                     'motivoRechazo', t.motivo_rechazo_muestra, 'abo', t.grupo_abo_determinado, 'rh', t.factor_rh_determinado,
                     'du', t.prueba_du_variante_rh, 'directa', t.prueba_directa_celular, 'inversa', t.prueba_inversa_serica,
                     'anticuerpos', t.rastreo_anticuerpos_irregulares, 'observaciones', t.observaciones)
                   from prueba_tipaje_muestra t where t.solicitud_id = st.solicitudid order by t.tipaje_id desc limit 1),
        'unidades', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                       'unidadId', u.o_unidad_id, 'codigo', u.o_codigo, 'componente', private.comp_front(u.o_componente),
                       'tipo', u.o_tipo_sangre, 'vence', private.dia(u.o_vence), 'estado', u.o_estado,
                       'cruzada', (select jsonb_build_object('resultado', c.resultado, 'mayor', c.prueba_mayor, 'menor', c.prueba_menor,
                                     'coombsDirecto', c.coombs_directo, 'coombsIndirecto', c.coombs_indirecto,
                                     'fecha', c.fecha_prueba, 'detalle', c.resultado_final)
                                   from prueba_cruzada c where c.solicitud_id = st.solicitudid and c.unidad_id = u.o_unidad_id
                                   order by c.prueba_cruzada_id desc limit 1)))), '[]')
                     from public.unidades_de_solicitud(st.solicitudid) u),
        'faltaParaDespachar', case when st.estado = 'Aprobada' then private.falta_para_despachar(st.solicitudid) end
      )) x
      from solicitudtransfusion st
      join paciente pa on pa.pacienteid = st.pacienteid
      join hemocomponente hc on hc.componenteid = st.componenteid
      where st.estado in ('Aprobada', 'Despachada') and st.fechasolicitud > now() - interval '60 days'
    ) q
  ), '[]');
end $$;

-- RF-TR2: tipaje de la muestra del paciente.
create or replace function public.blud_registrar_tipaje(p_solicitud text, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sid int := nullif(substring(coalesce(p_solicitud, '') from '(\d+)$'), '')::int;
  v_conforme boolean := coalesce((p ->> 'conforme')::boolean, true);
begin
  perform public._exigir_rol(array['laboratorio']);
  if v_sid is null or not exists (select 1 from solicitudtransfusion where solicitudid = v_sid and estado = 'Aprobada') then
    raise exception 'Esa solicitud no está aprobada o ya se despachó.';
  end if;
  if coalesce(trim(p ->> 'tubo'), '') = '' then raise exception 'Escribe el código del tubo de la muestra.'; end if;
  if not v_conforme and coalesce(trim(p ->> 'motivoRechazo'), '') = '' then raise exception 'Escribe por qué se rechaza la muestra.'; end if;
  if v_conforme and (p ->> 'abo' not in ('A', 'B', 'AB', 'O') or p ->> 'rh' not in ('+', '-')) then
    raise exception 'Indica el grupo ABO y el Rh determinados.';
  end if;
  insert into prueba_tipaje_muestra (solicitud_id, codigo_tubo_muestra, muestra_conforme, motivo_rechazo_muestra,
    prueba_directa_celular, prueba_inversa_serica, grupo_abo_determinado, factor_rh_determinado, prueba_du_variante_rh,
    rastreo_anticuerpos_irregulares, analista_id, observaciones)
  values (v_sid, left(trim(p ->> 'tubo'), 40), v_conforme, nullif(trim(p ->> 'motivoRechazo'), ''),
    nullif(p ->> 'directa', ''), nullif(p ->> 'inversa', ''),
    case when v_conforme then (p ->> 'abo')::enum_grupo_abo end, case when v_conforme then (p ->> 'rh')::enum_factor_rh end,
    nullif(p ->> 'du', ''), case when p ->> 'anticuerpos' in ('Negativo', 'Positivo') then (p ->> 'anticuerpos')::enum_rastreo_anticuerpos end,
    public._personal_id(), nullif(trim(p ->> 'observaciones'), ''));
end $$;

-- RF-TR3: prueba cruzada de una unidad reservada. Compatible solo si mayor y menor son 0 y el Coombs indirecto es negativo.
create or replace function public.blud_registrar_cruzada(p_solicitud text, p_unidad int, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_sid int := nullif(substring(coalesce(p_solicitud, '') from '(\d+)$'), '')::int;
  v_mayor int := (p ->> 'mayor')::int;
  v_menor int := (p ->> 'menor')::int;
  v_ci text := p ->> 'coombsIndirecto';
  v_cd text := p ->> 'coombsDirecto';
  v_res text;
  v_t record;
  v_u record;
begin
  perform public._exigir_rol(array['laboratorio']);
  if v_sid is null or not exists (select 1 from solicitudtransfusion where solicitudid = v_sid and estado = 'Aprobada') then
    raise exception 'Esa solicitud no está aprobada o ya se despachó.';
  end if;
  if not exists (select 1 from public.unidades_de_solicitud(v_sid) where o_unidad_id = p_unidad) then
    raise exception 'Esa unidad no está reservada para esta solicitud.';
  end if;
  select * into v_t from prueba_tipaje_muestra where solicitud_id = v_sid order by tipaje_id desc limit 1;
  if not found or not v_t.muestra_conforme then raise exception 'Registra primero el tipaje de una muestra conforme del paciente.'; end if;
  if v_mayor is null or v_menor is null or v_mayor not between 0 and 4 or v_menor not between 0 and 4 then
    raise exception 'La prueba mayor y la menor se registran de 0 (sin aglutinación) a 4.';
  end if;
  if v_ci not in ('Negativo', 'Positivo') or v_cd not in ('Negativo', 'Positivo') then raise exception 'Indica el resultado de los Coombs.'; end if;
  v_res := case when v_mayor = 0 and v_menor = 0 and v_ci = 'Negativo' then 'Compatible' else 'Incompatible' end;
  insert into prueba_cruzada (solicitud_id, unidad_id, coombs_directo, coombs_indirecto, resultado, laboratista_id,
    prueba_mayor, prueba_menor, resultado_final)
  values (v_sid, p_unidad, v_cd, v_ci, v_res, public._personal_id(), v_mayor, v_menor,
    v_res || coalesce('. ' || nullif(trim(p ->> 'observaciones'), ''), ''));
  -- RF-TR7: una incompatibilidad queda en la bitácora para el médico tratante y la dirección.
  if v_res = 'Incompatible' then
    insert into bitacora_auditoria (tabla_afectada, registro_id, operacion, usuario_id, sede_id, valores_nuevos)
    values ('solicitudtransfusion', v_sid, 'INCOMPATIBLE', public._uid(), public._sede_id(), jsonb_build_object('unidad_id', p_unidad));
  end if;
  return jsonb_build_object('resultado', v_res);
end $$;

-- Si una unidad salió incompatible, el laboratorio la libera y reserva otra compatible del stock.
create or replace function public.blud_cambiar_unidad(p_solicitud text, p_unidad int) returns jsonb
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

revoke all on function private.requiere_cruzada(text), private.falta_para_despachar(int) from public, anon, authenticated;
revoke all on function public.blud_transfusiones(), public.blud_registrar_tipaje(text, jsonb),
  public.blud_registrar_cruzada(text, int, jsonb), public.blud_cambiar_unidad(text, int) from public, anon;
grant execute on function public.blud_transfusiones(), public.blud_registrar_tipaje(text, jsonb),
  public.blud_registrar_cruzada(text, int, jsonb), public.blud_cambiar_unidad(text, int) to authenticated;
