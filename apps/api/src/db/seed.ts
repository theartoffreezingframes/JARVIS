/**
 * Demo data.
 *
 * Creates a fully populated account so the product can be evaluated end to end:
 * `demo@jarvis.app` / `Demo1234!` plus three friends, two groups, an active gang
 * session and ~10 weeks of history for the heat maps and analytics.
 *
 * Safe to re-run: it wipes and recreates only the demo accounts.
 */
import { addDays, toDayKey, type DayKey } from '@jarvis/shared';
import { closeDb, getDb, migrate } from './index.js';
import { hashPassword, newId } from '../lib/crypto.js';
import { incrementActivity, recomputeActivityDay } from '../repo/activity.js';
import { insertFocusSession, finishFocusSession } from '../repo/focus.js';
import { insertHabit, toggleCompletion } from '../repo/habits.js';
import { insertGangSession, upsertParticipant, addParticipant } from '../repo/gang.js';
import { insertNote } from '../repo/notes.js';
import { insertNotification } from '../repo/notifications.js';
import { insertProject } from '../repo/projects.js';
import { addMember, createFriendship, insertGroup } from '../repo/social.js';
import { insertSubtask, insertTask } from '../repo/tasks.js';
import { insertSettingsRow, nextSeq } from '../repo/users.js';
import { DASHBOARD_WIDGET_ORDER } from '../repo/mappers.js';
import type { UserRow } from '../repo/rows.js';

const DEMO_EMAIL = 'demo@jarvis.app';
const DEMO_PASSWORD = 'Demo1234!';

const FRIENDS = [
  { name: 'Rahul Menon', username: 'rahul', email: 'rahul@jarvis.app' },
  { name: 'Arjun Rao', username: 'arjun', email: 'arjun@jarvis.app' },
  { name: 'Priya Nair', username: 'priya', email: 'priya@jarvis.app' },
];

const IST = 330;

function daysAgo(n: number): DayKey {
  return addDays(toDayKey(Date.now(), IST), -n);
}

function today(): DayKey {
  return toDayKey(Date.now(), IST);
}

function atIso(dayKey: DayKey, hour: number, minute = 0): number {
  return Date.parse(`${dayKey}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`) - IST * 60_000;
}

function createUser(input: {
  email: string;
  username: string;
  name: string;
  passwordHash: string;
}): UserRow {
  const db = getDb();
  const now = Date.now();
  const id = newId('usr');
  db.prepare(
    `INSERT INTO users (id, email, username, name, password_hash, timezone, tz_offset_minutes,
                        week_starts_on, use_24_hour, email_verified, change_seq, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'Asia/Kolkata', ?, 1, 0, 1, 0, ?, ?)`,
  ).run(id, input.email, input.username, input.name, input.passwordHash, IST, now, now);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow;
}

export async function seed(): Promise<void> {
  migrate();
  const db = getDb();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // Wipe previous demo data so the script is idempotent.
  const emails = [DEMO_EMAIL, ...FRIENDS.map((f) => f.email)];
  const placeholders = emails.map(() => '?').join(', ');
  const existing = db
    .prepare(`SELECT id FROM users WHERE email IN (${placeholders})`)
    .all(...emails) as Array<{ id: string }>;
  for (const row of existing) {
    db.prepare('DELETE FROM users WHERE id = ?').run(row.id);
  }

  const demo = createUser({
    email: DEMO_EMAIL,
    username: 'demo',
    name: 'Demo Student',
    passwordHash,
  });

  const friends = FRIENDS.map((friend) =>
    createUser({ email: friend.email, username: friend.username, name: friend.name, passwordHash }),
  );

  for (const friend of friends) {
    createFriendship(demo.id, friend.id);
    db.prepare('UPDATE friendships SET status = ? WHERE requester_id = ? AND addressee_id = ?').run(
      'accepted',
      demo.id,
      friend.id,
    );
  }

  insertSettingsRow(demo.id, {
    theme: 'system',
    accentColor: '#6C5CE7',
    weekStartsOn: 1,
    use24Hour: false,
    defaultTaskDurationMinutes: 30,
    dayStartTime: '07:00',
    dayEndTime: '22:30',
    pomodoroFocusMinutes: 25,
    pomodoroShortBreakMinutes: 5,
    pomodoroLongBreakMinutes: 15,
    pomodoroSessionsBeforeLongBreak: 4,
    autoStartBreaks: true,
    autoStartNextSession: false,
    dailyPlanningReminder: '08:30',
    dailyReviewReminder: '21:30',
    dashboardWidgets: DASHBOARD_WIDGET_ORDER.map((id) => ({ id, visible: true })),
    leaderboardEnabled: true,
    notifications: {
      taskReminder: true,
      deadline: true,
      overdue: true,
      habitReminder: true,
      focusScheduled: true,
      gangInvite: true,
      gangUpcoming: true,
      dailyPlanning: true,
      dailyReview: true,
      quietHoursStart: '23:00',
      quietHoursEnd: '07:00',
    },
  });

  /* -------------------------------- projects ------------------------------ */
  const college = insertProject(demo.id, {
    name: 'College',
    description: 'Semester 6 coursework, assignments and exams',
    color: '#6C5CE7',
    icon: 'school',
    dueDate: addDays(today(), 40),
    tags: ['college'],
  });
  const coding = insertProject(demo.id, {
    name: 'Coding',
    description: 'DSA practice, side projects and GitHub work',
    color: '#0EA5E9',
    icon: 'code',
    dueDate: addDays(today(), 90),
    tags: ['coding', 'dsa'],
  });
  const fitness = insertProject(demo.id, {
    name: 'Fitness',
    description: 'Strength training and running plan',
    color: '#22C55E',
    icon: 'fitness',
    dueDate: null,
    tags: ['health'],
  });
  const hackathon = insertProject(demo.id, {
    name: 'Hackathon',
    description: '48 hour build — JARVIS group focus tracker',
    color: '#F59E0B',
    icon: 'rocket',
    status: 'not_started',
    dueDate: addDays(today(), 18),
    tags: ['hackathon'],
  });

  /* --------------------------------- tasks -------------------------------- */
  const T = today();

  const taskSpecs: Array<Parameters<typeof insertTask>[1] & { subtasks?: string[]; planDate?: DayKey | null }> = [
    {
      projectId: college.id,
      title: 'Finish DSA assignment',
      description: 'Graphs: BFS/DFS + shortest path questions 1–12',
      priority: 'urgent',
      important: true,
      urgent: true,
      dueDate: addDays(T, 1),
      dueTime: '19:00',
      estimatedMinutes: 120,
      planDate: T,
      isMustDo: true,
      tags: ['college', 'dsa'],
      subtasks: ['Read problem statements', 'Implement BFS', 'Implement Dijkstra', 'Write up answers'],
    },
    {
      projectId: coding.id,
      title: 'Solve 3 medium LeetCode problems',
      priority: 'high',
      important: true,
      urgent: false,
      dueDate: T,
      estimatedMinutes: 90,
      planDate: T,
      isMustDo: false,
      tags: ['dsa'],
    },
    {
      projectId: college.id,
      title: 'Submit DBMS lab record',
      priority: 'urgent',
      important: true,
      urgent: true,
      dueDate: T,
      dueTime: '17:00',
      estimatedMinutes: 45,
      planDate: T,
      isMustDo: true,
      tags: ['college'],
      subtasks: ['Print ER diagram', 'Get staff signature'],
    },
    {
      projectId: college.id,
      title: 'Revise Operating Systems: scheduling',
      description: 'Round robin, SJF and priority inversion notes',
      priority: 'medium',
      important: true,
      urgent: false,
      dueDate: addDays(T, 4),
      estimatedMinutes: 60,
      planDate: null,
      tags: ['college'],
    },
    {
      projectId: coding.id,
      title: 'Ship JARVIS gang timer edge cases',
      priority: 'high',
      important: true,
      urgent: false,
      dueDate: addDays(T, 6),
      estimatedMinutes: 180,
      planDate: null,
      recurrence: { kind: 'weekly', interval: 1, byWeekday: [1], until: null, count: 0, maxOccurrences: null },
      tags: ['coding'],
    },
    {
      projectId: fitness.id,
      title: 'Gym — push day',
      priority: 'medium',
      important: true,
      urgent: false,
      dueDate: T,
      dueTime: '06:30',
      estimatedMinutes: 60,
      planDate: null,
      recurrence: { kind: 'weekdays', interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null },
      tags: ['health'],
    },
    {
      projectId: null,
      title: 'Pay electricity bill',
      priority: 'urgent',
      important: false,
      urgent: true,
      dueDate: addDays(T, -1),
      dueTime: '20:00',
      estimatedMinutes: 15,
      planDate: null,
      tags: ['home', 'admin'],
    },
    {
      projectId: null,
      title: 'Reply to placement coordinator email',
      priority: 'medium',
      important: false,
      urgent: true,
      dueDate: T,
      dueTime: '16:00',
      estimatedMinutes: 15,
      tags: ['admin'],
    },
    {
      projectId: null,
      title: 'Scroll through tech news',
      priority: 'low',
      important: false,
      urgent: false,
      dueDate: null,
      estimatedMinutes: 30,
      tags: ['low-value'],
    },
    {
      projectId: hackathon.id,
      title: 'Draft hackathon pitch deck',
      priority: 'high',
      important: true,
      urgent: false,
      dueDate: addDays(T, 9),
      estimatedMinutes: 90,
      planDate: null,
      tags: ['hackathon'],
    },
    {
      projectId: coding.id,
      title: 'Write Changelog + README for side project',
      priority: 'low',
      important: false,
      urgent: false,
      dueDate: addDays(T, 12),
      estimatedMinutes: 45,
      tags: ['coding'],
    },
    {
      projectId: college.id,
      title: 'Prepare ML viva answers',
      priority: 'high',
      important: true,
      urgent: false,
      dueDate: addDays(T, 3),
      dueTime: '10:00',
      estimatedMinutes: 75,
      planDate: addDays(T, 1),
      tags: ['college'],
    },
    {
      projectId: fitness.id,
      title: 'Plan weekly meals',
      priority: 'medium',
      important: true,
      urgent: false,
      dueDate: addDays(T, 2),
      estimatedMinutes: 30,
      planDate: addDays(T, 1),
      tags: ['health'],
    },
    {
      projectId: null,
      title: 'Book train tickets for home',
      priority: 'urgent',
      important: true,
      urgent: true,
      dueDate: addDays(T, 2),
      dueTime: '12:00',
      estimatedMinutes: 20,
      planDate: null,
      tags: ['personal'],
    },
  ];

  const createdTasks: Array<{ id: string; title: string }> = [];
  taskSpecs.forEach((spec, index) => {
    const { subtasks, ...task } = spec;
    const row = insertTask(demo.id, { ...task, planOrder: index });
    createdTasks.push({ id: row.id, title: row.title });
    (subtasks ?? []).forEach((title, position) => {
      insertSubtask(demo.id, row.id, title, position);
    });
  });

  /* --------------------------- historic completed work --------------------- */
  // 10 weeks of plausible history so heat maps and charts have something real.
  for (let back = 70; back >= 1; back -= 1) {
    const day = daysAgo(back);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const base = weekend ? 1 : 2 + ((back * 7) % 3);
    const completedCount = Math.max(0, base - (back % 5 === 0 ? 1 : 0));
    const createdCount = weekend ? 1 : 2 + ((back * 3) % 2);

    for (let i = 0; i < completedCount; i += 1) {
      const title = ['Revision session', 'DSA practice set', 'Lab write-up', 'Reading block', 'Admin batch'][i % 5]!;
      const row = insertTask(demo.id, {
        projectId: i % 2 === 0 ? college.id : coding.id,
        title: `${title} #${70 - back + 1}`,
        status: 'done',
        priority: i % 3 === 0 ? 'high' : 'medium',
        important: i % 2 === 0,
        urgent: i % 4 === 0,
        dueDate: day,
        planDate: day,
        estimatedMinutes: 30 + (i % 3) * 30,
        actualMinutes: 25 + (i % 4) * 15,
        tags: [i % 2 === 0 ? 'college' : 'coding'],
      });
      // Backdate for honest history.
      db.prepare('UPDATE tasks SET created_at = ?, completed_at = ?, updated_at = ? WHERE id = ?').run(
        atIso(day, 9),
        atIso(day, 17 + (i % 4)),
        atIso(day, 18),
        row.id,
      );
    }

    for (let i = 0; i < createdCount; i += 1) {
      const row = insertTask(demo.id, {
        projectId: i % 3 === 0 ? coding.id : null,
        title: `Captured idea ${back}-${i}`,
        dueDate: null,
        priority: 'low',
      });
      db.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run(atIso(day, 11), row.id);
    }
  }

  /* --------------------------------- habits ------------------------------- */
  const habits = [
    {
      name: 'Morning workout',
      description: '45 minutes of strength or running',
      icon: 'fitness',
      color: '#22C55E',
      frequency: 'weekdays' as const,
      scheduleDays: [1, 2, 3, 4, 5],
      reminderTime: '06:00',
      consistency: 0.82,
    },
    {
      name: 'Read 20 pages',
      description: 'Non-fiction or course reading',
      icon: 'book',
      color: '#6C5CE7',
      frequency: 'daily' as const,
      scheduleDays: [],
      reminderTime: '21:00',
      consistency: 0.68,
    },
    {
      name: 'Solve one DSA problem',
      description: 'One problem, fully understood',
      icon: 'code',
      color: '#0EA5E9',
      frequency: 'daily' as const,
      scheduleDays: [],
      reminderTime: '19:30',
      consistency: 0.74,
    },
    {
      name: 'Sleep before 11:30',
      description: 'Lights out, phone away',
      icon: 'moon',
      color: '#8B5CF6',
      frequency: 'daily' as const,
      scheduleDays: [],
      reminderTime: '22:45',
      consistency: 0.55,
    },
  ];

  habits.forEach((habit, habitIndex) => {
    const row = insertHabit(demo.id, {
      name: habit.name,
      description: habit.description,
      icon: habit.icon,
      color: habit.color,
      frequency: habit.frequency,
      scheduleDays: habit.scheduleDays,
      reminderTime: habit.reminderTime,
    });

    for (let back = 60; back >= 1; back -= 1) {
      const day = daysAgo(back);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const scheduled = habit.frequency === 'weekdays' ? weekday !== 0 && weekday !== 6 : true;
      if (!scheduled) continue;
      // Deterministic pseudo-random "did they do it" so seeds are reproducible.
      const roll = ((back * (habitIndex + 3) * 17) % 100) / 100;
      if (roll < habit.consistency) {
        toggleCompletion(demo.id, row.id, day, true, null);
      }
    }

    // Today: leave one habit open so the dashboard shows something to do.
    if (habitIndex !== 3) {
      toggleCompletion(demo.id, row.id, today(), true, null);
    }
  });

  /* ------------------------------ focus sessions -------------------------- */
  for (let back = 45; back >= 0; back -= 1) {
    const day = daysAgo(back);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const sessions = weekend ? 1 + (back % 2) : 2 + (back % 3);
    for (let i = 0; i < sessions; i += 1) {
      const minutes = [25, 25, 50, 45, 30][(back + i) % 5]!;
      const task = createdTasks[(back + i) % createdTasks.length];
      const startedAt = atIso(day, 9 + i * 2, (back * 7) % 60);
      const row = insertFocusSession(demo.id, {
        taskId: back < 12 ? task?.id ?? null : null,
        projectId: back < 12 && i % 2 === 0 ? coding.id : null,
        mode: minutes >= 45 ? 'deep_work' : 'pomodoro',
        label: minutes >= 45 ? 'Deep work block' : 'Pomodoro',
        plannedMinutes: minutes,
        startedAt,
        dayKey: day,
      });
      finishFocusSession(demo.id, row.id, {
        actualSeconds: minutes * 60,
        completed: true,
        interruptions: 0,
        endedAt: startedAt + minutes * 60_000,
      });
    }
  }

  /* --------------------------------- notes -------------------------------- */
  insertNote(demo.id, {
    title: 'DSA revision plan',
    body: 'Week 1: arrays, hashing, two pointers\nWeek 2: trees, recursion\nWeek 3: graphs (BFS/DFS, Dijkstra)\nWeek 4: DP patterns\n\nRule: one problem per day, write the approach before coding.',
    projectId: coding.id,
    tags: ['dsa', 'college'],
    pinned: true,
  });
  insertNote(demo.id, {
    title: 'Hackathon ideas',
    body: '1. Group focus with shared clock\n2. Heat map for college study consistency\n3. Offline-first planner with honest capacity warnings',
    projectId: hackathon.id,
    tags: ['hackathon'],
  });
  insertNote(demo.id, {
    title: 'Meeting notes — project mentor',
    body: 'Mentor suggested narrowing the scope to real-time co-working and shipping the analytics after the demo.',
    projectId: college.id,
    tags: ['college'],
  });
  insertNote(demo.id, {
    title: 'Reflection prompts',
    body: 'What moved today?\nWhat did I avoid?\nWhat is the ONE thing for tomorrow?',
    tags: ['personal'],
  });

  /* --------------------------------- groups ------------------------------- */
  const dsaGroup = insertGroup(demo.id, {
    name: 'DSA Grind',
    description: 'Weekday 7 PM deep work sessions',
    emoji: '🔥',
    leaderboardEnabled: true,
  });
  const examGroup = insertGroup(demo.id, {
    name: 'Exam Sprint',
    description: 'Weekend morning study sessions until finals',
    emoji: '📚',
    leaderboardEnabled: false,
  });

  for (const friend of friends) {
    addMember(dsaGroup.id, friend.id, 'member');
    addMember(examGroup.id, friend.id, 'member');
  }
  db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run('admin', dsaGroup.id, friends[0]!.id);

  /* ------------------------------ gang sessions --------------------------- */
  const session = insertGangSession({
    groupId: dsaGroup.id,
    hostId: demo.id,
    title: 'DSA Grind — 5 members',
    startsAt: atIso(today(), 19),
    focusMinutes: 50,
    breakMinutes: 10,
    rounds: 2,
    mode: 'deep_work',
    recurrence: JSON.stringify({ kind: 'weekdays', interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null }),
  });

  addParticipant(session.id, demo.id, 'focusing');
  upsertParticipant(session.id, demo.id, { isHost: true, state: 'focusing', focusSeconds: 900 });
  friends.forEach((friend, index) => {
    addParticipant(session.id, friend.id, index === 2 ? 'break' : 'focusing');
    upsertParticipant(session.id, friend.id, {
      state: index === 2 ? 'break' : 'focusing',
      focusSeconds: 600 + index * 120,
    });
  });

  // A completed session from yesterday for history and analytics.
  const past = insertGangSession({
    groupId: dsaGroup.id,
    hostId: friends[0]!.id,
    title: 'Night Owl Sprint',
    startsAt: atIso(daysAgo(1), 21),
    focusMinutes: 45,
    breakMinutes: 5,
    rounds: 1,
    mode: 'deep_work',
  });
  db.prepare('UPDATE gang_sessions SET status = ?, clock_anchor_at = ?, clock_paused_ms = ? WHERE id = ?').run(
    'completed',
    atIso(daysAgo(1), 21),
    45 * 60_000,
    past.id,
  );
  addParticipant(past.id, demo.id, 'done');
  upsertParticipant(past.id, demo.id, { state: 'done', focusSeconds: 45 * 60 });
  friends.slice(0, 2).forEach((friend) => {
    addParticipant(past.id, friend.id, 'done');
    upsertParticipant(past.id, friend.id, { state: 'done', focusSeconds: 30 * 60 });
  });

  /* ------------------------------ notifications --------------------------- */
  insertNotification(demo.id, {
    kind: 'gang_upcoming',
    title: '“DSA Grind — 5 members” starts soon',
    body: 'DSA Grind · 50 minutes',
    sessionId: session.id,
    groupId: dsaGroup.id,
    scheduledFor: Date.now() + 45 * 60_000,
  });
  insertNotification(demo.id, {
    kind: 'task_reminder',
    title: 'Finish DSA assignment',
    body: 'Due tomorrow at 19:00',
    taskId: createdTasks[0]?.id ?? null,
    scheduledFor: Date.now() + 3 * 60 * 60_000,
  });
  insertNotification(demo.id, {
    kind: 'daily_review',
    title: 'Close the loop',
    body: 'Review today and pick tomorrow’s top task',
    scheduledFor: Date.now() + 6 * 60 * 60_000,
  });

  /* -------------------------------- rollups ------------------------------- */
  // Recompute today and yesterday precisely, then rebuild the trailing window so
  // activity matches the seeded history exactly.
  for (let back = 70; back >= 0; back -= 1) {
    recomputeActivityDay(demo.id, daysAgo(back), IST);
  }
  incrementActivity(demo.id, today(), { reviewed: 0 });

  db.prepare('UPDATE users SET change_seq = ? WHERE id = ?').run(nextSeq(demo.id) + 1000, demo.id);

  // eslint-disable-next-line no-console
  console.log(`
✅ Demo data ready

  Email:    ${DEMO_EMAIL}
  Password: ${DEMO_PASSWORD}

  Friends:  ${FRIENDS.map((f) => `${f.username} (${f.email})`).join(', ')}
  Groups:   DSA Grind, Exam Sprint
  Data:     ${taskSpecs.length} current tasks · 70 days of history · 4 habits · focus sessions · notes · gang sessions
`);
}

const isDirectRun = process.argv[1]?.includes('seed');
if (isDirectRun) {
  seed()
    .then(() => {
      closeDb();
      process.exit(0);
    })
    .catch((error) => {
      // eslint-disable-next-line no-console
      console.error('Seed failed', error);
      process.exit(1);
    });
}
