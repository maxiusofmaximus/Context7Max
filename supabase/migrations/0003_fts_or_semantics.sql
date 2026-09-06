-- mejora de recall: tsquery con OR entre términos significativos (ts_rank
-- ya premia quienes matchean más términos) y umbral vectorial más laxo.

drop function if exists public.match_context(text, text, text, halfvec, int, boolean);

create function match_context(
  p_library_id      text,
  p_version         text default null,
  p_query           text default '',
  p_embedding       halfvec default null,
  p_max_tokens      int default 4000,
  p_fast            boolean default false
) returns jsonb
language plpgsql stable as $$
declare
  v_version text;
  v_tsq     tsquery;
  v_code_budget int := greatest(floor(p_max_tokens * 0.7), 200);
  v_info_budget int := greatest(floor(p_max_tokens * 0.3), 100);
  v_result  jsonb;
begin
  -- tsquery OR-joined: términos >=3 chars, alfanum+._-, máximo 10
  select to_tsquery('simple', string_agg(t, ' | '))
    into v_tsq
    from (
      select distinct regexp_replace(tok, '[^a-z0-9_.\-]', '', 'g') as t
      from regexp_split_to_table(lower(coalesce(p_query, '')), '\s+') as tok
      where length(regexp_replace(tok, '[^a-z0-9_.\-]', '', 'g')) >= 3
      limit 10
    ) s;

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
                     when not p_fast and p_embedding is not null and s.embedding is not null
                     then 1 - (s.embedding <=> p_embedding)
                     else 0 end
           + 0.3 * ts_rank(s.fts, coalesce(v_tsq, ''::tsquery))
           )::real as score
    from code_snippets s
    where s.library_id = p_library_id
      and s.version = v_version
      and (
        case when p_fast
          then (v_tsq is not null and s.fts @@ v_tsq)
          else ( (v_tsq is not null and s.fts @@ v_tsq)
                 or (p_embedding is not null and s.embedding is not null
                     and 1 - (s.embedding <=> p_embedding) > 0.22) )
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
                     when not p_fast and p_embedding is not null and s.embedding is not null
                     then 1 - (s.embedding <=> p_embedding)
                     else 0 end
           + 0.3 * ts_rank(s.fts, coalesce(v_tsq, ''::tsquery))
           )::real as score
    from info_snippets s
    where s.library_id = p_library_id
      and s.version = v_version
      and (
        case when p_fast
          then (v_tsq is not null and s.fts @@ v_tsq)
          else ( (v_tsq is not null and s.fts @@ v_tsq)
                 or (p_embedding is not null and s.embedding is not null
                     and 1 - (s.embedding <=> p_embedding) > 0.22) )
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
