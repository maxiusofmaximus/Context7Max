-- ═══════════════════════════════════════════════════════════════════
-- Context7Max v3 — capas de conocimiento: guides (roadmaps paso a paso),
-- skills de agentes, y servidores MCP.
-- ═══════════════════════════════════════════════════════════════════

-- ── Guides: unidades de conocimiento paso a paso (roadmaps, currículos)
create table if not exists guides (
  id           bigint generated always as identity primary key,
  source       text not null,              -- 'roadmap.sh' | 'ossu' | 'freecodecamp' | 'odin' | 'fullstackopen' | 'missing-semester' | ...
  domain       text not null,              -- 'frontend' | 'android' | 'gamedev' | 'ai-engineer' | ...
  track        text,                       -- sub-sendero dentro del roadmap/currículo
  node_id      text,                       -- id estable del nodo/tema en el origen
  title        text not null,
  body         text not null,              -- verbatim: párrafo/lección/sección
  links        jsonb not null default '[]',-- [{type,label,url}] enlaces tipados (@official@, @course@…)
  position     int  not null default 0,    -- orden dentro del track cuando se conoce
  license      text,                       -- 'MIT' | 'CC BY-NC-SA 4.0' | 'proprietary-reference' …
  tokens       integer not null default 0,
  content_hash text not null,
  -- clave dedup generada (upsert por PostgREST requiere columna real)
  dedup_key    text generated always as
               (source || '|' || domain || '|' || coalesce(track, '') || '|' ||
                coalesce(node_id, '') || '|' || content_hash) stored,
  embedding    halfvec(384),
  fts          tsvector generated always as (
                 setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(domain, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(track, '')), 'B') ||
                 setweight(to_tsvector('simple', coalesce(body, '')), 'C')
               ) stored
);
create unique index if not exists guides_dedup_uidx on guides (dedup_key);
comment on table guides is 'Unidades de conocimiento paso a paso por dominio (roadmaps, currículos).';

-- ── Skills de agentes IA (formato SKILL.md / agentskills.io)
create table if not exists skills (
  id           text primary key,           -- 'github:owner/repo/path#skill-name' | 'uiskills:slug'
  source       text not null,              -- 'skills.sh' | 'ui-skills' | 'github'
  name         text not null,
  description  text,                       -- discovery layer (~100 tok)
  repo_url     text,
  raw_url      text,
  body         text not null,              -- SKILL.md verbatim (activation layer)
  frontmatter  jsonb not null default '{}',
  files        jsonb not null default '[]',-- [{path, bytes}] acompañantes
  content_hash text not null,
  license      text,
  installs     integer not null default 0, -- señal de popularidad si la hay
  trust        jsonb not null default '{}',-- auditorías externas (skills.sh)
  tokens       integer not null default 0,
  embedding    halfvec(384),
  fts          tsvector generated always as (
                 setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
                 setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
                 setweight(to_tsvector('simple', coalesce(body, '')), 'C')
               ) stored,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
comment on table skills is 'Agent skills indexadas (progressive disclosure: description = discovery, body = activation).';

-- ── Servidores MCP conocidos (registros oficiales)
create table if not exists mcp_servers (
  name        text primary key,
  description text,
  url         text,
  repo        text,
  registry    text not null,               -- 'modelcontextprotocol' | 'smithery'
  verified    boolean not null default false,
  use_count   integer not null default 0,
  fts         tsvector generated always as (
                setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
                setweight(to_tsvector('simple', coalesce(description, '')), 'B')
              ) stored,
  updated_at  timestamptz not null default now()
);

-- ═══════════════ Índices ═══════════════
create index if not exists guides_fts_idx       on guides using gin (fts);
create index if not exists guides_domain_idx    on guides (domain, source);
create index if not exists guides_embed_idx     on guides using hnsw (embedding halfvec_cosine_ops);
create index if not exists skills_fts_idx       on skills using gin (fts);
create index if not exists skills_name_trgm     on skills using gin (name gin_trgm_ops);
create index if not exists skills_embed_idx     on skills using hnsw (embedding halfvec_cosine_ops);
create index if not exists mcp_servers_fts_idx  on mcp_servers using gin (fts);

-- ═══════════════ RPC: búsqueda de guías (híbrida) ═══════════════
create or replace function search_guides(
  p_query     text,
  p_domain    text default null,
  p_embedding halfvec default null,
  p_limit     int default 25,
  p_fast      boolean default false
) returns jsonb
language plpgsql stable as $$
declare
  v_tsq tsquery;
begin
  select to_tsquery('simple', string_agg(t, ' | '))
    into v_tsq
    from (
      select distinct regexp_replace(tok, '[^a-z0-9_.\-]', '', 'g') as t
      from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as tok
      where length(regexp_replace(tok, '[^a-z0-9_.\-]', '', 'g')) >= 3
      limit 10
    ) s;

  return (
    select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.score desc), '[]'::jsonb)
    from (
      select g.source, g.domain, g.track, g.node_id, g.title, g.body, g.links,
             g.position, g.license, g.tokens,
             ( 0.7 * case
                       when not p_fast and p_embedding is not null and g.embedding is not null
                       then 1 - (g.embedding <=> p_embedding)
                       else 0 end
             + 0.3 * ts_rank(g.fts, coalesce(v_tsq, ''::tsquery))
             )::real as score
      from guides g
      where (p_domain is null or g.domain = p_domain)
        and (
          case when p_fast then (v_tsq is not null and g.fts @@ v_tsq)
          else ( (v_tsq is not null and g.fts @@ v_tsq)
                 or (p_embedding is not null and g.embedding is not null
                     and 1 - (g.embedding <=> p_embedding) > 0.2) )
          end
        )
      order by score desc
      limit p_limit
    ) r
  );
end $$;

-- ═══════════════ RPC: búsqueda de skills (híbrida) ═══════════════
create or replace function search_skills(
  p_query     text,
  p_embedding halfvec default null,
  p_limit     int default 15,
  p_fast      boolean default false
) returns jsonb
language plpgsql stable as $$
declare
  v_tsq tsquery;
begin
  select to_tsquery('simple', string_agg(t, ' | '))
    into v_tsq
    from (
      select distinct regexp_replace(tok, '[^a-z0-9_.\-]', '', 'g') as t
      from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as tok
      where length(regexp_replace(tok, '[^a-z0-9_.\-]', '', 'g')) >= 3
      limit 10
    ) s;

  return (
    select coalesce(jsonb_agg(row_to_json(r)::jsonb order by r.score desc), '[]'::jsonb)
    from (
      select s.id, s.name, s.description, s.source, s.repo_url, s.installs,
             s.license, s.trust, s.tokens,
             ( 0.7 * case
                       when not p_fast and p_embedding is not null and s.embedding is not null
                       then 1 - (s.embedding <=> p_embedding)
                       else 0 end
             + 0.3 * ts_rank(s.fts, coalesce(v_tsq, ''::tsquery))
             + 0.1 * similarity(lower(s.name), lower(p_query))
             + 0.05 * ln(1 + greatest(s.installs, 0))
             )::real as score
      from skills s
      where (
        case when p_fast then (v_tsq is not null and s.fts @@ v_tsq)
        else ( (v_tsq is not null and s.fts @@ v_tsq)
               or similarity(lower(s.name), lower(p_query)) > 0.2
               or (p_embedding is not null and s.embedding is not null
                   and 1 - (s.embedding <=> p_embedding) > 0.2) )
        end
      )
      order by score desc
      limit p_limit
    ) r
  );
end $$;
