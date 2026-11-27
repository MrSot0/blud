-- BLUD · Corrige blud_pedido_centro_recibir: el estado de la unidad se asigna con su tipo (enum_estado_unidad).
-- La versión de 20261127110000 en el repositorio ya lo trae; esto corrige la que se aplicó antes. Se puede repetir.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.blud_pedido_centro_recibir(text, jsonb)'::regprocedure);
  if position('::enum_estado_unidad' in v_def) = 0 then
    v_def := replace(v_def, 'estado = case when v_conforme then ''Disponible'' else ''Cuarentena'' end,',
                            'estado = (case when v_conforme then ''Disponible'' else ''Cuarentena'' end)::enum_estado_unidad,');
    if position('::enum_estado_unidad' in v_def) = 0 then raise exception 'No se pudo corregir blud_pedido_centro_recibir.'; end if;
    execute v_def;
  end if;
end $$;
