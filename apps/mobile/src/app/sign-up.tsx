/**
 * Create an account.
 *
 * A brand-new account gets an empty workspace: no demo user, no seeded content.
 * Data only ever appears because the person using the app put it there — or
 * explicitly asked for the sample workspace from Settings → Data.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Button, Card, Divider, Field, Input, Row, Screen, Stack, Type } from '../components/ui';
import { useAuth } from '../lib/auth';
import { GoogleSignInError, googleSignInAvailable } from '../lib/google';
import { usePalette, spacing } from '../lib/theme';

function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters';
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return 'Mix letters and numbers';
  return null;
}

export default function SignUpScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { signUp, signInWithGoogle } = useAuth();
  const googleReady = googleSignInAvailable();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [offsetMinutes, setOffsetMinutes] = useState(0);

  useEffect(() => {
    try {
      const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (resolved) setTimezone(resolved);
      setOffsetMinutes(-new Date().getTimezoneOffset());
    } catch {
      /* keep UTC */
    }
  }, []);

  const problem = useMemo(() => (password ? passwordProblem(password) : null), [password]);
  const usernameValid = /^[a-z0-9._]{3,20}$/.test(username);
  const canSubmit = name.trim().length > 1 && usernameValid && /\S+@\S+\.\S+/.test(email) && !problem && password.length > 0;

  const submitGoogle = async () => {
    setGoogleBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      try {
        await Notifications.requestPermissionsAsync();
      } catch {
        /* unsupported on this platform */
      }
    } catch (submitError) {
      if (submitError instanceof GoogleSignInError && submitError.cancelled) return;
      setError(submitError instanceof Error ? submitError.message : 'Could not continue with Google');
    } finally {
      setGoogleBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await signUp({
        name: name.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim().toLowerCase(),
        password,
        timezone,
        timezoneOffsetMinutes: offsetMinutes,
      });
      // Ask for notification permission in context (we just created the account)
      // rather than on first launch.
      try {
        await Notifications.requestPermissionsAsync();
      } catch {
        /* unsupported on this platform */
      }
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not create the account');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
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
          <Ionicons name="person-add" size={24} color={palette.onPrimary} />
        </View>
        <Type variant="display" accessibilityRole="header">
          Create your account
        </Type>
        <Type variant="body" color={palette.textMuted}>
          Your tasks, habits and focus history are stored privately against this account only.
        </Type>
      </Stack>

      <Card>
        <Stack gap={spacing.md}>
          <Field label="Name">
            <Input value={name} onChangeText={setName} placeholder="Akshay Kumar" autoComplete="name" textContentType="name" />
          </Field>
          <Field
            label="Username"
            hint="Lowercase letters, numbers, dot or underscore — used to invite you to groups."
            error={username.length > 0 && !usernameValid ? '3–20 characters: a–z, 0–9, . or _' : null}
          >
            <Input
              value={username}
              onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9._]/g, ''))}
              placeholder="akshay"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>
          <Field label="Email">
            <Input
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />
          </Field>
          <Field label="Password" error={problem} hint="At least 8 characters with letters and numbers.">
            <Input
              value={password}
              onChangeText={setPassword}
              placeholder="Choose a password"
              secureTextEntry
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
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
          <Button label="Create account" onPress={submit} loading={busy} disabled={!canSubmit} full />
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
                label="Sign up with Google"
                variant="secondary"
                icon="logo-google"
                onPress={submitGoogle}
                loading={googleBusy}
                disabled={busy}
                full
                accessibilityHint="Opens Google's account chooser in your browser"
              />
              <Type variant="caption" color={palette.textFaint}>
                Google confirms your email address. You can add a password later from Settings.
              </Type>
            </>
          ) : null}
          <Type variant="caption" color={palette.textFaint}>
            By continuing you agree that JARVIS may store your tasks, habits and focus history so it can sync across your
            devices. You can export or delete everything from Settings at any time.
          </Type>
        </Stack>
      </Card>

      <Button label="I already have an account" variant="ghost" onPress={() => router.replace('/sign-in')} />
    </Screen>
  );
}
