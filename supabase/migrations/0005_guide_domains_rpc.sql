-- Agregado de dominios de guías (evita el límite de 1000 filas de PostgREST)

create or replace function guide_domains()
returns table (domain text, source text, count bigint)
language sql stable as $$
  select g.domain, g.source, count(*)::bigint
  from guides g
  group by g.domain, g.source
  order by 3 desc;
$$;

comment on function guide_domains is 'Resumen dominio × fuente con conteo de guías.';
