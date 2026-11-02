-- BLUD · Esquema, roles y reglas de acceso (RLS)
-- Cada tabla espeja una colección de src/lib/db.ts (los campos camelCase del front se guardan en snake_case).
-- Regla general: todo exige sesión; cada rol ve y modifica solo lo que su trabajo necesita.
--   donante      → su perfil, sus citas, sus donaciones y sus tickets
--   operador     → donantes, donaciones, solicitudes (crear) y entregas
--   laboratorio  → donaciones (liberar/descartar), pruebas, fraccionamiento y casos positivos
--   soporte      → tickets y notas internas, datos de contacto de donantes
--   director     → todo lo anterior en lectura (laboratorio solo agregado), aprueba solicitudes y gestiona personal

-- ============================================================ Tipos
create type public.app_role as enum ('donante', 'operador', 'laboratorio', 'soporte', 'director');

-- ============================================================ Perfiles (uno por usuario de auth)
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  role public.app_role not null default 'donante',
  blood_type text,
  phone text,
  cargo text,
  sede text,
  colegiado text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ============================================================ Funciones auxiliares (esquema privado, no expuesto por la API)
create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- Rol de quien hace la petición (null sin sesión o con la cuenta desactivada)
create or replace function private.rol_actual()
returns public.app_role
language sql stable security definer set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function private.has_role(variadic roles public.app_role[])
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(private.rol_actual() = any (roles), false)
$$;

grant execute on function private.rol_actual() to authenticated, service_role;
grant execute on function private.has_role(public.app_role[]) to authenticated, service_role;

-- Al registrarse alguien, nace como donante. El rol NUNCA sale de los metadatos que envía el navegador.
create or replace function private.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, blood_type)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'blood_type', '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Solo la dirección (o el servidor) cambia rol, estado o correo de una cuenta.
create or replace function private.protect_profile()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null
     and coalesce(private.rol_actual() <> 'director', true)
     and (new.role is distinct from old.role or new.active is distinct from old.active or new.email is distinct from old.email) then
    raise exception 'Solo la dirección puede cambiar el rol, el estado o el correo de una cuenta';
  end if;
  return new;
end;
$$;

create trigger protect_profile
  before update on public.profiles
  for each row execute function private.protect_profile();

-- ============================================================ Datos de la red
create table public.donantes (
  id text primary key,
  -- Cuenta de la app del donante (null si lo registró el operador y aún no se vinculó)
  user_id uuid references auth.users (id) on delete set null,
  cedula text not null unique,
  nombre_completo text not null,
  sangre text not null default '',
  telefono text,
  email text,
  fecha_registro date not null default current_date,
  estado text not null default 'preregistrado' check (estado in ('preregistrado', 'verificado')),
  origen text not null default 'app' check (origen in ('app', 'operador')),
  operador_id text,
  fecha_verificacion date,
  diferido jsonb,
  updated_at timestamptz not null default now()
);
create index donantes_user_id_idx on public.donantes (user_id);

create table public.donaciones (
  id text primary key,
  donante_id text not null references public.donantes (id) on delete restrict,
  donante_nombre text not null,
  donante_cedula text not null,
  tipo_sangre text not null,
  tipo_hemocomponente text not null,
  volumen_ml integer not null check (volumen_ml between 50 and 600),
  fecha date not null default current_date,
  operador_id text not null,
  centro_id text,
  centro_nombre text,
  estado_lab text not null default 'pendiente' check (estado_lab in ('pendiente', 'liberada', 'descartada')),
  updated_at timestamptz not null default now()
);
create index donaciones_donante_id_idx on public.donaciones (donante_id);

create table public.pedidos (
  id text primary key,
  paciente_nombre text not null,
  paciente_cedula text not null default '',
  tipo_sangre text not null,
  tipo_hemocomponente text not null,
  unidades integer not null check (unidades between 1 and 20),
  hospital_destino text not null,
  fecha date not null default current_date,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobado', 'rechazado', 'despachado')),
  prioridad text not null default 'normal' check (prioridad in ('normal', 'urgente', 'critica')),
  servicio text,
  medico text,
  diagnostico text,
  clinica jsonb,
  creado_por text,
  creado_por_nombre text,
  revisado_por text,
  revisado_por_nombre text,
  fecha_revision date,
  motivo_rechazo text,
  entrega_id text,
  updated_at timestamptz not null default now()
);

create table public.entregas (
  id text primary key,
  pedido_id text references public.pedidos (id) on delete set null,
  paciente_nombre text not null,
  paciente_cedula text not null default '',
  tipo_sangre text not null,
  tipo_hemocomponente text not null,
  unidades integer not null check (unidades >= 1),
  hospital_destino text not null,
  fecha date not null default current_date,
  operador_id text not null,
  updated_at timestamptz not null default now()
);

create table public.pruebas (
  id text primary key,
  donacion_id text not null references public.donaciones (id) on delete cascade,
  codigo text not null,
  fecha date not null default current_date,
  resultados jsonb not null,
  resultado_global text not null check (resultado_global in ('negativo', 'positivo', 'indeterminado')),
  tipo_sangre_confirmado text not null,
  lote text,
  observaciones text,
  laboratorista_id text not null,
  updated_at timestamptz not null default now()
);

create table public.fracciones (
  id text primary key,
  donacion_id text not null unique references public.donaciones (id) on delete cascade,
  codigo text not null,
  fecha date not null default current_date,
  productos jsonb not null,
  observaciones text,
  laboratorista_id text not null,
  updated_at timestamptz not null default now()
);

create table public.positivos (
  id text primary key,
  prueba_id text not null references public.pruebas (id) on delete cascade,
  donacion_id text not null references public.donaciones (id) on delete cascade,
  donante_id text not null references public.donantes (id) on delete cascade,
  codigo text not null,
  prueba text not null,
  enfermedad text not null,
  fecha date not null default current_date,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'notificado')),
  notificado_a text,
  referencia text,
  fecha_notificacion date,
  notificado_por text,
  updated_at timestamptz not null default now()
);

create table public.tickets (
  id text primary key,
  owner_id uuid references auth.users (id) on delete set null default auth.uid(),
  codigo text not null,
  donante_id text not null,
  donante_nombre text not null,
  donante_email text not null default '',
  asunto text not null,
  estado text not null default 'abierto' check (estado in ('abierto', 'en_proceso', 'resuelto')),
  prioridad text not null default 'normal' check (prioridad in ('normal', 'alta')),
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  asignado_a jsonb,
  mensajes jsonb not null default '[]'::jsonb,
  resuelto_en timestamptz,
  updated_at timestamptz not null default now()
);
create index tickets_owner_id_idx on public.tickets (owner_id);

-- Notas internas de soporte: tabla aparte para que el donante jamás las reciba
create table public.ticket_notas (
  id text primary key references public.tickets (id) on delete cascade,
  notas jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.citas (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  center_id text not null,
  center_name text not null,
  date date not null,
  time text not null,
  created_at timestamptz not null default now()
);
create index citas_user_id_idx on public.citas (user_id);

-- ============================================================ Reglas de negocio que el navegador no puede saltarse
-- Donante: no puede verificarse ni quitarse un diferimiento a sí mismo.
create or replace function private.protect_donante()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and private.has_role('donante') then
    if tg_op = 'INSERT' then
      new.estado := 'preregistrado';
      new.diferido := null;
      new.operador_id := null;
      new.fecha_verificacion := null;
      new.user_id := auth.uid();
    else
      new.estado := old.estado;
      new.diferido := old.diferido;
      new.operador_id := old.operador_id;
      new.fecha_verificacion := old.fecha_verificacion;
      new.user_id := old.user_id;
      new.cedula := case when old.estado = 'verificado' then old.cedula else new.cedula end;
    end if;
  elsif auth.uid() is not null and tg_op = 'UPDATE' and not private.has_role('director') then
    -- El personal no reasigna a qué cuenta pertenece un registro
    new.user_id := old.user_id;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger protect_donante
  before insert or update on public.donantes
  for each row execute function private.protect_donante();

-- Donaciones: lo que registra el operador entra siempre en cuarentena (lo libera el laboratorio).
create or replace function private.protect_donacion()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and tg_op = 'INSERT' and not private.has_role('laboratorio', 'director') then
    new.estado_lab := 'pendiente';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger protect_donacion
  before insert or update on public.donaciones
  for each row execute function private.protect_donacion();

-- Solicitudes: el operador las crea "pendientes" y solo puede pasarlas de "aprobado" a "despachado".
create or replace function private.protect_pedido()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.has_role('director') then
    if tg_op = 'INSERT' then
      new.estado := 'pendiente';
      new.revisado_por := null;
      new.revisado_por_nombre := null;
      new.fecha_revision := null;
      new.motivo_rechazo := null;
    elsif not (old.estado = 'aprobado' and new.estado = 'despachado') then
      raise exception 'Solo la dirección aprueba o rechaza solicitudes; el operador solo despacha las aprobadas';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger protect_pedido
  before insert or update on public.pedidos
  for each row execute function private.protect_pedido();

-- ============================================================ Permisos de tabla (las filas las filtra RLS)
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.donantes enable row level security;
alter table public.donaciones enable row level security;
alter table public.pedidos enable row level security;
alter table public.entregas enable row level security;
alter table public.pruebas enable row level security;
alter table public.fracciones enable row level security;
alter table public.positivos enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_notas enable row level security;
alter table public.citas enable row level security;

-- ---------- profiles
create policy "perfil: ver el propio o la dirección todos" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.has_role('director')));
create policy "perfil: editar el propio o la dirección" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or (select private.has_role('director')))
  with check (id = (select auth.uid()) or (select private.has_role('director')));

-- ---------- donantes
create policy "donantes: personal ve todos, donante el suyo" on public.donantes for select to authenticated
  using ((select private.has_role('operador', 'laboratorio', 'soporte', 'director')) or user_id = (select auth.uid()));
create policy "donantes: operador o dirección registran; donante se pre-registra" on public.donantes for insert to authenticated
  with check ((select private.has_role('operador', 'director')) or ((select private.has_role('donante')) and user_id = (select auth.uid())));
create policy "donantes: actualizan operador, laboratorio, dirección o el propio donante" on public.donantes for update to authenticated
  using ((select private.has_role('operador', 'laboratorio', 'director')) or user_id = (select auth.uid()))
  with check ((select private.has_role('operador', 'laboratorio', 'director')) or user_id = (select auth.uid()));
create policy "donantes: borra la dirección" on public.donantes for delete to authenticated
  using ((select private.has_role('director')));

-- ---------- donaciones
create policy "donaciones: personal ve todas, donante las suyas" on public.donaciones for select to authenticated
  using (
    (select private.has_role('operador', 'laboratorio', 'soporte', 'director'))
    or donante_id in (select d.id from public.donantes d where d.user_id = (select auth.uid()))
  );
create policy "donaciones: registran operador o dirección" on public.donaciones for insert to authenticated
  with check ((select private.has_role('operador', 'director')));
create policy "donaciones: laboratorio o dirección cambian su estado" on public.donaciones for update to authenticated
  using ((select private.has_role('laboratorio', 'director')))
  with check ((select private.has_role('laboratorio', 'director')));
create policy "donaciones: borra la dirección" on public.donaciones for delete to authenticated
  using ((select private.has_role('director')));

-- ---------- pedidos (solicitudes)
create policy "pedidos: ven operador y dirección" on public.pedidos for select to authenticated
  using ((select private.has_role('operador', 'director')));
create policy "pedidos: crean operador y dirección" on public.pedidos for insert to authenticated
  with check ((select private.has_role('operador', 'director')));
create policy "pedidos: actualizan operador (despacho) y dirección" on public.pedidos for update to authenticated
  using ((select private.has_role('operador', 'director')))
  with check ((select private.has_role('operador', 'director')));
create policy "pedidos: borra la dirección si no se despachó" on public.pedidos for delete to authenticated
  using ((select private.has_role('director')) and estado <> 'despachado');

-- ---------- entregas
create policy "entregas: ven operador y dirección" on public.entregas for select to authenticated
  using ((select private.has_role('operador', 'director')));
create policy "entregas: registran operador y dirección" on public.entregas for insert to authenticated
  with check ((select private.has_role('operador', 'director')));

-- ---------- laboratorio (solo laboratorio; la dirección ve un resumen por la función de abajo)
create policy "pruebas: laboratorio" on public.pruebas for all to authenticated
  using ((select private.has_role('laboratorio'))) with check ((select private.has_role('laboratorio')));
create policy "fracciones: laboratorio" on public.fracciones for all to authenticated
  using ((select private.has_role('laboratorio'))) with check ((select private.has_role('laboratorio')));
create policy "fracciones: operador y dirección ven qué se obtuvo (stock)" on public.fracciones for select to authenticated
  using ((select private.has_role('operador', 'director')));
create policy "positivos: laboratorio" on public.positivos for all to authenticated
  using ((select private.has_role('laboratorio'))) with check ((select private.has_role('laboratorio')));

-- ---------- tickets de soporte
create policy "tickets: soporte y dirección ven todos, donante los suyos" on public.tickets for select to authenticated
  using ((select private.has_role('soporte', 'director')) or owner_id = (select auth.uid()));
create policy "tickets: los crea el donante o soporte" on public.tickets for insert to authenticated
  with check ((select private.has_role('soporte')) or ((select private.has_role('donante')) and owner_id = (select auth.uid())));
create policy "tickets: responden soporte o el donante dueño" on public.tickets for update to authenticated
  using ((select private.has_role('soporte')) or owner_id = (select auth.uid()))
  with check ((select private.has_role('soporte')) or owner_id = (select auth.uid()));
create policy "notas internas: solo soporte" on public.ticket_notas for all to authenticated
  using ((select private.has_role('soporte'))) with check ((select private.has_role('soporte')));

-- ---------- citas
create policy "citas: el donante las suyas; operador y dirección ven todas" on public.citas for select to authenticated
  using (user_id = (select auth.uid()) or (select private.has_role('operador', 'director')));
create policy "citas: el donante crea las suyas" on public.citas for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "citas: el donante cambia o cancela las suyas" on public.citas for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "citas: el donante borra las suyas" on public.citas for delete to authenticated
  using (user_id = (select auth.uid()));

-- ============================================================ Resumen del laboratorio para la dirección
-- Sin la prueba reactiva ni el donante: solo lo necesario para KPIs y reportes.
create or replace function public.resumen_laboratorio()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.has_role('director', 'laboratorio') then
    raise exception 'Sin permiso';
  end if;
  return jsonb_build_object(
    'pruebas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'donacion_id', p.donacion_id, 'codigo', p.codigo, 'fecha', p.fecha,
        'resultado_global', p.resultado_global, 'tipo_sangre_confirmado', p.tipo_sangre_confirmado,
        'laboratorista_id', p.laboratorista_id, 'resultados', '{}'::jsonb))
      from public.pruebas p), '[]'::jsonb),
    'positivos', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'estado', c.estado, 'fecha', c.fecha, 'codigo', c.codigo))
      from public.positivos c), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.resumen_laboratorio() from public, anon;
grant execute on function public.resumen_laboratorio() to authenticated;

-- ============================================================ Vincular la cuenta del donante con su registro
-- Si el operador registró al donante en persona, el donante enlaza su cuenta con su cédula.
-- Solo se vincula un registro sin dueño y cuyo correo (si lo tiene) es el de la cuenta.
create or replace function public.vincular_mi_registro(p_cedula text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_id text;
begin
  if not private.has_role('donante') then
    raise exception 'Solo los donantes vinculan su registro';
  end if;
  update public.donantes d
     set user_id = auth.uid()
   where d.cedula = p_cedula
     and d.user_id is null
     and (d.email is null or lower(d.email) = lower((select u.email from auth.users u where u.id = auth.uid())))
  returning d.id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.vincular_mi_registro(text) from public, anon;
grant execute on function public.vincular_mi_registro(text) to authenticated;
