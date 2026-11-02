-- BLUD · Cuentas de prueba y datos de ejemplo (fechas relativas a hoy). Idempotente.
-- Mismas credenciales que el modo demo del sitio. NO usar en un proyecto con donantes reales.

create extension if not exists pgcrypto with schema extensions;

-- ============================================================ Cuentas
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
  ('a0000000-0000-4000-8000-000000000003'::uuid, 'operador@blud.app', 'Operador2026', 'Dra. María Colina'),
  ('a0000000-0000-4000-8000-000000000004'::uuid, 'laboratorio@blud.app', 'Laboratorio2026', 'Lic. Andrea Vargas'),
  ('a0000000-0000-4000-8000-000000000005'::uuid, 'soporte@blud.app', 'Soporte2026', 'Lic. Daniela Ríos')
) as v (id, email, clave, nombre)
on conflict (id) do nothing;

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now()
from auth.users u
where u.id::text like 'a0000000-0000-4000-8000-00000000000_'
on conflict (provider_id, provider) do nothing;

-- El trigger crea los perfiles como "donante"; aquí se asignan los roles del personal.
update public.profiles p set
  role = v.rol::public.app_role, full_name = v.nombre, blood_type = v.sangre, phone = v.tel,
  cargo = v.cargo, sede = v.sede, colegiado = v.colegiado
from (values
  ('maria@blud.app', 'director', 'María Fernández', 'O+', '+58 414 1234567', 'Director General de Banco de Sangre', 'Hospital Central Maracaibo', 'MPPS-84920'),
  ('carlos@blud.app', 'donante', 'Carlos Pérez', 'A-', '+58 414 7654321', null, null, null),
  ('operador@blud.app', 'operador', 'Dra. María Colina', 'B+', '+58 414 5550123', 'Operador de Banco de Sangre', 'Hospital Central Maracaibo', 'MPPS-51230'),
  ('laboratorio@blud.app', 'laboratorio', 'Lic. Andrea Vargas', 'O-', '+58 414 5550456', 'Bioanalista', 'Hospital Central Maracaibo', 'MPPS-60721'),
  ('soporte@blud.app', 'soporte', 'Lic. Daniela Ríos', 'A+', '+58 414 5550789', 'Especialista de Soporte al Donante', 'Hospital Central Maracaibo', 'BLUD-SOP-014')
) as v (email, rol, nombre, sangre, tel, cargo, sede, colegiado)
where p.email = v.email;

-- ============================================================ Donantes
insert into public.donantes (id, user_id, cedula, nombre_completo, sangre, telefono, email, fecha_registro, estado, origen, operador_id, fecha_verificacion, diferido) values
  ('demo-1', null, 'V-20111222', 'Laura Pérez', 'O+', null, null, current_date - 1, 'preregistrado', 'app', null, null, null),
  ('demo-2', null, 'V-18222333', 'Carlos Rincón', 'A-', null, null, current_date - 2, 'preregistrado', 'app', null, null, null),
  ('demo-3', null, 'V-15333444', 'Ana Morales', 'O-', null, null, current_date - 60, 'verificado', 'operador', 'operador@blud.app', current_date - 60, null),
  ('demo-4', null, 'V-12444555', 'Luis Fernández', 'B+', null, null, current_date - 120, 'verificado', 'app', 'operador@blud.app', current_date - 120, null),
  ('demo-5', null, 'V-14555666', 'Pedro Sánchez', 'A+', null, null, current_date - 50, 'verificado', 'operador', 'operador@blud.app', current_date - 50, jsonb_build_object('desde', current_date - 6)),
  ('demo-6', null, 'V-19777888', 'Gabriela Ruiz', 'AB+', null, null, current_date - 45, 'verificado', 'app', 'operador@blud.app', current_date - 45, null),
  ('demo-7', null, 'V-16888999', 'José Valbuena', 'O+', null, null, current_date - 15, 'verificado', 'operador', 'operador@blud.app', current_date - 15, null),
  ('demo-8', null, 'V-17999000', 'Carmen Urdaneta', 'O+', null, null, current_date - 20, 'verificado', 'app', 'operador@blud.app', current_date - 20, null),
  ('BLD-DEMO01', null, 'V-12345601', 'Luis Martínez', 'O+', '+58 414 5550101', 'luis@correo.com', current_date - 30, 'verificado', 'app', null, null, null),
  ('BLD-DEMO02', null, 'V-12345602', 'Ana Rodríguez', 'A+', '+58 414 5550102', 'ana@correo.com', current_date - 30, 'preregistrado', 'app', null, null, null),
  ('BLD-DEMO03', null, 'V-12345603', 'Pedro Gil', 'B-', '+58 414 5550103', 'pedro@correo.com', current_date - 30, 'verificado', 'app', null, null, null),
  ('BLD-CARLOS', 'a0000000-0000-4000-8000-000000000002', 'V-21333444', 'Carlos Pérez', 'A-', '+58 414 7654321', 'carlos@blud.app', current_date - 200, 'verificado', 'app', 'operador@blud.app', current_date - 120, null)
on conflict (id) do nothing;

-- ============================================================ Donaciones
insert into public.donaciones (id, donante_id, donante_nombre, donante_cedula, tipo_sangre, tipo_hemocomponente, volumen_ml, fecha, operador_id, centro_nombre, estado_lab) values
  ('demo-d1', 'demo-3', 'Ana Morales', 'V-15333444', 'O-', 'Sangre Total', 450, current_date - 25, 'operador@blud.app', 'Hospital Central Maracaibo', 'liberada'),
  ('demo-d2', 'demo-4', 'Luis Fernández', 'V-12444555', 'B+', 'Sangre Total', 450, current_date - 12, 'operador@blud.app', 'Hospital Central Maracaibo', 'liberada'),
  ('demo-d3', 'demo-6', 'Gabriela Ruiz', 'V-19777888', 'AB+', 'Concentrado Globular', 450, current_date - 38, 'operador@blud.app', 'Hospital Central Maracaibo', 'liberada'),
  ('demo-d4', 'demo-3', 'Ana Morales', 'V-15333444', 'O-', 'Plaquetas', 250, current_date - 3, 'operador@blud.app', 'Hospital Central Maracaibo', 'liberada'),
  ('demo-d5', 'demo-5', 'Pedro Sánchez', 'V-14555666', 'A+', 'Sangre Total', 450, current_date - 7, 'operador@blud.app', 'Hospital Central Maracaibo', 'descartada'),
  ('demo-d6', 'demo-6', 'Gabriela Ruiz', 'V-19777888', 'AB+', 'Sangre Total', 450, current_date - 1, 'operador@blud.app', 'Hospital Central Maracaibo', 'pendiente'),
  ('demo-d7', 'demo-7', 'José Valbuena', 'V-16888999', 'O+', 'Sangre Total', 450, current_date, 'operador@blud.app', 'Hospital Central Maracaibo', 'pendiente'),
  ('demo-d8', 'demo-8', 'Carmen Urdaneta', 'V-17999000', 'O+', 'Sangre Total', 450, current_date - 10, 'operador@blud.app', 'Hospital Central Maracaibo', 'liberada'),
  ('demo-c1', 'BLD-CARLOS', 'Carlos Pérez', 'V-21333444', 'A-', 'Sangre Total', 450, current_date - 120, 'operador@blud.app', 'Hospital Central Maracaibo', 'liberada')
on conflict (id) do nothing;

-- ============================================================ Laboratorio
insert into public.pruebas (id, donacion_id, codigo, fecha, resultados, resultado_global, tipo_sangre_confirmado, laboratorista_id)
select v.id, v.donacion, v.codigo, current_date - v.dias,
  case when v.reactiva is null
    then '{"vih":"no_reactivo","hbsag":"no_reactivo","hbcore":"no_reactivo","hcv":"no_reactivo","sifilis":"no_reactivo","chagas":"no_reactivo","htlv":"no_reactivo","malaria":"no_reactivo"}'::jsonb
    else jsonb_set('{"vih":"no_reactivo","hbsag":"no_reactivo","hbcore":"no_reactivo","hcv":"no_reactivo","sifilis":"no_reactivo","chagas":"no_reactivo","htlv":"no_reactivo","malaria":"no_reactivo"}'::jsonb, array[v.reactiva], '"reactivo"')
  end,
  case when v.reactiva is null then 'negativo' else 'positivo' end, v.sangre, 'laboratorio@blud.app'
from (values
  ('demo-pr1', 'demo-d1', 'DON-D1', 24, 'O-', null),
  ('demo-pr2', 'demo-d2', 'DON-D2', 11, 'B+', null),
  ('demo-pr3', 'demo-d3', 'DON-D3', 37, 'AB+', null),
  ('demo-pr4', 'demo-d4', 'DON-D4', 2, 'O-', null),
  ('demo-pr8', 'demo-d8', 'DON-D8', 9, 'O+', null),
  ('demo-prc1', 'demo-c1', 'DON-C1', 119, 'A-', null),
  ('demo-pr5', 'demo-d5', 'DON-D5', 6, 'A+', 'hbsag')
) as v (id, donacion, codigo, dias, sangre, reactiva)
on conflict (id) do nothing;

insert into public.fracciones (id, donacion_id, codigo, fecha, productos, laboratorista_id) values
  ('demo-fr1', 'demo-d1', 'DON-D1', current_date - 24,
   '[{"componente":"Concentrado Globular","unidades":1,"volumenMl":250},{"componente":"Plasma Fresco Congelado","unidades":1,"volumenMl":200},{"componente":"Plaquetas","unidades":1,"volumenMl":50}]'::jsonb,
   'laboratorio@blud.app')
on conflict (id) do nothing;

insert into public.positivos (id, prueba_id, donacion_id, donante_id, codigo, prueba, enfermedad, fecha, estado) values
  ('demo-cs5', 'demo-pr5', 'demo-d5', 'demo-5', 'DON-D5', 'hbsag', 'Hepatitis B (HBsAg)', current_date - 6, 'pendiente')
on conflict (id) do nothing;

-- ============================================================ Solicitudes y entregas (una de cada estado)
insert into public.pedidos (id, paciente_nombre, paciente_cedula, tipo_sangre, tipo_hemocomponente, unidades, hospital_destino, fecha, estado, prioridad, servicio, medico, diagnostico, creado_por, creado_por_nombre, revisado_por, revisado_por_nombre, fecha_revision, motivo_rechazo, entrega_id) values
  ('demo-p1', 'Roberto Gómez', 'V-9876543', 'O-', 'Concentrado Globular', 1, 'Hospital Central Maracaibo', current_date, 'pendiente', 'urgente', 'Emergencia', 'Dr. Roberto Silva', 'Hemorragia digestiva alta', 'operador@blud.app', 'Dra. María Colina', null, null, null, null, null),
  ('demo-p2', 'María Delgado', 'V-18765432', 'B+', 'Sangre Total', 1, 'Hospital Universitario de Maracaibo', current_date - 1, 'aprobado', 'normal', 'Cirugía', 'Dra. Elena Ríos', 'Anemia posoperatoria', 'operador@blud.app', 'Dra. María Colina', 'maria@blud.app', 'María Fernández', current_date - 1, null, null),
  ('demo-p3', 'Pablo Ortiz', 'V-11222333', 'AB+', 'Plasma Fresco Congelado', 2, 'Policlínica Amado', current_date - 3, 'rechazado', 'normal', 'Medicina interna', 'Dr. Luis Herrera', null, 'operador@blud.app', 'Dra. María Colina', 'maria@blud.app', 'María Fernández', current_date - 2, 'Sin estudios de coagulación que justifiquen el plasma.', null),
  ('demo-p4', 'Elena Bracho', 'V-13444555', 'O-', 'Plasma Fresco Congelado', 1, 'Hospital Coromoto', current_date - 6, 'despachado', 'critica', 'UCI', 'Dr. Carlos Gómez', null, 'operador@blud.app', 'Dra. María Colina', 'maria@blud.app', 'María Fernández', current_date - 6, null, 'demo-e4')
on conflict (id) do nothing;

insert into public.entregas (id, pedido_id, paciente_nombre, paciente_cedula, tipo_sangre, tipo_hemocomponente, unidades, hospital_destino, fecha, operador_id) values
  ('demo-e4', 'demo-p4', 'Elena Bracho', 'V-13444555', 'O-', 'Plasma Fresco Congelado', 1, 'Hospital Coromoto', current_date - 5, 'operador@blud.app')
on conflict (id) do nothing;

-- ============================================================ Soporte
insert into public.tickets (id, owner_id, codigo, donante_id, donante_nombre, donante_email, asunto, estado, prioridad, creado, actualizado, mensajes) values
  ('tk-demo1', null, 'TCK-DEMO1', 'BLD-DEMO01', 'Luis Martínez', 'luis@correo.com', 'Mi cita', 'abierto', 'normal', now() - interval '35 minutes', now() - interval '35 minutes',
   jsonb_build_array(jsonb_build_object('id', 'm1', 'autor', 'donante', 'nombre', 'Luis Martínez', 'texto', 'Agendé mi cita para el viernes pero tengo que viajar. ¿Cómo la cambio a la semana siguiente?', 'fecha', now() - interval '35 minutes'))),
  ('tk-demo2', null, 'TCK-DEMO2', 'BLD-DEMO02', 'Ana Rodríguez', 'ana@correo.com', 'Verificación de identidad', 'abierto', 'alta', now() - interval '2 hours', now() - interval '2 hours',
   jsonb_build_array(jsonb_build_object('id', 'm2', 'autor', 'donante', 'nombre', 'Ana Rodríguez', 'texto', 'Subí mi cédula pero mi perfil sigue diciendo que no estoy verificada. Necesito donar esta semana.', 'fecha', now() - interval '2 hours'))),
  ('tk-demo3', null, 'TCK-DEMO3', 'BLD-DEMO03', 'Pedro Gil', 'pedro@correo.com', 'Mi carnet o mi QR', 'abierto', 'normal', now() - interval '10 hours', now() - interval '10 hours',
   jsonb_build_array(jsonb_build_object('id', 'm3', 'autor', 'donante', 'nombre', 'Pedro Gil', 'texto', 'El QR de mi carnet no se muestra, solo veo un recuadro en blanco.', 'fecha', now() - interval '10 hours'))),
  ('tk-demo4', 'a0000000-0000-4000-8000-000000000002', 'TCK-DEMO4', 'BLD-CARLOS', 'Carlos Pérez', 'carlos@blud.app', 'Mi cita', 'en_proceso', 'normal', now() - interval '1 day', now() - interval '20 hours',
   jsonb_build_array(
     jsonb_build_object('id', 'm4', 'autor', 'donante', 'nombre', 'Carlos Pérez', 'texto', '¿Puedo donar plaquetas además de sangre total?', 'fecha', now() - interval '1 day'),
     jsonb_build_object('id', 'm5', 'autor', 'soporte', 'nombre', 'Lic. Daniela Ríos', 'texto', 'Hola Carlos, sí: la donación de plaquetas se agenda aparte en un centro con aféresis. Te contamos cuáles en tu próxima cita.', 'fecha', now() - interval '20 hours')))
on conflict (id) do nothing;

insert into public.ticket_notas (id, notas) values
  ('tk-demo4', jsonb_build_array(jsonb_build_object('id', 'n1', 'autor', 'Lic. Daniela Ríos', 'texto', 'Donante frecuente: ofrecerle aféresis en el Banco de Sangre del Zulia.', 'fecha', now() - interval '20 hours')))
on conflict (id) do nothing;

insert into public.citas (id, user_id, center_id, center_name, date, time) values
  ('demo-cita1', 'a0000000-0000-4000-8000-000000000002', 'c1', 'Banco de Sangre del Zulia', current_date + 3, '09:30')
on conflict (id) do nothing;
