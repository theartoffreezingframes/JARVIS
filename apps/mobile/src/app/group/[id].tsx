/**
 * Group detail.
 *
 * Owner-only actions (rename, remove member, delete group) are hidden from
 * members — and enforced on the server, so hiding them is a courtesy rather than
 * a security boundary.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Input,
  LoadingBlock,
  ProgressBar,
  Row,
  Screen,
  SectionHeader,
  Stack,
  SwitchRow,
  Type,
} from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useFriends, useGangMutations, useGroup, useGroupMutations, useLeaderboard } from '../../hooks/useSocial';
import { radius, spacing, usePalette } from '../../lib/theme';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const palette = usePalette();
  const router = useRouter();
  const { user, settings, updateSettings } = useAuth();
  const { group, sessions, isLoading, refetch } = useGroup(id ?? null);
  const { leaderboard, refetch: refetchLeaderboard } = useLeaderboard(id ?? null);
  const { friends } = useFriends();
  const mutations = useGroupMutations();
  const gang = useGangMutations();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [emoji, setEmoji] = useState(group?.emoji ?? '🎯');
  const [busy, setBusy] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('Focus session');
  const [sessionMinutes, setSessionMinutes] = useState(25);
  const [sessionRounds, setSessionRounds] = useState(2);

  if (isLoading && !group) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <LoadingBlock label="Loading group" />
      </Screen>
    );
  }

  if (!group) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <EmptyState icon="people-outline" title="Group unavailable" body="You may have left it, or it was deleted." />
      </Screen>
    );
  }

  const isOwner = group.ownerId === user?.id;
  const upcoming = sessions.filter((session) => session.status === 'scheduled' || session.status === 'running' || session.status === 'paused');
  const past = sessions.filter((session) => session.status === 'completed' || session.status === 'cancelled');

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="New session" icon="add" size="sm" onPress={() => setSessionOpen(true)} />
      </Row>

      <Stack gap={spacing.sm}>
        <Row gap={spacing.md} align="center">
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: radius.md,
              backgroundColor: palette.surfaceMuted,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Type variant="title">{group.emoji}</Type>
          </View>
          <Stack gap={2} style={{ flex: 1 }}>
            <Type variant="title" accessibilityRole="header">
              {group.name}
            </Type>
            <Type variant="caption" color={palette.textMuted}>
              {group.memberCount} member{group.memberCount === 1 ? '' : 's'} · invite code {group.inviteCode}
            </Type>
          </Stack>
        </Row>
        {group.description ? (
          <Type variant="body" color={palette.textMuted}>
            {group.description}
          </Type>
        ) : null}
        <Row gap={spacing.sm} wrap>
          {isOwner ? <Badge label="You own this group" color={palette.primary} icon="star" /> : null}
          {group.leaderboardEnabled ? <Badge label="Leaderboard on" color={palette.info} icon="podium" /> : null}
          <Badge label={`${upcoming.length} upcoming`} />
        </Row>
      </Stack>

      <Row gap={spacing.sm} wrap>
        {isOwner ? (
          <>
            <Button label="Edit group" size="sm" variant="secondary" icon="create-outline" onPress={() => setEditing((value) => !value)} />
            <Button
              label="Delete group"
              size="sm"
              variant="danger"
              icon="trash-outline"
              onPress={() =>
                Alert.alert('Delete this group?', 'Sessions and membership are removed for everyone.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                      try {
                        await mutations.remove(group.id);
                        router.back();
                      } catch (error) {
                        Alert.alert(
                          'Could not delete the group',
                          error instanceof Error ? error.message : 'Only the owner can delete a group.',
                        );
                      }
                    },
                  },
                ])
              }
            />
          </>
        ) : (
          <Button
            label="Leave group"
            size="sm"
            variant="danger"
            icon="exit-outline"
            onPress={() =>
              Alert.alert('Leave this group?', 'You can rejoin later with the invite code.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Leave',
                  style: 'destructive',
                  onPress: async () => {
                    await mutations.leave(group.id);
                    router.back();
                  },
                },
              ])
            }
          />
        )}
      </Row>

      {editing && isOwner ? (
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Name">
              <Input value={name} onChangeText={setName} />
            </Field>
            <Field label="Description">
              <Input value={description} onChangeText={setDescription} multiline />
            </Field>
            <Field label="Emoji">
              <Row gap={spacing.sm} wrap>
                {['🎯', '📚', '💻', '🏃', '🧠', '☕'].map((option) => (
                  <Chip key={option} label={option} selected={emoji === option} onPress={() => setEmoji(option)} />
                ))}
              </Row>
            </Field>
            <SwitchRow
              label="Group leaderboard"
              description="Weekly focus minutes, sessions and consistency. Members can ask you to turn this off."
              value={group.leaderboardEnabled}
              onValueChange={async (value) => {
                await mutations.update(group.id, { leaderboardEnabled: value });
                void refetch();
                void refetchLeaderboard();
              }}
            />
            <Row gap={spacing.sm}>
              <Button label="Cancel" variant="secondary" onPress={() => setEditing(false)} />
              <Button
                label="Save"
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await mutations.update(group.id, { name: name.trim(), description: description.trim() || null, emoji });
                    setEditing(false);
                    void refetch();
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </Row>
          </Stack>
        </Card>
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Members" subtitle={isOwner ? 'You can remove members' : 'Only the owner can manage members'} />
        <Card>
          <Stack gap={spacing.md}>
            {group.members.map((member) => (
              <Row key={member.userId} gap={spacing.md} align="center">
                <Avatar name={member.name} size={34} />
                <Stack gap={2} style={{ flex: 1 }}>
                  <Row gap={6}>
                    <Type variant="bodyStrong">{member.name}</Type>
                    {member.role === 'owner' ? <Badge label="Owner" color={palette.primary} /> : null}
                    {member.userId === user?.id ? <Badge label="You" /> : null}
                  </Row>
                  <Type variant="caption" color={palette.textMuted}>
                    @{member.username}
                    {member.focusMinutes !== undefined ? ` · ${member.focusMinutes} min this week` : ''}
                  </Type>
                </Stack>
                {isOwner && member.userId !== user?.id ? (
                  <Button
                    label="Remove"
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      Alert.alert(`Remove ${member.name}?`, 'They lose access to this group and its sessions.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: async () => {
                            await mutations.removeMember(group.id, member.userId);
                            void refetch();
                          },
                        },
                      ])
                    }
                  />
                ) : null}
              </Row>
            ))}
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Sessions" subtitle={`${upcoming.length} upcoming · ${past.length} past`} />
        {sessions.length === 0 ? (
          <Card>
            <Type variant="caption" color={palette.textFaint}>
              No sessions yet. Start one and everyone in the group gets an invite.
            </Type>
          </Card>
        ) : (
          sessions.slice(0, 8).map((session) => (
            <Card key={session.id} onPress={() => router.push(`/gang/${session.id}`)} accessibilityLabel={`Open ${session.title}`}>
              <Row gap={spacing.md} align="center">
                <Ionicons
                  name={session.status === 'running' ? 'radio-button-on' : session.status === 'completed' ? 'checkmark-circle' : 'time-outline'}
                  size={18}
                  color={session.status === 'running' ? palette.success : session.status === 'completed' ? palette.primary : palette.textMuted}
                />
                <Stack gap={2} style={{ flex: 1 }}>
                  <Type variant="bodyStrong">{session.title}</Type>
                  <Type variant="caption" color={palette.textMuted}>
                    {new Date(session.startsAt).toLocaleString()} · {session.focusMinutes}m × {session.rounds} ·{' '}
                    {session.participants.length} participants
                  </Type>
                </Stack>
                <Badge
                  label={session.status}
                  color={session.status === 'running' ? palette.success : session.status === 'scheduled' ? palette.info : palette.textMuted}
                />
              </Row>
            </Card>
          ))
        )}
      </Stack>

      {group.leaderboardEnabled && leaderboard?.enabled ? (
        <Stack gap={spacing.sm}>
          <SectionHeader title="Leaderboard" subtitle={`Last ${leaderboard.periodDays} days · focus minutes and consistency`} />
          <Card>
            <Stack gap={spacing.md}>
              {leaderboard.entries.map((entry, index) => {
                const top = leaderboard.entries[0]?.focusMinutes || 1;
                return (
                  <Stack key={entry.userId} gap={6}>
                    <Row justify="space-between" align="center">
                      <Row gap={spacing.sm}>
                        <Type variant="caption" color={palette.textFaint}>
                          {index + 1}
                        </Type>
                        <Avatar name={entry.name} size={28} />
                        <Stack gap={2}>
                          <Type variant="bodyStrong">{entry.name}</Type>
                          <Type variant="micro" color={palette.textFaint}>
                            {entry.sessions} SESSIONS · {entry.tasksCompleted} TASKS · {entry.consistency}% CONSISTENT
                          </Type>
                        </Stack>
                      </Row>
                      <Type variant="bodyStrong">{entry.focusMinutes}m</Type>
                    </Row>
                    <ProgressBar value={(entry.focusMinutes / Math.max(1, top)) * 100} height={4} />
                  </Stack>
                );
              })}
              <Type variant="caption" color={palette.textFaint}>
                Friendly and optional. It measures consistency, not how much anyone suffers — you can turn it off in
                Settings → Customize if it stops being motivating.
              </Type>
              <SwitchRow
                label="Show leaderboards to me"
                description="A personal preference; it does not change what other members see."
                value={settings?.leaderboardEnabled ?? false}
                onValueChange={(value) => void updateSettings({ leaderboardEnabled: value })}
              />
            </Stack>
          </Card>
        </Stack>
      ) : null}

      {sessionOpen ? (
        <Card>
          <Stack gap={spacing.md}>
            <SectionHeader title="New session" />
            <Field label="Name">
              <Input value={sessionTitle} onChangeText={setSessionTitle} placeholder="DSA Grind" />
            </Field>
            <Field label="Focus length">
              <Row gap={spacing.sm} wrap>
                {[15, 25, 45, 50, 90].map((minutes) => (
                  <Chip
                    key={minutes}
                    label={`${minutes}m`}
                    selected={sessionMinutes === minutes}
                    onPress={() => setSessionMinutes(minutes)}
                  />
                ))}
              </Row>
            </Field>
            <Field label="Rounds">
              <Row gap={spacing.sm} wrap>
                {[1, 2, 3, 4].map((rounds) => (
                  <Chip key={rounds} label={String(rounds)} selected={sessionRounds === rounds} onPress={() => setSessionRounds(rounds)} />
                ))}
              </Row>
            </Field>
            <Row gap={spacing.sm}>
              <Button label="Cancel" variant="secondary" onPress={() => setSessionOpen(false)} />
              <Button
                label="Create and start"
                icon="play"
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    const session = await gang.create({
                      groupId: group.id,
                      title: sessionTitle.trim() || 'Focus session',
                      startsAt: Date.now(),
                      focusMinutes: sessionMinutes,
                      breakMinutes: Math.max(5, Math.round(sessionMinutes / 5)),
                      rounds: sessionRounds,
                      mode: sessionMinutes >= 50 ? 'deep_work' : 'pomodoro',
                      inviteUserIds: friends.map((friend) => friend.user.id),
                    });
                    await gang.control(session.id, 'start');
                    setSessionOpen(false);
                    router.push(`/gang/${session.id}`);
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </Row>
          </Stack>
        </Card>
      ) : null}
    </Screen>
  );
}
