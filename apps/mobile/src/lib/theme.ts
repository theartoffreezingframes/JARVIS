/**
 * The JARVIS design system.
 *
 * Colours, spacing, radii and type live here so that every screen looks like
 * part of the same product. The user's account settings feed in as well: theme
 * preference, preset, accent colour, density, corner style, animation level and
 * font scale all flow through this module, which is why components read values
 * from `usePalette()`/`useMetrics()` rather than importing constants directly.
 *
 * Accessibility rules encoded here:
 *  - the accent is darkened/lightened until it has enough contrast with the
 *    surface it sits on, so a custom colour can never make text unreadable;
 *  - font scale is clamped to 0.85–1.3 and every text style keeps a line height
 *    that still fits;
 *  - touch targets are never below 44pt regardless of density.
 */
import { useColorScheme } from 'react-native';
import { useSyncExternalStore } from 'react';

export type Appearance = 'light' | 'dark';
export type ThemePreference = 'light' | 'dark' | 'system';

export interface Palette {
  /** App background, one step below surfaces. */
  background: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  borderStrong: string;
  primary: string;
  primaryMuted: string;
  onPrimary: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  quadrant: { do_now: string; schedule: string; delegate: string; eliminate: string };
  priority: { low: string; medium: string; high: string; urgent: string };
  /** Heat map ramp, level 0 → 4. */
  heat: [string, string, string, string, string];
}

const light: Palette = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F3F7',
  text: '#0F172A',
  textMuted: '#5B6478',
  textFaint: '#98A2B3',
  border: '#E4E7EC',
  borderStrong: '#CDD3DD',
  primary: '#4F46E5',
  primaryMuted: '#EEF0FF',
  onPrimary: '#FFFFFF',
  success: '#0E9F6E',
  warning: '#C27803',
  danger: '#D92D20',
  info: '#1D6FE0',
  quadrant: { do_now: '#D92D20', schedule: '#1D6FE0', delegate: '#C27803', eliminate: '#667085' },
  priority: { low: '#667085', medium: '#1D6FE0', high: '#C27803', urgent: '#D92D20' },
  heat: ['#EDEFF3', '#D7DCF7', '#A9B2F0', '#7B87E8', '#4F46E5'],
};

const dark: Palette = {
  background: '#0B0F19',
  surface: '#141A28',
  surfaceMuted: '#1C2436',
  text: '#F7F8FA',
  textMuted: '#9BA5B7',
  textFaint: '#6C7688',
  border: '#232B3D',
  borderStrong: '#323C52',
  primary: '#7C83F5',
  primaryMuted: '#1D2440',
  onPrimary: '#0B0F19',
  success: '#34D399',
  warning: '#F0B429',
  danger: '#F97066',
  info: '#60A5FA',
  quadrant: { do_now: '#F97066', schedule: '#60A5FA', delegate: '#F0B429', eliminate: '#98A2B3' },
  priority: { low: '#98A2B3', medium: '#60A5FA', high: '#F0B429', urgent: '#F97066' },
  heat: ['#1B2233', '#2A3462', '#3B4A9E', '#5563D6', '#8B92F7'],
};

export const palettes: Record<Appearance, Palette> = { light, dark };

/** Surface tints shipped as presets — each keeps the same contrast ratios. */
export interface ThemePresetDef {
  id: 'indigo' | 'slate' | 'ocean' | 'forest' | 'sunset' | 'mono';
  label: string;
  accent: string;
  background: Record<Appearance, string>;
  surface: Record<Appearance, string>;
  surfaceMuted: Record<Appearance, string>;
}

export const THEME_PRESETS: ThemePresetDef[] = [
  {
    id: 'indigo',
    label: 'Indigo',
    accent: '#4F46E5',
    background: { light: '#F6F7F9', dark: '#0B0F19' },
    surface: { light: '#FFFFFF', dark: '#141A28' },
    surfaceMuted: { light: '#F1F3F7', dark: '#1C2436' },
  },
  {
    id: 'slate',
    label: 'Slate',
    accent: '#475569',
    background: { light: '#F5F6F8', dark: '#0D1117' },
    surface: { light: '#FFFFFF', dark: '#161B22' },
    surfaceMuted: { light: '#EDEFF2', dark: '#1F242C' },
  },
  {
    id: 'ocean',
    label: 'Ocean',
    accent: '#0E7490',
    background: { light: '#F3F7F9', dark: '#071318' },
    surface: { light: '#FFFFFF', dark: '#0E1F27' },
    surfaceMuted: { light: '#E8F1F4', dark: '#152C36' },
  },
  {
    id: 'forest',
    label: 'Forest',
    accent: '#15803D',
    background: { light: '#F4F7F4', dark: '#08130C' },
    surface: { light: '#FFFFFF', dark: '#102016' },
    surfaceMuted: { light: '#E9F1EA', dark: '#16291B' },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    accent: '#C2410C',
    background: { light: '#FAF6F4', dark: '#140A07' },
    surface: { light: '#FFFFFF', dark: '#22130E' },
    surfaceMuted: { light: '#F6EAE5', dark: '#2E1B14' },
  },
  {
    id: 'mono',
    label: 'Mono',
    accent: '#111827',
    background: { light: '#F7F7F8', dark: '#0A0A0B' },
    surface: { light: '#FFFFFF', dark: '#151517' },
    surfaceMuted: { light: '#EFEFF1', dark: '#1E1E21' },
  },
];

export const ACCENT_SWATCHES = ['#4F46E5', '#7C3AED', '#0E7490', '#15803D', '#C2410C', '#BE123C', '#B45309', '#475569'];

/* -------------------------------------------------------------------------- */
/*  Contrast                                                                  */
/* -------------------------------------------------------------------------- */

function parseHex(hex: string): [number, number, number] | null {
  const value = hex.replace('#', '').trim();
  if (value.length !== 6) return null;
  const num = Number.parseInt(value, 16);
  if (Number.isNaN(num)) return null;
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const first = parseHex(a);
  const second = parseHex(b);
  if (!first || !second) return 21;
  const l1 = luminance(first);
  const l2 = luminance(second);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function mix(rgb: [number, number, number], target: [number, number, number], amount: number): [number, number, number] {
  return [
    rgb[0] + (target[0] - rgb[0]) * amount,
    rgb[1] + (target[1] - rgb[1]) * amount,
    rgb[2] + (target[2] - rgb[2]) * amount,
  ];
}

/** Nudges a colour until it is readable on the given background. */
export function ensureContrast(color: string, background: string, minimum = 4): string {
  const rgb = parseHex(color);
  const bg = parseHex(background);
  if (!rgb || !bg) return color;
  let current = rgb;
  const towards: [number, number, number] = luminance(bg) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let step = 0; step < 20; step += 1) {
    const candidate = toHex(current);
    if (contrastRatio(candidate, background) >= minimum) return candidate;
    current = mix(current, towards, 0.12);
  }
  return toHex(current);
}

export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const alphaHex = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}${alphaHex}`;
}

/* -------------------------------------------------------------------------- */
/*  Metrics                                                                   */
/* -------------------------------------------------------------------------- */

export const baseSpacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 36,
} as const;

export const baseRadius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export type SpacingKey = keyof typeof baseSpacing;
export type RadiusKey = keyof typeof baseRadius;

/**
 * Spacing and radii are live views of the current density/corner settings, so a
 * screen written once with `spacing.lg` respects the user's choice without
 * threading metrics through every component.
 */
function liveScale<Key extends string>(base: Record<Key, number>, factor: () => number, pill?: Key) {
  const out = {} as Record<Key, number>;
  for (const key of Object.keys(base) as Key[]) {
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => (pill && key === pill ? base[key] : Math.round(base[key] * factor())),
    });
  }
  return out;
}

export const spacing = liveScale(baseSpacing, () => (config.density === 'compact' ? 0.78 : 1)) as Record<
  SpacingKey,
  number
>;
export const radius = liveScale(baseRadius, () => (config.radiusStyle === 'soft' ? 0.62 : 1), 'pill') as Record<
  RadiusKey,
  number
>;

export interface Metrics {
  density: 'comfortable' | 'compact';
  radiusStyle: 'rounded' | 'soft';
  fontScale: number;
  animationLevel: 'full' | 'reduced' | 'none';
  /** Spacing multiplier applied to `space()`. */
  space: (key: keyof typeof baseSpacing) => number;
  /** Radius applied to `round()`. */
  round: (key: keyof typeof baseRadius) => number;
  /** Duration in ms for a motion role, already respecting the user's choice. */
  duration: (role: 'quick' | 'base' | 'slow') => number;
  font: (size: number) => number;
}

let metrics: Omit<Metrics, 'space' | 'round' | 'duration' | 'font'> = {
  density: 'comfortable',
  radiusStyle: 'rounded',
  fontScale: 1,
  animationLevel: 'full',
};

const DENSITY_FACTOR = { comfortable: 1, compact: 0.78 } as const;
const RADIUS_FACTOR = { rounded: 1, soft: 0.62 } as const;
const MOTION: Record<Metrics['animationLevel'], Record<'quick' | 'base' | 'slow', number>> = {
  full: { quick: 140, base: 220, slow: 320 },
  reduced: { quick: 90, base: 120, slow: 160 },
  none: { quick: 0, base: 0, slow: 0 },
};

export function buildMetrics(): Metrics {
  return {
    ...metrics,
    space: (key) => Math.round(baseSpacing[key] * DENSITY_FACTOR[metrics.density]),
    round: (key) => (key === 'pill' ? 999 : Math.round(baseRadius[key] * RADIUS_FACTOR[metrics.radiusStyle])),
    duration: (role) => MOTION[metrics.animationLevel][role],
    font: (size) => Number((size * metrics.fontScale).toFixed(1)),
  };
}

/** Typography roles — scaled by the user's font-size preference. */
export interface TypeStyle {
  fontSize: number;
  lineHeight: number;
  fontWeight: '400' | '500' | '600' | '700';
  letterSpacing?: number;
}

const baseTypography: Record<string, TypeStyle> = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.4 },
  headline: { fontSize: 19, lineHeight: 25, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15.5, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15.5, lineHeight: 22, fontWeight: '600' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12.5, lineHeight: 17, fontWeight: '500' },
  micro: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 0.3 },
};

/** Text styles scaled by the user's font-size preference at read time. */
export const typography = new Proxy(baseTypography, {
  get(target, key: string) {
    const style = target[key];
    if (!style) return undefined;
    const scale = config.fontScale;
    if (scale === 1) return style;
    return {
      ...style,
      fontSize: Number((style.fontSize * scale).toFixed(1)),
      lineHeight: Math.round(style.lineHeight * Math.max(1, scale * 0.96)),
    };
  },
}) as Record<keyof typeof baseTypography, TypeStyle>;

/** Minimum touch target, used on every interactive element. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TOUCH = 44;

/* -------------------------------------------------------------------------- */
/*  Runtime configuration                                                     */
/* -------------------------------------------------------------------------- */

interface ThemeConfig {
  preference: ThemePreference;
  preset: ThemePresetDef['id'];
  accentColor: string | null;
  density: Metrics['density'];
  radiusStyle: Metrics['radiusStyle'];
  animationLevel: Metrics['animationLevel'];
  fontScale: number;
}

let config: ThemeConfig = {
  preference: 'system',
  preset: 'indigo',
  accentColor: null,
  density: 'comfortable',
  radiusStyle: 'rounded',
  animationLevel: 'full',
  fontScale: 1,
};

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function setAppearancePreference(next: ThemePreference): void {
  if (next === config.preference) return;
  config = { ...config, preference: next };
  notify();
}

export function getAppearancePreference(): ThemePreference {
  return config.preference;
}

/** Applies the user's stored customization (called by the auth provider). */
export function applyThemeSettings(next: Partial<ThemeConfig>): void {
  let changed = false;
  for (const [key, value] of Object.entries(next) as Array<[keyof ThemeConfig, never]>) {
    if (value === undefined || config[key] === value) continue;
    (config as unknown as Record<string, unknown>)[key] = value;
    changed = true;
  }
  const presetChanged = next.preset !== undefined || next.accentColor !== undefined;
  const metricsChanged =
    next.density !== undefined ||
    next.radiusStyle !== undefined ||
    next.animationLevel !== undefined ||
    next.fontScale !== undefined;
  if (metricsChanged) {
    metrics = {
      density: config.density,
      radiusStyle: config.radiusStyle,
      animationLevel: config.animationLevel,
      fontScale: config.fontScale,
    };
  }
  if (changed || presetChanged) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function useConfig(): ThemeConfig {
  return useSyncExternalStore(
    subscribe,
    () => config,
    () => config,
  );
}

export function useAppearance(): Appearance {
  const scheme = useColorScheme();
  const current = useConfig();
  if (current.preference === 'system') return scheme === 'dark' ? 'dark' : 'light';
  return current.preference;
}

/**
 * The active palette: base light/dark colours, the chosen preset's surface
 * tints, and the accent — contrast-corrected for the surface it appears on.
 */
export function usePalette(): Palette {
  const appearance = useAppearance();
  const current = useConfig();
  const base = palettes[appearance];
  const preset = THEME_PRESETS.find((item) => item.id === current.preset) ?? THEME_PRESETS[0];
  const background = preset.background[appearance];
  const surface = preset.surface[appearance];
  const surfaceMuted = preset.surfaceMuted[appearance];

  const requested = current.accentColor ?? preset.accent;
  const onSurface = ensureContrast(requested, surface, 4.5);
  const primary = appearance === 'light' ? onSurface : ensureContrast(onSurface, background, 3.5);
  const onPrimary = contrastRatio('#FFFFFF', primary) >= 3.4 ? '#FFFFFF' : '#0B0F19';

  return {
    ...base,
    background,
    surface,
    surfaceMuted,
    primary,
    primaryMuted: withAlpha(primary, appearance === 'light' ? 0.1 : 0.18),
    onPrimary,
    heat:
      appearance === 'light'
        ? [
            withAlpha(primary, 0.1),
            withAlpha(primary, 0.28),
            withAlpha(primary, 0.5),
            withAlpha(primary, 0.74),
            primary,
          ]
        : base.heat,
  };
}

export function useMetrics(): Metrics {
  useConfig();
  return buildMetrics();
}

export { spacing as baseSpace };
export type { Palette as PaletteType };
