/**
 * Relational schema.
 *
 * Conventions
 *  - ids: opaque TEXT (`usr_…`, `tsk_…`). Never sequential, never trusted from input.
 *  - instants: INTEGER epoch milliseconds (UTC).
 *  - calendar days: TEXT `YYYY-MM-DD` in the user's local timezone.
 *  - wall clock: TEXT `HH:mm`.
 *  - soft deletes: `deleted_at` (keeps offline sync + conflict detection honest).
 *  - `seq`: per-user monotonically increasing revision used as the sync cursor.
 */
export const SCHEMA_SQL = /* sql */ `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  username              TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  avatar_url            TEXT,
  bio                   TEXT,
  password_hash         TEXT NOT NULL,
  timezone              TEXT NOT NULL DEFAULT 'UTC',
  tz_offset_minutes     INTEGER NOT NULL DEFAULT 0,
  week_starts_on        INTEGER NOT NULL DEFAULT 1,
  use_24_hour           INTEGER NOT NULL DEFAULT 0,
  email_verified        INTEGER NOT NULL DEFAULT 0,
  change_seq            INTEGER NOT NULL DEFAULT 0,
  created_at            INTEGER NOT NULL,
  updated_at            INTEGER NOT NULL,
  deleted_at            INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS user_settings (
  user_id   TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data      TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  seq       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Session id embedded in the access token issued alongside this row. It makes
  -- access tokens revocable: signing out, changing a password or resetting one
  -- invalidates every access token minted for that session immediately.
  sid          TEXT,
  token_hash   TEXT NOT NULL UNIQUE,
  device_name  TEXT,
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  expires_at   INTEGER NOT NULL,
  revoked_at   INTEGER,
  -- Why the session ended: 'rotated' (normal refresh), 'logout', 'password',
  -- 'admin'. Only a replayed *rotated* token is treated as theft.
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);
-- Note: the index on sid is created by migrate() after the column is guaranteed
-- to exist. On an existing database the column is added by an ALTER TABLE, and an
-- index over a not-yet-added column would fail the whole boot.

CREATE TABLE IF NOT EXISTS password_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  color       TEXT NOT NULL DEFAULT '#6C5CE7',
  icon        TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  priority    TEXT NOT NULL DEFAULT 'medium',
  due_date    TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  seq         INTEGER NOT NULL DEFAULT 0,
  client_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, status, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_client ON projects(user_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tasks (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
  parent_task_id      TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  description         TEXT,
  notes               TEXT,
  status              TEXT NOT NULL DEFAULT 'todo',
  priority            TEXT NOT NULL DEFAULT 'medium',
  important           INTEGER NOT NULL DEFAULT 0,
  urgent              INTEGER NOT NULL DEFAULT 0,
  due_date            TEXT,
  due_time            TEXT,
  reminder_at         INTEGER,
  estimated_minutes   INTEGER,
  actual_minutes      INTEGER NOT NULL DEFAULT 0,
  scheduled_start     INTEGER,
  scheduled_end       INTEGER,
  plan_date           TEXT,
  plan_order          INTEGER NOT NULL DEFAULT 0,
  is_must_do          INTEGER NOT NULL DEFAULT 0,
  recurrence          TEXT,
  recurred_from_id    TEXT,
  completed_at        INTEGER,
  archived_at         INTEGER,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  seq                 INTEGER NOT NULL DEFAULT 0,
  client_id           TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(user_id, due_date, status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(user_id, project_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(user_id, plan_date, plan_order);
CREATE INDEX IF NOT EXISTS idx_tasks_seq ON tasks(user_id, seq);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_reminder ON tasks(reminder_at, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_client ON tasks(user_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS subtasks (
  id           TEXT PRIMARY KEY,
  task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'todo',
  position     INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  deleted_at   INTEGER,
  seq          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id, position);

CREATE TABLE IF NOT EXISTS tags (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#8A8F98',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_user_name ON tags(user_id, name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS task_tags (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_task_tags_user ON task_tags(user_id, tag_id);

CREATE TABLE IF NOT EXISTS project_tags (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  tag_id     TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, tag_id)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  task_id    TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL DEFAULT 0,
  client_id  TEXT
);
CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_client ON notes(user_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS habits (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  icon              TEXT,
  color             TEXT NOT NULL DEFAULT '#22C55E',
  frequency         TEXT NOT NULL DEFAULT 'daily',
  schedule_days     TEXT NOT NULL DEFAULT '',
  target_per_period INTEGER NOT NULL DEFAULT 1,
  reminder_time     TEXT,
  archived          INTEGER NOT NULL DEFAULT 0,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER,
  seq               INTEGER NOT NULL DEFAULT 0,
  client_id         TEXT
);
CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id, archived, deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_habits_client ON habits(user_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS habit_completions (
  id         TEXT PRIMARY KEY,
  habit_id   TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key    TEXT NOT NULL,
  count      INTEGER NOT NULL DEFAULT 1,
  note       TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_habit_completion_unique ON habit_completions(habit_id, day_key);
CREATE INDEX IF NOT EXISTS idx_habit_completion_user ON habit_completions(user_id, day_key);

CREATE TABLE IF NOT EXISTS focus_sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  gang_session_id TEXT,
  mode            TEXT NOT NULL DEFAULT 'pomodoro',
  label           TEXT,
  planned_minutes INTEGER NOT NULL,
  actual_seconds  INTEGER NOT NULL DEFAULT 0,
  completed       INTEGER NOT NULL DEFAULT 0,
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  interruptions   INTEGER NOT NULL DEFAULT 0,
  day_key         TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  deleted_at      INTEGER,
  seq             INTEGER NOT NULL DEFAULT 0,
  client_id       TEXT
);
CREATE INDEX IF NOT EXISTS idx_focus_user_day ON focus_sessions(user_id, day_key);
CREATE INDEX IF NOT EXISTS idx_focus_task ON focus_sessions(task_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_focus_client ON focus_sessions(user_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS groups (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  description         TEXT,
  emoji               TEXT NOT NULL DEFAULT '🔥',
  invite_code         TEXT NOT NULL UNIQUE,
  owner_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  leaderboard_enabled INTEGER NOT NULL DEFAULT 0,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  deleted_at          INTEGER,
  seq                 INTEGER NOT NULL DEFAULT 0,
  client_id           TEXT
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id     TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',
  joined_at    INTEGER NOT NULL,
  last_seen_at INTEGER,
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

CREATE TABLE IF NOT EXISTS friendships (
  id           TEXT PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  UNIQUE (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_pair ON friendships(requester_id, addressee_id);
CREATE INDEX IF NOT EXISTS idx_friendships_status ON friendships(status);

CREATE TABLE IF NOT EXISTS gang_sessions (
  id                TEXT PRIMARY KEY,
  group_id          TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  host_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  starts_at         INTEGER NOT NULL,
  focus_minutes     INTEGER NOT NULL,
  break_minutes     INTEGER NOT NULL DEFAULT 5,
  rounds            INTEGER NOT NULL DEFAULT 1,
  mode              TEXT NOT NULL DEFAULT 'deep_work',
  status            TEXT NOT NULL DEFAULT 'scheduled',
  clock_anchor_at   INTEGER NOT NULL,
  clock_paused_ms   INTEGER NOT NULL DEFAULT 0,
  is_clock_paused   INTEGER NOT NULL DEFAULT 0,
  current_round     INTEGER NOT NULL DEFAULT 1,
  recurrence        TEXT,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL,
  deleted_at        INTEGER,
  seq               INTEGER NOT NULL DEFAULT 0,
  client_id         TEXT
);
CREATE INDEX IF NOT EXISTS idx_gang_group ON gang_sessions(group_id, status);
CREATE INDEX IF NOT EXISTS idx_gang_starts ON gang_sessions(starts_at);

CREATE TABLE IF NOT EXISTS gang_participants (
  session_id        TEXT NOT NULL REFERENCES gang_sessions(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state             TEXT NOT NULL DEFAULT 'invited',
  focus_seconds     INTEGER NOT NULL DEFAULT 0,
  seconds_remaining INTEGER NOT NULL DEFAULT 0,
  is_host           INTEGER NOT NULL DEFAULT 0,
  joined_at         INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL,
  reactions_sent    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gang_participants_user ON gang_participants(user_id);

CREATE TABLE IF NOT EXISTS gang_reactions (
  id         TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES gang_sessions(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction   TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gang_reactions_session ON gang_reactions(session_id, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  task_id       TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  habit_id      TEXT REFERENCES habits(id) ON DELETE CASCADE,
  session_id    TEXT REFERENCES gang_sessions(id) ON DELETE CASCADE,
  group_id      TEXT REFERENCES groups(id) ON DELETE CASCADE,
  scheduled_for INTEGER NOT NULL,
  delivered_at  INTEGER,
  read_at       INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  seq           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, scheduled_for DESC);

CREATE TABLE IF NOT EXISTS daily_reviews (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key             TEXT NOT NULL,
  reflection          TEXT,
  mood                INTEGER,
  energy              INTEGER,
  tasks_completed     INTEGER NOT NULL DEFAULT 0,
  tasks_planned       INTEGER NOT NULL DEFAULT 0,
  focus_minutes       INTEGER NOT NULL DEFAULT 0,
  habits_completed    INTEGER NOT NULL DEFAULT 0,
  overdue_carry_over  INTEGER NOT NULL DEFAULT 0,
  tomorrow_top_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER NOT NULL,
  seq                 INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_user_day ON daily_reviews(user_id, day_key);

-- Materialised per-day activity: powers dashboard, analytics and heat maps
-- without scanning the whole history on every request.
CREATE TABLE IF NOT EXISTS activity_days (
  user_id                      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_key                      TEXT NOT NULL,
  tasks_completed              INTEGER NOT NULL DEFAULT 0,
  tasks_created                INTEGER NOT NULL DEFAULT 0,
  focus_minutes                INTEGER NOT NULL DEFAULT 0,
  habit_completions            INTEGER NOT NULL DEFAULT 0,
  planned_count                INTEGER NOT NULL DEFAULT 0,
  planned_completed            INTEGER NOT NULL DEFAULT 0,
  important_not_urgent_done    INTEGER NOT NULL DEFAULT 0,
  overdue_count                INTEGER NOT NULL DEFAULT 0,
  reviewed                     INTEGER NOT NULL DEFAULT 0,
  updated_at                   INTEGER NOT NULL,
  PRIMARY KEY (user_id, day_key)
);
CREATE INDEX IF NOT EXISTS idx_activity_user_day ON activity_days(user_id, day_key);

-- Idempotency ledger for offline mutations replayed by the client.
CREATE TABLE IF NOT EXISTS sync_operations (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity     TEXT NOT NULL,
  op         TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  result     TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sync_ops_user ON sync_operations(user_id, created_at);

-- Remote push registrations. One row per (device install, platform). A device
-- token is unique across the table: when a different account signs in on the
-- same install the row is re-pointed at the new user, so a stale owner can never
-- receive another account's notifications.
CREATE TABLE IF NOT EXISTS push_tokens (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL,
  platform     TEXT NOT NULL,
  device_id    TEXT,
  device_name  TEXT,
  enabled      INTEGER NOT NULL DEFAULT 1,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens(user_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  user_id    TEXT,
  action     TEXT NOT NULL,
  ip         TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
`;
