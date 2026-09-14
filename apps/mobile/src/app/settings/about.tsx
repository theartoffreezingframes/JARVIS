/**
 * About — how the product behaves, in plain language.
 */
import { useRouter } from 'expo-router';
import { Badge, Button, Card, Row, Screen, SectionHeader, Stack, Type } from '../../components/ui';
import { api, API_BASE_URL } from '../../lib/api';
import { useOfflineStatus } from '../../lib/offline';
import { useQuery } from '../../lib/query';
import { useRealtimeStatus } from '../../lib/realtime';
import { spacing, usePalette } from '../../lib/theme';

interface HealthPayload {
  capabilities?: { email?: string; push?: boolean };
}

export default function AboutScreen() {
  const palette = usePalette();
  const router = useRouter();
  const offline = useOfflineStatus();
  const realtime = useRealtimeStatus();

  // The reset-delivery line below must describe *this* server, not the one the
  // app was developed against, so it is read from the live capability report.
  const health = useQuery<HealthPayload>('about-health', () => api.get<HealthPayload>('/api/health'), {
    staleTime: 5 * 60_000,
  });
  const emailProvider = health.data?.capabilities?.email;
  const emailLine =
    emailProvider === undefined
      ? 'Checking how this server delivers password-reset email…'
      : emailProvider === 'none'
        ? 'Password resets: this server has no mail provider configured, so a reset link cannot be emailed. An administrator has to set the JARVIS_EMAIL_* variables before sign-in recovery can work for real users.'
        : `Password resets are emailed by this server's configured provider (${emailProvider}).`;

  return (
    <Screen edges={['top']}>
      <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          About JARVIS
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Capture → prioritize → plan → focus → complete → review → improve.
        </Type>
      </Stack>

      <Card>
        <Stack gap={spacing.sm}>
          <Row gap={spacing.sm} wrap>
            <Badge label="Version 1.0.0" color={palette.primary} />
            <Badge label={`API ${API_BASE_URL}`} />
            <Badge label={offline.online ? 'Online' : 'Offline mode'} color={offline.online ? palette.success : palette.warning} />
            <Badge label={`Realtime: ${realtime}`} color={realtime === 'open' ? palette.success : palette.textMuted} />
          </Row>
          <Type variant="caption" color={palette.textMuted}>
            {offline.pending} change{offline.pending === 1 ? '' : 's'} queued on this device.
          </Type>
        </Stack>
      </Card>

      <Stack gap={spacing.sm}>
        <SectionHeader title="How sync works" />
        <Card>
          <Stack gap={spacing.sm}>
            <Type variant="caption" color={palette.textMuted}>
              Every record has a per-user revision number. Changes you make offline are queued on the device with a
              client id, then replayed through an idempotent endpoint when you reconnect — so a retried change can never
              create a duplicate.
            </Type>
            <Type variant="caption" color={palette.textMuted}>
              If the same field changed on two devices, the server keeps the value it already has and reports the
              conflict rather than silently overwriting your work. Nothing is lost, and nothing is merged by guessing.
            </Type>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="The productivity score" />
        <Card>
          <Stack gap={spacing.sm}>
            <Type variant="caption" color={palette.textMuted}>
              The score measures a balanced day: completing what you planned, focusing within a sustainable range,
              keeping habits, protecting important-not-urgent work, and reviewing the day.
            </Type>
            <Type variant="caption" color={palette.textMuted}>
              Extra focus beyond the sustainable ceiling earns nothing, and working longer is never treated as
              automatically better. A calm, consistent day scores well.
            </Type>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Security" />
        <Card>
          <Stack gap={spacing.sm}>
            {[
              'Passwords are stored as salted scrypt hashes, never in plain text.',
              'Sessions use short-lived access tokens with rotating refresh tokens; reuse revokes the family.',
              'Every query is scoped to your user id — other accounts cannot read your rows.',
              'Group membership and ownership are checked on the server for every group action.',
              'No server secret is ever shipped in the app; the client only holds your session tokens, in the OS keychain.',
            ].map((line) => (
              <Type key={line} variant="caption" color={palette.textMuted}>
                • {line}
              </Type>
            ))}
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="What is not built yet" />
        <Card>
          <Stack gap={spacing.sm}>
            <Type variant="caption" color={palette.textMuted}>
              • {emailLine}
            </Type>
            <Type variant="caption" color={palette.textMuted}>
              • Google and Apple sign-in — email and password are complete; the schema already separates credentials from
              identity so an external provider can be added without a migration.
            </Type>
            <Type variant="caption" color={palette.textMuted}>
              • AI features. Task breakdown, duration estimation and scheduling suggestions are deliberately absent rather
              than faked; the planner is deterministic today and the domain layer is where those features would plug in.
            </Type>
            <Type variant="caption" color={palette.textMuted}>
              • Home-screen widgets and third-party calendar sync.
            </Type>
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}
