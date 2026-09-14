/**
 * Password reset.
 *
 * Step 1 asks for the email and always reports success (so the screen cannot be
 * used to discover which addresses exist). Step 2 accepts the reset token and a
 * new password. In this deployment the API hands the token back directly when
 * email delivery is not configured, which the screen states plainly rather than
 * pretending an email was sent.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, Card, Field, Input, Row, Screen, Stack, Type } from '../components/ui';
import { useAuth } from '../lib/auth';
import { usePalette, spacing } from '../lib/theme';

export default function ForgotPasswordScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { forgotPassword, resetPassword } = useAuth();

  const [stage, setStage] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [devToken, setDevToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const request = async () => {
    setBusy(true);
    setError(null);
    try {
      const returned = await forgotPassword(email.trim().toLowerCase());
      setDevToken(returned);
      setStage('reset');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not start the reset');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError(null);
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
              Every other device has been signed out. Sign in again with your new password.
            </Type>
            <Button label="Back to sign in" onPress={() => router.replace('/sign-in')} />
          </Stack>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <Stack gap={spacing.sm} style={{ paddingTop: spacing.xxl }}>
        <Type variant="title" accessibilityRole="header">
          Reset your password
        </Type>
        <Type variant="body" color={palette.textMuted}>
          {stage === 'request'
            ? 'We will email you a reset token if that address has an account.'
            : 'Enter the token from the email together with a new password.'}
        </Type>
      </Stack>

      <Card>
        <Stack gap={spacing.md}>
          {stage === 'request' ? (
            <>
              <Field label="Email">
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </Field>
              <Button label="Send reset link" onPress={request} loading={busy} disabled={!email.includes('@')} full />
            </>
          ) : (
            <>
              {devToken ? (
                <Card style={{ backgroundColor: palette.primaryMuted, borderColor: palette.primary }}>
                  <Stack gap={4}>
                    <Type variant="label" color={palette.primary}>
                      EMAIL DELIVERY IS NOT CONFIGURED
                    </Type>
                    <Type variant="caption" color={palette.textMuted}>
                      This deployment has no mail provider, so the token is shown here once. In production it would be
                      emailed and never displayed.
                    </Type>
                    <Row gap={spacing.sm} style={{ marginTop: spacing.xs }}>
                      <Type variant="bodyStrong" style={{ flex: 1 }}>
                        {devToken}
                      </Type>
                      <Button label="Use it" size="sm" variant="secondary" onPress={() => setToken(devToken)} />
                    </Row>
                  </Stack>
                </Card>
              ) : null}
              <Field label="Reset token">
                <Input value={token} onChangeText={setToken} placeholder="Paste the token" autoCapitalize="none" />
              </Field>
              <Field label="New password" hint="At least 8 characters with letters and numbers.">
                <Input value={password} onChangeText={setPassword} placeholder="New password" secureTextEntry autoCapitalize="none" />
              </Field>
              <Button
                label="Update password"
                onPress={reset}
                loading={busy}
                disabled={token.length < 10 || password.length < 8}
                full
              />
              <Button label="Use a different email" variant="ghost" size="sm" onPress={() => setStage('request')} />
            </>
          )}
          {error ? (
            <Row gap={6}>
              <Ionicons name="alert-circle" size={15} color={palette.danger} />
              <Type variant="caption" color={palette.danger} style={{ flex: 1 }}>
                {error}
              </Type>
            </Row>
          ) : null}
        </Stack>
      </Card>

      <Button label="Back to sign in" variant="ghost" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
