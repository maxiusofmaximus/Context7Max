# Reciclaje de disco de Supabase (hacerlo una vez, ahora)

La base tiene 639 MB reportados por tu SO (parte de ese tamaño son "dead rows" del trim).
Para liberar el espacio real ve a **Supabase → SQL Editor** y pega:

```sql
VACUUM FULL ANALYZE info_snippets;
VACUUM FULL ANALYZE skills;
VACUUM FULL ANALYZE guides;
VACUUM FULL ANALYZE code_snippets;
VACUUM FULL ANALYZE libraries;
VACUUM FULL ANALYZE catalog;
VACUUM FULL ANALYZE mcp_servers;
```

(VACUUM FULL reescribe la tabla y devuelve espacio al filesystem — el CLI no lo
permite porque usa una transacción; el SQL Editor del dashboard corre en autocommit.)

Después verás el resultado real con:

```bash
pnpm tsx scripts/db-size.mts
```

Si sigue por encima de 500 MB snabela: usa `ctx7max remove <id>` con las librerías
más pesadas (las verás en `ctx7max list` por tokens). El pipeline bloquea nuevas
ingestas al 97% del free tier, así que nunca puedes quedarte fuera por accidente.
