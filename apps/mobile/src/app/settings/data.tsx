/**
 * Settings → Data & privacy.
 *
 * Export everything, remove the sample workspace, read what is stored and why,
 * and delete the account. Deletion is real: credentials are cleared, sessions
 * revoked and the account is excluded from every query.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Linking } from 'react-native';
import { Badge, Button, Card, Field, Input, Row, Screen, SectionHeader, Stack, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { api, API_BASE_URL } from '../../lib/api';
import { useOfflineStatus } from '../../lib/offline';
import { spacing, usePalette } from '../../lib/theme';

interface PrivacyResponse {
  dataStored: { tasks: number; notes: number; sessions: number };
  notes: string[];
}

export default function DataSettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { user, deleteAccount, signOut } = useAuth();
  const offline = useOfflineStatus();
  const [privacy, setPrivacy] = useState<PrivacyResponse | null>(null);
  const [demoEnabled, setDemoEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [password, setPassword] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [privacyData, demo] = await Promise.all([
          api.get<PrivacyResponse>('/api/me/privacy'),
          api.get<{ demoData: { enabled: boolean } }>('/api/me/demo-data'),
        ]);
        setPrivacy(privacyData);
        setDemoEnabled(demo.demoData.enabled);
      } catch {
        /* the screen still works without these details */
      }
    })();
  }, []);

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Account" variant="ghost" icon="person-outline" onPress={() => router.push('/settings')} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Data & privacy
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Your records belong to you — take them anywhere or remove them completely.
        </Type>
      </Stack>

      {message ? (
        <Card style={{ backgroundColor: palette.surfaceMuted }}>
          <Type variant="caption">{message}</Type>
        </Card>
      ) : null}

      <Stack gap={spacing.sm}>
        <SectionHeader title="Export" />
        <Card>
          <Stack gap={spacing.sm}>
            <Type variant="caption" color={palette.textMuted}>
              Downloads a JSON document containing your profile, settings, projects, tasks, tags, habits and their
              completions, focus sessions, notes, groups and daily reviews.
            </Type>
            <Row gap={spacing.sm} wrap>
              <Button
                label="Export as JSON"
                icon="download-outline"
                variant="secondary"
                onPress={() => {
                  const url = `${API_BASE_URL}/api/me/export?format=json`;
                  void Linking.openURL(url).catch(() => setMessage('Could not open the export link on this device.'));
                }}
              />
              <Button
                label="Export as CSV"
                icon="grid-outline"
                variant="ghost"
                onPress={() => {
                  const url = `${API_BASE_URL}/api/me/export?format=csv`;
                  void Linking.openURL(url).catch(() => setMessage('Could not open the export link on this device.'));
                }}
              />
            </Row>
            <Type variant="micro" color={palette.textFaint}>
              The export endpoint is authenticated with your session token.
            </Type>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Sample workspace" subtitle="Clearer than starting with fake data everywhere" />
        <Card>
          <Stack gap={spacing.sm}>
            <Row gap={spacing.sm} wrap>
              <Badge
                label={demoEnabled ? 'Sample data present' : 'No sample data'}
                color={demoEnabled ? palette.warning : palette.success}
              />
            </Row>
            <Type variant="caption" color={palette.textMuted}>
              Sample content is created inside your own account and tagged, so removing it never touches anything you
              created yourself.
            </Type>
            <Row gap={spacing.sm} wrap>
              <Button
                label="Add sample data"
                icon="flask-outline"
                variant="secondary"
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await api.post('/api/me/demo-data');
                    setDemoEnabled(true);
                    setMessage('Sample workspace added.');
                  } catch {
                    setMessage('Could not add the sample workspace.');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
              <Button
                label="Remove sample data"
                icon="trash-outline"
                variant="ghost"
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  try {
                    await api.delete('/api/me/demo-data');
                    setDemoEnabled(false);
                    setMessage('Sample workspace removed.');
                  } catch {
                    setMessage('Could not remove the sample workspace.');
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </Row>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="What we store" />
        <Card>
          <Stack gap={spacing.sm}>
            {privacy ? (
              <>
                <Row gap={spacing.lg} wrap>
                  <Stack gap={2}>
                    <Type variant="micro" color={palette.textMuted}>
                      TASKS
                    </Type>
                    <Type variant="headline">{privacy.dataStored.tasks}</Type>
                  </Stack>
                  <Stack gap={2}>
                    <Type variant="micro" color={palette.textMuted}>
                      NOTES
                    </Type>
                    <Type variant="headline">{privacy.dataStored.notes}</Type>
                  </Stack>
                  <Stack gap={2}>
                    <Type variant="micro" color={palette.textMuted}>
                      FOCUS SESSIONS
                    </Type>
                    <Type variant="headline">{privacy.dataStored.sessions}</Type>
                  </Stack>
                </Row>
                {privacy.notes.map((note) => (
                  <Type key={note} variant="caption" color={palette.textMuted}>
                    • {note}
                  </Type>
                ))}
              </>
            ) : (
              <Type variant="caption" color={palette.textFaint}>
                Privacy details could not be loaded right now.
              </Type>
            )}
            <Row gap={spacing.sm} wrap>
              <Badge label={offline.online ? 'Online' : 'Offline'} color={offline.online ? palette.success : palette.warning} />
              <Badge label={`${offline.pending} queued changes`} />
            </Row>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Delete account" subtitle="Immediate and irreversible" />
        <Card style={{ borderColor: `${palette.danger}66` }}>
          <Stack gap={spacing.sm}>
            <Type variant="caption" color={palette.textMuted}>
              Deleting clears your credentials, revokes every session on every device, and removes your tasks,
              projects, habits, notes and focus history from every query. Rows are anonymised rather than kept linked to
              you.
            </Type>
            <Field label="Confirm with your password">
              <Input
                value={password}
                onChangeText={setPassword}
                placeholder="Your password"
                secureTextEntry
                autoCapitalize="none"
              />
            </Field>
            <Button
              label="Delete my account"
              icon="trash-outline"
              variant="danger"
              disabled={password.length < 6}
              onPress={() =>
                Alert.alert(
                  'Delete your account?',
                  'This cannot be undone. Export your data first if you want a copy.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete everything',
                      style: 'destructive',
                      onPress: async () => {
                        setBusy(true);
                        try {
                          await deleteAccount(password);
                        } catch (error) {
                          setMessage(error instanceof Error ? error.message : 'Could not delete the account.');
                        } finally {
                          setBusy(false);
                          setPassword('');
                        }
                      },
                    },
                  ],
                )
              }
              full
            />
            <Button label="Sign out instead" variant="ghost" onPress={() => void signOut()} />
          </Stack>
        </Card>
      </Stack>

      {user ? (
        <Type variant="micro" color={palette.textFaint}>
          ACCOUNT {user.id} · {user.email}
        </Type>
      ) : null}
    </Screen>
  );
}
