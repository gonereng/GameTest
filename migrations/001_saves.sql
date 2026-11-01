-- One cloud save per signed-in player. user_id is the Neon Auth user id (the JWT "sub" claim).
CREATE TABLE IF NOT EXISTS saves (
  user_id    text        PRIMARY KEY,
  data       jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
