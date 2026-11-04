-- BLUD · Cuentas de prueba y datos de ejemplo sobre el esquema de Bloodonor. Idempotente: si ya existen, no hace nada.
-- Mismas credenciales que el modo demo del sitio. Cambia las contraseñas antes de guardar datos reales.
-- Los datos se cargan con las funciones del esquema (evaluar_donante, registrar_donacion, registrar_serologia,
-- fraccionar_donacion, reservar_unidades…), haciéndose pasar por cada rol, para que respeten sus reglas.

create extension if not exists pgcrypto with schema extensions;

do $seed$
declare
  v_sede int;
  v_uid int;
  v_don int[] := '{}';
  v_carlos int;
  r record;
  v_din int[] := '{}';
  v_sol int[] := '{}';
  v_id int;
begin
  if exists (select 1 from public.usuario where lower(correo) = 'maria@blud.app') then
    raise notice 'Las cuentas de prueba de BLUD ya existen: no se cargó nada.';
    return;
  end if;
  select sedeid into v_sede from public.sede where nombre = 'Hospital Central Maracaibo';
  v_sede := coalesce(v_sede, (select min(sedeid) from public.sede where tipo = 'BancoSangre'));

  -- ------------------------------------------------------------ Cuentas de acceso (Supabase Auth)
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select
    '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
    extensions.crypt(v.clave, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v.nombre), now(), now(),
    '', '', '', ''
  from (values
    ('a0000000-0000-4000-8000-000000000001'::uuid, 'maria@blud.app', 'Donante2026', 'María Fernández'),
    ('a0000000-0000-4000-8000-000000000002'::uuid, 'carlos@blud.app', 'Sangre2026', 'Carlos Pérez'),
    ('a0000000-0000-4000-8000-000000000003'::uuid, 'operador@blud.app', 'Operador2026', 'María Colina'),
    ('a0000000-0000-4000-8000-000000000004'::uuid, 'laboratorio@blud.app', 'Laboratorio2026', 'Andrea Vargas'),
    ('a0000000-0000-4000-8000-000000000005'::uuid, 'soporte@blud.app', 'Soporte2026', 'Daniela Ríos')
  ) as v (id, email, clave, nombre)
  on conflict (id) do nothing;

  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
  from auth.users u
  where u.id::text like 'a0000000-0000-4000-8000-00000000000_'
  on conflict (provider_id, provider) do nothing;

  -- ------------------------------------------------------------ Personal
  insert into public.usuario (cedula, nombres, apellidos, fechanacimiento, sexo, telefono, correo, password_hash, rol, sederegistroid)
  values
    ('V-9800001', 'María', 'Fernández', '1975-03-12', 'F', '+58 414 1234567', 'maria@blud.app', 'supabase-auth', 'PersonalSalud', v_sede),
    ('V-9800002', 'María', 'Colina', '1984-07-02', 'F', '+58 414 5550123', 'operador@blud.app', 'supabase-auth', 'PersonalSalud', v_sede),
    ('V-9800003', 'Andrea', 'Vargas', '1988-11-23', 'F', '+58 414 5550456', 'laboratorio@blud.app', 'supabase-auth', 'PersonalSalud', v_sede),
    ('V-9800004', 'Daniela', 'Ríos', '1993-01-30', 'F', '+58 414 5550789', 'soporte@blud.app', 'supabase-auth', 'PersonalSalud', v_sede);
  insert into public.personalsalud (usuarioid, cargo, sedeid, colegiado)
  select u.usuarioid, v.cargo::public.enum_cargo_personal, v_sede, v.colegiado
  from (values
    ('maria@blud.app', 'Director', 'MPPS-84920'),
    ('operador@blud.app', 'Medico', 'MPPS-51230'),
    ('laboratorio@blud.app', 'Laboratista', 'MPPS-60721'),
    ('soporte@blud.app', 'TecnicoSoporte', 'BLUD-SOP-014')
  ) as v (correo, cargo, colegiado)
  join public.usuario u on u.correo = v.correo;

  -- ------------------------------------------------------------ Donantes
  -- Carlos usa la app; los demás los registró un operador en persona (correo de marcador).
  insert into public.usuario (cedula, nombres, apellidos, fechanacimiento, sexo, telefono, correo, password_hash, rol, sederegistroid)
  values ('V-21333444', 'Carlos', 'Pérez', '1992-05-20', 'M', '+58 414 7654321', 'carlos@blud.app', 'supabase-auth', 'Donante', v_sede)
  returning usuarioid into v_uid;
  insert into public.donante (usuarioid, tipo_sangre, verificado_en) values (v_uid, private.ts_id('A-'), now())
  returning donanteid into v_carlos;

  for r in select * from (values
    (1, 'V-15333444', 'Ana', 'Morales', '1985-02-14'::date, 'F', 'O-'),
    (2, 'V-12444555', 'Luis', 'Fernández', '1979-09-03'::date, 'M', 'B+'),
    (3, 'V-16888999', 'José', 'Valbuena', '1983-12-11'::date, 'M', 'O+'),
    (4, 'V-19777888', 'Gabriela', 'Ruiz', '1990-06-27'::date, 'F', 'AB+'),
    (5, 'V-14555666', 'Pedro', 'Sánchez', '1981-04-08'::date, 'M', 'A+'),
    (6, 'V-17999000', 'Carmen', 'Urdaneta', '1987-10-19'::date, 'F', 'O+'),
    (7, 'V-20111222', 'Laura', 'Pérez', '1996-08-01'::date, 'F', 'O+')
  ) as t (n, ced, nom, ape, nac, sexo, sangre) order by n loop
    insert into public.usuario (cedula, nombres, apellidos, fechanacimiento, sexo, telefono, correo, password_hash, rol, sederegistroid)
    values (r.ced, r.nom, r.ape, r.nac, r.sexo::public.enum_sexo, '', lower(replace(r.ced, '-', '')) || '@presencial.blud',
            'presencial', 'Donante', v_sede)
    returning usuarioid into v_uid;
    -- Laura (7) queda solo pre-registrada: sin verificar ni donar.
    insert into public.donante (usuarioid, tipo_sangre, verificado_en)
    values (v_uid, private.ts_id(r.sangre), case when r.n < 7 then now() end)
    returning donanteid into v_id;
    v_don := v_don || v_id;
  end loop;

  -- ------------------------------------------------------------ Extracciones (como operador)
  perform set_config('request.jwt.claims', '{"email":"operador@blud.app"}', true);
  update public.donante set verificado_por = public._personal_id() where verificado_en is not null;
  for i in 1..6 loop
    perform public.evaluar_donante(v_don[i], 70, '120/80', 14.5, 36.6, 72::smallint, null, null, null, null);
    select o_donacion_id into v_id from public.registrar_donacion(v_don[i], 450::smallint, 'Voluntaria', 'CPDA-1', null);
    v_din := v_din || v_id;
  end loop;
  perform public.evaluar_donante(v_carlos, 78, '118/76', 15.1, 36.5, 68::smallint, null, null, null, null);
  select o_donacion_id into v_id from public.registrar_donacion(v_carlos, 450::smallint, 'Voluntaria', 'CPDA-1', null);
  v_din := v_din || v_id; -- v_din[7] = Carlos

  -- ------------------------------------------------------------ Laboratorio
  perform set_config('request.jwt.claims', '{"email":"laboratorio@blud.app"}', true);
  -- 1–4 y Carlos negativos; 5 reactiva a hepatitis C (se descarta); 6 sigue en cuarentena.
  foreach v_id in array array[v_din[1], v_din[2], v_din[3], v_din[4], v_din[7]] loop
    perform public.registrar_serologia(v_id, 'Negativo', 'Negativo', 'Negativo', 'Negativo', 'Negativo', 'Negativo', 'Negativo');
  end loop;
  perform public.registrar_serologia(v_din[5], 'Negativo', 'Negativo', 'Negativo', 'Positivo', 'Negativo', 'Negativo', 'Negativo');
  -- 1–3 se fraccionan (concentrado globular, plasma y plaquetas) y se liberan.
  foreach v_id in array array[v_din[1], v_din[2], v_din[3]] loop
    perform public.fraccionar_donacion(v_id, array(select componenteid::int from public.hemocomponente where tipo::text <> 'Crioprecipitado'), 3000, 10::smallint, 22, null);
    perform public.liberar_unidades(v_id);
  end loop;

  -- ------------------------------------------------------------ Solicitudes
  perform set_config('request.jwt.claims', '{"email":"operador@blud.app"}', true);
  for r in select * from (values
    (1, 'V-30111222', 'Roberto', 'Gómez', 'O+', 'Concentrado de hematíes/ plaquetas', 2, 'Urgente', 'Anemia aguda por sangrado digestivo', 'Emergencia'),
    (2, 'V-30222333', 'Elena', 'Paz', 'O+', 'Plasma fresco congelado', 1, 'Programada', 'Coagulopatía en cirugía programada', 'Cirugía'),
    (3, 'V-30333444', 'Mario', 'Ochoa', 'A-', 'Concentrado de plaquetas', 2, 'Programada', 'Trombocitopenia', 'Hematología'),
    (4, 'V-30444555', 'Rosa', 'Blanco', 'O+', 'Concentrado de hematíes/ plaquetas', 1, 'Urgente', 'Hemorragia posparto', 'Obstetricia')
  ) as t (n, ced, nom, ape, sangre, comp, cant, urg, indicacion, servicio) order by n loop
    select o_solicitud_id into v_id from private.crear_solicitud(
      jsonb_build_object('cedula', r.ced, 'nombres', r.nom, 'apellidos', r.ape, 'servicio_area', r.servicio, 'diagnostico', r.indicacion, 'hb_g_dl', '7.2'),
      r.sangre,
      jsonb_build_array(jsonb_build_object('componente', (select componenteid from public.hemocomponente where tipo::text = r.comp), 'unidades', r.cant)),
      r.urg::public.enum_nivel_urgencia, r.indicacion, false, true, null) limit 1;
    v_sol := v_sol || v_id;
  end loop;

  -- La dirección aprueba la 2 y la 4, rechaza la 3; la 1 queda por aprobar.
  perform set_config('request.jwt.claims', '{"email":"maria@blud.app"}', true);
  perform public.reservar_unidades(v_sol[2]);
  perform public.reservar_unidades(v_sol[4]);
  perform public.rechazar_solicitud(v_sol[3], 'Sin plaquetas A− disponibles: se refiere al Banco de Sangre del Zulia.');

  perform set_config('request.jwt.claims', '{"email":"operador@blud.app"}', true);
  perform private.despachar(v_sol[4]);

  -- ------------------------------------------------------------ Fechas realistas (todo se registró hoy)
  for r in select * from (values (1, 6), (2, 4), (3, 2), (4, 9), (5, 7), (6, 1), (7, 100)) as t (n, dias) loop
    update public.donacion set fechadonacion = fechadonacion - r.dias * interval '1 day' where donacionid = v_din[r.n];
    update public.evaluacion_donante set fecha_evaluacion = fecha_evaluacion - r.dias * interval '1 day'
    where donante_id = (select donanteid from public.donacion where donacionid = v_din[r.n]);
    update public.prueba_serologica set fecha_analisis = fecha_analisis - (r.dias - 1) * interval '1 day' where donacion_id = v_din[r.n];
    update public.fraccionamiento set fecha_hora_fraccionamiento = fecha_hora_fraccionamiento - r.dias * interval '1 day' where donacion_id = v_din[r.n];
    update public.unidadsangre set
      fechafabricacion = fechafabricacion - r.dias * interval '1 day',
      fechavencimiento = fechavencimiento - r.dias * interval '1 day'
    where donacionid = v_din[r.n];
  end loop;

  -- ------------------------------------------------------------ Cita de Carlos (donó hace 100 días)
  perform set_config('request.jwt.claims', '{"email":"carlos@blud.app"}', true);
  perform public.agendar_cita(v_sede, date_trunc('day', now()) + interval '5 days 9 hours', null);

  -- ------------------------------------------------------------ Soporte
  insert into public.ticket_soporte (ticket_id, codigo, dueno_correo, donante_ref, donante_nombre, asunto, estado, prioridad, mensajes, creado, actualizado)
  values
    ('tk-demo1', 'TCK-DEMO1', 'carlos@blud.app', 'BLD-' || lpad(v_carlos::text, 6, '0'), 'Carlos Pérez', 'Mi cita', 'abierto', 'normal',
     jsonb_build_array(jsonb_build_object('id', 'm1', 'autor', 'donante', 'nombre', 'Carlos Pérez',
       'texto', '¿Puedo cambiar mi cita a la tarde?', 'fecha', to_char(now() - interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS'))),
     now() - interval '1 day', now() - interval '1 day'),
    ('tk-demo2', 'TCK-DEMO2', 'carlos@blud.app', 'BLD-' || lpad(v_carlos::text, 6, '0'), 'Carlos Pérez', 'Mi carnet o mi QR', 'en_proceso', 'alta',
     jsonb_build_array(
       jsonb_build_object('id', 'm1', 'autor', 'donante', 'nombre', 'Carlos Pérez', 'texto', 'Mi QR no carga en el centro.',
         'fecha', to_char(now() - interval '3 days', 'YYYY-MM-DD"T"HH24:MI:SS')),
       jsonb_build_object('id', 'm2', 'autor', 'soporte', 'nombre', 'Daniela Ríos', 'texto', 'Lo revisamos. ¿Desde qué teléfono lo abres?',
         'fecha', to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS'))),
     now() - interval '3 days', now() - interval '2 days');
  update public.ticket_soporte set asignado_a = jsonb_build_object('id', 'soporte@blud.app', 'nombre', 'Daniela Ríos') where ticket_id = 'tk-demo2';
  insert into public.ticket_nota (ticket_id, notas) values ('tk-demo2', jsonb_build_array(jsonb_build_object(
    'id', 'n1', 'autor', 'Daniela Ríos', 'texto', 'Posible caché vieja del navegador. Pedir captura.',
    'fecha', to_char(now() - interval '2 days', 'YYYY-MM-DD"T"HH24:MI:SS'))));

end
$seed$;
