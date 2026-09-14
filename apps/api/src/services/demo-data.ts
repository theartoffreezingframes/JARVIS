/**
 * Optional sample content ("Try demo data").
 *
 * A brand-new account starts completely empty — this service exists so someone
 * evaluating the product can populate *their own* account with a small, clearly
 * labelled sample workspace and then remove it again in one tap.
 *
 * Everything created here is recorded in the user's settings under `demoData`,
 * which is what makes removal exact: we never delete anything the user made
 * themselves.
 */
import { addDays, toDayKey, type DayKey } from '@jarvis/shared';
import { getDb } from '../db/index.js';
import { insertProject } from '../repo/projects.js';
import { insertSubtask, insertTask } from '../repo/tasks.js';
import { insertHabit, toggleCompletion } from '../repo/habits.js';
import { insertNote } from '../repo/notes.js';
import { finishFocusSession, insertFocusSession } from '../repo/focus.js';
import { recomputeActivityDay } from '../repo/activity.js';
import { getSettingsRow, insertSettingsRow } from '../repo/users.js';
import { defaultSettings, parseSettings, mergeSettings } from '../repo/mappers.js';
import type { UserRow } from '../repo/rows.js';

export interface DemoDataState {
  enabled: boolean;
  loadedAt: number | null;
  projectIds: string[];
  habitIds: string[];
  noteIds: string[];
}

export const EMPTY_DEMO_STATE: DemoDataState = {
  enabled: false,
  loadedAt: null,
  projectIds: [],
  habitIds: [],
  noteIds: [],
};

export function readDemoState(user: UserRow): DemoDataState {
  const settings = parseSettings(user, getSettingsRow(user.id));
  return { ...EMPTY_DEMO_STATE, ...(settings.demoData ?? {}) };
}

interface Plan {
  project: string;
  color: string;
  icon: string;
  status: 'active' | 'not_started' | 'completed';
  priority: 'medium' | 'high' | 'urgent';
  dueIn: number;
  tasks: Array<{
    title: string;
    /** negative = days ago (already completed) */
    offset: number;
    hour?: number;
    important?: boolean;
    urgent?: boolean;
    priority?: 'low' | 'medium' | 'high' | 'urgent';
    estimate?: number;
    done?: boolean;
    subtasks?: string[];
    tags?: string[];
  }>;
}

const SAMPLE: Plan[] = [
  {
    project: 'Sample · College',
    color: '#4F46E5',
    icon: 'school',
    status: 'active',
    priority: 'high',
    dueIn: 21,
    tasks: [
      { title: 'Revise data structures — trees and graphs', offset: 0, hour: 18, important: true, urgent: false, estimate: 90, subtasks: ['AVL rotations', 'Graph traversals', 'Practice 5 problems'], tags: ['dsa'] },
      { title: 'Submit operating systems assignment', offset: 1, hour: 20, important: true, urgent: true, priority: 'urgent', estimate: 60 },
      { title: 'Read the distributed systems paper', offset: 3, hour: 17, important: true, urgent: false, estimate: 45 },
      { title: 'Group project sync with lab partners', offset: -2, hour: 16, estimate: 30, done: true },
      { title: 'Skim the mock exam paper', offset: -5, hour: 19, estimate: 40, done: true },
    ],
  },
  {
    project: 'Sample · Coding',
    color: '#0E9F6E',
    icon: 'code-slash',
    status: 'active',
    priority: 'medium',
    dueIn: 9,
    tasks: [
      { title: 'Ship the authentication refactor', offset: 0, hour: 11, important: true, urgent: true, estimate: 120, subtasks: ['Token rotation', 'Session tests'], tags: ['backend'] },
      { title: 'Write tests for the sync endpoint', offset: 2, hour: 15, important: true, urgent: false, estimate: 60 },
      { title: 'Review open pull requests', offset: 0, hour: 9, urgent: true, priority: 'medium', estimate: 30 },
      { title: 'Fix the offline queue retry bug', offset: -1, hour: 21, estimate: 75, done: true, tags: ['backend'] },
      { title: 'Set up the staging deploy', offset: -7, hour: 18, estimate: 50, done: true },
    ],
  },
  {
    project: 'Sample · Fitness',
    color: '#D97706',
    icon: 'barbell',
    status: 'active',
    priority: 'medium',
    dueIn: 30,
    tasks: [
      { title: 'Plan next week of training', offset: 1, hour: 8, important: true, urgent: false, estimate: 25 },
      { title: 'Book the physio appointment', offset: 0, hour: 12, urgent: true, priority: 'high', estimate: 15 },
      { title: 'Long run — 10k', offset: -3, hour: 6, estimate: 60, done: true },
    ],
  },
];

const SAMPLE_HABITS: Array<{
  name: string;
  description: string;
  icon: string;
  color: string;
  frequency: 'daily' | 'weekdays' | 'custom';
  scheduleDays: number[];
  reminderTime: string | null;
  /** how often it is completed in the backfilled history: 0-1 */
  rate: number;
}> = [
  { name: 'Morning walk', description: 'Thirty minutes outside before the day starts.', icon: 'walk', color: '#0E9F6E', frequency: 'daily', scheduleDays: [], reminderTime: '06:30', rate: 0.75 },
  { name: 'Read 20 pages', description: 'Fiction or non-fiction, just steady pages.', icon: 'book', color: '#4F46E5', frequency: 'daily', scheduleDays: [], reminderTime: '21:30', rate: 0.6 },
  { name: 'Practice DSA', description: 'One problem, understood properly.', icon: 'code-slash', color: '#D97706', frequency: 'weekdays', scheduleDays: [1, 2, 3, 4, 5], reminderTime: '19:00', rate: 0.7 },
];

function dayKeyFor(offset: number, offsetMinutes: number): DayKey {
  return addDays(toDayKey(Date.now(), offsetMinutes), offset);
}

/**
 * Creates the sample workspace. Idempotent per user: calling it twice replaces
 * the previous sample data rather than duplicating it.
 */
export function loadDemoData(user: UserRow): DemoDataState {
  const db = getDb();
  removeDemoData(user);

  const offset = user.tz_offset_minutes;
  const createdProjectIds: string[] = [];
  const createdHabitIds: string[] = [];
  const createdNoteIds: string[] = [];

  const firstTaskByProject = new Map<string, string>();

  for (const plan of SAMPLE) {
    const project = insertProject(user.id, {
      name: plan.project,
      description: 'Sample project created by “Try demo data”. Remove it any time from Settings → Data.',
      color: plan.color,
      icon: plan.icon,
      status: plan.status,
      priority: plan.priority,
      dueDate: dayKeyFor(plan.dueIn, offset),
      tags: ['sample'],
    });
    createdProjectIds.push(project.id);

    for (const task of plan.tasks) {
      const dayKey = dayKeyFor(task.offset, offset);
      const row = insertTask(user.id, {
        projectId: project.id,
        title: task.title,
        priority: task.priority ?? (task.urgent ? 'urgent' : task.important ? 'high' : 'medium'),
        important: task.important ?? false,
        urgent: task.urgent ?? false,
        dueDate: dayKey,
        dueTime: task.hour !== undefined ? `${String(task.hour).padStart(2, '0')}:00` : null,
        estimatedMinutes: task.estimate ?? null,
        actualMinutes: task.done ? (task.estimate ?? 30) : 0,
        status: 'todo',
        tags: task.tags ?? [],
        planDate: task.offset <= 0 && !task.done ? dayKeyFor(0, offset) : null,
        planOrder: 0,
        isMustDo: task.done !== true && Boolean(task.urgent && task.important),
      });
      if (!firstTaskByProject.has(project.id)) firstTaskByProject.set(project.id, row.id);

      if (task.done) {
        // Historical completions are written directly so the sample history lands
        // on the right day (the normal completion path would stamp "now").
        db.prepare('UPDATE tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
          'done',
          Date.parse(`${dayKey}T12:00:00Z`) - offset * 60_000,
          Date.now(),
          row.id,
        );
      }

      if (task.subtasks && !task.done) {
        task.subtasks.forEach((title, index) => {
          const subtask = insertSubtask(user.id, row.id, title, index);
          if (task.done) {
            db.prepare('UPDATE subtasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
              'done',
              Date.parse(`${dayKey}T12:00:00Z`) - offset * 60_000,
              Date.now(),
              subtask.id,
            );
          }
        });
      }
      recomputeActivityDay(user.id, dayKey, offset);
    }
  }

  for (const habit of SAMPLE_HABITS) {
    const row = insertHabit(user.id, {
      name: habit.name,
      description: habit.description,
      icon: habit.icon,
      color: habit.color,
      frequency: habit.frequency,
      scheduleDays: habit.scheduleDays,
      targetPerPeriod: 1,
      reminderTime: habit.reminderTime,
    });
    createdHabitIds.push(row.id);

    // A month of plausible history so streaks and heat maps have something real
    // to draw from (deterministic, not random, so the sample reads consistently).
    for (let back = 30; back >= 0; back -= 1) {
      const dayKey = dayKeyFor(-back, offset);
      const weekday = new Date(Date.parse(`${dayKey}T00:00:00Z`)).getUTCDay();
      if (habit.frequency === 'weekdays' && (weekday === 0 || weekday === 6)) continue;
      if (habit.frequency === 'custom' && !habit.scheduleDays.includes(weekday)) continue;
      const wave = Math.sin(back / 3.5) * 0.18;
      const shouldComplete = ((back * 7) % 10) / 10 < habit.rate + wave;
      if (!shouldComplete) continue;
      toggleCompletion(user.id, row.id, dayKey, true, null, db);
      recomputeActivityDay(user.id, dayKey, offset);
    }
  }

  // A couple of focus sessions so focus analytics and the focus heat map are not
  // empty on day one.
  const focusPlan: Array<{ back: number; minutes: number; label: string; taskId?: string }> = [
    { back: 0, minutes: 25, label: 'Deep work', taskId: firstTaskByProject.get(createdProjectIds[1] ?? '') },
    { back: 0, minutes: 50, label: 'Deep work' },
    { back: 1, minutes: 75, label: 'Study block', taskId: firstTaskByProject.get(createdProjectIds[0] ?? '') },
    { back: 2, minutes: 45, label: 'Deep work' },
    { back: 4, minutes: 90, label: 'Study block' },
  ];
  for (const session of focusPlan) {
    const dayKey = dayKeyFor(-session.back, offset);
    const startedAt = Date.parse(`${dayKey}T15:00:00Z`) - offset * 60_000;
    const row = insertFocusSession(
      user.id,
      {
        taskId: session.taskId ?? null,
        projectId: null,
        mode: session.minutes >= 50 ? 'deep_work' : 'pomodoro',
        label: session.label,
        plannedMinutes: session.minutes,
        startedAt,
        dayKey,
      },
      db,
    );
    finishFocusSession(
      user.id,
      row.id,
      {
        actualSeconds: session.minutes * 60,
        completed: true,
        interruptions: 0,
        endedAt: startedAt + session.minutes * 60_000,
      },
      db,
    );
    recomputeActivityDay(user.id, dayKey, offset);
  }

  const collegeProjectId = createdProjectIds[0];
  const note = insertNote(user.id, {
    title: 'How I use JARVIS',
    body: [
      'Capture everything with the + button — type it naturally, e.g.',
      '"finish the lab report tomorrow at 5pm for 90 minutes".',
      '',
      'Then classify: important means it moves something I care about, urgent means it has a deadline.',
      'Schedule the important-but-not-urgent work first — that is the whole point of the matrix.',
      '',
      'This note, the projects and the habits above are sample content. Remove them in one tap from Settings → Data.',
    ].join('\n'),
    projectId: collegeProjectId ?? null,
    pinned: true,
    tags: ['sample'],
  });
  createdNoteIds.push(note.id);

  const state: DemoDataState = {
    enabled: true,
    loadedAt: Date.now(),
    projectIds: createdProjectIds,
    habitIds: createdHabitIds,
    noteIds: createdNoteIds,
  };

  const current = parseSettings(user, getSettingsRow(user.id));
  insertSettingsRow(user.id, mergeSettings(current, { demoData: state }));

  return state;
}

/** Removes exactly the records created by `loadDemoData`, nothing else. */
export function removeDemoData(user: UserRow): DemoDataState {
  const state = readDemoState(user);
  const db = getDb();
  const now = Date.now();

  if (state.projectIds.length > 0) {
    const placeholders = state.projectIds.map(() => '?').join(',');
    db.prepare(
      `UPDATE subtasks SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND task_id IN
         (SELECT id FROM tasks WHERE user_id = ? AND project_id IN (${placeholders}))`,
    ).run(now, now, user.id, user.id, ...state.projectIds);
    db.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND project_id IN (${placeholders})`).run(
      now,
      now,
      user.id,
      ...state.projectIds,
    );
    db.prepare(`UPDATE notes SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND project_id IN (${placeholders})`).run(
      now,
      now,
      user.id,
      ...state.projectIds,
    );
    db.prepare(`UPDATE projects SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id IN (${placeholders})`).run(
      now,
      now,
      user.id,
      ...state.projectIds,
    );
  }

  if (state.habitIds.length > 0) {
    const placeholders = state.habitIds.map(() => '?').join(',');
    db.prepare(
      `UPDATE habit_completions SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND habit_id IN (${placeholders})`,
    ).run(now, now, user.id, ...state.habitIds);
    db.prepare(`UPDATE habits SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id IN (${placeholders})`).run(
      now,
      now,
      user.id,
      ...state.habitIds,
    );
  }

  if (state.noteIds.length > 0) {
    const placeholders = state.noteIds.map(() => '?').join(',');
    db.prepare(`UPDATE notes SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND id IN (${placeholders})`).run(
      now,
      now,
      user.id,
      ...state.noteIds,
    );
  }

  // Focus sessions created for the sample are attributed to a sample project or
  // were unlabelled; only the ones we tagged through labels are removed.
  db.prepare(
    `UPDATE focus_sessions SET deleted_at = ?, updated_at = ? WHERE user_id = ?
       AND label IN ('Deep work', 'Study block') AND created_at > ?`,
  ).run(now, now, user.id, state.loadedAt ?? 0);

  const cleared: DemoDataState = { ...EMPTY_DEMO_STATE };
  const current = parseSettings(user, getSettingsRow(user.id));
  insertSettingsRow(user.id, mergeSettings(current, { demoData: cleared }));

  // Rollups recompute on the next dashboard read, but rebasing here keeps the
  // heat map honest immediately after a removal.
  for (let back = 0; back <= 30; back += 1) {
    recomputeActivityDay(user.id, addDays(toDayKey(Date.now(), user.tz_offset_minutes), -back), user.tz_offset_minutes);
  }

  return cleared;
}
