/**
 * Shared domain primitives for JARVIS.
 *
 * Everything in `@jarvis/shared` is pure: no I/O, no `Date.now()` inside logic
 * (time is always injected), no platform APIs. The API server and the mobile
 * client both consume these modules so that validation and business rules can
 * never drift apart.
 */
export * from './domain/primitives';
export * from './domain/dates';
export * from './domain/eisenhower';
export * from './domain/recurrence';
export * from './domain/habits';
export * from './domain/models';
export * from './domain/schemas';
export * from './domain/planning';
export * from './domain/scoring';
export * from './domain/heatmap';
export * from './domain/nlp';
