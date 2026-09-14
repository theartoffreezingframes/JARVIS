/**
 * Analytics visuals.
 *
 * Intensity, trends and distribution — drawn with plain views and one small
 * SVG path so they stay cheap to render on long lists. The heat map is careful
 * to describe *activity*, never worth: streaks and rest days are both valid.
 */
import type { HeatmapCell } from '@jarvis/shared';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Badge, Card, ProgressBar, Row, Stack, Type } from './ui';
import { radius, spacing, typography, usePalette, type Palette } from '../lib/theme';

/* -------------------------------------------------------------------------- */
/*  Heat map                                                                  */
/* -------------------------------------------------------------------------- */

function toMinutes(dayKey: string): number {
  return Date.parse(`${dayKey}T00:00:00Z`);
}

function weekIndexOf(dayKey: string, firstDayKey: string): number {
  return Math.floor((toMinutes(dayKey) - toMinutes(firstDayKey)) / 86_400_000 / 7);
}

export function HeatmapGrid({
  cells,
  weekStartsOn = 1,
  compact = false,
  onSelectDay,
  selectedDay,
}: {
  cells: HeatmapCell[];
  weekStartsOn?: 0 | 1;
  compact?: boolean;
  onSelectDay?: (cell: HeatmapCell) => void;
  selectedDay?: string | null;
}) {
  const palette = usePalette();
  const size = compact ? 11 : 15;
  const gap = compact ? 3 : 4;

  const columns = useMemo(() => {
    if (cells.length === 0) return [] as Array<Array<HeatmapCell | null>>;
    const startWeekday = ((new Date(toMinutes(cells[0].dayKey)).getUTCDay() - weekStartsOn) + 7) % 7;
    const grid: Array<Array<HeatmapCell | null>> = [];
    let column: Array<HeatmapCell | null> = Array.from({ length: startWeekday }, () => null);
    for (const cell of cells) {
      column.push(cell);
      if (column.length === 7) {
        grid.push(column);
        column = [];
      }
    }
    if (column.length > 0) {
      while (column.length < 7) column.push(null);
      grid.push(column);
    }
    return grid;
  }, [cells, weekStartsOn]);

  const scrollable = columns.length > 16;

  const body = (
    <Row gap={gap} align="flex-start" style={{ paddingVertical: spacing.xs }}>
      {columns.map((column, columnIndex) => (
        <Stack key={`week-${columnIndex}`} gap={gap}>
          {column.map((cell, rowIndex) =>
            cell ? (
              <Pressable
                key={cell.dayKey}
                onPress={onSelectDay ? () => onSelectDay(cell) : undefined}
                disabled={!onSelectDay}
                accessibilityRole={onSelectDay ? 'button' : 'image'}
                accessibilityLabel={`${cell.dayKey}: ${cell.value} — level ${cell.level} of 4`}
                style={{
                  width: size,
                  height: size,
                  borderRadius: 3,
                  backgroundColor: palette.heat[Math.min(4, Math.max(0, cell.level))],
                  borderWidth: selectedDay === cell.dayKey ? 1.5 : StyleSheet.hairlineWidth,
                  borderColor: selectedDay === cell.dayKey ? palette.text : palette.border,
                }}
              />
            ) : (
              <View key={`empty-${columnIndex}-${rowIndex}`} style={{ width: size, height: size }} />
            ),
          )}
        </Stack>
      ))}
    </Row>
  );

  return (
    <Stack gap={spacing.sm}>
      {scrollable ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: spacing.md }}>
          {body}
        </ScrollView>
      ) : (
        body
      )}
      <Row gap={6} align="center">
        <Type variant="micro" color={palette.textFaint}>
          NONE
        </Type>
        {palette.heat.map((color) => (
          <View key={color} style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: color }} />
        ))}
        <Type variant="micro" color={palette.textFaint}>
          BUSY
        </Type>
      </Row>
      <Type variant="caption" color={palette.textFaint}>
        Intensity shows activity, not achievement. Rest days are part of a sustainable plan.
      </Type>
    </Stack>
  );
}

/* -------------------------------------------------------------------------- */
/*  Bars + sparkline                                                          */
/* -------------------------------------------------------------------------- */

export function MiniBars({
  data,
  color,
  height = 84,
  formatValue,
}: {
  data: Array<{ label: string; value: number }>;
  color?: string;
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const palette = usePalette();
  const max = Math.max(1, ...data.map((point) => point.value));
  const tint = color ?? palette.primary;
  return (
    <Stack gap={spacing.sm}>
      <Row gap={4} align="flex-end" style={{ height }}>
        {data.map((point, index) => (
          <View key={`${point.label}-${index}`} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
            <View
              accessibilityLabel={`${point.label}: ${formatValue ? formatValue(point.value) : point.value}`}
              style={{
                width: '100%',
                height: Math.max(2, Math.round((point.value / max) * (height - 14))),
                borderRadius: radius.sm,
                backgroundColor: index === data.length - 1 ? tint : `${tint}99`,
              }}
            />
          </View>
        ))}
      </Row>
      <Row justify="space-between">
        <Type variant="micro" color={palette.textFaint}>
          {data[0]?.label}
        </Type>
        <Type variant="micro" color={palette.textFaint}>
          {data[data.length - 1]?.label}
        </Type>
      </Row>
    </Stack>
  );
}

export function Sparkline({
  values,
  color,
  width = 260,
  height = 56,
}: {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const palette = usePalette();
  const tint = color ?? palette.primary;
  if (values.length < 2) {
    return (
      <Type variant="caption" color={palette.textFaint}>
        Not enough data yet — a few days of activity will draw this trend.
      </Type>
    );
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M${points.join(' L')}`;
  return (
    <Svg width={width} height={height} accessibilityLabel="Trend over time">
      <Path d={path} stroke={tint} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Distribution                                                              */
/* -------------------------------------------------------------------------- */

export function DistributionBar({
  segments,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
}) {
  const palette = usePalette();
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  if (total === 0) {
    return (
      <Type variant="caption" color={palette.textFaint}>
        Nothing classified in this range yet.
      </Type>
    );
  }
  return (
    <Stack gap={spacing.sm}>
      <Row gap={3} style={{ height: 10 }}>
        {segments.map((segment) => (
          <View
            key={segment.label}
            accessibilityLabel={`${segment.label}: ${segment.value} of ${total}`}
            style={{
              flex: Math.max(segment.value, 0.0001),
              backgroundColor: segment.color,
              borderRadius: radius.pill,
            }}
          />
        ))}
      </Row>
      <Stack gap={6}>
        {segments.map((segment) => (
          <Row key={segment.label} justify="space-between">
            <Row gap={6}>
              <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: segment.color }} />
              <Type variant="caption">{segment.label}</Type>
            </Row>
            <Type variant="caption" color={palette.textMuted}>
              {segment.value} · {Math.round((segment.value / total) * 100)}%
            </Type>
          </Row>
        ))}
      </Stack>
    </Stack>
  );
}

/* -------------------------------------------------------------------------- */
/*  Score                                                                     */
/* -------------------------------------------------------------------------- */

export function ScoreCard({
  score,
}: {
  score: {
    score: number;
    band: string;
    headline: string;
    components: Array<{ id: string; label: string; value: number; max: number; note: string }>;
    flags: { overwork: boolean; underPlanned: boolean; sustainable: boolean };
  };
}) {
  const palette = usePalette();
  const tone =
    score.band === 'exceptional'
      ? palette.quadrant.schedule
      : score.band === 'strong'
        ? palette.success
        : score.band === 'steady'
          ? palette.info
          : palette.textMuted;
  return (
    <Card>
      <Stack gap={spacing.md}>
        <Row justify="space-between" align="flex-start">
          <Stack gap={2} style={{ flex: 1 }}>
            <Type variant="label" color={palette.textMuted}>
              TODAY
            </Type>
            <Type variant="headline">{score.headline}</Type>
          </Stack>
          <View style={{ alignItems: 'center', minWidth: 62 }}>
            <Type variant="display" color={tone}>
              {Math.round(score.score)}
            </Type>
            <Type variant="micro" color={palette.textMuted}>
              {score.band.toUpperCase()}
            </Type>
          </View>
        </Row>
        <Stack gap={spacing.sm}>
          {score.components.map((component) => (
            <Stack key={component.id} gap={5}>
              <Row justify="space-between">
                <Type variant="caption">{component.label}</Type>
                <Type variant="caption" color={palette.textMuted}>
                  {Math.round(component.value)}/{component.max}
                </Type>
              </Row>
              <ProgressBar value={(component.value / Math.max(1, component.max)) * 100} color={tone} height={5} />
              <Type variant="micro" color={palette.textFaint}>
                {component.note}
              </Type>
            </Stack>
          ))}
        </Stack>
        {score.flags.overwork ? (
          <Row gap={6}>
            <Ionicons name="leaf-outline" size={14} color={palette.warning} />
            <Type variant="caption" color={palette.warning} style={{ flex: 1 }}>
              You are past the sustainable focus ceiling — extra hours stop adding score.
            </Type>
          </Row>
        ) : score.flags.sustainable ? (
          <Row gap={6}>
            <Ionicons name="checkmark-circle-outline" size={14} color={palette.success} />
            <Type variant="caption" color={palette.success} style={{ flex: 1 }}>
              A sustainable pace. Consistency beats intensity.
            </Type>
          </Row>
        ) : null}
      </Stack>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Small helpers                                                             */
/* -------------------------------------------------------------------------- */

export function TrendPill({ direction, changePercent, label }: { direction: string; changePercent: number; label: string }) {
  const palette = usePalette();
  const flat = direction === 'flat' || Math.abs(changePercent) < 1;
  const icon = flat ? 'remove' : changePercent > 0 ? 'trending-up' : 'trending-down';
  const color = flat ? palette.textMuted : changePercent > 0 ? palette.success : palette.warning;
  return (
    <Row gap={6}>
      <Ionicons name={icon as never} size={14} color={color} />
      <Type variant="caption" color={color}>
        {flat ? `Steady ${label}` : `${changePercent > 0 ? '+' : ''}${Math.round(changePercent)}% ${label} vs last period`}
      </Type>
    </Row>
  );
}

export function HeatLegendNote({ palette }: { palette: Palette }) {
  return (
    <Type variant="caption" color={palette.textFaint}>
      Levels are relative to your own recent activity — a calmer week is not a worse week.
    </Type>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  const palette = usePalette();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg }}>
      {children}
      <View style={{ width: '100%', height: StyleSheet.hairlineWidth, backgroundColor: palette.border }} />
    </View>
  );
}

export const heatmapStyles = StyleSheet.create({
  label: { ...typography.micro },
});

export function useSelectedDay() {
  const [selected, setSelected] = useState<string | null>(null);
  return { selected, setSelected };
}

export function DayDetail({ cell }: { cell: HeatmapCell }) {
  const palette = usePalette();
  return (
    <Card style={{ backgroundColor: palette.surfaceMuted }}>
      <Stack gap={spacing.sm}>
        <Row justify="space-between">
          <Type variant="bodyStrong">{cell.dayKey}</Type>
          <Badge label={`Score ${Math.round(cell.productivityScore)}`} color={palette.primary} />
        </Row>
        <Row justify="space-between">
          <Type variant="caption">Tasks completed</Type>
          <Type variant="caption" color={palette.textMuted}>
            {cell.tasksCompleted}
          </Type>
        </Row>
        <Row justify="space-between">
          <Type variant="caption">Tasks created</Type>
          <Type variant="caption" color={palette.textMuted}>
            {cell.tasksCreated}
          </Type>
        </Row>
        <Row justify="space-between">
          <Type variant="caption">Focus minutes</Type>
          <Type variant="caption" color={palette.textMuted}>
            {cell.focusMinutes}
          </Type>
        </Row>
        <Row justify="space-between">
          <Type variant="caption">Habits completed</Type>
          <Type variant="caption" color={palette.textMuted}>
            {cell.habitsCompleted}
          </Type>
        </Row>
        <Row justify="space-between">
          <Type variant="caption">Planned tasks</Type>
          <Type variant="caption" color={palette.textMuted}>
            {cell.plannedTaskCount}
          </Type>
        </Row>
      </Stack>
    </Card>
  );
}
