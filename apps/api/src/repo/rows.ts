/** Database row shapes (snake_case, INTEGER booleans) — the storage layer contract. */

export interface UserRow {
  id: string;
  email: string;
  username: string;
  name: string;
  avatar_url: string | null;
  bio: string | null;
  password_hash: string;
  google_sub: string | null;
  has_password: number;
  timezone: string;
  tz_offset_minutes: number;
  week_starts_on: number;
  use_24_hour: number;
  email_verified: number;
  change_seq: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SettingsRow {
  user_id: string;
  data: string;
  updated_at: number;
  seq: number;
}

export interface TaskRow {
  id: string;
  user_id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  notes: string | null;
  status: string;
  priority: string;
  important: number;
  urgent: number;
  due_date: string | null;
  due_time: string | null;
  reminder_at: number | null;
  estimated_minutes: number | null;
  actual_minutes: number;
  scheduled_start: number | null;
  scheduled_end: number | null;
  plan_date: string | null;
  plan_order: number;
  is_must_do: number;
  recurrence: string | null;
  recurred_from_id: string | null;
  completed_at: number | null;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
  client_id: string | null;
}

export interface SubtaskRow {
  id: string;
  task_id: string;
  user_id: string;
  title: string;
  status: string;
  position: number;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
}

export interface ProjectRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
  client_id: string | null;
}

export interface TagRow {
  id: string;
  user_id: string;
  name: string;
  color: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
}

export interface HabitRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string;
  frequency: string;
  schedule_days: string;
  target_per_period: number;
  reminder_time: string | null;
  archived: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
  client_id: string | null;
}

export interface HabitCompletionRow {
  id: string;
  habit_id: string;
  user_id: string;
  day_key: string;
  count: number;
  note: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
}

export interface FocusSessionRow {
  id: string;
  user_id: string;
  task_id: string | null;
  project_id: string | null;
  gang_session_id: string | null;
  mode: string;
  label: string | null;
  planned_minutes: number;
  actual_seconds: number;
  completed: number;
  started_at: number;
  ended_at: number | null;
  interruptions: number;
  day_key: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
  client_id: string | null;
}

export interface NoteRow {
  id: string;
  user_id: string;
  project_id: string | null;
  task_id: string | null;
  title: string;
  body: string;
  pinned: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
  client_id: string | null;
}

export interface GroupRow {
  id: string;
  name: string;
  description: string | null;
  emoji: string;
  invite_code: string;
  owner_id: string;
  leaderboard_enabled: number;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
  client_id: string | null;
}

export interface GroupMemberRow {
  group_id: string;
  user_id: string;
  role: string;
  joined_at: number;
  last_seen_at: number | null;
}

export interface GangSessionRow {
  id: string;
  group_id: string;
  host_id: string;
  title: string;
  starts_at: number;
  focus_minutes: number;
  break_minutes: number;
  rounds: number;
  mode: string;
  status: string;
  clock_anchor_at: number;
  clock_paused_ms: number;
  is_clock_paused: number;
  current_round: number;
  recurrence: string | null;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  seq: number;
  client_id: string | null;
}

export interface GangParticipantRow {
  session_id: string;
  user_id: string;
  state: string;
  focus_seconds: number;
  seconds_remaining: number;
  is_host: number;
  joined_at: number;
  last_seen_at: number;
  reactions_sent: number;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  kind: string;
  title: string;
  body: string;
  task_id: string | null;
  habit_id: string | null;
  session_id: string | null;
  group_id: string | null;
  scheduled_for: number;
  delivered_at: number | null;
  read_at: number | null;
  created_at: number;
  updated_at: number;
  seq: number;
}

export interface DailyReviewRow {
  id: string;
  user_id: string;
  day_key: string;
  reflection: string | null;
  mood: number | null;
  energy: number | null;
  tasks_completed: number;
  tasks_planned: number;
  focus_minutes: number;
  habits_completed: number;
  overdue_carry_over: number;
  tomorrow_top_task_id: string | null;
  created_at: number;
  updated_at: number;
  seq: number;
}

export interface ActivityDayRow {
  user_id: string;
  day_key: string;
  tasks_completed: number;
  tasks_created: number;
  focus_minutes: number;
  habit_completions: number;
  planned_count: number;
  planned_completed: number;
  important_not_urgent_done: number;
  overdue_count: number;
  reviewed: number;
  updated_at: number;
}
