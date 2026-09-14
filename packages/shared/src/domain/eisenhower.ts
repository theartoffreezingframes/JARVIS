import type { Quadrant } from './primitives';

export interface EisenhowerInput {
  important: boolean;
  urgent: boolean;
}

export interface QuadrantMeta {
  id: Quadrant;
  title: string;
  action: string;
  /** Short instruction shown on the matrix card. */
  subtitle: string;
  description: string;
  /** Accent colour token (resolved by the design system, not hard-coded per platform). */
  tone: 'danger' | 'primary' | 'warning' | 'neutral';
  order: number;
}

export const QUADRANTS_META: readonly QuadrantMeta[] = [
  {
    id: 'do_now',
    title: 'Do Now',
    action: 'DO',
    subtitle: 'Urgent + Important',
    description: 'Crises, deadlines and anything with real consequences. Handle these first, then keep them rare.',
    tone: 'danger',
    order: 0,
  },
  {
    id: 'schedule',
    title: 'Schedule',
    action: 'PLAN',
    subtitle: 'Not Urgent + Important',
    description: 'Deep work, learning, health and relationships. This is where compounding progress lives — give it calendar time.',
    tone: 'primary',
    order: 1,
  },
  {
    id: 'delegate',
    title: 'Delegate',
    action: 'SHARE',
    subtitle: 'Urgent + Not Important',
    description: 'Someone else’s emergency, most interruptions and routine admin. Hand it off, batch it, or automate it.',
    tone: 'warning',
    order: 2,
  },
  {
    id: 'eliminate',
    title: 'Eliminate',
    action: 'DROP',
    subtitle: 'Not Urgent + Not Important',
    description: 'Busywork and noise. Remove it rather than optimising it.',
    tone: 'neutral',
    order: 3,
  },
] as const;

// Keys are `${important}:${urgent}`.
const QUADRANT_BY_KEY: Record<string, Quadrant> = {
  'true:true': 'do_now', // urgent + important
  'true:false': 'schedule', // important, not urgent
  'false:true': 'delegate', // urgent, not important
  'false:false': 'eliminate', // neither
};

/** Derive the Eisenhower quadrant from the two classifying questions. */
export function quadrantOf(input: EisenhowerInput): Quadrant {
  return QUADRANT_BY_KEY[`${input.important}:${input.urgent}`] ?? 'eliminate';
}

export function quadrantMeta(quadrant: Quadrant): QuadrantMeta {
  return QUADRANTS_META.find((q) => q.id === quadrant) ?? QUADRANTS_META[3]!;
}

/** Reverse mapping — used by drag & drop on the matrix. */
export function flagsForQuadrant(quadrant: Quadrant): EisenhowerInput {
  switch (quadrant) {
    case 'do_now':
      return { important: true, urgent: true };
    case 'schedule':
      return { important: true, urgent: false };
    case 'delegate':
      return { important: false, urgent: true };
    case 'eliminate':
    default:
      return { important: false, urgent: false };
  }
}

export interface MatrixSuggestion {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  body: string;
  quadrant: Quadrant | null;
}

export interface MatrixCounts {
  do_now: number;
  schedule: number;
  delegate: number;
  eliminate: number;
}

/**
 * Coaching copy for an overloaded matrix. These are deliberately framed as
 * trade-offs, never as "do more": the goal is a believable advisor, not a nag.
 */
export function matrixSuggestions(counts: MatrixCounts, total?: number): MatrixSuggestion[] {
  const suggestions: MatrixSuggestion[] = [];
  const sum = total ?? counts.do_now + counts.schedule + counts.delegate + counts.eliminate;

  if (counts.do_now >= 8) {
    suggestions.push({
      id: 'firefighting',
      severity: 'critical',
      quadrant: 'do_now',
      title: `${counts.do_now} tasks are marked urgent and important`,
      body: 'You are fire-fighting. Pick the two that genuinely cannot wait, schedule the rest, and ask which ones became urgent because they were left in “Schedule” too long.',
    });
  } else if (counts.do_now >= 4) {
    suggestions.push({
      id: 'heavy-do-now',
      severity: 'warning',
      quadrant: 'do_now',
      title: `${counts.do_now} items in Do Now`,
      body: 'More than a few genuine emergencies is a signal, not a badge. Reserve this quadrant for work with real consequences today.',
    });
  }

  if (sum >= 10 && counts.schedule <= 1) {
    suggestions.push({
      id: 'no-investment',
      severity: 'warning',
      quadrant: 'schedule',
      title: 'Almost nothing in Schedule',
      body: 'Nothing important-but-not-urgent means no time is going into learning, health or long-term work. Block 60 minutes for one of those this week.',
    });
  }

  if (counts.delegate >= 6) {
    suggestions.push({
      id: 'delegate-heavy',
      severity: 'warning',
      quadrant: 'delegate',
      title: `${counts.delegate} tasks are urgent but not important`,
      body: 'This is other people’s urgency. Batch them into one block, template them, or hand them over.',
    });
  }

  if (counts.eliminate >= 6) {
    suggestions.push({
      id: 'eliminate-heavy',
      severity: 'info',
      quadrant: 'eliminate',
      title: `${counts.eliminate} tasks landed in Eliminate`,
      body: 'Consider deleting them instead of carrying them. An honest list is faster to trust.',
    });
  }

  if (sum > 0 && counts.schedule + counts.do_now > 0 && counts.eliminate + counts.delegate > counts.schedule + counts.do_now) {
    suggestions.push({
      id: 'reactive-share',
      severity: 'info',
      quadrant: null,
      title: 'Most of your list is reactive',
      body: 'The majority of open tasks are not important. Trimming a few will do more for your week than any planning tweak.',
    });
  }

  return suggestions;
}
