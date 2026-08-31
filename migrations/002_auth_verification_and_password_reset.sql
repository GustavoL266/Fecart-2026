CREATE TABLE IF NOT EXISTS login_verifications (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS login_verifications_user_created_idx
  ON login_verifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS login_verifications_expiry_idx
  ON login_verifications (expires_at) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_created_idx
  ON password_reset_tokens (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS password_reset_tokens_expiry_idx
  ON password_reset_tokens (expires_at) WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  action VARCHAR(50) NOT NULL,
  key_hash CHAR(64) NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (action, key_hash)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_updated_idx ON auth_rate_limits (updated_at);
