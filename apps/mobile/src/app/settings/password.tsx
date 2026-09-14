/** Settings → Change password. Revokes sessions on other devices by design. */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Field, Input, Row, Screen, Stack, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { spacing, usePalette } from '../../lib/theme';

export default function PasswordSettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { changePassword } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const problem =
    next.length > 0 && next.length < 8
      ? 'Use at least 8 characters'
      : next.length > 0 && !(/[A-Za-z]/.test(next) && /[0-9]/.test(next))
        ? 'Mix letters and numbers'
        : confirm.length > 0 && confirm !== next
          ? 'The two passwords do not match'
          : null;

  return (
    <Screen edges={['top']}>
      <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Change password
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Changing your password signs out every other device. This one stays signed in.
        </Type>
      </Stack>

      <Card>
        <Stack gap={spacing.md}>
          <Field label="Current password">
            <Input value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" />
          </Field>
          <Field label="New password" error={problem}>
            <Input value={next} onChangeText={setNext} secureTextEntry autoCapitalize="none" />
          </Field>
          <Field label="Confirm new password">
            <Input value={confirm} onChangeText={setConfirm} secureTextEntry autoCapitalize="none" />
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
            label="Update password"
            loading={busy}
            disabled={!current || !next || !confirm || Boolean(problem)}
            onPress={async () => {
              setBusy(true);
              setError(null);
              setMessage(null);
              try {
                await changePassword(current, next);
                setMessage('Password updated. Other devices have been signed out.');
                setCurrent('');
                setNext('');
                setConfirm('');
              } catch (changeError) {
                setError(changeError instanceof Error ? changeError.message : 'Could not change the password');
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
