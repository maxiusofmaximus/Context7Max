-- 🔒 RLS en toda la base: nadie accede salvo service_role (nuestro servidor).
-- Idempotente y defensivo: recorre TODAS las tablas de `public`, incluidas
-- las que se creen en el futuro al reaplicar.
--
-- Sin policies → anon/authenticated no leen ni escriben nada (deny by default).
-- El acceso real es siempre server-side con la service_role key, que bypasea RLS.

do $$
declare
  t record;
begin
  for t in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
  end loop;
end $$;

-- Guardia explícita (documenta el estado esperado)
alter table if exists guides       force row level security;
alter table if exists skills       force row level security;
alter table if exists mcp_servers  force row level security;
alter table if exists libraries    force row level security;
alter table if exists code_snippets force row level security;
alter table if exists info_snippets force row level security;
alter table if exists catalog      force row level security;
alter table if exists jobs         force row level security;
alter table if exists api_keys     force row level security;
