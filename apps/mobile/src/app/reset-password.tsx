/**
 * Password reset landing page.
 *
 * This is where the link in the reset email points (the API serves the web build
 * at the same origin, so `https://your-jarvis-host/reset-password?token=…`
 * opens this screen in a browser and — via the `jarvis://` scheme — in the app).
 *
 * A reset token is single-use and expires in 30 minutes; the screen says exactly
 * what happened instead of a generic "check your email" that hides failures.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Field, Input, Screen, Stack, Type } from '../components/ui';
import { useAuth } from '../lib/auth';
import { spacing, usePalette } from '../lib/theme';

/** Accepts a bare token or a full reset URL pasted from the email. */
function extractToken(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  const match = /[?&]token=([^&\s]+)/.exec(value);
  if (match) return decodeURIComponent(match[1]);
  return value;
}

export default function ResetPasswordScreen() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const { resetPassword } = useAuth();

  const [token, setToken] = useState(() => extractToken(params.token));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError(null);
    if (token.trim().length < 10) {
      setError('Paste the reset token from your email, or open the link in the email again.');
      return;
    }
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token.trim(), password);
      setDone(true);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset the password');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Card>
          <Stack gap={spacing.sm} style={{ alignItems: 'center', paddingVertical: spacing.lg }}>
            <Ionicons name="checkmark-circle" size={40} color={palette.success} />
            <Type variant="headline">Password updated</Type>
            <Type variant="caption" color={palette.textMuted} style={{ textAlign: 'center' }}>
              Every other device has been signed out. This one is signed in and ready.
            </Type>
            <Button label="Open JARVIS" onPress={() => router.replace('/')} />
          </Stack>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <Stack gap={spacing.sm} style={{ paddingTop: spacing.xxl }}>
        <Type variant="title" accessibilityRole="header">
          Choose a new password
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Reset links work once and expire after 30 minutes. If yours has expired, request a new one from the sign-in
          screen.
        </Type>

        <Card>
          <Stack gap={spacing.sm}>
            <Field label="Reset token">
              <Input
                value={token}
                onChangeText={setToken}
                placeholder="Paste the token or the link from your email"
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Reset token"
              />
            </Field>
            <Field label="New password">
              <Input
                value={password}
                onChangeText={setPassword}
                placeholder="At least 8 characters"
                secureTextEntry
                accessibilityLabel="New password"
              />
            </Field>
            <Field label="Confirm password">
              <Input
                value={confirm}
                onChangeText={setConfirm}
                placeholder="Repeat the password"
                secureTextEntry
                accessibilityLabel="Confirm password"
              />
            </Field>
            {error ? (
              <Type variant="caption" color={palette.danger}>
                {error}
              </Type>
            ) : null}
            <Button label="Set new password" onPress={() => void submit()} loading={busy} />
            <Button label="Back to sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}
