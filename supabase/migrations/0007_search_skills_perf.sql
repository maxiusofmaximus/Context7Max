-- Perf: la versión previa hacía scan completo por el OR con similarity()
-- de trigramas en el WHERE (mata el índice). Nueva lógica: filtra SOLO por
-- FTS (GIN) o vector (HNSW), ambos index-friendly; el boost de nombre pasa
-- al cálculo de score sobre el resultado ya acotado.

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
        (v_tsq is not null and s.fts @@ v_tsq)
        or (not p_fast and p_embedding is not null and s.embedding is not null
            and 1 - (s.embedding <=> p_embedding) > 0.22)
      )
      order by score desc
      limit p_limit
    ) r
  );
end $$;
