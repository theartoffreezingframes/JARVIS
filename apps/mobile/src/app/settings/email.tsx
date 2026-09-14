/** Settings → Change email. Requires the current password; marks the address unverified. */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Badge, Button, Card, Field, Input, Row, Screen, Stack, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { spacing, usePalette } from '../../lib/theme';

export default function EmailSettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { user, changeEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen edges={['top']}>
      <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Change email
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Your email is used to sign in and to receive password resets.
        </Type>
      </Stack>

      <Card>
        <Stack gap={spacing.sm}>
          <Row justify="space-between" align="center">
            <Type variant="caption">Current address</Type>
            <Type variant="bodyStrong">{user?.email}</Type>
          </Row>
          {user ? (
            <Badge
              label={user.emailVerified ? 'Verified' : 'Not verified'}
              color={user.emailVerified ? palette.success : palette.warning}
            />
          ) : null}
        </Stack>
      </Card>

      <Card>
        <Stack gap={spacing.md}>
          <Field label="New email">
            <Input
              value={email}
              onChangeText={setEmail}
              placeholder="new@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </Field>
          <Field label="Current password" hint="Confirms it is really you.">
            <Input value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
          </Field>
          {message ? (
            <Row gap={6}>
              <Ionicons name="checkmark-circle" size={15} color={palette.success} />
              <Type variant="caption" color={palette.success} style={{ flex: 1 }}>
                {message}
              </Type>
            </Row>
          ) : null}
          {error ? (
            <Row gap={6}>
              <Ionicons name="alert-circle" size={15} color={palette.danger} />
              <Type variant="caption" color={palette.danger} style={{ flex: 1 }}>
                {error}
              </Type>
            </Row>
          ) : null}
          <Button
            label="Update email"
            loading={busy}
            disabled={!/\S+@\S+\.\S+/.test(email) || password.length < 6}
            onPress={async () => {
              setBusy(true);
              setError(null);
              setMessage(null);
              try {
                await changeEmail(email.trim().toLowerCase(), password);
                setMessage('Email updated. It will show as unverified until confirmed.');
                setEmail('');
                setPassword('');
              } catch (changeError) {
                setError(changeError instanceof Error ? changeError.message : 'Could not change the email');
              } finally {
                setBusy(false);
              }
            }}
            full
          />
        </Stack>
      </Card>
    </Screen>
  );
}
