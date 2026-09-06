-- ═══════════════════════════════════════════════════════════════════
-- Context7Max — schema inicial
-- Supabase (Postgres 15+) + pgvector (halfvec 384 = gte-small) + pg_trgm
-- ═══════════════════════════════════════════════════════════════════

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ── Catalog: light, name-resolution only (seeded in bulk, ~1400+ entries)
create table if not exists catalog (
  id          text primary key,             -- "/org/project"
  title       text not null,
  description text,
  source_type text not null check (source_type in ('github','llmstxt','website','openapi')),
  source_url  text not null,
  tags        text[] not null default '{}',
  stars       integer not null default 0,
  trust_score integer not null default 5,
  created_at  timestamptz not null default now()
);

-- ── Libraries: fully indexed documentation
create table if not exists libraries (
  id             text primary key,          -- "/org/project"
  title          text not null,
  description    text,
  source_type    text not null check (source_type in ('github','llmstxt','website','openapi')),
  source_url     text not null,
  branch         text,
  repo_sha       text,                      -- commit indexed (staleness check)
  license        text,
  stars          integer not null default 0,
  trust_score    integer not null default 5,
  state          text not null default 'initial'
                 check (state in ('initial','queued','parsing','embedding','finalized','error')),
  state_message  text,
  total_tokens   integer not null default 0,
  total_snippets integer not null default 0,
  versions       text[] not null default '{}',
  rules          text[] not null default '{}',
  settings       jsonb not null default '{}',
  quality        jsonb not null default '{}',  -- coverage metrics
  last_update_at timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- ── Code snippets (verbatim docs examples)
create table if not exists code_snippets (
  id           bigint generated always as identity primary key,
  library_id   text not null references libraries(id) on delete cascade,
  version      text not null default 'main',
  title        text not null,
  description  text,
  language     text,
  code         text not null,
  tokens       integer not null default 0,
  source_url   text,
  source_file  text,
  line_start   integer,
  line_end     integer,
  breadcrumb   text,
  content_hash text not null,
  embedding    halfvec(384),
  fts          tsvector generated always as (
                 setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
                 setweight(to_tsvector('simple', coalesce(language, '')), 'B') ||
                 setweight(to_tsvector('simple', coalesce(code, '')), 'C')
               ) stored,
  unique (library_id, version, content_hash)
);

-- ── Info snippets (prose documentation)
create table if not exists info_snippets (
  id           bigint generated always as identity primary key,
  library_id   text not null references libraries(id) on delete cascade,
  version      text not null default 'main',
  page_title   text,
  breadcrumb   text,
  content      text not null,
  tokens       integer not null default 0,
  source_url   text,
  source_file  text,
  content_hash text not null,
  embedding    halfvec(384),
  fts          tsvector generated always as (
                 setweight(to_tsvector('simple', coalesce(page_title, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(breadcrumb, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(content, '')), 'B')
               ) stored,
  unique (library_id, version, content_hash)
);

-- ── Ingestion jobs (transparent state machine)
create table if not exists jobs (
  id         uuid primary key default gen_random_uuid(),
  library_id text not null,
  action     text not null check (action in ('ingest','refresh','remove')),
  status     text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  stage      text,
  message    text,
  stats      jsonb not null default '{}',
  actor      text not null default 'cli' check (actor in ('cli','action','api','cron')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── API keys (bcrypt-ish: sha256 + pepper is enough for a personal gate)
create table if not exists api_keys (
  id         bigint generated always as identity primary key,
  key_hash   text not null unique,
  label      text,
  created_at timestamptz not null default now()
);

-- ═══════════════ Indexes ═══════════════

create index if not exists code_snippets_fts_idx     on code_snippets using gin (fts);
create index if not exists info_snippets_fts_idx     on info_snippets using gin (fts);
create index if not exists code_snippets_lib_ver_idx on code_snippets (library_id, version);
create index if not exists info_snippets_lib_ver_idx on info_snippets (library_id, version);
create index if not exists libraries_title_trgm      on libraries using gin (title gin_trgm_ops);
create index if not exists libraries_id_trgm         on libraries using gin (id gin_trgm_ops);
create index if not exists catalog_title_trgm        on catalog using gin (title gin_trgm_ops);
create index if not exists catalog_id_trgm           on catalog using gin (id gin_trgm_ops);
create index if not exists jobs_lib_idx              on jobs (library_id, created_at desc);

-- HNSW over halfvec (only worthwhile once rows exist; cheap to keep)
create index if not exists code_snippets_embed_idx on code_snippets using hnsw (embedding halfvec_cosine_ops);
create index if not exists info_snippets_embed_idx on info_snippets using hnsw (embedding halfvec_cosine_ops);

-- ═══════════════ RPC: library search (catalog + indexed) ═══════════════

create or replace function search_libraries(
  p_name  text,
  p_query text default '',
  p_limit int  default 8
) returns table (
  id text, title text, description text, source_type text,
  stars integer, trust_score integer,
  indexed boolean, state text, total_tokens integer, total_snippets integer,
  versions text[], last_update_at text, branch text, score real
) language sql stable as $$
  with candidates as (
    select l.id, l.title, l.description, l.source_type, l.stars, l.trust_score,
           true as indexed, l.state, l.total_tokens, l.total_snippets,
           l.versions, l.last_update_at::text, l.branch
    from libraries l
    where l.state in ('finalized','parsing','embedding','queued')
      and (
        lower(l.title) = lower(trim(p_name))
        or lower(l.id) = lower(trim(p_name))
        or lower(l.id) = '/' || lower(trim(p_name))
        or l.id ilike '%/' || trim(p_name)
        or l.title ilike '%' || trim(p_name) || '%'
        or similarity(lower(l.title), lower(trim(p_name))) > 0.15
        or similarity(lower(l.id), lower(trim(p_name))) > 0.2
      )
    union all
    select c.id, c.title, c.description, c.source_type, c.stars, c.trust_score,
           false, null, null, null, null, null, null
    from catalog c
    where not exists (select 1 from libraries l where l.id = c.id)
      and (
        lower(c.title) = lower(trim(p_name))
        or c.id ilike '%/' || trim(p_name)
        or c.title ilike '%' || trim(p_name) || '%'
        or similarity(lower(c.title), lower(trim(p_name))) > 0.15
        or similarity(lower(c.id), lower(trim(p_name))) > 0.2
      )
  )
  select
    c.*,
    (
      6.0 * case when lower(c.title) = lower(trim(p_name)) then 1 else 0 end +
      5.0 * case when lower(c.id) = lower(trim(p_name)) or lower(c.id) = '/' || lower(trim(p_name)) then 1 else 0 end +
      3.0 * case when c.id ilike '%/' || trim(p_name) then 1 else 0 end +
      3.0 * similarity(lower(c.title), lower(trim(p_name))) +
      1.5 * similarity(lower(c.id), lower(trim(p_name))) +
      2.0 * case when c.indexed then 1 else 0 end +
      0.4 * ln(1 + greatest(c.stars, 0)) +
      0.2 * c.trust_score
    )::real as score
  from candidates c
  order by score desc, c.stars desc
  limit p_limit;
$$;

-- ═══════════════ RPC: hybrid context matching ═══════════════
-- 0.7 * cosine similarity (when embedding available) + 0.3 * FTS rank
-- with token budgets: ~70% to code, ~30% to prose.

create or replace function match_context(
  p_library_id      text,
  p_version         text default null,
  p_query           text default '',
  p_query_embedding halfvec default null,
  p_max_tokens      int default 4000,
  p_fast            boolean default false
) returns jsonb
language plpgsql stable as $$
declare
  v_version text;
  v_tsq     tsquery := websearch_to_tsquery('simple', coalesce(p_query, ''));
  v_code_budget int := greatest(floor(p_max_tokens * 0.7), 200);
  v_info_budget int := greatest(floor(p_max_tokens * 0.3), 100);
  v_result  jsonb;
begin
  -- resolve version: requested, else the version with most snippets
  select coalesce(
    p_version,
    (select version from code_snippets
      where library_id = p_library_id
      group by version order by count(*) desc limit 1),
    'main'
  ) into v_version;

  with code_ranked as (
    select s.title, s.description, s.language, s.tokens, s.source_url,
           s.source_file, s.breadcrumb, s.code,
           ( 0.7 * case
                     when not p_fast and p_query_embedding is not null and s.embedding is not null
                     then 1 - (s.embedding <=> p_query_embedding)
                     else 0 end
           + 0.3 * ts_rank(s.fts, v_tsq)
           )::real as score
    from code_snippets s
    where s.library_id = p_library_id
      and s.version = v_version
      and (
        case when p_fast then (s.fts @@ v_tsq)
        else ( (s.fts @@ v_tsq)
               or (p_query_embedding is not null and s.embedding is not null
                   and 1 - (s.embedding <=> p_query_embedding) > 0.3) )
        end
      )
    order by score desc
    limit 60
  ),
  code_budget as (
    select *, sum(tokens) over (order by score desc) as run_total
    from code_ranked
  ),
  code_picked as (
    select * from code_budget where run_total <= v_code_budget + tokens
  ),
  info_ranked as (
    select s.page_title, s.breadcrumb, s.content, s.tokens, s.source_url,
           ( 0.7 * case
                     when not p_fast and p_query_embedding is not null and s.embedding is not null
                     then 1 - (s.embedding <=> p_query_embedding)
                     else 0 end
           + 0.3 * ts_rank(s.fts, v_tsq)
           )::real as score
    from info_snippets s
    where s.library_id = p_library_id
      and s.version = v_version
      and (
        case when p_fast then (s.fts @@ v_tsq)
        else ( (s.fts @@ v_tsq)
               or (p_query_embedding is not null and s.embedding is not null
                   and 1 - (s.embedding <=> p_query_embedding) > 0.3) )
        end
      )
    order by score desc
    limit 30
  ),
  info_budget as (
    select *, sum(tokens) over (order by score desc) as run_total
    from info_ranked
  ),
  info_picked as (
    select * from info_budget where run_total <= v_info_budget + tokens
  )
  select jsonb_build_object(
    'codeSnippets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', title, 'description', description, 'language', language,
        'tokens', tokens, 'source_url', source_url, 'source_file', source_file,
        'breadcrumb', breadcrumb, 'code', code,
        'score', round(score::numeric, 4)
      ) order by score desc)
      from code_picked
    ), '[]'::jsonb),
    'infoSnippets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'page_title', page_title, 'breadcrumb', breadcrumb, 'content', content,
        'tokens', tokens, 'source_url', source_url,
        'score', round(score::numeric, 4)
      ) order by score desc)
      from info_picked
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;

-- ═══════════════ RLS: deny-all by default, service_role bypasses ═══

alter table catalog       enable row level security;
alter table libraries     enable row level security;
alter table code_snippets enable row level security;
alter table info_snippets enable row level security;
alter table jobs          enable row level security;
alter table api_keys      enable row level security;
