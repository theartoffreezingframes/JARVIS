/**
 * Focus groups and friends.
 *
 * Groups are private: you are only ever shown groups you belong to, and the
 * server refuses anything else. Creating a session schedules it against the
 * group's server-side clock, which is what the gang timer screen reads.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorBlock, Field, Input, LoadingBlock, Row, Screen, SectionHeader, Segmented, Sheet, Stack, SwitchRow, Type } from '../components/ui';
import { useAuth } from '../lib/auth';
import { useFriends, useGangMutations, useGangSessions, useGroupMutations, useGroups } from '../hooks/useSocial';
import { radius, spacing, usePalette } from '../lib/theme';

export default function GroupsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { user } = useAuth();
  const { groups, friendCount, isLoading, error: groupsError, refetch } = useGroups();
  const { active, scheduled, history } = useGangSessions();
  const { friends, incoming, outgoing, refetch: refetchFriends } = useFriends();
  const groupMutations = useGroupMutations();
  const gangMutations = useGangMutations();

  const [tab, setTab] = useState<'groups' | 'friends' | 'sessions'>('groups');
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [friendOpen, setFriendOpen] = useState(false);
  const [sessionGroup, setSessionGroup] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🎯');
  const [leaderboard, setLeaderboard] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sessionTitle, setSessionTitle] = useState('Focus session');
  const [sessionMinutes, setSessionMinutes] = useState(25);
  const [sessionRounds, setSessionRounds] = useState(2);
  const [sessionStartNow, setSessionStartNow] = useState(true);

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Row gap={spacing.sm}>
          <Button label="Join" size="sm" variant="secondary" icon="enter-outline" onPress={() => setJoinOpen(true)} />
          <Button label="New group" size="sm" icon="add" onPress={() => setCreateOpen(true)} />
        </Row>
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Focus groups
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Private groups for accountability and co-working — no feed, no chat.
        </Type>
      </Stack>

      <Segmented
        options={[
          { value: 'groups', label: 'Groups' },
          { value: 'sessions', label: 'Sessions' },
          { value: 'friends', label: 'Friends' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'groups' ? (
        <>
          {isLoading && groups.length === 0 ? <LoadingBlock label="Loading groups" /> : null}
          {groupsError && !isLoading && groups.length === 0 ? (
            <ErrorBlock message="Your groups could not be loaded." onRetry={() => void refetch()} />
          ) : null}
          {!isLoading && !groupsError && groups.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="Create a focus group with your friends"
              body="A group is how you start synchronised gang sessions — everyone focuses at the same time on their own work."
              actionLabel="Create a group"
              onAction={() => setCreateOpen(true)}
            />
          ) : null}
          {groups.map((group) => {
            const isOwner = group.ownerId === user?.id;
            const groupSessions = [...active, ...scheduled].filter((session) => session.groupId === group.id);
            return (
              <Card key={group.id} onPress={() => router.push(`/group/${group.id}`)} accessibilityLabel={`Open group ${group.name}`}>
                <Stack gap={spacing.md}>
                  <Row gap={spacing.md} align="flex-start">
                    <View
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: radius.md,
                        backgroundColor: palette.surfaceMuted,
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Type variant="headline">{group.emoji}</Type>
                    </View>
                    <Stack gap={3} style={{ flex: 1 }}>
                      <Row gap={6} wrap>
                        <Type variant="bodyStrong">{group.name}</Type>
                        {isOwner ? <Badge label="Owner" color={palette.primary} /> : null}
                        {group.leaderboardEnabled ? <Badge label="Leaderboard on" color={palette.info} icon="podium" /> : null}
                      </Row>
                      {group.description ? (
                        <Type variant="caption" color={palette.textMuted} numberOfLines={2}>
                          {group.description}
                        </Type>
                      ) : null}
                      <Type variant="caption" color={palette.textFaint}>
                        {group.memberCount} member{group.memberCount === 1 ? '' : 's'} · invite code {group.inviteCode}
                      </Type>
                    </Stack>
                  </Row>
                  {groupSessions.length > 0 ? (
                    <Row gap={spacing.sm} wrap>
                      {groupSessions.slice(0, 2).map((session) => (
                        <Chip
                          key={session.id}
                          label={`${session.title} · ${session.status}`}
                          color={session.status === 'running' ? palette.success : palette.info}
                          onPress={() => router.push(`/gang/${session.id}`)}
                        />
                      ))}
                    </Row>
                  ) : null}
                  <Row gap={spacing.sm} wrap>
                    <Button label="Open" size="sm" variant="secondary" onPress={() => router.push(`/group/${group.id}`)} />
                    <Button label="Start a session" size="sm" onPress={() => setSessionGroup(group.id)} />
                  </Row>
                </Stack>
              </Card>
            );
          })}
        </>
      ) : null}

      {tab === 'sessions' ? (
        <>
          <SectionHeader title="Live now" subtitle={`${active.length} active`} />
          {active.length === 0 ? (
            <Card>
              <Type variant="caption" color={palette.textFaint}>
                Nothing live. Start one from a group and everyone sees the same countdown.
              </Type>
            </Card>
          ) : (
            active.map((session) => (
              <Card key={session.id} onPress={() => router.push(`/gang/${session.id}`)} accessibilityLabel={`Join ${session.title}`}>
                <Row gap={spacing.md}>
                  <Ionicons name="radio-button-on" size={18} color={palette.success} />
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Type variant="bodyStrong">{session.title}</Type>
                    <Type variant="caption" color={palette.textMuted}>
                      {session.groupName} · {session.participants.length} joined ·{' '}
                      {session.participants.filter((participant) => participant.state === 'focusing').length} focusing
                    </Type>
                  </Stack>
                  <Button label="Join" size="sm" onPress={() => router.push(`/gang/${session.id}`)} />
                </Row>
              </Card>
            ))
          )}

          <SectionHeader title="Scheduled" subtitle={`${scheduled.length} upcoming`} />
          {scheduled.length === 0 ? (
            <Card>
              <Type variant="caption" color={palette.textFaint}>
                No sessions scheduled.
              </Type>
            </Card>
          ) : (
            scheduled.map((session) => (
              <Card key={session.id} onPress={() => router.push(`/gang/${session.id}`)} accessibilityLabel={`Open ${session.title}`}>
                <Row gap={spacing.md}>
                  <Ionicons name="time-outline" size={18} color={palette.info} />
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Type variant="bodyStrong">{session.title}</Type>
                    <Type variant="caption" color={palette.textMuted}>
                      {session.groupName} · {new Date(session.startsAt).toLocaleString()}
                      {session.recurrence ? ` · repeats ${session.recurrence.kind}` : ''}
                    </Type>
                  </Stack>
                  <Button label="View" size="sm" variant="secondary" onPress={() => router.push(`/gang/${session.id}`)} />
                </Row>
              </Card>
            ))
          )}

          {history.length > 0 ? (
            <>
              <SectionHeader title="History" subtitle={`${history.length} completed sessions`} />
              {history.slice(0, 6).map((session) => (
                <Card key={session.id}>
                  <Row justify="space-between" align="center">
                    <Stack gap={2} style={{ flex: 1 }}>
                      <Type variant="bodyStrong">{session.title}</Type>
                      <Type variant="caption" color={palette.textMuted}>
                        {new Date(session.startsAt).toLocaleDateString()} · {session.participants.length} participants
                      </Type>
                    </Stack>
                    <Type variant="bodyStrong">
                      {Math.round(session.participants.reduce((sum, participant) => sum + participant.focusSeconds, 0) / 60)}m
                    </Type>
                  </Row>
                </Card>
              ))}
            </>
          ) : null}
        </>
      ) : null}

      {tab === 'friends' ? (
        <>
          <Card>
            <Row gap={spacing.md}>
              <Ionicons name="person-add-outline" size={20} color={palette.primary} />
              <Stack gap={2} style={{ flex: 1 }}>
                <Type variant="bodyStrong">Add a friend by username</Type>
                <Type variant="caption" color={palette.textMuted}>
                  Friends can be invited to your private groups.
                </Type>
              </Stack>
              <Button label="Add" size="sm" onPress={() => setFriendOpen(true)} />
            </Row>
          </Card>

          {incoming.length > 0 ? (
            <Stack gap={spacing.sm}>
              <SectionHeader title="Requests" subtitle={`${incoming.length} waiting`} />
              {incoming.map((friend) => (
                <Card key={friend.friendshipId}>
                  <Row gap={spacing.md}>
                    <Avatar name={friend.user.name} size={34} />
                    <Stack gap={2} style={{ flex: 1 }}>
                      <Type variant="bodyStrong">{friend.user.name}</Type>
                      <Type variant="caption" color={palette.textMuted}>
                        @{friend.user.username}
                      </Type>
                    </Stack>
                    <Row gap={6}>
                      <Button
                        label="Accept"
                        size="sm"
                        onPress={async () => {
                          await groupMutations.respondToFriend(friend.friendshipId, true);
                          void refetchFriends();
                        }}
                      />
                      <Button
                        label="Decline"
                        size="sm"
                        variant="ghost"
                        onPress={async () => {
                          await groupMutations.respondToFriend(friend.friendshipId, false);
                          void refetchFriends();
                        }}
                      />
                    </Row>
                  </Row>
                </Card>
              ))}
            </Stack>
          ) : null}

          <SectionHeader title="Friends" subtitle={`${friendCount} accepted`} />
          {friends.length === 0 ? (
            <Card>
              <Type variant="caption" color={palette.textFaint}>
                No friends yet. Add someone by their username to invite them to a group.
              </Type>
            </Card>
          ) : (
            friends.map((friend) => (
              <Card key={friend.friendshipId}>
                <Row gap={spacing.md}>
                  <Avatar name={friend.user.name} size={34} />
                  <Stack gap={2} style={{ flex: 1 }}>
                    <Type variant="bodyStrong">{friend.user.name}</Type>
                    <Type variant="caption" color={palette.textMuted}>
                      @{friend.user.username}
                    </Type>
                  </Stack>
                  <Button
                    label="Remove"
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      Alert.alert('Remove friend?', undefined, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: async () => {
                            await groupMutations.removeFriend(friend.friendshipId);
                            void refetchFriends();
                          },
                        },
                      ])
                    }
                  />
                </Row>
              </Card>
            ))
          )}

          {outgoing.length > 0 ? (
            <Stack gap={spacing.sm}>
              <SectionHeader title="Sent" subtitle={`${outgoing.length} pending`} />
              {outgoing.map((friend) => (
                <Card key={friend.friendshipId}>
                  <Type variant="caption" color={palette.textMuted}>
                    Waiting for @{friend.user.username} to accept
                  </Type>
                </Card>
              ))}
            </Stack>
          ) : null}
        </>
      ) : null}

      {/* Create group */}
      <Sheet
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New focus group"
        footer={
          <Row gap={spacing.sm}>
            <Button label="Cancel" variant="secondary" onPress={() => setCreateOpen(false)} />
            <Button
              label="Create group"
              loading={busy}
              disabled={name.trim().length < 2}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  const group = await groupMutations.create({
                    name: name.trim(),
                    emoji,
                    leaderboardEnabled: leaderboard,
                  });
                  setName('');
                  setCreateOpen(false);
                  void refetch();
                  router.push(`/group/${group.id}`);
                } catch (createError) {
                  setError(createError instanceof Error ? createError.message : 'Could not create the group');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Row>
        }
      >
        <Field label="Name">
          <Input value={name} onChangeText={setName} placeholder="DSA Grind" />
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
          description="Optional, private to this group, and off by default. Focus minutes, sessions and consistency."
          value={leaderboard}
          onValueChange={setLeaderboard}
        />
        {error ? (
          <Type variant="caption" color={palette.danger}>
            {error}
          </Type>
        ) : null}
      </Sheet>

      {/* Join group */}
      <Sheet
        visible={joinOpen}
        onClose={() => setJoinOpen(false)}
        title="Join a group"
        footer={
          <Row gap={spacing.sm}>
            <Button label="Cancel" variant="secondary" onPress={() => setJoinOpen(false)} />
            <Button
              label="Join"
              loading={busy}
              disabled={inviteCode.trim().length < 4}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  const group = await groupMutations.join(inviteCode.trim().toUpperCase());
                  setInviteCode('');
                  setJoinOpen(false);
                  void refetch();
                  router.push(`/group/${group.id}`);
                } catch (joinError) {
                  setError(joinError instanceof Error ? joinError.message : 'That invite code did not work');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Row>
        }
      >
        <Field label="Invite code" hint="Ask the group owner for the code shown on their group.">
          <Input
            value={inviteCode}
            onChangeText={(value) => setInviteCode(value.toUpperCase())}
            placeholder="JNKYNE3"
            autoCapitalize="characters"
          />
        </Field>
        {error ? (
          <Type variant="caption" color={palette.danger}>
            {error}
          </Type>
        ) : null}
      </Sheet>

      {/* Add friend */}
      <Sheet
        visible={friendOpen}
        onClose={() => setFriendOpen(false)}
        title="Add a friend"
        footer={
          <Row gap={spacing.sm}>
            <Button label="Cancel" variant="secondary" onPress={() => setFriendOpen(false)} />
            <Button
              label="Send request"
              loading={busy}
              disabled={username.trim().length < 3}
              onPress={async () => {
                setBusy(true);
                setError(null);
                try {
                  await groupMutations.requestFriend(username.trim().toLowerCase());
                  setUsername('');
                  setFriendOpen(false);
                  void refetchFriends();
                } catch (requestError) {
                  setError(requestError instanceof Error ? requestError.message : 'Could not send the request');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Row>
        }
      >
        <Field label="Username" hint="They will see a request and can accept or decline.">
          <Input
            value={username}
            onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
            placeholder="rahul"
            autoCapitalize="none"
          />
        </Field>
        {error ? (
          <Type variant="caption" color={palette.danger}>
            {error}
          </Type>
        ) : null}
      </Sheet>

      {/* Create gang session */}
      <Sheet
        visible={Boolean(sessionGroup)}
        onClose={() => setSessionGroup(null)}
        title="New gang session"
        footer={
          <Row gap={spacing.sm}>
            <Button label="Cancel" variant="secondary" onPress={() => setSessionGroup(null)} />
            <Button
              label={sessionStartNow ? 'Start now' : 'Schedule for 30 min'}
              loading={busy}
              onPress={async () => {
                if (!sessionGroup) return;
                setBusy(true);
                setError(null);
                try {
                  const startsAt = sessionStartNow ? Date.now() : Date.now() + 30 * 60_000;
                  const session = await gangMutations.create({
                    groupId: sessionGroup,
                    title: sessionTitle.trim() || 'Focus session',
                    startsAt,
                    focusMinutes: sessionMinutes,
                    breakMinutes: Math.max(5, Math.round(sessionMinutes / 5)),
                    rounds: sessionRounds,
                    mode: sessionMinutes >= 50 ? 'deep_work' : 'pomodoro',
                    inviteUserIds: friends.map((friend) => friend.user.id),
                  });
                  setSessionGroup(null);
                  router.push(`/gang/${session.id}`);
                } catch (createError) {
                  setError(createError instanceof Error ? createError.message : 'Could not create the session');
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Row>
        }
      >
        <Field label="Session name">
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
        <SwitchRow
          label="Start immediately"
          description={sessionStartNow ? 'Everyone can join right away.' : 'Scheduled 30 minutes from now.'}
          value={sessionStartNow}
          onValueChange={setSessionStartNow}
        />
        <Type variant="caption" color={palette.textFaint}>
          All friends in this group receive an invite notification.
        </Type>
        {error ? (
          <Type variant="caption" color={palette.danger}>
            {error}
          </Type>
        ) : null}
      </Sheet>
    </Screen>
  );
}
