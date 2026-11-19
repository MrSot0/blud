-- BLUD · Sedes con coordenadas para los mapas (mapa de calor del director y, más adelante, /centros).
-- Datos públicos de la red: nombre, tipo, dirección, ciudad, teléfono, coordenadas y si recibe citas. Se puede repetir.

create or replace function public.blud_sedes_mapa() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', s.sedeid,
    'nombre', s.nombre,
    'tipo', s.tipo::text,
    'direccion', nullif(s.direccion, 'Por definir'),
    'ciudad', s.ciudad,
    'telefono', s.telefono,
    'lat', s.latitud,
    'lng', s.longitud,
    'recibeCitas', s.recibe_citas
  )) order by s.nombre), '[]')
  from sede s
$$;

revoke all on function public.blud_sedes_mapa() from public;
grant execute on function public.blud_sedes_mapa() to anon, authenticated;
