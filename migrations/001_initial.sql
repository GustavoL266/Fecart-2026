CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category VARCHAR(100) NOT NULL,
  cost_price NUMERIC(14, 2) NOT NULL CHECK (cost_price >= 0),
  additional_costs NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (additional_costs >= 0),
  profit_margin NUMERIC(6, 2) NOT NULL CHECK (profit_margin >= 0 AND profit_margin <= 100),
  suggested_price NUMERIC(14, 2) NOT NULL CHECK (suggested_price >= 0),
  marketplace VARCHAR(120) NOT NULL DEFAULT 'Manual',
  consultation_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  calculation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS products_user_consultation_date_idx
  ON products (user_id, consultation_date DESC);

CREATE INDEX IF NOT EXISTS products_user_name_idx
  ON products (user_id, name);

CREATE TABLE IF NOT EXISTS user_sessions (
  sid VARCHAR NOT NULL PRIMARY KEY,
  sess JSON NOT NULL,
  expire TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS user_sessions_expire_idx ON user_sessions (expire);

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS products_set_updated_at ON products;
CREATE TRIGGER products_set_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
