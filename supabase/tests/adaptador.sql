-- Pruebas del adaptador BLUD ↔ Bloodonor. Corre DESPUÉS de la migración y del seed, dentro de la misma transacción,
-- y termina con un error a propósito: así todo se revierte y el mensaje trae los resultados (✔ / ✘).

create function pg_temp.como(p text) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('email', p,
    'sub', coalesce((select id::text from auth.users where email = p), '00000000-0000-4000-8000-000000000000'))::text, true)
$$;
create function pg_temp.din(p_cedula text) returns text language sql as $$
  select x.din_codigo from public.donacion x join public.donante d on d.donanteid = x.donanteid
  join public.usuario u on u.usuarioid = d.usuarioid where u.cedula = p_cedula order by x.donacionid desc limit 1
$$;

do $t$
declare
  r text[] := '{}';
  j jsonb;
  v jsonb;
  n int;
  m int;
  s text;
  ok boolean;
begin
  -- ============================================================ Donante
  perform pg_temp.como('carlos@blud.app');
  begin
    j := public.blud_panel();
    ok := jsonb_array_length(j -> 'blud-db-donantes') = 1 and jsonb_array_length(j -> 'blud-db-donaciones') = 1
      and not (j ? 'blud-db-pedidos') and not (j ? 'blud-db-pruebas') and not (j ? 'blud-db-ticket-notas')
      and not (j ? 'blud-db-unidades') and jsonb_array_length(j -> 'blud-db-tickets') = 2 and jsonb_array_length(j -> 'citas') = 1;
    r := r || (case when ok then '✔' else '✘' end || ' donante: solo su ficha, su donación, sus 2 tickets y su cita; nada del personal');
    r := r || (case when not (j -> 'blud-db-donaciones' -> 0 ? 'estadoLab') and j -> 'blud-db-donantes' -> 0 ? 'userId'
      then '✔' else '✘' end || ' donante: no ve el estado de laboratorio; su ficha trae userId');
    r := r || (case when public.blud_mi_perfil() ->> 'role' = 'donante' then '✔' else '✘' end || ' donante: blud_mi_perfil → donante');
  exception when others then r := r || ('✘ donante panel: ' || sqlerrm); end;

  begin
    perform public.blud_guardar('blud-db-pedidos', '{"id":"x1","pacienteNombre":"A B","tipoSangre":"O+","tipoHemocomponente":"Plaquetas","unidades":1,"estado":"pendiente","diagnostico":"x","clinica":{"consentimiento":"si"}}');
    r := r || text '✘ donante: pudo crear una solicitud';
  exception when others then r := r || ('✔ donante: no crea solicitudes (' || sqlerrm || ')'); end;

  begin
    perform public.blud_guardar('blud-db-donaciones', jsonb_build_object('id', 'x2', 'donanteCedula', 'V-21333444', 'tipoSangre', 'A-',
      'tipoHemocomponente', 'Sangre Total', 'volumenMl', 450, 'evaluacion', jsonb_build_object('peso', '70', 'presion', '120/80', 'hb', '14', 'temperatura', '36.5')));
    r := r || text '✘ donante: pudo registrar una donación';
  exception when others then r := r || ('✔ donante: no registra donaciones (' || sqlerrm || ')'); end;

  begin
    perform public.blud_guardar('blud-db-tickets', '{"id":"tk-demo1","mensajes":[{"id":"z","autor":"soporte","nombre":"x","texto":"falso"}]}');
    r := r || text '✘ donante: pudo escribir como soporte';
  exception when others then r := r || text '✔ donante: no puede escribir como soporte ni borrar mensajes'; end;

  begin
    select t.mensajes into v from public.ticket_soporte t where ticket_id = 'tk-demo1';
    perform public.blud_guardar('blud-db-tickets', jsonb_build_object('id', 'tk-demo1',
      'mensajes', v || jsonb_build_array(jsonb_build_object('id', 'm9', 'autor', 'donante', 'nombre', 'Carlos', 'texto', 'Gracias', 'fecha', '2026-11-02T10:00:00'))));
    perform public.blud_guardar('blud-db-tickets', '{"id":"tk-nuevo","codigo":"TCK-NUEVO","donanteId":"BLD-1","donanteNombre":"Carlos","asunto":"Otro","mensajes":[{"id":"a","autor":"donante","nombre":"Carlos","texto":"Hola"}]}');
    ok := (select jsonb_array_length(mensajes) from public.ticket_soporte where ticket_id = 'tk-demo1') = 2
      and (select dueno_correo from public.ticket_soporte where ticket_id = 'tk-nuevo') = 'carlos@blud.app';
    r := r || (case when ok then '✔' else '✘' end || ' donante: responde su ticket y abre uno nuevo a su nombre');
  exception when others then r := r || ('✘ donante tickets: ' || sqlerrm); end;

  begin
    perform public.blud_guardar('blud-db-ticket-notas', '{"id":"tk-demo2","notas":[]}');
    r := r || text '✘ donante: pudo tocar notas internas';
  exception when others then r := r || text '✔ donante: no toca notas internas'; end;

  begin
    perform public.blud_guardar('blud-db-donantes', '{"id":"BLD-X","cedula":"V-21333444","nombreCompleto":"Carlos Pérez","sangre":"O+","telefono":"+58 412 0000000"}');
    ok := (select telefono from public.usuario where correo = 'carlos@blud.app') = '+58 412 0000000'
      and (select private.ts_txt(tipo_sangre) from public.donante d join public.usuario u using (usuarioid) where u.correo = 'carlos@blud.app') = 'A-';
    r := r || (case when ok then '✔' else '✘' end || ' donante: edita su teléfono; no cambia el tipo de sangre ya confirmado');
  exception when others then r := r || ('✘ donante perfil: ' || sqlerrm); end;

  -- Donante nuevo (se registró en la app y completa su perfil)
  begin
    perform set_config('request.jwt.claims', '{"email":"nuevo@correo.com","sub":"00000000-0000-4000-8000-0000000000aa"}', true);
    perform public.blud_guardar('blud-db-donantes', '{"id":"BLD-N","cedula":"v 27.111.222","nombreCompleto":"Nuevo Donante Prueba","sangre":"B-","nacimiento":"1999-01-01","sexo":"F"}');
    ok := exists (select 1 from public.usuario u join public.donante d using (usuarioid) where u.correo = 'nuevo@correo.com' and u.cedula = 'V-27111222' and u.rol = 'Donante');
    r := r || (case when ok then '✔' else '✘' end || ' donante nuevo: su perfil crea usuario + donante (rol Donante)');
    -- Pre-registrado por el operador: se une con cédula + fecha de nacimiento
    perform set_config('request.jwt.claims', '{"email":"laura@correo.com","sub":"00000000-0000-4000-8000-0000000000ab"}', true);
    perform public.blud_guardar('blud-db-donantes', '{"id":"BLD-L","cedula":"V-20111222","nombreCompleto":"Laura Pérez","sangre":"O+","nacimiento":"2000-01-01","sexo":"F"}');
    r := r || text '✘ donante: se unió a un registro ajeno con fecha de nacimiento equivocada';
  exception when others then r := r || ('✔ donante: no se une a un registro ajeno sin la fecha de nacimiento correcta (' || sqlerrm || ')'); end;
  begin
    -- El bloque anterior se revirtió, y con él la sesión: se vuelve a entrar como Laura.
    perform set_config('request.jwt.claims', '{"email":"laura@correo.com","sub":"00000000-0000-4000-8000-0000000000ab"}', true);
    perform public.blud_guardar('blud-db-donantes', '{"id":"BLD-L","cedula":"V-20111222","nombreCompleto":"Laura Pérez","sangre":"O+","nacimiento":"1996-08-01","sexo":"F"}');
    ok := exists (select 1 from public.usuario where cedula = 'V-20111222' and correo = 'laura@correo.com');
    r := r || (case when ok then '✔' else '✘' end || ' donante: se une a su registro presencial con cédula + nacimiento');
  exception when others then r := r || ('✘ donante unión: ' || sqlerrm); end;

  -- ============================================================ Operador
  perform pg_temp.como('operador@blud.app');
  begin
    j := public.blud_panel();
    ok := jsonb_array_length(j -> 'blud-db-donantes') >= 8 and jsonb_array_length(j -> 'blud-db-pedidos') = 4
      and jsonb_array_length(j -> 'blud-db-entregas') = 1 and jsonb_array_length(j -> 'blud-db-unidades') = 7
      and not (j ? 'blud-db-pruebas') and not (j ? 'blud-db-positivos') and not (j ? 'perfiles');
    r := r || (case when ok then '✔' else '✘' end || format(' operador: donantes %s, solicitudes %s, entregas %s, unidades disponibles %s; sin laboratorio ni personal',
      jsonb_array_length(j -> 'blud-db-donantes'), jsonb_array_length(j -> 'blud-db-pedidos'), jsonb_array_length(j -> 'blud-db-entregas'), jsonb_array_length(j -> 'blud-db-unidades')));
    s := (select string_agg(e ->> 'estado', ',' order by e ->> 'id') from jsonb_array_elements(j -> 'blud-db-pedidos') e);
    r := r || (case when s = 'pendiente,aprobado,rechazado,despachado' then '✔' else '✘' end || ' operador: estados del seed → ' || s);
    r := r || (case when (select count(*) from jsonb_array_elements(j -> 'blud-db-donaciones') e where e ->> 'estadoLab' = 'pendiente') = 1
      and (select count(*) from jsonb_array_elements(j -> 'blud-db-donaciones') e where e ->> 'estadoLab' = 'descartada') = 1
      then '✔' else '✘' end || ' operador: 1 donación en cuarentena y 1 descartada');
  exception when others then r := r || ('✘ operador panel: ' || sqlerrm); end;

  begin
    perform public.blud_guardar('blud-db-donantes', '{"id":"OP-1","cedula":"V-25000111","nombreCompleto":"Juan Prueba Uno","sangre":"O+","nacimiento":"1990-05-05","sexo":"M","estado":"verificado"}');
    v := public.blud_guardar('blud-db-donaciones', jsonb_build_object('id', 'tmp', 'donanteCedula', 'V-25000111', 'tipoSangre', 'O+',
      'tipoHemocomponente', 'Sangre Total', 'volumenMl', 450, 'evaluacion', jsonb_build_object('peso', '72', 'presion', '120/80', 'hb', '14,8', 'temperatura', '36.6')));
    r := r || (case when v ->> 'aviso' like 'Donación DON-%' then '✔' else '✘' end || ' operador: registra donante en persona y su donación → ' || coalesce(v ->> 'aviso', v::text));
  exception when others then r := r || ('✘ operador donación: ' || sqlerrm); end;

  begin
    perform public.blud_guardar('blud-db-donaciones', '{"id":"tmp2","donanteCedula":"V-20111222","tipoSangre":"O+","tipoHemocomponente":"Sangre Total","volumenMl":450}');
    r := r || text '✘ operador: registró sin evaluación';
  exception when others then r := r || ('✔ operador: sin signos vitales no hay extracción (' || sqlerrm || ')'); end;

  begin
    n := (select count(*) from public.evaluacion_donante);
    v := public.blud_guardar('blud-db-donaciones', jsonb_build_object('id', 'tmp3', 'donanteCedula', 'V-20111222', 'tipoSangre', 'O+',
      'tipoHemocomponente', 'Sangre Total', 'volumenMl', 450, 'evaluacion', jsonb_build_object('peso', '45', 'presion', '120/80', 'hb', '11', 'temperatura', '36.6')));
    ok := v ->> 'error' like 'No apto%' and (select count(*) from public.evaluacion_donante) = n + 1 and pg_temp.din('V-20111222') is null;
    r := r || (case when ok then '✔' else '✘' end || ' operador: donante no apto → no hay donación y el diferimiento queda guardado (' || coalesce(v ->> 'error', '') || ')');
  exception when others then r := r || ('✘ operador no apto: ' || sqlerrm); end;

  begin
    perform public.blud_guardar('blud-db-pedidos', '{"id":"nuevo1","pacienteNombre":"Paciente Prueba","pacienteCedula":"V-31000111","tipoSangre":"O+","tipoHemocomponente":"Concentrado Globular","unidades":1,"hospitalDestino":"x","estado":"pendiente","prioridad":"urgente","diagnostico":"Anemia","clinica":{"Hb":"6,9","consentimiento":"si"}}');
    select solicitudid into n from public.solicitudtransfusion st join public.paciente p using (pacienteid) where p.cedula = 'V-31000111';
    ok := (select estado from public.solicitudtransfusion where solicitudid = n) = 'Pendiente'
      and (select hb_g_dl from public.paciente where cedula = 'V-31000111') = 6.9;
    r := r || (case when ok then '✔' else '✘' end || ' operador: carga una orden médica → queda Pendiente');
  exception when others then r := r || ('✘ operador orden: ' || sqlerrm); end;

  begin
    perform public.blud_guardar('blud-db-pedidos', jsonb_build_object('id', 'REQ-' || lpad(n::text, 6, '0'), 'estado', 'aprobado'));
    r := r || text '✘ operador: se aprobó su propia orden';
  exception when others then r := r || ('✔ operador: no aprueba (' || sqlerrm || ')'); end;

  begin
    perform public.blud_guardar('blud-db-entregas', jsonb_build_object('id', 'e1', 'pedidoId', 'REQ-' || lpad(n::text, 6, '0')));
    r := r || text '✘ operador: despachó sin aprobación';
  exception when others then r := r || ('✔ operador: no despacha sin aprobación (' || sqlerrm || ')'); end;

  -- ============================================================ Dirección
  perform pg_temp.como('maria@blud.app');
  begin
    j := public.blud_panel();
    ok := (select bool_and(e -> 'resultados' = '{}'::jsonb) from jsonb_array_elements(j -> 'blud-db-pruebas') e)
      and (select bool_and(not (e ? 'enfermedad') and not (e ? 'prueba')) from jsonb_array_elements(j -> 'blud-db-positivos') e)
      and jsonb_array_length(j -> 'perfiles') >= 8;
    r := r || (case when ok then '✔' else '✘' end || format(' dirección: resumen de laboratorio sin resultados ni enfermedad; %s cuentas del personal', jsonb_array_length(j -> 'perfiles')));
  exception when others then r := r || ('✘ dirección panel: ' || sqlerrm); end;

  begin
    perform public.blud_guardar('blud-db-pedidos', jsonb_build_object('id', 'REQ-' || lpad(n::text, 6, '0'), 'estado', 'aprobado'));
    ok := (select estado from public.solicitudtransfusion where solicitudid = n) = 'Aprobada';
    r := r || (case when ok then '✔' else '✘' end || ' dirección: aprueba y se reservan unidades compatibles');
    perform pg_temp.como('operador@blud.app');
    perform public.blud_guardar('blud-db-entregas', jsonb_build_object('id', 'e2', 'pedidoId', 'REQ-' || lpad(n::text, 6, '0')));
    perform public.blud_guardar('blud-db-pedidos', jsonb_build_object('id', 'REQ-' || lpad(n::text, 6, '0'), 'estado', 'despachado'));
    ok := (select estado from public.solicitudtransfusion where solicitudid = n) = 'Despachada'
      and (select count(*) from public.bitacora_auditoria where operacion = 'DESPACHO' and registro_id = n) = 1
      and exists (select 1 from public.unidadsangre where estado = 'EnTransito' and unidadid in (select o_unidad_id from public.unidades_de_solicitud(n)));
    r := r || (case when ok then '✔' else '✘' end || ' operador: despacha la aprobada una sola vez (entrega + pedido) y las unidades salen');
  exception when others then r := r || ('✘ aprobar/despachar: ' || sqlerrm); end;

  perform pg_temp.como('maria@blud.app');
  begin
    select st.solicitudid into m from public.solicitudtransfusion st join public.paciente p using (pacienteid) where p.cedula = 'V-30111222';
    perform public.blud_guardar('blud-db-pedidos', jsonb_build_object('id', 'REQ-' || lpad(m::text, 6, '0'), 'estado', 'rechazado', 'motivoRechazo', 'Prueba de rechazo'));
    j := public.blud_panel();
    ok := (select e ->> 'motivoRechazo' from jsonb_array_elements(j -> 'blud-db-pedidos') e where e ->> 'id' = 'REQ-' || lpad(m::text, 6, '0')) = 'Prueba de rechazo';
    r := r || (case when ok then '✔' else '✘' end || ' dirección: rechaza con motivo y el motivo vuelve al panel');
  exception when others then r := r || ('✘ rechazo: ' || sqlerrm); end;

  begin
    v := public.blud_guardar('blud-db-pedidos', '{"id":"nuevo2","pacienteNombre":"Sin Stock","pacienteCedula":"V-31000222","tipoSangre":"AB-","tipoHemocomponente":"Crioprecipitado","unidades":5,"estado":"aprobado","prioridad":"critica","diagnostico":"Hipofibrinogenemia"}');
    select solicitudid into m from public.solicitudtransfusion st join public.paciente p using (pacienteid) where p.cedula = 'V-31000222';
    ok := v ->> 'aviso' like 'Quedó por aprobar%' and (select estado from public.solicitudtransfusion where solicitudid = m) = 'Pendiente';
    r := r || (case when ok then '✔' else '✘' end || ' dirección: si no hay stock, su solicitud queda por aprobar (' || coalesce(v ->> 'aviso', '') || ')');
    perform public.blud_borrar('blud-db-pedidos', 'REQ-' || lpad(m::text, 6, '0'));
    r := r || (case when not exists (select 1 from public.solicitudtransfusion where solicitudid = m) then '✔' else '✘' end || ' dirección: borra una solicitud por aprobar');
  exception when others then r := r || ('✘ dirección sin stock: ' || sqlerrm); end;

  begin
    perform public.blud_personal_activo('soporte@blud.app', false);
    perform pg_temp.como('soporte@blud.app');
    begin
      perform public.blud_panel();
      r := r || text '✘ una cuenta desactivada sigue leyendo';
    exception when others then r := r || ('✔ cuenta desactivada no lee nada (' || sqlerrm || ')'); end;
    perform pg_temp.como('maria@blud.app');
    perform public.blud_personal_activo('soporte@blud.app', true);
  exception when others then r := r || ('✘ desactivar: ' || sqlerrm); end;

  begin
    perform pg_temp.como('operador@blud.app');
    perform public.blud_personal_activo('laboratorio@blud.app', false);
    r := r || text '✘ el operador desactivó una cuenta';
  exception when others then r := r || text '✔ solo la dirección desactiva cuentas'; end;

  -- ============================================================ Laboratorio
  perform pg_temp.como('laboratorio@blud.app');
  begin
    j := public.blud_panel();
    ok := jsonb_array_length(j -> 'blud-db-pruebas') = 6 and (j -> 'blud-db-positivos' -> 0 ->> 'enfermedad') = 'Hepatitis C (anti-VHC)'
      and not (j ? 'blud-db-pedidos') and (j -> 'blud-db-pruebas' -> 0 -> 'resultados' ? 'vih');
    r := r || (case when ok then '✔' else '✘' end || ' laboratorio: ve pruebas con resultados y el caso con su enfermedad; no ve solicitudes');
  exception when others then r := r || ('✘ laboratorio panel: ' || sqlerrm); end;

  begin
    s := pg_temp.din('V-17999000'); -- Carmen: en cuarentena
    perform public.blud_guardar('blud-db-pruebas', jsonb_build_object('id', 'p-tmp', 'donacionId', s, 'resultados',
      '{"vih":"no_reactivo","hbsag":"no_reactivo","hbcore":"no_reactivo","hcv":"no_reactivo","sifilis":"no_reactivo","chagas":"no_reactivo","htlv":"no_reactivo","malaria":"no_reactivo"}'::jsonb));
    perform public.blud_guardar('blud-db-donaciones', jsonb_build_object('id', s, 'tipoSangre', 'O+', 'estadoLab', 'liberada'));
    perform public.blud_guardar('blud-db-fracciones', jsonb_build_object('id', 'f-tmp', 'donacionId', s, 'productos',
      '[{"componente":"Concentrado Globular","unidades":1,"volumenMl":280},{"componente":"Plasma Fresco Congelado","unidades":1,"volumenMl":200}]'::jsonb));
    ok := (select count(*) from public.unidadsangre un join public.donacion x on x.donacionid = un.donacionid where x.din_codigo = s and un.estado = 'Disponible') = 2;
    r := r || (case when ok then '✔' else '✘' end || ' laboratorio: serología negativa + fraccionamiento → 2 unidades disponibles');
  exception when others then r := r || ('✘ laboratorio flujo: ' || sqlerrm); end;

  begin
    s := (select e ->> 'id' from jsonb_array_elements(j -> 'blud-db-positivos') e limit 1);
    perform public.blud_guardar('blud-db-positivos', jsonb_build_object('id', s, 'estado', 'notificado', 'notificadoA', 'Epidemiología regional', 'referencia', 'OF-123'));
    ok := (select e ->> 'estado' from jsonb_array_elements(public.blud_panel() -> 'blud-db-positivos') e where e ->> 'id' = s) = 'notificado';
    r := r || (case when ok then '✔' else '✘' end || ' laboratorio: notifica el caso positivo');
  exception when others then r := r || ('✘ notificación: ' || sqlerrm); end;

  -- ============================================================ Soporte
  perform pg_temp.como('soporte@blud.app');
  begin
    j := public.blud_panel();
    ok := jsonb_array_length(j -> 'blud-db-tickets') = 3 and jsonb_array_length(j -> 'blud-db-ticket-notas') = 1
      and not (j ? 'blud-db-pedidos') and not (j ? 'blud-db-pruebas');
    r := r || (case when ok then '✔' else '✘' end || ' soporte: ve todos los tickets y las notas; nada clínico');
    perform public.blud_guardar('blud-db-ticket-notas', '{"id":"tk-demo1","notas":[{"id":"n","autor":"Daniela","texto":"Llamar","fecha":"2026-11-02"}]}');
    perform public.blud_guardar('blud-db-tickets', '{"id":"tk-demo1","codigo":"TCK-DEMO1","donanteEmail":"carlos@blud.app","estado":"resuelto","prioridad":"normal","resueltoEn":"2026-11-02T12:00:00Z","mensajes":[]}');
    ok := (select estado from public.ticket_soporte where ticket_id = 'tk-demo1') = 'resuelto' and exists (select 1 from public.ticket_nota where ticket_id = 'tk-demo1');
    r := r || (case when ok then '✔' else '✘' end || ' soporte: resuelve el ticket y guarda una nota interna');
  exception when others then r := r || ('✘ soporte: ' || sqlerrm); end;

  -- ============================================================ Permisos y esquema existente
  r := r || (case when not has_function_privilege('anon', 'public.blud_panel()', 'execute')
    and not has_function_privilege('anon', 'public.blud_guardar(text, jsonb)', 'execute') then '✔' else '✘' end || ' sin sesión no se llaman las funciones');
  r := r || (case when not has_table_privilege('authenticated', 'public.ticket_soporte', 'select')
    and not has_table_privilege('authenticated', 'public.ticket_nota', 'select') then '✔' else '✘' end || ' las tablas de soporte no se leen directo desde la API');
  r := r || (case when not has_function_privilege('authenticated', 'private.g_pedido(jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'private.crear_solicitud(jsonb, text, jsonb, enum_nivel_urgencia, text, boolean, boolean, timestamptz)', 'execute')
    then '✔' else '✘' end || ' las funciones privadas no se pueden llamar desde la API');
  r := r || (case when position('array[''director'']' in pg_get_functiondef('public.crear_solicitud(jsonb, text, jsonb, enum_nivel_urgencia, text, boolean, boolean, timestamptz)'::regprocedure)) > 0
    then '✔' else '✘' end || ' public.crear_solicitud sigue igual (solo la dirección)');

  raise exception E'RESULTADOS (%/% ok)\n%', (select count(*) from unnest(r) x where x like '✔%'), array_length(r, 1), array_to_string(r, E'\n');
end $t$;
