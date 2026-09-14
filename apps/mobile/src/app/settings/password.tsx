/**
 * Settings → Password.
 *
 * Accounts that already have a password: changing it signs out every other
 * device (this one stays signed in).
 *
 * Accounts created through Google Sign-In have no password yet — they set a
 * first one here, proved by the live session rather than by a current password
 * they never had. The server enforces the distinction; this screen only
 * reflects it.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Field, Input, Row, Screen, Stack, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { spacing, usePalette } from '../../lib/theme';

export default function PasswordSettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { changePassword, user } = useAuth();
  const firstPassword = user?.hasPassword === false;
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
          {firstPassword ? 'Set a password' : 'Change password'}
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          {firstPassword
            ? 'You signed in with Google, so this account has no password yet. Setting one lets you sign in with your email as well.'
            : 'Changing your password signs out every other device. This one stays signed in.'}
        </Type>
      </Stack>

      <Card>
        <Stack gap={spacing.md}>
          {firstPassword ? null : (
            <Field label="Current password">
              <Input value={current} onChangeText={setCurrent} secureTextEntry autoCapitalize="none" />
            </Field>
          )}
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
            label={firstPassword ? 'Set password' : 'Update password'}
            loading={busy}
            disabled={(!firstPassword && !current) || !next || !confirm || Boolean(problem)}
            onPress={async () => {
              setBusy(true);
              setError(null);
              setMessage(null);
              try {
                await changePassword(firstPassword ? undefined : current, next);
                setMessage(
                  firstPassword
                    ? 'Password set. You can now sign in with your email and password.'
                    : 'Password updated. Other devices have been signed out.',
                );
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
