-- BLUD · Ajustes de la auditoría del 27/11/2026 (avisos de seguridad y rendimiento de Supabase). Se puede repetir.
--   1. Cuatro funciones auxiliares sin search_path fijo (aviso function_search_path_mutable).
--   2. Clave foránea sin índice: hemo_vigilancia.registrado_por.
--   3. Índice duplicado en bitacora_auditoria (idx_bitacora_fecha = idx_auditoria_fecha).

alter function public._sufijo_componente(text) set search_path = public, pg_temp;
alter function public._resultado_ok(text) set search_path = public, pg_temp;
alter function public._compatible(text, text, text, text, text) set search_path = public, pg_temp;
alter function private.msg_json(public.chat_mensaje) set search_path = public, pg_temp;

create index if not exists idx_hemo_vigilancia_registrado_por on public.hemo_vigilancia (registrado_por);

drop index if exists public.idx_bitacora_fecha;
