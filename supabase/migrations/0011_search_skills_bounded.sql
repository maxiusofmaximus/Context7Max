-- Perf fix final para search_skills:
-- FTS-first (GIN) para candidatos + top-K vectorial sin dependencia en WHERE
-- (el anterior mezclaba WHERE con métrica vectorial → seq scan en tablas anchas).

drop function if exists public.search_skills(text, halfvec, int, boolean);

create function search_skills(
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
    with fts_pick as (
      select s.id, s.name, s.description, s.source, s.repo_url, s.installs,
             s.license, s.trust, s.tokens, s.embedding,
             ts_rank(s.fts, coalesce(v_tsq, ''::tsquery))::real as fts_score
      from skills s
      where v_tsq is not null and s.fts @@ v_tsq
      limit 300
    ),
    vec_pick as (
      select s.id, s.name, s.description, s.source, s.repo_url, s.installs,
             s.license, s.trust, s.tokens, s.embedding,
             0::real as fts_score
      from skills s
      where not p_fast and p_embedding is not null and s.embedding is not null
      order by s.embedding <=> p_embedding
      limit 300
    ),
    merged as (
      select distinct on (id) * from (
        select * from fts_pick
        union all
        select * from vec_pick
      ) m
      order by id
    ),
    scored as (
      select
        id, name, description, source, repo_url, installs, license, trust, tokens,
        ( greatest(fts_score, 0)
          + 0.7 * case
            when not p_fast and p_embedding is not null and embedding is not null
            then 1 - (embedding <=> p_embedding)
            else 0 end
          + 0.05 * ln(1 + greatest(installs, 0))
        )::real as score
      from merged
    )
    select coalesce(jsonb_agg(row_to_json(scored)::jsonb order by scored.score desc), '[]'::jsonb)
    from (select * from scored order by score desc limit p_limit) scored
  );
end $$;
