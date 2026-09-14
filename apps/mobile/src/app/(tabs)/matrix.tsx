/**
 * Eisenhower matrix.
 *
 * Four quadrants, placed automatically from each task's importance and urgency,
 * and re-classified by dragging a task into another quadrant. Balances are
 * surfaced as suggestions rather than scores, so the matrix coaches instead of
 * nagging.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { Task } from '@jarvis/shared';
import { QUADRANT_HINT, QUADRANT_LABEL, TaskRow, formatMinutes, priorityColor } from '../../components/tasks';
import {
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  LoadingBlock,
  Row,
  Screen,
  Sheet,
  Stack,
  Type,
} from '../../components/ui';
import { useDashboard } from '../../hooks/useDashboard';
import { useMatrix, useTaskMutations } from '../../hooks/useTasks';
import { usePalette, radius, spacing, type Palette } from '../../lib/theme';
import { useAuth } from '../../lib/auth';

type Quadrant = 'do_now' | 'schedule' | 'delegate' | 'eliminate';
const QUADRANTS: Quadrant[] = ['do_now', 'schedule', 'delegate', 'eliminate'];

interface Zone {
  quadrant: Quadrant;
  x: number;
  y: number;
  width: number;
  height: number;
}

function ZoneRegistry() {
  const refs = useRef<Partial<Record<Quadrant, View | null>>>({});
  const zones = useRef<Zone[]>([]);

  const register = useCallback((quadrant: Quadrant) => (node: View | null) => {
    refs.current[quadrant] = node;
  }, []);

  const measure = useCallback((): Promise<void> => {
    const entries = Object.entries(refs.current) as Array<[Quadrant, View | null]>;
    const pending = entries.map(
      ([quadrant, node]) =>
        new Promise<void>((resolve) => {
          if (!node) {
            resolve();
            return;
          }
          node.measureInWindow((x, y, width, height) => {
            zones.current = zones.current.filter((zone) => zone.quadrant !== quadrant);
            zones.current.push({ quadrant, x, y, width, height });
            resolve();
          });
        }),
    );
    return Promise.all(pending).then(() => undefined);
  }, []);

  const hit = useCallback((x: number, y: number): Quadrant | null => {
    const zone = zones.current.find(
      (item) => x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height,
    );
    return zone?.quadrant ?? null;
  }, []);

  return { register, measure, hit };
}

export default function MatrixScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings, updateSettings } = useAuth();
  const matrixSettings = settings?.matrix;
  const [displayStyle, setDisplayStyle] = useState<'grid' | 'list'>(matrixSettings?.displayStyle ?? 'grid');

  const name = (quadrant: Quadrant) => matrixSettings?.quadrantNames[quadrant] ?? QUADRANT_LABEL[quadrant];
  const description = (quadrant: Quadrant) => matrixSettings?.quadrantDescriptions[quadrant] ?? QUADRANT_HINT[quadrant];
  const { counts, tasks, isLoading, refetch } = useMatrix();
  const { dashboard } = useDashboard();
  const { setQuadrant } = useTaskMutations();
  const zones = useRef(ZoneRegistry()).current;

  const [menuTask, setMenuTask] = useState<Task | null>(null);
  const [hovered, setHovered] = useState<Quadrant | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    void zones.measure();
  }, [zones, tasks.length]);

  const onDrop = useCallback(
    (task: Task, target: Quadrant | null) => {
      setHovered(null);
      setDragging(null);
      if (!target) return;
      const current = quadrantOf(task);
      if (current === target) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      void setQuadrant(task, target);
    },
    [setQuadrant],
  );

  const suggestions = dashboard?.matrix.suggestions ?? [];
  const overload = suggestions.filter((suggestion) => suggestion.quadrant === 'do_now');

  if (isLoading && tasks.length === 0) {
    return (
      <Screen>
        <LoadingBlock label="Sorting your matrix" />
      </Screen>
    );
  }

  return (
    <Screen padded={false} scroll={false}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <Row justify="space-between" align="center">
            <Stack gap={2}>
              <Type variant="title" accessibilityRole="header">
                Matrix
              </Type>
              <Type variant="caption" color={palette.textMuted}>
                {displayStyle === 'grid'
                  ? 'Long-press a task, then drag it to re-classify'
                  : 'Each row shows its quadrant — tap to re-classify'}
              </Type>
            </Stack>
            <Row gap={spacing.xs}>
              <Button
                label={displayStyle === 'grid' ? 'List' : 'Grid'}
                size="sm"
                variant="ghost"
                icon={displayStyle === 'grid' ? 'list' : 'grid'}
                onPress={() => {
                  const next = displayStyle === 'grid' ? 'list' : 'grid';
                  setDisplayStyle(next);
                  void updateSettings({ matrix: { displayStyle: next } });
                }}
              />
              <Button label="Add" icon="add" size="sm" onPress={() => router.push('/task-new')} />
            </Row>
          </Row>

          {overload.length > 0 ? (
            <Card style={{ backgroundColor: `${palette.warning}14`, borderColor: `${palette.warning}55` }}>
              {overload.slice(0, 2).map((suggestion) => (
                <Row key={suggestion.id} gap={spacing.sm} style={{ paddingVertical: 2 }}>
                  <Ionicons name="bulb-outline" size={16} color={palette.warning} />
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Type variant="bodyStrong">{suggestion.title}</Type>
                    <Type variant="caption" color={palette.textMuted}>
                      {suggestion.body}
                    </Type>
                  </Stack>
                </Row>
              ))}
            </Card>
          ) : null}
        </View>

        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!dragging}
        >
          {displayStyle === 'list' ? (
            <Stack gap={spacing.sm}>
              {QUADRANTS.map((quadrant) => {
                const quadrantTasks = tasks.filter((task) => quadrantOf(task) === quadrant);
                return (
                  <Stack key={quadrant} gap={spacing.xs}>
                    <Row justify="space-between" align="center">
                      <Row gap={6}>
                        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.quadrant[quadrant] }} />
                        <Type variant="label" color={palette.quadrant[quadrant]}>
                          {name(quadrant)}
                        </Type>
                      </Row>
                      <Badge label={String(counts[quadrant])} color={palette.quadrant[quadrant]} />
                    </Row>
                    {matrixSettings?.showHints !== false ? (
                      <Type variant="micro" color={palette.textFaint}>
                        {description(quadrant)}
                      </Type>
                    ) : null}
                    <Card style={{ paddingVertical: spacing.sm }}>
                      {quadrantTasks.length === 0 ? (
                        <Type variant="caption" color={palette.textFaint}>
                          Nothing here.
                        </Type>
                      ) : (
                        quadrantTasks.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            today={dashboard?.today ?? ''}
                            onPress={() => router.push(`/task/${task.id}`)}
                            onLongPress={() => setMenuTask(task)}
                          />
                        ))
                      )}
                    </Card>
                  </Stack>
                );
              })}
            </Stack>
          ) : (
            <>
              <Row gap={spacing.md} align="stretch" style={{ flex: 1 }}>
            <QuadrantColumn
              customName={name('do_now')}
              customDescription={description('do_now')}
              showHints={matrixSettings?.showHints !== false}
              quadrant="do_now"
              tasks={tasks.filter((task) => quadrantOf(task) === 'do_now')}
              count={counts.do_now}
              register={zones.register}
              onMeasureNeeded={zones.measure}
              onHit={zones.hit}
              onHover={setHovered}
              onDrop={onDrop}
              onDragState={setDragging}
              hovered={hovered === 'do_now'}
              palette={palette}
              today={dashboard?.today ?? ''}
              onOpen={(task) => router.push(`/task/${task.id}`)}
              onMenu={setMenuTask}
              onToggle={() => undefined}
            />
            <QuadrantColumn
              customName={name('schedule')}
              customDescription={description('schedule')}
              showHints={matrixSettings?.showHints !== false}
              quadrant="schedule"
              tasks={tasks.filter((task) => quadrantOf(task) === 'schedule')}
              count={counts.schedule}
              register={zones.register}
              onMeasureNeeded={zones.measure}
              onHit={zones.hit}
              onHover={setHovered}
              onDrop={onDrop}
              onDragState={setDragging}
              hovered={hovered === 'schedule'}
              palette={palette}
              today={dashboard?.today ?? ''}
              onOpen={(task) => router.push(`/task/${task.id}`)}
              onMenu={setMenuTask}
              onToggle={() => undefined}
            />
          </Row>
          <Row gap={spacing.md} align="stretch" style={{ flex: 1 }}>
            <QuadrantColumn
              customName={name('delegate')}
              customDescription={description('delegate')}
              showHints={matrixSettings?.showHints !== false}
              quadrant="delegate"
              tasks={tasks.filter((task) => quadrantOf(task) === 'delegate')}
              count={counts.delegate}
              register={zones.register}
              onMeasureNeeded={zones.measure}
              onHit={zones.hit}
              onHover={setHovered}
              onDrop={onDrop}
              onDragState={setDragging}
              hovered={hovered === 'delegate'}
              palette={palette}
              today={dashboard?.today ?? ''}
              onOpen={(task) => router.push(`/task/${task.id}`)}
              onMenu={setMenuTask}
              onToggle={() => undefined}
            />
            <QuadrantColumn
              customName={name('eliminate')}
              customDescription={description('eliminate')}
              showHints={matrixSettings?.showHints !== false}
              quadrant="eliminate"
              tasks={tasks.filter((task) => quadrantOf(task) === 'eliminate')}
              count={counts.eliminate}
              register={zones.register}
              onMeasureNeeded={zones.measure}
              onHit={zones.hit}
              onHover={setHovered}
              onDrop={onDrop}
              onDragState={setDragging}
              hovered={hovered === 'eliminate'}
              palette={palette}
              today={dashboard?.today ?? ''}
              onOpen={(task) => router.push(`/task/${task.id}`)}
              onMenu={setMenuTask}
              onToggle={() => undefined}
                />
              </Row>
            </>
          )}

          {tasks.length === 0 ? (
            <EmptyState
              icon="grid-outline"
              title="Nothing to classify yet"
              body="Every task lands in a quadrant automatically once you mark it important or urgent."
              actionLabel="Add a task"
              onAction={() => router.push('/task-new')}
            />
          ) : null}
        </ScrollView>
      </View>

      <Sheet visible={Boolean(menuTask)} onClose={() => setMenuTask(null)} title={menuTask?.title}>
        {menuTask ? (
          <Stack gap={spacing.sm}>
            <Type variant="caption" color={palette.textMuted}>
              Classify this task
            </Type>
            <Row gap={spacing.sm} wrap>
              {QUADRANTS.map((quadrant) => (
                <Chip
                  key={quadrant}
                  label={QUADRANT_LABEL[quadrant]}
                  color={palette.quadrant[quadrant]}
                  selected={quadrantOf(menuTask) === quadrant}
                  onPress={() => {
                    void setQuadrant(menuTask, quadrant);
                    setMenuTask(null);
                  }}
                />
              ))}
            </Row>
            <Row gap={spacing.sm}>
              <Button label="Not important" variant="secondary" onPress={() => {
                void setQuadrant(menuTask, menuTask.urgent ? 'delegate' : 'eliminate');
                setMenuTask(null);
              }} />
              <Button label="Important" variant="secondary" onPress={() => {
                void setQuadrant(menuTask, menuTask.urgent ? 'do_now' : 'schedule');
                setMenuTask(null);
              }} />
            </Row>
            <Button label="Open details" icon="open-outline" variant="secondary" onPress={() => {
              const task = menuTask;
              setMenuTask(null);
              router.push(`/task/${task.id}`);
            }} />
          </Stack>
        ) : null}
      </Sheet>
    </Screen>
  );
}

export function quadrantOf(task: Task): Quadrant {
  if (task.important && task.urgent) return 'do_now';
  if (task.important) return 'schedule';
  if (task.urgent) return 'delegate';
  return 'eliminate';
}

function QuadrantColumn({
  quadrant,
  customName,
  customDescription,
  showHints = true,
  tasks,
  count,
  register,
  onMeasureNeeded,
  onHit,
  onHover,
  onDrop,
  onDragState,
  hovered,
  palette,
  today,
  onOpen,
  onMenu,
  onToggle,
}: {
  quadrant: Quadrant;
  customName?: string;
  customDescription?: string;
  showHints?: boolean;
  tasks: Task[];
  count: number;
  register: (quadrant: Quadrant) => (node: View | null) => void;
  onMeasureNeeded: () => Promise<void>;
  onHit: (x: number, y: number) => Quadrant | null;
  onHover: (quadrant: Quadrant | null) => void;
  onDrop: (task: Task, target: Quadrant | null) => void;
  onDragState: (taskId: string | null) => void;
  hovered: boolean;
  palette: Palette;
  today: string;
  onOpen: (task: Task) => void;
  onMenu: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  const color = palette.quadrant[quadrant];
  return (
    <View
      style={{ flex: 1 }}
      ref={register(quadrant)}
      onLayout={() => void onMeasureNeeded()}
      accessibilityLabel={`${customName ?? QUADRANT_LABEL[quadrant]} quadrant, ${count} tasks`}
    >
      <View
        style={{
          flex: 1,
          minHeight: 170,
          borderRadius: radius.lg,
          borderWidth: hovered ? 2 : StyleSheet.hairlineWidth,
          borderColor: hovered ? color : palette.border,
          backgroundColor: hovered ? `${color}14` : palette.surface,
          padding: spacing.md,
          gap: spacing.sm,
        }}
      >
        <Stack gap={2}>
          <Row justify="space-between">
            <Row gap={6}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
              <Type variant="label" color={color} numberOfLines={1}>
                {customName ?? QUADRANT_LABEL[quadrant]}
              </Type>
            </Row>
            <Badge label={String(count)} color={color} />
          </Row>
          {showHints ? (
            <Type variant="micro" color={palette.textFaint} numberOfLines={2}>
              {customDescription ?? QUADRANT_HINT[quadrant]}
            </Type>
          ) : null}
        </Stack>

        <Stack gap={spacing.xs}>
          {tasks.slice(0, 5).map((task) => (
            <DraggableTask
              key={task.id}
              task={task}
              color={color}
              today={today}
              palette={palette}
              onHit={onHit}
              onHover={onHover}
              onDrop={onDrop}
              onDragState={onDragState}
              onOpen={onOpen}
              onMenu={onMenu}
              onToggle={onToggle}
            />
          ))}
          {tasks.length > 5 ? (
            <Type variant="caption" color={palette.textMuted}>
              +{tasks.length - 5} more
            </Type>
          ) : null}
          {tasks.length === 0 ? (
            <Type variant="caption" color={palette.textFaint}>
              Drop a task here
            </Type>
          ) : null}
        </Stack>
      </View>
    </View>
  );
}

function DraggableTask({
  task,
  color,
  today,
  palette,
  onHit,
  onHover,
  onDrop,
  onDragState,
  onOpen,
  onMenu,
  onToggle,
}: {
  task: Task;
  color: string;
  today: string;
  palette: Palette;
  onHit: (x: number, y: number) => Quadrant | null;
  onHover: (quadrant: Quadrant | null) => void;
  onDrop: (task: Task, target: Quadrant | null) => void;
  onDragState: (taskId: string | null) => void;
  onOpen: (task: Task) => void;
  onMenu: (task: Task) => void;
  onToggle: (task: Task) => void;
}) {
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const active = useSharedValue(0);
  const [isDragging, setIsDragging] = useState(false);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(260)
        .onStart(() => {
          active.value = 1;
          runOnJS(setIsDragging)(true);
          runOnJS(onDragState)(task.id);
          runOnJS(Haptics.selectionAsync)();
        })
        .onUpdate((event) => {
          translateX.value = event.translationX;
          translateY.value = event.translationY;
          const target = onHit(event.absoluteX, event.absoluteY);
          runOnJS(onHover)(target);
        })
        .onEnd((event) => {
          const target = onHit(event.absoluteX, event.absoluteY);
          translateX.value = 0;
          translateY.value = 0;
          active.value = 0;
          runOnJS(setIsDragging)(false);
          runOnJS(onDrop)(task, target);
        })
        .onFinalize(() => {
          active.value = 0;
          runOnJS(setIsDragging)(false);
        }),
    [active, onDragState, onDrop, onHit, onHover, task, translateX, translateY],
  );

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: 1 + active.value * 0.02 }],
    zIndex: active.value ? 20 : 0,
    opacity: active.value ? 0.95 : 1,
    elevation: active.value ? 8 : 0,
    shadowOpacity: active.value ? 0.2 : 0,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          {
            borderRadius: radius.md,
            backgroundColor: isDragging ? `${color}18` : palette.surfaceMuted,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDragging ? color : palette.border,
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
          },
          style,
        ]}
      >
        <TaskRow
          task={task}
          today={today}
          dense
          onPress={() => onOpen(task)}
          onLongPress={() => onMenu(task)}
          onToggle={() => onToggle(task)}
          trailing={
            <Row gap={4}>
              {task.estimatedMinutes ? (
                <Type variant="micro" color={palette.textFaint}>
                  {formatMinutes(task.estimatedMinutes)}
                </Type>
              ) : null}
              <Ionicons name="reorder-three" size={14} color={palette.textFaint} />
            </Row>
          }
        />
      </Animated.View>
    </GestureDetector>
  );
}
