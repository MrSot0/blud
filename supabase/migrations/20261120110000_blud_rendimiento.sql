-- BLUD · Rendimiento: índices, políticas RLS sin reevaluar auth por fila, caché acotada y consulta paginada.
-- Se puede repetir. Aplicada en la base como dos migraciones: blud_rendimiento (secciones 1–3) y blud_rendimiento_pagina (4).
--
--   Medición previa (1000 donantes y 2000 donaciones de prueba, en transacción revertida):
--     blud_panel del personal ≈ 400–500 ms y ≈ 1 MB por rol, que el navegador guarda entero en localStorage
--     (límite ≈ 5 MB). mi_rol()/_uid() buscaban lower(correo) sin índice: recorrido completo de usuario en cada RPC.
--
--   1. Índices para las claves foráneas y los filtros que usan blud_panel, las bandejas y los triggers.
--   2. Políticas de usuario/donante/personalsalud con (select auth.jwt()) — se evalúa una vez por consulta.
--   3. blud_panel trae al navegador solo lo reciente (private.ventana_cache(), 365 días) y lo pendiente:
--      donantes recientes o con actividad, donaciones/pruebas/fraccionamientos del último año, positivos sin
--      notificar, tickets abiertos o tocados en 90 días. El donante sigue recibiendo todo lo suyo.
--      NO se toca la sección de solicitudes/entregas (blud-db-pedidos, blud-db-entregas).
--   4. blud_pagina(): lo anterior a la ventana, y cualquier lista larga, se pide por páginas (cursor por fecha + id).

-- ============================================================ 1. Índices
create index if not exists idx_usuario_correo_lower on public.usuario (lower(correo));
create index if not exists idx_usuario_sederegistro on public.usuario (sederegistroid);
create index if not exists idx_usuario_fecharegistro on public.usuario (fecharegistro desc);
-- Duplicados de restricciones únicas (cedula, correo, din_codigo): solo encarecen las escrituras.
drop index if exists public.idx_usuario_cedula;
drop index if exists public.idx_usuario_correo;
drop index if exists public.idx_donacion_din;

create index if not exists idx_donante_tipo_sangre on public.donante (tipo_sangre);
create index if not exists idx_donante_verificado_por on public.donante (verificado_por);
create index if not exists idx_donante_verificado_en on public.donante (verificado_en desc);

create index if not exists idx_donacion_donante on public.donacion (donanteid, fechadonacion desc);
create index if not exists idx_donacion_personal on public.donacion (personalid);
create index if not exists idx_donacion_sede on public.donacion (sedeid);
create index if not exists idx_donacion_fecha on public.donacion (fechadonacion desc, donacionid desc);

create index if not exists idx_evaluacion_donante on public.evaluacion_donante (donante_id, evaluacion_id desc);
create index if not exists idx_evaluacion_personal on public.evaluacion_donante (personal_salud_id);

create index if not exists idx_prueba_serologica_donacion_fecha on public.prueba_serologica (donacion_id, fecha_analisis desc, prueba_id desc);
create index if not exists idx_prueba_serologica_fecha on public.prueba_serologica (fecha_analisis desc, prueba_id desc);
create index if not exists idx_prueba_serologica_analista on public.prueba_serologica (analista_id);

create index if not exists idx_fraccionamiento_fecha on public.fraccionamiento (fecha_hora_fraccionamiento desc, fraccionamiento_id desc);
create index if not exists idx_fraccionamiento_analista on public.fraccionamiento (analista_id);

create index if not exists idx_unidadsangre_donacion on public.unidadsangre (donacionid);
create index if not exists idx_unidadsangre_componente on public.unidadsangre (componenteid);
create index if not exists idx_unidadsangre_sede on public.unidadsangre (sedeid, estado);
create index if not exists idx_unidadsangre_tipo on public.unidadsangre (tiposangreid);

create index if not exists idx_auditoria_sede on public.bitacora_auditoria (sede_id);
create index if not exists idx_auditoria_tabla_operacion on public.bitacora_auditoria (tabla_afectada, operacion, registro_id);

create index if not exists idx_cita_sede_fecha on public.cita (sedeid, fecha_hora_cita);
create index if not exists idx_chat_mensaje_autor on public.chat_mensaje (autor_usuarioid);
create index if not exists idx_chat_conversacion_creada_por on public.chat_conversacion (creada_por);

create index if not exists idx_ticket_actualizado on public.ticket_soporte (actualizado desc, ticket_id desc);
create index if not exists idx_ticket_estado on public.ticket_soporte (estado);

create index if not exists idx_paciente_sede on public.paciente (sedeid);
create index if not exists idx_personalsalud_sede on public.personalsalud (sedeid);
create index if not exists idx_hemo_paciente on public.hemo_vigilancia (paciente_id);
create index if not exists idx_hemo_solicitud on public.hemo_vigilancia (solicitud_id);
create index if not exists idx_hemo_unidad on public.hemo_vigilancia (unidad_id);
create index if not exists idx_hemo_medico on public.hemo_vigilancia (medico_responsable_id);
create index if not exists idx_cruzada_solicitud_unidad on public.prueba_cruzada (solicitud_id, unidad_id, prueba_cruzada_id desc);
create index if not exists idx_cruzada_unidad on public.prueba_cruzada (unidad_id);
create index if not exists idx_cruzada_laboratista on public.prueba_cruzada (laboratista_id);
create index if not exists idx_tipaje_solicitud on public.prueba_tipaje_muestra (solicitud_id, tipaje_id desc);
create index if not exists idx_tipaje_analista on public.prueba_tipaje_muestra (analista_id);
create index if not exists idx_solicitud_componente on public.solicitudtransfusion (componenteid);
create index if not exists idx_solicitud_paciente on public.solicitudtransfusion (pacienteid);
create index if not exists idx_solicitud_sede on public.solicitudtransfusion (sedesolicitanteid);
create index if not exists idx_solicitud_tipo on public.solicitudtransfusion (tiposangreid);
create index if not exists idx_solicitud_medico on public.solicitudtransfusion (medico_solicitante_id);
create index if not exists idx_solicitud_fecha on public.solicitudtransfusion (fechasolicitud desc);

-- ============================================================ 2. RLS: auth una vez por consulta
alter policy usuario_leer_propio on public.usuario
  using (lower(correo::text) = lower((select auth.jwt()) ->> 'email'));
alter policy usuario_editar_propio on public.usuario
  using (lower(correo::text) = lower((select auth.jwt()) ->> 'email'))
  with check (lower(correo::text) = lower((select auth.jwt()) ->> 'email'));
alter policy usuario_registro_donante on public.usuario
  with check (lower(correo::text) = lower((select auth.jwt()) ->> 'email') and rol = 'Donante'::enum_rol_usuario and activo = true);
alter policy donante_leer_propio on public.donante
  using (usuarioid in (select usuarioid from public.usuario where lower(correo::text) = lower((select auth.jwt()) ->> 'email')));
alter policy donante_crear_propio on public.donante
  with check (usuarioid in (select usuarioid from public.usuario where lower(correo::text) = lower((select auth.jwt()) ->> 'email')));
alter policy personalsalud_leer_propio on public.personalsalud
  using (usuarioid in (select usuarioid from public.usuario where lower(correo::text) = lower((select auth.jwt()) ->> 'email')));

-- ============================================================ 3. Caché acotada en blud_panel
-- Cuánta historia baja al navegador. Lo anterior se consulta con blud_pagina().
create or replace function private.ventana_cache() returns interval
language sql immutable set search_path = '' as $$ select interval '365 days' $$;

-- Parche por reemplazo de fragmentos (sin reescribir la función): otros cambios a blud_panel se conservan.
do $$
declare
  d text := pg_get_functiondef('public.blud_panel'::regproc);
  cambios text[][] := array[
    -- Donantes del personal: recientes, con actividad o con cita próxima (el resto, por búsqueda/paginación).
    array['where v_staff or d.donanteid = v_don), ''[]''));',
          'where (not v_staff and d.donanteid = v_don) or (v_staff and (u.fecharegistro > now() - private.ventana_cache() or d.verificado_en > now() - private.ventana_cache() or exists (select 1 from donacion x where x.donanteid = d.donanteid and x.fechadonacion > now() - private.ventana_cache()) or exists (select 1 from cita c where c.donanteid = d.donanteid and c.fecha_hora_cita > now() - interval ''7 days'' and c.estado in (''Programada'', ''En espera''))))), ''[]''));'],
    -- Donaciones del personal: último año. El donante recibe todas las suyas.
    array['where x.din_codigo is not null and (v_staff or x.donanteid = v_don)), ''[]''));',
          'where x.din_codigo is not null and (v_staff or x.donanteid = v_don) and (not v_staff or x.fechadonacion > now() - private.ventana_cache())), ''[]''));'],
    -- Pruebas del laboratorio: último año.
    array['join donante d on d.donanteid = x.donanteid), ''[]''));',
          'join donante d on d.donanteid = x.donanteid where ps.fecha_analisis > now() - private.ventana_cache()), ''[]''));'],
    -- Casos positivos: los pendientes siempre; los notificados, del último año.
    array['where m.v = ''Positivo''), ''[]''));',
          'where m.v = ''Positivo'' and (nt.id is null or ps.fecha_analisis > now() - private.ventana_cache())), ''[]''));'],
    -- Fraccionamientos: último año.
    array['from fraccionamiento f join donacion x on x.donacionid = f.donacion_id), ''[]''));',
          'from fraccionamiento f join donacion x on x.donacionid = f.donacion_id where f.fecha_hora_fraccionamiento > now() - private.ventana_cache()), ''[]''));'],
    -- Tickets de soporte/dirección: abiertos o con movimiento en 90 días. El donante, todos los suyos.
    array['where v_rol in (''soporte'', ''director'') or lower(t.dueno_correo) = v_email), ''[]''));',
          'where (v_rol in (''soporte'', ''director'') and (t.estado <> ''resuelto'' or t.actualizado > now() - interval ''90 days'')) or lower(t.dueno_correo) = v_email), ''[]''));'],
    array['from ticket_nota n), ''[]''));',
          'from ticket_nota n where exists (select 1 from ticket_soporte t where t.ticket_id = n.ticket_id and (t.estado <> ''resuelto'' or t.actualizado > now() - interval ''90 days''))), ''[]''));']
  ];
  i int;
  aplicados int := 0;
begin
  for i in 1 .. array_length(cambios, 1) loop
    if position(cambios[i][1] in d) > 0 then
      d := replace(d, cambios[i][1], cambios[i][2]);
      aplicados := aplicados + 1;
    elsif position(cambios[i][2] in d) = 0 then
      raise notice 'blud_panel: no se encontró el fragmento %', left(cambios[i][1], 60);
    end if;
  end loop;
  if aplicados > 0 then execute d; end if;
  raise notice 'blud_panel: % fragmentos acotados', aplicados;
end $$;

-- ============================================================ 4. Consulta paginada
-- blud_pagina(coleccion, q, filtros, limite, cursor) → { items, siguiente, total }
--   coleccion: donaciones · donantes · pruebas · fracciones · tickets
--   filtros:   { "antesDe": "YYYY-MM-DD" }      solo registros anteriores a esa fecha (lo que no está en caché)
--              { "operadorId": "correo" }        registrados/verificados por esa persona (Mis donantes, historial)
--              { "estado": "..." }              tickets por estado
--   cursor:    el «siguiente» de la página anterior (fecha ISO|id). Orden: más reciente primero.
-- Cada ítem tiene la misma forma que en blud_panel, así la interfaz los pinta igual.
create or replace function public.blud_pagina(
  p_coleccion text, p_q text default null, p_filtros jsonb default '{}', p_limite int default 25, p_cursor text default null
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_rol text := private.rol_actual();
  v_email text := lower(auth.jwt() ->> 'email');
  v_don int := public._donante_id();
  v_staff boolean;
  v_lab boolean;
  v_lim int := least(greatest(coalesce(p_limite, 25), 1), 100);
  v_q text := nullif(lower(trim(coalesce(p_q, ''))), '');
  v_qd text := nullif(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '');
  v_antes timestamptz := (nullif(p_filtros ->> 'antesDe', ''))::date::timestamptz;
  v_oper text := nullif(lower(p_filtros ->> 'operadorId'), '');
  v_estado text := nullif(p_filtros ->> 'estado', '');
  v_cf timestamptz;
  v_ci bigint;
  v_items jsonb;
  v_total bigint;
  v_ult text;
begin
  if v_email is null then raise exception 'Inicia sesión de nuevo.' using errcode = '42501'; end if;
  if v_rol is null then raise exception 'Tu cuenta está desactivada.' using errcode = '42501'; end if;
  v_staff := v_rol in ('operador', 'laboratorio', 'soporte', 'director');
  v_lab := v_rol = 'laboratorio';
  if p_cursor ~ '^[^|]+\|\d+$' then
    v_cf := split_part(p_cursor, '|', 1)::timestamptz;
    v_ci := split_part(p_cursor, '|', 2)::bigint;
  end if;

  if p_coleccion = 'donaciones' then
    with base as (
      select x.*, u.nombres, u.apellidos, u.cedula, d.tipo_sangre
      from donacion x join donante d on d.donanteid = x.donanteid join usuario u on u.usuarioid = d.usuarioid
      where x.din_codigo is not null and (v_staff or x.donanteid = v_don)
        and (v_antes is null or x.fechadonacion < v_antes)
        and (v_oper is null or private.correo_personal(x.personalid) = v_oper)
        and (v_q is null or lower(u.nombres || ' ' || u.apellidos) like '%' || v_q || '%' or lower(x.din_codigo) like '%' || v_q || '%'
             or (v_qd is not null and length(v_qd) >= 4 and regexp_replace(u.cedula, '\D', '', 'g') like '%' || v_qd || '%'))
    ), pagina as (
      select * from base where v_cf is null or (fechadonacion, donacionid) < (v_cf, v_ci)
      order by fechadonacion desc, donacionid desc limit v_lim
    )
    select (select count(*) from base),
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', p.din_codigo, 'donanteId', 'BLD-' || lpad(p.donanteid::text, 6, '0'),
             'donanteNombre', trim(p.nombres || ' ' || p.apellidos), 'donanteCedula', private.cedula(p.cedula),
             'tipoSangre', private.ts_txt(p.tipo_sangre),
             'tipoHemocomponente', case when p.tipo_donacion = 'Aferesis' then 'Plaquetas' else 'Sangre Total' end,
             'volumenMl', p.volumenml, 'fecha', private.dia(p.fechadonacion), 'operadorId', private.correo_personal(p.personalid),
             'centroNombre', (select nombre from sede where sedeid = p.sedeid), 'dinIsbt', private.din_legible(p.din_isbt),
             'tipoDonacion', case when v_staff then p.tipo_donacion::text end,
             'estadoLab', case when not v_staff then null
               when not p.apta or sero.g = 'Positivo' then 'descartada' when sero.g = 'Negativo' then 'liberada' else 'pendiente' end
           )) order by p.fechadonacion desc, p.donacionid desc), '[]'),
           (select fechadonacion::text || '|' || donacionid from pagina order by fechadonacion, donacionid limit 1)
      into v_total, v_items, v_ult
    from pagina p
    left join lateral (select resultado_global g from prueba_serologica where donacion_id = p.donacionid
                       order by fecha_analisis desc, prueba_id desc limit 1) sero on true;

  elsif p_coleccion = 'donantes' then
    if not v_staff then raise exception 'No tienes permiso para realizar esta acción.' using errcode = '42501'; end if;
    with base as (
      select d.*, u.nombres, u.apellidos, u.cedula, u.telefono, u.correo, u.fechanacimiento, u.sexo, u.fecharegistro,
             coalesce(d.verificado_en, u.fecharegistro) orden
      from donante d join usuario u on u.usuarioid = d.usuarioid
      where (v_antes is null or coalesce(d.verificado_en, u.fecharegistro) < v_antes)
        and (v_oper is null or private.correo_personal(d.verificado_por) = v_oper)
        and (v_q is null or lower(u.nombres || ' ' || u.apellidos) like '%' || v_q || '%'
             or ('bld-' || lpad(d.donanteid::text, 6, '0')) = v_q
             or (v_qd is not null and length(v_qd) >= 4 and regexp_replace(u.cedula, '\D', '', 'g') like '%' || v_qd || '%'))
    ), pagina as (
      select * from base where v_cf is null or (orden, donanteid) < (v_cf, v_ci)
      order by orden desc, donanteid desc limit v_lim
    )
    select (select count(*) from base),
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', 'BLD-' || lpad(p.donanteid::text, 6, '0'), 'cedula', private.cedula(p.cedula),
             'nombreCompleto', trim(p.nombres || ' ' || p.apellidos), 'sangre', private.ts_txt(p.tipo_sangre),
             'telefono', nullif(p.telefono, ''), 'email', case when p.correo not like '%@presencial.blud' then lower(p.correo) end,
             'nacimiento', p.fechanacimiento, 'sexo', p.sexo, 'fechaRegistro', private.dia(p.fecharegistro),
             'estado', case when p.verificado_en is not null or exists (select 1 from donacion x where x.donanteid = p.donanteid)
               then 'verificado' else 'preregistrado' end,
             'origen', case when p.correo like '%@presencial.blud' then 'operador' else 'app' end,
             'operadorId', private.correo_personal(p.verificado_por), 'fechaVerificacion', private.dia(p.verificado_en)
           )) order by p.orden desc, p.donanteid desc), '[]'),
           (select orden::text || '|' || donanteid from pagina order by orden, donanteid limit 1)
      into v_total, v_items, v_ult
    from pagina p;

  elsif p_coleccion = 'pruebas' then
    if v_rol not in ('laboratorio', 'director') then raise exception 'No tienes permiso para realizar esta acción.' using errcode = '42501'; end if;
    with base as (
      select ps.*, x.din_codigo, d.tipo_sangre
      from prueba_serologica ps join donacion x on x.donacionid = ps.donacion_id join donante d on d.donanteid = x.donanteid
      where (v_antes is null or ps.fecha_analisis < v_antes)
        and (v_oper is null or private.correo_personal(ps.analista_id) = v_oper)
        and (v_q is null or lower(x.din_codigo) like '%' || v_q || '%')
    ), pagina as (
      select * from base where v_cf is null or (fecha_analisis, prueba_id) < (v_cf, v_ci)
      order by fecha_analisis desc, prueba_id desc limit v_lim
    )
    select (select count(*) from base),
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', 'PS-' || p.prueba_id, 'donacionId', p.din_codigo, 'codigo', p.din_codigo, 'fecha', private.dia(p.fecha_analisis),
             'resultados', case when v_lab then jsonb_strip_nulls(jsonb_build_object(
               'vih', private.res_front(p.vih_1_2), 'hbsag', private.res_front(p.hepatitis_b_hbsag),
               'hbcore', private.res_front(p.hepatitis_b_antihbc), 'hcv', private.res_front(p.hepatitis_c_antihcv),
               'sifilis', private.res_front(p.sifilis_vdrl), 'chagas', private.res_front(p.chagas),
               'htlv', private.res_front(p.htlv_i_ii))) else '{}'::jsonb end,
             'resultadoGlobal', lower(p.resultado_global), 'tipoSangreConfirmado', private.ts_txt(p.tipo_sangre),
             'laboratoristaId', private.correo_personal(p.analista_id)
           )) order by p.fecha_analisis desc, p.prueba_id desc), '[]'),
           (select fecha_analisis::text || '|' || prueba_id from pagina order by fecha_analisis, prueba_id limit 1)
      into v_total, v_items, v_ult
    from pagina p;

  elsif p_coleccion = 'fracciones' then
    if v_rol not in ('laboratorio', 'operador', 'director') then raise exception 'No tienes permiso para realizar esta acción.' using errcode = '42501'; end if;
    with base as (
      select f.*, x.din_codigo
      from fraccionamiento f join donacion x on x.donacionid = f.donacion_id
      where (v_antes is null or f.fecha_hora_fraccionamiento < v_antes)
        and (v_q is null or lower(x.din_codigo) like '%' || v_q || '%')
    ), pagina as (
      select * from base where v_cf is null or (fecha_hora_fraccionamiento, fraccionamiento_id) < (v_cf, v_ci)
      order by fecha_hora_fraccionamiento desc, fraccionamiento_id desc limit v_lim
    )
    select (select count(*) from base),
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', 'FR-' || p.fraccionamiento_id, 'donacionId', p.din_codigo, 'codigo', p.din_codigo,
             'fecha', private.dia(p.fecha_hora_fraccionamiento),
             'productos', (select coalesce(jsonb_agg(jsonb_build_object('componente', private.comp_front(hc.tipo::text), 'unidades', g.n, 'volumenMl', 0)), '[]')
                           from (select componenteid, count(*) n from unidadsangre where fraccionamiento_id = p.fraccionamiento_id group by componenteid) g
                           join hemocomponente hc on hc.componenteid = g.componenteid),
             'observaciones', p.observaciones, 'laboratoristaId', private.correo_personal(p.analista_id)
           )) order by p.fecha_hora_fraccionamiento desc, p.fraccionamiento_id desc), '[]'),
           (select fecha_hora_fraccionamiento::text || '|' || fraccionamiento_id from pagina order by fecha_hora_fraccionamiento, fraccionamiento_id limit 1)
      into v_total, v_items, v_ult
    from pagina p;

  elsif p_coleccion = 'tickets' then
    with base as (
      select t.*, row_number() over (order by t.actualizado, t.ticket_id) rn
      from ticket_soporte t
      where (v_rol in ('soporte', 'director') or lower(t.dueno_correo) = v_email)
        and (v_antes is null or t.actualizado < v_antes)
        and (v_estado is null or t.estado = v_estado)
        and (v_q is null or lower(t.asunto) like '%' || v_q || '%' or lower(t.codigo) like '%' || v_q || '%'
             or lower(coalesce(t.donante_nombre, '')) like '%' || v_q || '%' or lower(t.dueno_correo) like '%' || v_q || '%')
    ), pagina as (
      select * from base where v_cf is null or (actualizado, rn) < (v_cf, v_ci)
      order by actualizado desc, rn desc limit v_lim
    )
    select (select count(*) from base),
           coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'id', p.ticket_id, 'codigo', p.codigo, 'donanteId', coalesce(p.donante_ref, ''), 'donanteNombre', p.donante_nombre,
             'donanteEmail', p.dueno_correo, 'asunto', p.asunto, 'estado', p.estado, 'prioridad', p.prioridad,
             'creado', p.creado, 'actualizado', p.actualizado, 'asignadoA', p.asignado_a, 'mensajes', p.mensajes, 'resueltoEn', p.resuelto_en
           )) order by p.actualizado desc, p.rn desc), '[]'),
           (select actualizado::text || '|' || rn from pagina order by actualizado, rn limit 1)
      into v_total, v_items, v_ult
    from pagina p;

  else
    raise exception 'Colección desconocida: %', p_coleccion;
  end if;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'siguiente', case when jsonb_array_length(v_items) = v_lim then v_ult end
  );
end $$;

revoke all on function private.ventana_cache() from public, anon, authenticated;
revoke all on function public.blud_pagina(text, text, jsonb, int, text) from public, anon;
grant execute on function public.blud_pagina(text, text, jsonb, int, text) to authenticated;
