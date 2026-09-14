/**
 * Sign in.
 *
 * Sessions are stored in the OS keychain, so this screen is only ever seen when
 * there is genuinely no valid session — reopening the app signs you straight in.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Card, Divider, Field, Input, Row, Screen, Stack, Type } from '../components/ui';
import { useAuth } from '../lib/auth';
import { GoogleSignInError } from '../lib/google';
import { googleSignInAvailable } from '../lib/google';
import { usePalette, spacing } from '../lib/theme';

export default function SignInScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { signIn, signInWithGoogle } = useAuth();
  const googleReady = googleSignInAvailable();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not sign in');
    } finally {
      setBusy(false);
    }
  };

  const submitGoogle = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (submitError) {
      // Backing out of the Google sheet is not an error.
      if (submitError instanceof GoogleSignInError && submitError.cancelled) return;
      setError(submitError instanceof Error ? submitError.message : 'Could not sign in with Google');
    } finally {
      setGoogleBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']} scroll={false}>
      <>
        <Stack gap={spacing.sm} style={{ paddingTop: spacing.xxl }}>
            <View
              style={{
                width: 54,
                height: 54,
                borderRadius: 16,
                backgroundColor: palette.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name="sparkles" size={26} color={palette.onPrimary} />
            </View>
            <Type variant="display" accessibilityRole="header">
              Welcome back
            </Type>
            <Type variant="body" color={palette.textMuted}>
              Capture, prioritise, plan, focus — one place for the work that matters.
            </Type>
          </Stack>

          <Card>
            <Stack gap={spacing.md}>
              <Field label="Email">
                <Input
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  textContentType="emailAddress"
                  returnKeyType="next"
                />
              </Field>
              <Field label="Password">
                <Input
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Your password"
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={submit}
                />
              </Field>
              {error ? (
                <Row gap={6}>
                  <Ionicons name="alert-circle" size={15} color={palette.danger} />
                  <Type variant="caption" color={palette.danger} style={{ flex: 1 }}>
                    {error}
                  </Type>
                </Row>
              ) : null}
              <Button label="Sign in" onPress={submit} loading={busy} full disabled={!email || password.length < 1} />
              {googleReady ? (
                <>
                  <Row gap={spacing.sm}>
                    <Divider style={{ flex: 1 }} />
                    <Type variant="caption" color={palette.textMuted}>
                      or
                    </Type>
                    <Divider style={{ flex: 1 }} />
                  </Row>
                  <Button
                    label="Continue with Google"
                    variant="secondary"
                    icon="logo-google"
                    onPress={submitGoogle}
                    loading={googleBusy}
                    disabled={busy}
                    full
                    accessibilityHint="Opens Google's account chooser in your browser"
                  />
                </>
              ) : null}
              <Button label="Forgot password?" variant="ghost" size="sm" onPress={() => router.push('/forgot-password')} />
            </Stack>
          </Card>

          <Card>
            <Stack gap={spacing.sm}>
              <Type variant="bodyStrong">New here?</Type>
              <Type variant="caption" color={palette.textMuted}>
                Create an account and your workspace starts empty — no sample data, no demo user.
              </Type>
              <Button label="Create an account" variant="secondary" onPress={() => router.push('/sign-up')} full />
            </Stack>
          </Card>
      </>
    </Screen>
  );
}
