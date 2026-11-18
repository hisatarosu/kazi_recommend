-- 通知の送り先 (友だち追加したユーザー / 招待されたグループ)
CREATE TABLE targets (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN ('user', 'group', 'room')),
  created_at TEXT NOT NULL
);

-- 家事ごとの現在の状態
CREATE TABLE chore_state (
  chore_id      TEXT PRIMARY KEY,
  last_done_at  TEXT,  -- 'YYYY-MM-DD' (JST)
  last_done_by  TEXT,  -- LINE userId
  snoozed_until TEXT   -- この日付 (JST) までは提案しない
);

-- やった / パス の履歴 (あとで頻度を学習するために全部残す)
CREATE TABLE events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  chore_id TEXT NOT NULL,
  action   TEXT NOT NULL CHECK (action IN ('done', 'skip')),
  user_id  TEXT,
  at       TEXT NOT NULL  -- ISO 8601 (UTC)
);

CREATE INDEX idx_events_chore ON events (chore_id, at);
