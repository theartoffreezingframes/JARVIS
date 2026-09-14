/**
 * Domain unit tests — the pure logic both the app and the server rely on.
 * Run with: npm test -w @jarvis/api
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDays,
  buildDayPlan,
  buildHeatmap,
  combineDayAndTime,
  dayDiff,
  formatDuration,
  habitScheduledOn,
  matrixSuggestions,
  nextOccurrence,
  parseNaturalLanguageTask,
  productivityScore,
  quadrantOf,
  shiftTime,
  startOfWeekKey,
  toDayKey,
} from '@jarvis/shared';

const IST = 330;
// Monday 14 Sep 2026, 17:30 IST
const NOW = Date.UTC(2026, 8, 14, 12, 0);
const ctx = { now: NOW, offsetMinutes: IST };

test('day keys respect the user timezone offset', () => {
  // 23:30 UTC on the 14th is already the 15th in IST.
  const lateUtc = Date.UTC(2026, 8, 14, 23, 30);
  assert.equal(toDayKey(lateUtc, 0), '2026-09-14');
  assert.equal(toDayKey(lateUtc, IST), '2026-09-15');
  assert.equal(dayDiff('2026-09-15', '2026-09-14'), 1);
  assert.equal(addDays('2026-09-30', 1), '2026-10-01');
});

test('week start honours the user preference', () => {
  assert.equal(startOfWeekKey('2026-09-14', 1), '2026-09-14'); // Monday
  assert.equal(startOfWeekKey('2026-09-14', 0), '2026-09-13'); // Sunday
});

test('time helpers format and shift wall-clock times', () => {
  assert.equal(shiftTime('23:30', 45), '00:15');
  assert.equal(formatDuration(95), '1h 35m');
  assert.equal(combineDayAndTime('2026-09-15', '19:00', IST) - NOW, 25.5 * 3_600_000);
});

test('Eisenhower quadrants derive from the two questions', () => {
  assert.equal(quadrantOf({ important: true, urgent: true }), 'do_now');
  assert.equal(quadrantOf({ important: true, urgent: false }), 'schedule');
  assert.equal(quadrantOf({ important: false, urgent: true }), 'delegate');
  assert.equal(quadrantOf({ important: false, urgent: false }), 'eliminate');
});

test('overloaded matrices produce coaching, not nagging', () => {
  const suggestions = matrixSuggestions({ do_now: 12, schedule: 1, delegate: 2, eliminate: 1 });
  assert.ok(suggestions.some((s) => s.quadrant === 'do_now' && s.severity === 'critical'));
  assert.ok(suggestions.every((s) => s.body.length > 20));
  assert.equal(matrixSuggestions({ do_now: 1, schedule: 2, delegate: 0, eliminate: 0 }).length, 0);
});

test('recurrence generates the next occurrence and respects limits', () => {
  const daily = nextOccurrence('2026-09-01', { kind: 'daily', interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null }, '2026-09-14');
  assert.equal(daily, '2026-09-15');

  const weekdays = nextOccurrence('2026-09-11', { kind: 'weekdays', interval: 1, byWeekday: [], until: null, count: 0, maxOccurrences: null }, '2026-09-11');
  assert.equal(weekdays, '2026-09-14'); // Friday → Monday

  const capped = nextOccurrence('2026-09-01', { kind: 'daily', interval: 1, byWeekday: [], until: null, count: 5, maxOccurrences: 5 }, '2026-09-14');
  assert.equal(capped, null);

  // `until` is inclusive: the 10th is still generated, the 11th is not.
  const until = nextOccurrence('2026-09-01', { kind: 'daily', interval: 1, byWeekday: [], until: '2026-09-10', count: 0, maxOccurrences: null }, '2026-09-09');
  assert.equal(until, '2026-09-10');
  const exhausted = nextOccurrence('2026-09-01', { kind: 'daily', interval: 1, byWeekday: [], until: '2026-09-10', count: 0, maxOccurrences: null }, '2026-09-10');
  assert.equal(exhausted, null);
});

test('daily planner lays out blocks and warns honestly about capacity', () => {
  const tasks = [
    { id: 'a', title: 'Deep work', estimatedMinutes: 180, isMustDo: true, planOrder: 0, priority: 'high' as const, dueDate: null, dueTime: null },
    { id: 'b', title: 'Emails', estimatedMinutes: 120, isMustDo: false, planOrder: 1, priority: 'low' as const, dueDate: null, dueTime: null },
    { id: 'c', title: 'Review', estimatedMinutes: 240, isMustDo: false, planOrder: 2, priority: 'medium' as const, dueDate: null, dueTime: null },
  ];
  const plan = buildDayPlan({ dayKey: '2026-09-14', tasks, dayStartTime: '09:00', dayEndTime: '17:00', breakMinutes: 60, nowMinutes: 0 });
  assert.equal(plan.blocks.length, 3);
  assert.equal(plan.blocks[0]!.startLabel, '09:00');
  assert.equal(plan.capacityMinutes, 420);
  assert.equal(plan.plannedMinutes, 540);
  const over = plan.warnings.find((w) => w.id === 'overbooked');
  assert.ok(over, 'expected an over-capacity warning');
  assert.match(over!.title, /9h into 7h/);
});

test('planner keeps must-dos first and flags too many of them', () => {
  const tasks = ['a', 'b', 'c', 'd'].map((id, index) => ({
    id,
    title: `Task ${id}`,
    estimatedMinutes: 30,
    isMustDo: true, // four must-dos is one too many
    planOrder: 5 - index,
    priority: 'medium' as const,
    dueDate: null,
    dueTime: null,
  }));
  const plan = buildDayPlan({ dayKey: '2026-09-14', tasks, nowMinutes: 0 });
  assert.ok(plan.blocks[0]!.isMustDo);
  assert.ok(plan.warnings.some((w) => w.id === 'too_many_must_do'));

  const realistic = ['a', 'b', 'c', 'd'].map((id, index) => ({
    id,
    title: `Task ${id}`,
    estimatedMinutes: 30,
    isMustDo: index < 3,
    planOrder: 5 - index,
    priority: 'medium' as const,
    dueDate: null,
    dueTime: null,
  }));
  const realisticPlan = buildDayPlan({ dayKey: '2026-09-14', tasks: realistic, nowMinutes: 0 });
  assert.equal(realisticPlan.warnings.some((w) => w.id === 'too_many_must_do'), false);
});

test('natural language capture extracts date, time, duration and metadata', () => {
  const parsed = parseNaturalLanguageTask('Finish DSA assignment tomorrow at 7 PM !high #college for 90 minutes', ctx);
  assert.equal(parsed.title, 'Finish DSA assignment');
  assert.equal(parsed.dueDate, '2026-09-15');
  assert.equal(parsed.dueTime, '19:00');
  assert.equal(parsed.priority, 'high');
  assert.equal(parsed.estimatedMinutes, 90);
  assert.deepEqual(parsed.tags, ['college']);
  assert.ok(parsed.confidence > 0.5);
});

test('natural language capture handles weekdays, recurrence and relative times', () => {
  const friday = parseNaturalLanguageTask('Call mom friday 6pm', ctx);
  assert.equal(friday.dueDate, '2026-09-18');
  assert.equal(friday.dueTime, '18:00');

  const recurring = parseNaturalLanguageTask('Gym every day at 6am', ctx);
  assert.equal(recurring.recurrenceKind, 'daily');
  assert.equal(recurring.dueTime, '06:00');

  const relative = parseNaturalLanguageTask('Quick sync in 2 hours', ctx);
  assert.equal(relative.dueDate, '2026-09-14');
  assert.equal(relative.dueTime, '19:30');
});

test('natural language capture never eats plain titles', () => {
  const plain = parseNaturalLanguageTask('Read chapter 7', ctx);
  assert.equal(plain.title, 'Read chapter 7');
  assert.equal(plain.dueDate, null);
  assert.equal(plain.dueTime, null);

  const adjective = parseNaturalLanguageTask('Weekly review every monday at 5pm', ctx);
  assert.equal(adjective.title, 'Weekly review');
  assert.equal(adjective.recurrenceKind, 'weekly');
});

test('productivity score measures ratios, never raw volume', () => {
  const light = productivityScore({
    dayKey: '2026-09-14',
    plannedTasks: 3,
    completedPlannedTasks: 3,
    completedTasks: 3,
    focusMinutes: 90,
    habitsScheduled: 3,
    habitsCompleted: 3,
    importantNotUrgentCompleted: 1,
    overdueTasks: 0,
    reviewedDay: true,
  });
  const heroic = productivityScore({
    dayKey: '2026-09-14',
    plannedTasks: 3,
    completedPlannedTasks: 3,
    completedTasks: 3,
    focusMinutes: 600, // 10 hours — must not score higher
    habitsScheduled: 3,
    habitsCompleted: 3,
    importantNotUrgentCompleted: 1,
    overdueTasks: 0,
    reviewedDay: true,
  });
  assert.equal(light.score, heroic.score);
  assert.equal(heroic.flags.overwork, true);
  assert.match(heroic.headline, /recovery/i);

  const bad = productivityScore({
    dayKey: '2026-09-14',
    plannedTasks: 6,
    completedPlannedTasks: 0,
    completedTasks: 0,
    focusMinutes: 0,
    habitsScheduled: 0,
    habitsCompleted: 0,
    overdueTasks: 5,
  });
  assert.ok(bad.score < light.score);
});

test('heat map buckets days by intensity and summarises totals', () => {
  const activity = new Map(
    [
      ['2026-09-01', 4],
      ['2026-09-02', 1],
      ['2026-09-03', 9],
    ].map(([dayKey, value]) => [
      dayKey as string,
      {
        dayKey: dayKey as string,
        tasksCompleted: value as number,
        tasksCreated: 0,
        focusMinutes: 0,
        habitsCompleted: 0,
        habitsScheduled: 0,
        plannedTaskCount: value as number,
        plannedCompletedCount: value as number,
      },
    ]),
  );

  const heatmap = buildHeatmap({ metric: 'tasks_completed', range: 'month', anchor: '2026-09-14', activity });
  assert.equal(heatmap.cells.length, 30);
  const busiest = heatmap.cells.find((cell) => cell.dayKey === '2026-09-03');
  // With only a few active days the scale stays readable, but the busiest day
  // must still be the darkest cell.
  assert.ok((busiest?.level ?? 0) >= 3);
  assert.equal(busiest?.level, Math.max(...heatmap.cells.map((cell) => cell.level)));
  assert.equal(heatmap.totals.tasksCompleted, 14);
  assert.equal(heatmap.totals.activeDays, 3);
  assert.equal(heatmap.totals.bestDay, '2026-09-03');
  assert.equal(heatmap.cells.find((c) => c.dayKey === '2026-09-10')?.level, 0);

  // A dense history exercises the full 0–4 ramp.
  const dense = new Map(
    Array.from({ length: 12 }, (_, index) => {
      const dayKey = addDays('2026-09-01', index);
      const value = index + 1;
      return [
        dayKey,
        {
          dayKey,
          tasksCompleted: value,
          tasksCreated: 0,
          focusMinutes: 0,
          habitsCompleted: 0,
          habitsScheduled: 0,
          plannedTaskCount: value,
          plannedCompletedCount: value,
        },
      ];
    }),
  );
  const denseHeatmap = buildHeatmap({ metric: 'tasks_completed', range: 'month', anchor: '2026-09-14', activity: dense });
  assert.equal(Math.max(...denseHeatmap.cells.map((cell) => cell.level)), 4);
});

test('habit scheduling understands frequencies', () => {
  assert.equal(habitScheduledOn({ frequency: 'daily', scheduleDays: [] }, '2026-09-14'), true);
  assert.equal(habitScheduledOn({ frequency: 'weekdays', scheduleDays: [] }, '2026-09-19'), false); // Saturday
  assert.equal(habitScheduledOn({ frequency: 'custom', scheduleDays: [1, 3] }, '2026-09-14'), true);
  assert.equal(habitScheduledOn({ frequency: 'custom', scheduleDays: [1, 3] }, '2026-09-15'), false);
});
