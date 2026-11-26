-- BLUD · bitacora_auditoria.operacion es varchar(20): acorta los códigos de hemovigilancia que no cabían
-- (HEMOVIGILANCIA_EDICION → HV_EDICION, HEMOVIGILANCIA_CIERRE → HV_CIERRE). La versión de 20261125120000 en el
-- repositorio ya trae los nombres cortos; esto corrige la que se aplicó antes de notarlo. Se puede repetir.
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.blud_registrar_hemovigilancia(jsonb)'::regprocedure);
  if position('HEMOVIGILANCIA_' in v_def) > 0 then
    v_def := replace(replace(v_def, '''HEMOVIGILANCIA_CIERRE''', '''HV_CIERRE'''), '''HEMOVIGILANCIA_EDICION''', '''HV_EDICION''');
    execute v_def;
  end if;
end $$;
