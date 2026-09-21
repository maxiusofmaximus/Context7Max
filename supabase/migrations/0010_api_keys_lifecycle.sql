-- Ciclo de vida de API keys: expiración + revocación + último uso
-- (nunca obligatorias; una key sin expires_at nunca caduca, estilo NIM)

alter table api_keys add column if not exists expires_at timestamptz;
alter table api_keys add column if not exists last_used_at timestamptz;
alter table api_keys add column if not exists revoked_at timestamptz;

create index if not exists api_keys_expiry_idx on api_keys (expires_at)
  where expires_at is not null;

comment on column api_keys.expires_at is 'null = sin expiración (como NVIDIA NIM)';
comment on column api_keys.revoked_at is 'no-null = revocada (invalida al instante)';
