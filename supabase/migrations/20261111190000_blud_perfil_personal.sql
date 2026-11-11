-- BLUD · El perfil de cualquier usuario (personal incluido) devuelve su cédula, para que "Mi perfil"
-- la lea de la base en lugar de guardarla en el navegador. Se aplica después de 20261111170000. Se puede repetir.
create or replace function public.blud_mi_perfil() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_email text := lower(auth.jwt() ->> 'email');
  v jsonb;
begin
  if v_email is null then return null; end if;
  select jsonb_build_object(
    'id', u.usuarioid::text, 'email', lower(u.correo), 'full_name', trim(u.nombres || ' ' || u.apellidos),
    'role', private.rol_de(u.rol::text, p.cargo::text), 'blood_type', private.ts_txt(d.tipo_sangre),
    'phone', nullif(u.telefono, ''), 'cargo', private.cargo_label(p.cargo::text),
    'sede', coalesce(s.nombre, sr.nombre), 'sede_id', coalesce(p.sedeid, u.sederegistroid),
    'colegiado', p.colegiado, 'active', u.activo, 'cedula', private.cedula(u.cedula))
  into v
  from usuario u
  left join personalsalud p on p.usuarioid = u.usuarioid
  left join donante d on d.usuarioid = u.usuarioid
  left join sede s on s.sedeid = p.sedeid
  left join sede sr on sr.sedeid = u.sederegistroid
  where lower(u.correo) = v_email
  limit 1;
  -- Cuenta recién creada que aún no completa su ficha de donante.
  return coalesce(v, (
    select jsonb_build_object('id', id::text, 'email', v_email, 'full_name', coalesce(raw_user_meta_data ->> 'full_name', v_email),
      'role', 'donante', 'blood_type', raw_user_meta_data ->> 'blood_type', 'active', true)
    from auth.users where id = auth.uid()));
end $$;
