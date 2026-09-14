/**
 * The focus timer.
 *
 * Nothing here counts down in JavaScript state: every phase stores the instant
 * it *ends*, and the remaining time is always derived from the clock. That means
 * the timer stays accurate when the app is backgrounded, when the phone sleeps,
 * and when the app is relaunched — the UI simply re-reads the timestamps.
 *
 * The timer also drives real records: starting a phase creates a focus session
 * on the server (queued when offline), and finishing it writes the actual
 * seconds, which is what the focus analytics and heat map are built from.
 */
import { useEffect, useReducer } from 'react';
import * as Notifications from 'expo-notifications';
import * as Haptics from 'expo-haptics';
import { api } from './api';
import { enqueueOperation, isOfflineError } from './offline';
import { invalidate } from './query';
import { readJson, writeJson, storageKeys } from './storage';
import { elapsedSecondsAt, hasExpiredAt, progressAt, remainingMsAt } from './timer-math';
import { todayKey } from '@jarvis/shared';

export type FocusPhase = 'focus' | 'short_break' | 'long_break';
export type FocusMode = 'pomodoro' | 'custom' | 'deep_work';

export interface FocusTimerConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  sessionsBeforeLongBreak: number;
  autoStartBreaks: boolean;
  autoStartNextSession: boolean;
  offsetMinutes: number;
  haptics: boolean;
  sound: boolean;
}

export interface FocusTimerState {
  phase: FocusPhase;
  /** null when idle. */
  endsAt: number | null;
  /** Remaining milliseconds when paused. */
  pausedRemainingMs: number | null;
  startedAt: number | null;
  phasePlannedSeconds: number;
  completedRounds: number;
  taskId: string | null;
  taskTitle: string | null;
  label: string | null;
  mode: FocusMode;
  /** Server session id (null while offline; the queue carries the record). */
  sessionId: string | null;
  /** Seconds focused in the current phase so far (accrued across pauses). */
  accruedSeconds: number;
  interruptions: number;
  running: boolean;
  finishedAt: number | null;
  notifiedPhaseEnd: boolean;
}

const DEFAULT_CONFIG: FocusTimerConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  sessionsBeforeLongBreak: 4,
  autoStartBreaks: true,
  autoStartNextSession: false,
  offsetMinutes: 0,
  haptics: true,
  sound: false,
};

const IDLE: FocusTimerState = {
  phase: 'focus',
  endsAt: null,
  pausedRemainingMs: null,
  startedAt: null,
  phasePlannedSeconds: 25 * 60,
  completedRounds: 0,
  taskId: null,
  taskTitle: null,
  label: null,
  mode: 'pomodoro',
  sessionId: null,
  accruedSeconds: 0,
  interruptions: 0,
  running: false,
  finishedAt: null,
  notifiedPhaseEnd: false,
};

let config: FocusTimerConfig = { ...DEFAULT_CONFIG };
let state: FocusTimerState = { ...IDLE };
let hydrated = false;

const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;

function notify(): void {
  for (const listener of listeners) listener();
}

function persist(): void {
  void writeJson(storageKeys.focusTimer, { state, config });
}

function scheduleNotification(title: string, body: string, at: number): void {
  if (at <= Date.now()) return;
  void Notifications.scheduleNotificationAsync({
    content: { title, body, sound: config.sound, data: { kind: 'focus' } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(at), channelId: 'default' },
  }).catch(() => undefined);
}

async function cancelNotifications(): Promise<void> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((item) => (item.content?.data as { kind?: string } | undefined)?.kind === 'focus')
        .map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)),
    );
  } catch {
    /* web / unsupported */
  }
}

function buzz(style: 'light' | 'success' | 'warning'): void {
  if (!config.haptics) return;
  void Haptics.notificationAsync(
    style === 'success'
      ? Haptics.NotificationFeedbackType.Success
      : style === 'warning'
        ? Haptics.NotificationFeedbackType.Warning
        : Haptics.NotificationFeedbackType.Success,
  ).catch(() => undefined);
}

function secondsFor(phase: FocusPhase): number {
  if (phase === 'short_break') return config.shortBreakMinutes * 60;
  if (phase === 'long_break') return config.longBreakMinutes * 60;
  return config.focusMinutes * 60;
}

export function configureFocusTimer(next: Partial<FocusTimerConfig>): void {
  config = { ...config, ...next };
  persist();
}

export function getFocusTimerConfig(): FocusTimerConfig {
  return config;
}

export function getFocusTimerState(): FocusTimerState {
  return state;
}

export function remainingMs(current: FocusTimerState = state, now: number = Date.now()): number {
  return remainingMsAt(current, now);
}

/** True when the running phase has passed its stored end timestamp. */
export function phaseHasExpired(now: number = Date.now()): boolean {
  return hasExpiredAt(state, now);
}

export function useFocusTimerState(): FocusTimerState {
  const [, force] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, [force]);
  return state;
}

export function subscribeFocusTimer(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function startTicker(): void {
  if (ticker) return;
  ticker = setInterval(() => {
    if (!state.running) return;
    if (remainingMs() <= 0) {
      void completePhase();
    } else {
      notify();
    }
  }, 500);
}

/**
 * Re-checks the running phase against the wall clock.
 *
 * Called whenever the app comes back to the foreground: if the phase ended while
 * the phone was asleep (or while the JS timers were suspended) the session is
 * written immediately, instead of waiting for the next tick.
 */
export async function refreshFocusTimerFromClock(): Promise<void> {
  if (!hydrated) return;
  if (state.running && remainingMs() <= 0) {
    await completePhase();
    return;
  }
  notify();
}

/** Restores a running timer after a relaunch — the clock does the rest. */
export async function hydrateFocusTimer(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  const saved = await readJson<{ state?: FocusTimerState; config?: FocusTimerConfig } | null>(storageKeys.focusTimer, null);
  if (saved?.config) config = { ...DEFAULT_CONFIG, ...saved.config };
  if (saved?.state) state = { ...IDLE, ...saved.state };
  startTicker();
  if (state.running && remainingMs() <= 0) await completePhase();
  notify();
}

async function recordSessionStart(input: {
  mode: FocusMode;
  plannedMinutes: number;
  taskId: string | null;
  label: string | null;
  startedAt: number;
}): Promise<string | null> {
  const dayKey = todayKey(Date.now(), config.offsetMinutes);
  const clientId = `fcs_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  try {
    const payload = await api.post<{ session: { id: string } }>('/api/focus/sessions', {
      taskId: input.taskId,
      projectId: null,
      mode: input.mode,
      label: input.label,
      plannedMinutes: input.plannedMinutes,
      startedAt: input.startedAt,
      dayKey,
      clientId,
    });
    return payload.session.id;
  } catch (error) {
    if (!isOfflineError(error)) return null;
    await enqueueOperation({
      label: 'Save focus session',
      sync: {
        entity: 'focus_session',
        op: 'create',
        entityId: clientId,
        patch: {
          taskId: input.taskId,
          projectId: null,
          mode: input.mode,
          label: input.label,
          plannedMinutes: input.plannedMinutes,
          startedAt: input.startedAt,
          dayKey,
          clientId,
        },
      },
      invalidate: ['focus', 'dashboard', 'analytics'],
    });
    return clientId;
  }
}

async function recordSessionEnd(input: {
  sessionId: string | null;
  actualSeconds: number;
  completed: boolean;
  interruptions: number;
  taskId: string | null;
}): Promise<void> {
  if (input.actualSeconds <= 0) return;
  const payload = {
    actualSeconds: Math.round(input.actualSeconds),
    completed: input.completed,
    interruptions: input.interruptions,
    taskId: input.taskId,
  };
  if (!input.sessionId) return;
  const isLocal = input.sessionId.startsWith('fcs_');
  try {
    if (isLocal) {
      await api.post('/api/focus/sessions', {
        taskId: input.taskId,
        projectId: null,
        mode: 'pomodoro',
        label: null,
        plannedMinutes: Math.max(1, Math.round(input.actualSeconds / 60)),
        startedAt: Date.now() - input.actualSeconds * 1000,
        actualSeconds: Math.round(input.actualSeconds),
        completed: true,
      });
    } else {
      await api.patch(`/api/focus/sessions/${input.sessionId}`, payload);
    }
  } catch (error) {
    if (!isOfflineError(error)) return;
    await enqueueOperation({
      label: 'Record focus time',
      sync: { entity: 'focus_session', op: 'update', entityId: input.sessionId, patch: payload },
      invalidate: ['focus', 'dashboard', 'analytics'],
    });
  }
  invalidate('focus', 'dashboard', 'analytics', 'heatmap');
}

export interface StartFocusInput {
  minutes?: number;
  mode?: FocusMode;
  taskId?: string | null;
  taskTitle?: string | null;
  label?: string | null;
}

export async function startFocus(input: StartFocusInput = {}): Promise<void> {
  const minutes = input.minutes ?? config.focusMinutes;
  const startedAt = Date.now();
  const mode = input.mode ?? (minutes === config.focusMinutes ? 'pomodoro' : 'custom');
  state = {
    ...IDLE,
    phase: 'focus',
    mode,
    label: input.label ?? (mode === 'deep_work' ? 'Deep work' : null),
    taskId: input.taskId ?? null,
    taskTitle: input.taskTitle ?? null,
    phasePlannedSeconds: minutes * 60,
    startedAt,
    endsAt: startedAt + minutes * 60_000,
    running: true,
    completedRounds: state.completedRounds,
  };
  notify();
  persist();
  startTicker();
  scheduleNotification('Focus complete', `${minutes} minutes done. Take a breath.`, startedAt + minutes * 60_000);

  const sessionId = await recordSessionStart({
    mode,
    plannedMinutes: minutes,
    taskId: input.taskId ?? null,
    label: input.label ?? null,
    startedAt,
  });
  if (state.startedAt === startedAt) {
    state = { ...state, sessionId };
    persist();
    notify();
  }
}

export function pauseFocus(): void {
  if (!state.running) return;
  state = {
    ...state,
    running: false,
    pausedRemainingMs: remainingMs(),
    accruedSeconds: elapsedSeconds(),
    interruptions: state.interruptions + 1,
    endsAt: null,
  };
  notify();
  persist();
  void cancelNotifications();
}

export function resumeFocus(): void {
  if (state.running || state.pausedRemainingMs === null) return;
  state = {
    ...state,
    running: true,
    endsAt: Date.now() + state.pausedRemainingMs,
    pausedRemainingMs: null,
    startedAt: state.startedAt ?? Date.now(),
  };
  notify();
  persist();
  startTicker();
  if (state.endsAt !== null) scheduleNotification('Focus complete', 'Your session is finishing.', state.endsAt);
}

export function elapsedSeconds(now: number = Date.now()): number {
  return elapsedSecondsAt(state, now);
}

/** Stops the current phase early, keeping the time actually spent. */
export async function stopFocus(): Promise<void> {
  const seconds = elapsedSeconds();
  const sessionId = state.sessionId;
  const taskId = state.taskId;
  const phase = state.phase;
  state = { ...IDLE, completedRounds: state.completedRounds };
  await cancelNotifications();
  notify();
  persist();
  if (phase === 'focus') {
    await recordSessionEnd({
      sessionId,
      actualSeconds: seconds,
      completed: false,
      interruptions: state.interruptions,
      taskId,
    });
  }
}

/** Full reset: back to a clean, idle timer. */
export async function resetFocus(): Promise<void> {
  state = { ...IDLE };
  await cancelNotifications();
  notify();
  persist();
}

/** Ends the phase now (used by Skip) without recording focus time. */
export async function skipPhase(): Promise<void> {
  await cancelNotifications();
  if (state.phase === 'focus') {
    await stopFocus();
    await beginPhase(nextBreakPhase(state.completedRounds), false);
    return;
  }
  state = {
    ...state,
    phase: 'focus',
    phasePlannedSeconds: config.focusMinutes * 60,
    running: false,
    endsAt: null,
    pausedRemainingMs: null,
    startedAt: null,
    sessionId: null,
    accruedSeconds: 0,
    interruptions: 0,
  };
  notify();
  persist();
}

function nextBreakPhase(completedRounds: number): FocusPhase {
  const rounds = completedRounds + 1;
  return rounds % Math.max(2, config.sessionsBeforeLongBreak) === 0 ? 'long_break' : 'short_break';
}

async function beginPhase(phase: FocusPhase, autoStart: boolean): Promise<void> {
  const seconds = secondsFor(phase);
  const startedAt = Date.now();
  state = {
    ...state,
    phase,
    phasePlannedSeconds: seconds,
    running: autoStart,
    endsAt: autoStart ? startedAt + seconds * 1000 : null,
    pausedRemainingMs: autoStart ? null : seconds * 1000,
    startedAt: autoStart ? startedAt : null,
    sessionId: null,
    accruedSeconds: 0,
    interruptions: 0,
    taskId: null,
    taskTitle: null,
    mode: phase === 'focus' ? 'pomodoro' : 'custom',
  };
  if (autoStart) {
    startTicker();
    scheduleNotification(
      phase === 'focus' ? 'Focus session starting' : 'Break over',
      phase === 'focus' ? 'Back to it — the timer is running.' : 'Ready for the next round?',
      state.endsAt ?? 0,
    );
    if (phase === 'focus') {
      const sessionId = await recordSessionStart({
        mode: 'pomodoro',
        plannedMinutes: config.focusMinutes,
        taskId: null,
        label: null,
        startedAt,
      });
      if (state.startedAt === startedAt) state = { ...state, sessionId };
    }
  }
  notify();
  persist();
}

/** Phase finished naturally (or the clock ran past the end while backgrounded). */
async function completePhase(): Promise<void> {
  if (state.phase === 'focus') {
    const focusSeconds = Math.max(state.phasePlannedSeconds, elapsedSeconds());
    const sessionId = state.sessionId;
    const taskId = state.taskId;
    const interruptions = state.interruptions;
    state = {
      ...state,
      running: false,
      endsAt: null,
      pausedRemainingMs: 0,
      finishedAt: Date.now(),
      completedRounds: state.completedRounds + 1,
      notifiedPhaseEnd: true,
    };
    notify();
    persist();
    buzz('success');
    await recordSessionEnd({ sessionId, actualSeconds: focusSeconds, completed: true, interruptions, taskId });
    await beginPhase(nextBreakPhase(state.completedRounds - 1), config.autoStartBreaks);
    return;
  }

  state = { ...state, running: false, endsAt: null, pausedRemainingMs: 0, finishedAt: Date.now() };
  notify();
  persist();
  buzz('light');
  scheduleNotification('Break finished', 'Your next focus block is ready.', Date.now() + 500);
  await beginPhase('focus', config.autoStartNextSession);
}

/** Starts a break immediately (the "take a break" action). */
export async function startBreak(long = false): Promise<void> {
  await cancelNotifications();
  await beginPhase(long ? 'long_break' : 'short_break', true);
}

export function focusTimerProgress(current: FocusTimerState = state): number {
  return progressAt(current, Date.now());
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
