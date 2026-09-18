-- Medida de uso de la base (para vigilar el límite de 500MB del free tier)

create or replace function db_size_info()
returns jsonb
language plpgsql security definer
as $$
declare
  v_total bigint := pg_database_size(current_database());
begin
  return jsonb_build_object(
    'total_bytes', v_total,
    'total_mb', round(v_total / 1048576.0, 1),
    'by_table', (
      select jsonb_agg(jsonb_build_object(
        'table', relname,
        'mb', round(pg_total_relation_size(c.oid) / 1048576.0, 2)
      ) order by pg_total_relation_size(c.oid) desc)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','i')
        and pg_total_relation_size(c.oid) > 1048576
    ),
    'free_tier_remaining_mb', round((524288000 - v_total) / 1048576.0, 1)
  );
end $$;

comment on function db_size_info is 'Uso de almacenamiento y margen del free tier (500MB)';
