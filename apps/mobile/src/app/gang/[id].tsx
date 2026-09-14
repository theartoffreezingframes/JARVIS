/**
 * Gang timer — a synchronised group focus session.
 *
 * The clock is not computed here: the server sends an authoritative anchor
 * (`clockAnchorAt`) plus how much paused time has accrued, and every client
 * derives "time remaining" from that with its own device clock. Nothing ticks
 * over the wire, so a participant can background the app, lose signal, or join
 * twenty minutes late and still see exactly the same countdown as everyone else.
 *
 * Real-time transport is a WebSocket; when it drops the screen falls back to
 * polling and says so, and reconnecting restores the authoritative state.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Avatar, Badge, Button, Card, EmptyState, LoadingBlock, Row, Screen, SectionHeader, Stack, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useGangMutations, useGangSession } from '../../hooks/useSocial';
import { useRealtimeStatus } from '../../lib/realtime';
import { realtime } from '../../lib/realtime';
import { radius, spacing, usePalette } from '../../lib/theme';

const REACTIONS: Array<{ key: 'muscle' | 'fire' | 'clap' | 'heart' | 'rocket'; emoji: string }> = [
  { key: 'muscle', emoji: '💪' },
  { key: 'fire', emoji: '🔥' },
  { key: 'clap', emoji: '👏' },
  { key: 'heart', emoji: '❤️' },
  { key: 'rocket', emoji: '🚀' },
];

const REACTION_EMOJI: Record<string, string> = Object.fromEntries(REACTIONS.map((item) => [item.key, item.emoji]));

function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export default function GangSessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const router = useRouter();
  const { user } = useAuth();
  const { detail, isLoading, refetch } = useGangSession(id ?? null);
  const mutations = useGangMutations();
  const realtimeStatus = useRealtimeStatus();
  const [now, setNow] = useState(() => Date.now());

  // Local 250 ms tick — this only re-renders; it never talks to the network.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, []);

  // When the socket is unavailable, fall back to polling so the session stays
  // in step (the server remains the single source of truth either way).
  useEffect(() => {
    if (realtimeStatus === 'open' || !id) return;
    const interval = setInterval(() => void refetch(), 5_000);
    return () => clearInterval(interval);
  }, [realtimeStatus, id, refetch]);

  useEffect(() => {
    if (!id) return;
    return () => {
      realtime.leave(id);
    };
  }, [id]);

  const session = detail?.session;
  const clock = detail?.clock;

  const derived = useMemo(() => {
    if (!session || !clock) return null;
    const totalMs = clock.totalSeconds * 1000;
    // Elapsed time = time since the authoritative anchor, minus every paused
    // millisecond the server has recorded. The server remains the reference.
    const elapsedMs = Math.max(0, now - session.clockAnchorAt - session.clockPausedMs);
    const totalRemaining = Math.max(0, totalMs - elapsedMs);

    const focusMs = (clock.focusSecondsPerRound || session.focusMinutes * 60) * 1000;
    const breakMs = (clock.breakSecondsPerRound || session.breakMinutes * 60) * 1000;
    const position = elapsedMs % Math.max(1, focusMs + breakMs);
    const inBreak = position >= focusMs;
    const phaseRemaining = inBreak ? (focusMs + breakMs - position) / 1000 : (focusMs - position) / 1000;

    return {
      totalRemaining: totalRemaining / 1000,
      phaseRemaining: Math.max(0, phaseRemaining),
      phase: inBreak ? ('break' as const) : ('focus' as const),
      progress: totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0,
    };
  }, [session, clock, now]);

  if (isLoading && !detail) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <LoadingBlock label="Joining the session" />
      </Screen>
    );
  }

  if (!session || !derived) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <EmptyState icon="people-outline" title="Session unavailable" body="It may have ended or been cancelled." />
      </Screen>
    );
  }

  const isHost = session.hostId === user?.id;
  const recentReactions = detail.reactions.filter((reaction) => Date.now() - reaction.createdAt < 30_000).slice(-8);
  const me = session.participants.find((participant) => participant.userId === user?.id);
  const focusing = session.participants.filter((participant) => participant.state === 'focusing');
  const finished = session.status === 'completed' || session.status === 'cancelled';
  const live = session.status === 'running' || session.status === 'paused';

  const size = 240;
  const stroke = 11;
  const radiusValue = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radiusValue;

  const join = async () => {
    try {
      await mutations.join(session.id);
      await refetch();
    } catch {
      Alert.alert('Could not join', 'Check your connection and try again.');
    }
  };

  const control = async (action: 'start' | 'pause' | 'resume' | 'skip' | 'stop') => {
    try {
      await mutations.control(session.id, action);
    } catch (error) {
      Alert.alert('Not allowed', error instanceof Error ? error.message : 'Only the host can control this session.');
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <Row justify="space-between" align="center">
        <Button label="Leave" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Row gap={spacing.sm}>
          {realtimeStatus === 'open' ? (
            <Badge label="Live" color={palette.success} icon="wifi" />
          ) : (
            <Badge label="Reconnecting" color={palette.warning} icon="cloud-offline" />
          )}
          {isHost ? <Badge label="Host" color={palette.primary} icon="star" /> : null}
        </Row>
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          {session.title}
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          {session.groupName} · {session.participants.length} joined · {session.focusMinutes}m focus /{' '}
          {session.breakMinutes}m break × {session.rounds}
          {session.recurrence ? ` · repeats ${session.recurrence.kind}` : ''}
        </Type>
      </Stack>

      <Card style={{ alignItems: 'center', gap: spacing.md }}>
        <Row gap={spacing.sm}>
          <Badge
            label={finished ? 'SESSION COMPLETE' : derived.phase === 'break' ? 'BREAK' : 'FOCUS'}
            color={finished ? palette.success : derived.phase === 'break' ? palette.info : palette.primary}
            icon={finished ? 'trophy' : derived.phase === 'break' ? 'cafe' : 'flash'}
          />
          <Badge label={`Round ${Math.min(session.rounds, clock?.currentRound ?? 1)}/${session.rounds}`} />
          {session.isClockPaused ? <Badge label="Paused" color={palette.warning} icon="pause" /> : null}
        </Row>

        <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
          <Svg width={size} height={size} style={{ position: 'absolute' }}>
            <Circle cx={size / 2} cy={size / 2} r={radiusValue} stroke={palette.surfaceMuted} strokeWidth={stroke} fill="none" />
            <Circle
              cx={size / 2}
              cy={size / 2}
              r={radiusValue}
              stroke={finished ? palette.success : derived.phase === 'break' ? palette.info : palette.primary}
              strokeWidth={stroke}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${circumference} ${circumference}`}
              strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, derived.progress)))}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          </Svg>
          <Stack gap={2} style={{ alignItems: 'center' }}>
            <Type variant="display" style={{ fontSize: 52, lineHeight: 58 }}>
              {finished ? '🎉' : formatClock(derived.totalRemaining)}
            </Type>
            <Type variant="caption" color={palette.textMuted}>
              {finished
                ? 'Gang session complete'
                : session.isClockPaused
                  ? 'Paused by the host'
                  : `${formatClock(derived.phaseRemaining)} left in this ${derived.phase}`}
            </Type>
          </Stack>
        </View>

        {!me ? (
          <Button label="Join this session" icon="enter-outline" onPress={join} />
        ) : (
          <Row gap={spacing.sm} wrap justify="center">
            <Button
              label={me.state === 'focusing' ? 'Focusing' : 'Mark focusing'}
              size="sm"
              variant={me.state === 'focusing' ? 'primary' : 'secondary'}
              onPress={() => void mutations.setMyState(session.id, 'focusing')}
            />
            <Button
              label="I'm on a break"
              size="sm"
              variant={me.state === 'break' ? 'primary' : 'secondary'}
              onPress={() => void mutations.setMyState(session.id, 'break')}
            />
            <Button
              label="Done"
              size="sm"
              variant={me.state === 'done' ? 'primary' : 'secondary'}
              onPress={() => void mutations.setMyState(session.id, 'done')}
            />
          </Row>
        )}

        {isHost && !finished ? (
          <Row gap={spacing.sm} wrap justify="center">
            {session.status === 'scheduled' || session.status === 'completed' ? (
              <Button label="Start for everyone" icon="play" onPress={() => void control('start')} />
            ) : session.isClockPaused ? (
              <Button label="Resume" icon="play" onPress={() => void control('resume')} />
            ) : (
              <Button label="Pause" icon="pause" onPress={() => void control('pause')} />
            )}
            <Button label="Skip phase" icon="play-skip-forward" variant="secondary" onPress={() => void control('skip')} />
            <Button label="End session" icon="stop" variant="danger" onPress={() => void control('stop')} />
          </Row>
        ) : null}

        {!isHost && live ? (
          <Type variant="caption" color={palette.textFaint}>
            The host controls the shared clock. Pausing yourself does not affect anyone else.
          </Type>
        ) : null}
      </Card>

      <Stack gap={spacing.sm}>
        <SectionHeader
          title="Everyone"
          subtitle={`${focusing.length} of ${session.participants.length} focusing right now`}
        />
        <Card>
          <Stack gap={spacing.md}>
            {session.participants.map((participant) => (
              <Row key={participant.userId} gap={spacing.md} align="center">
                <Avatar name={participant.name} size={34} />
                <Stack gap={2} style={{ flex: 1 }}>
                  <Row gap={6}>
                    <Type variant="bodyStrong">{participant.name}</Type>
                    {participant.userId === session.hostId ? <Badge label="Host" color={palette.primary} /> : null}
                    {participant.userId === user?.id ? <Badge label="You" /> : null}
                  </Row>
                  <Type variant="caption" color={palette.textMuted}>
                    {Math.round(participant.focusSeconds / 60)} min focused
                    {participant.joinedAt ? ` · joined ${new Date(participant.joinedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : ''}
                  </Type>
                </Stack>
                <Badge
                  label={stateLabel(participant.state)}
                  color={
                    participant.state === 'focusing'
                      ? palette.success
                      : participant.state === 'break' || participant.state === 'paused'
                        ? palette.warning
                        : participant.state === 'done'
                          ? palette.primary
                          : palette.textMuted
                  }
                />
              </Row>
            ))}
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Encouragement" subtitle="No chat — just a nudge" />
        <Row gap={spacing.sm} wrap>
          {REACTIONS.map(({ key, emoji }) => (
            <Pressable
              key={key}
              onPress={() => void mutations.react(session.id, key)}
              accessibilityRole="button"
              accessibilityLabel={`Send ${emoji}`}
              style={{
                width: 46,
                height: 46,
                borderRadius: radius.pill,
                backgroundColor: palette.surfaceMuted,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Type variant="headline">{emoji}</Type>
            </Pressable>
          ))}
        </Row>
        {recentReactions.length > 0 ? (
          <Row gap={6} wrap>
            {recentReactions.map((reaction) => (
              <Badge
                key={reaction.id}
                label={`${REACTION_EMOJI[reaction.reaction] ?? '👏'} ${
                  session.participants.find((participant) => participant.userId === reaction.userId)?.name.split(' ')[0] ?? ''
                }`.trim()}
                color={palette.primary}
              />
            ))}
          </Row>
        ) : null}
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Session totals" />
        <Card>
          <Row gap={spacing.lg}>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                YOUR FOCUS
              </Type>
              <Type variant="title">{Math.round((me?.focusSeconds ?? 0) / 60)}m</Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                GROUP TOTAL
              </Type>
              <Type variant="title">
                {Math.round(session.participants.reduce((sum, participant) => sum + participant.focusSeconds, 0) / 60)}m
              </Type>
            </Stack>
            <Stack gap={2} style={{ flex: 1 }}>
              <Type variant="micro" color={palette.textMuted}>
                JOINED
              </Type>
              <Type variant="title">{session.participants.length}</Type>
            </Stack>
          </Row>
          <Type variant="caption" color={palette.textFaint} style={{ marginTop: spacing.sm }}>
            Finished sessions are written to each participant's focus history, so they count towards personal
            analytics and heat maps.
          </Type>
        </Card>
      </Stack>

      {finished ? (
        <Card style={{ borderColor: `${palette.success}66` }}>
          <Stack gap={spacing.sm}>
            <Row gap={spacing.sm}>
              <Ionicons name="trophy" size={20} color={palette.success} />
              <Type variant="headline">Gang Session Complete 🎉</Type>
            </Row>
            <Type variant="caption" color={palette.textMuted}>
              {session.participants.length} people focused together for{' '}
              {Math.round(session.participants.reduce((sum, participant) => sum + participant.focusSeconds, 0) / 60)}{' '}
              minutes in total. Your share has been added to your focus history.
            </Type>
            <Row gap={spacing.sm}>
              <Button label="Back to groups" variant="secondary" onPress={() => router.back()} />
              <Button label="See analytics" variant="ghost" onPress={() => router.push('/analytics')} />
            </Row>
          </Stack>
        </Card>
      ) : null}
    </Screen>
  );
}

function stateLabel(state: string): string {
  switch (state) {
    case 'focusing':
      return 'Focusing';
    case 'break':
      return 'Break';
    case 'paused':
      return 'Paused';
    case 'done':
      return 'Done';
    case 'left':
      return 'Left';
    default:
      return 'Invited';
  }
}
