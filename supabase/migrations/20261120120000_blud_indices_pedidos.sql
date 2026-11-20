-- BLUD · Índices de pedido_entre_centros (claves foráneas y filtros de las bandejas). Se puede repetir.
create index if not exists pedido_ec_sede_solicitante_idx on public.pedido_entre_centros (sede_solicitante);
create index if not exists pedido_ec_sede_proveedora_idx on public.pedido_entre_centros (sede_proveedora);
create index if not exists pedido_ec_componente_idx on public.pedido_entre_centros (componenteid);
create index if not exists pedido_ec_tiposangre_idx on public.pedido_entre_centros (tiposangreid);
create index if not exists pedido_ec_solicitud_local_idx on public.pedido_entre_centros (solicitud_local_id);
create index if not exists pedido_ec_creado_por_idx on public.pedido_entre_centros (creado_por);
create index if not exists pedido_ec_revisado_por_idx on public.pedido_entre_centros (revisado_por);
create index if not exists pedido_ec_despachado_por_idx on public.pedido_entre_centros (despachado_por);
create index if not exists pedido_ec_recibido_por_idx on public.pedido_entre_centros (recibido_por);
