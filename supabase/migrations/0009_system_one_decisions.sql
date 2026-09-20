-- ═══════════════════════════════════════════════════════════════════
-- Context7Max — System One Models / decisión (fase 1: registro)
-- Specs de decisión (contratos System One) + log de decisiones para calibración.
-- ═══════════════════════════════════════════════════════════════════

-- ── Specs de decisión: contratos {state, questions} → decisiones tipadas ──
create table if not exists decision_specs (
  id            text primary key,           -- 'prompt-injection-audit' | 'github:org/repo/path'
  name          text not null,
  description   text,
  domain        text,                        -- 'security' | 'quality' | 'routing' | 'custom'
  source        text not null default 'builtin',  -- builtin | github | typesafe | custom
  state_hint    text,                        -- qué meter en 'state' (pista para el agente)
  questions     jsonb not null,              -- { id: { type: choice|score|noul, instructions, criteria } }
  routing       jsonb not null default '{}', -- thresholds/rules, p.ej. {"on_confidence_below":0.7,"action":"escalate"}
  license       text,
  scope         text default 'public',       -- public | internal
  content_hash  text not null,
  tokens        integer not null default 0,
  embedding     halfvec(384),
  fts           tsvector generated always as (
                  setweight(to_tsvector('simple', coalesce(name, '')), 'A') ||
                  setweight(to_tsvector('simple', coalesce(description, '')), 'B') ||
                  setweight(to_tsvector('simple', coalesce(domain, '')), 'B') ||
                  setweight(to_tsvector('simple', coalesce(questions::text, '')), 'C')
                ) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table decision_specs is 'Contratos de decisión System One (Jev-style): qué preguntar con estado dado.';

-- ── Log de decisiones ejecutadas: sirve para calibrar (ECE/Brier) ──
create table if not exists decision_log (
  id            bigint generated always as identity primary key,
  spec_id       text not null,
  backend       text not null,              -- typesafe | llamacpp | laya | hf-local | llm-fallback
  model         text,
  input_hash    text not null,              -- sha256(state+questions+model) para memo-caché
  latency_ms    integer,
  output        jsonb not null,             -- answers completos
  confidence    real,                       -- confianza agregada (min o la más marcante)
  outcome       boolean,                    -- null = no evaluado; true/false = correcto/incorrecto
  user_notes    text,
  created_at    timestamptz not null default now()
);

-- ═══════════════ Índices ═══════════════
create index if not exists decision_specs_fts_idx   on decision_specs using gin (fts);
create index if not exists decision_specs_embed_idx on decision_specs using hnsw (embedding halfvec_cosine_ops);
create index if not exists decision_log_spec_idx    on decision_log (spec_id, created_at desc);
create index if not exists decision_log_memo_idx    on decision_log (input_hash) where outcome is null;

-- ═══════════════ RPC: búsqueda de specs (híbrida, índice-friendly) ═══════════════
create or replace function search_decision_specs(
  p_query     text,
  p_embedding halfvec default null,
  p_domain    text default null,
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
      select s.id, s.name, s.description, s.domain, s.source, s.state_hint,
             s.questions, s.routing, s.license, s.tokens,
             ( 0.7 * case
                       when not p_fast and p_embedding is not null and s.embedding is not null
                       then 1 - (s.embedding <=> p_embedding)
                       else 0 end
             + 0.3 * ts_rank(s.fts, coalesce(v_tsq, ''::tsquery))
             )::real as score
      from decision_specs s
      where (p_domain is null or s.domain = p_domain)
        and (
          case when p_fast
            then (v_tsq is not null and s.fts @@ v_tsq)
            else ( (v_tsq is not null and s.fts @@ v_tsq)
                   or (p_embedding is not null and s.embedding is not null
                       and 1 - (s.embedding <=> p_embedding) > 0.22) )
          end
        )
      order by score desc
      limit p_limit
    ) r
  );
end $$;

comment on function search_decision_specs is 'Búsqueda híbrida de specs de decisión (FTS+vector).';

-- ═══════════════ Reporte de calibración por spec ═══════════════
create or replace function decision_calibration(p_spec_id text)
returns jsonb
language sql stable as $$
  with per_bucket as (
    select
      width_bucket(confidence, 0, 1, 10) as bucket,
      avg(confidence) as avg_confidence,
      avg(case when outcome is null then null else (case when outcome then 1.0 else 0.0 end) end) as realized_accuracy,
      count(*) as n
    from decision_log
    where spec_id = p_spec_id and outcome is not null and confidence is not null
    group by 1
  )
  select jsonb_build_object(
    'samples', (select count(*) from decision_log where spec_id = p_spec_id and outcome is not null),
    'avg_confidence', (select avg(confidence) from decision_log where spec_id = p_spec_id and outcome is not null),
    'realized_accuracy', (select avg(case when outcome then 1.0 else 0.0 end) from decision_log where spec_id = p_spec_id and outcome is not null),
    'buckets', (select jsonb_agg(row_to_json(b) order by b.bucket) from per_bucket b)
  );
$$;

-- RLS obligatorio (deny-all a anon; service_role server-side pasa)
alter table decision_specs enable row level security;
alter table decision_log enable row level security;
