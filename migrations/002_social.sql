-- Social features: farm codes (visiting and gifts), leaderboard opt-in, and the gift mailbox.

-- One row per signed-in player, made the first time they open the Online menu.
CREATE TABLE IF NOT EXISTS profiles (
  user_id     text        PRIMARY KEY,
  -- 8 characters, shown as ABCD-EFGH. Whoever has it can visit the farm and send gifts.
  share_code  text        NOT NULL UNIQUE,
  -- Shown on the public leaderboards only when the player opts in.
  on_boards   boolean     NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Gifts waiting for (or already collected by) a player.
CREATE TABLE IF NOT EXISTS gifts (
  id          bigserial   PRIMARY KEY,
  from_user   text        NOT NULL,
  to_user     text        NOT NULL,
  item        text        NOT NULL,
  qty         integer     NOT NULL CHECK (qty BETWEEN 1 AND 10),
  note        text        NOT NULL DEFAULT '' CHECK (length(note) <= 80),
  created_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS gifts_inbox ON gifts (to_user) WHERE claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS gifts_sent ON gifts (from_user, created_at);
