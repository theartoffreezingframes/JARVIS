/**
 * Settings → Customize → Focus & pomodoro.
 *
 * Durations, rounds, auto-start behaviour, sound and haptics, countdown style,
 * keep-screen-awake and the daily focus target used by the dashboard ring.
 */
import { useRouter } from 'expo-router';
import { Badge, Button, Card, Chip, Field, Input, Row, Screen, SectionHeader, Segmented, Stack, SwitchRow, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { spacing, usePalette } from '../../lib/theme';

const PRESETS = [
  { label: 'Classic', focus: 25, short: 5, long: 15, rounds: 4 },
  { label: 'Deep work', focus: 50, short: 10, long: 20, rounds: 3 },
  { label: 'Sprint', focus: 15, short: 5, long: 10, rounds: 4 },
  { label: 'Marathon', focus: 90, short: 15, long: 25, rounds: 2 },
];

export default function FocusSettingsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const { settings, updateSettings } = useAuth();

  if (!settings) {
    return (
      <Screen edges={['top']}>
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Type variant="body">Loading your preferences…</Type>
      </Screen>
    );
  }

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Open timer" variant="ghost" onPress={() => router.replace('/(tabs)/focus')} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Focus & pomodoro
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Currently {settings.pomodoroFocusMinutes} / {settings.pomodoroShortBreakMinutes} /{' '}
          {settings.pomodoroLongBreakMinutes} with a long break every {settings.pomodoroSessionsBeforeLongBreak} rounds.
        </Type>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Presets" />
        <Row gap={spacing.sm} wrap>
          {PRESETS.map((preset) => (
            <Chip
              key={preset.label}
              label={`${preset.label} · ${preset.focus}/${preset.short}/${preset.long}`}
              selected={settings.pomodoroFocusMinutes === preset.focus}
              onPress={() =>
                void updateSettings({
                  pomodoroFocusMinutes: preset.focus,
                  pomodoroShortBreakMinutes: preset.short,
                  pomodoroLongBreakMinutes: preset.long,
                  pomodoroSessionsBeforeLongBreak: preset.rounds,
                })
              }
            />
          ))}
        </Row>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Durations" subtitle="Minutes" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Focus">
              <Input
                value={String(settings.pomodoroFocusMinutes)}
                onChangeText={(value) =>
                  void updateSettings({ pomodoroFocusMinutes: clamp(Number(value.replace(/\D/g, '')) || 25, 1, 180) })
                }
                keyboardType="number-pad"
              />
            </Field>
            <Field label="Short break">
              <Input
                value={String(settings.pomodoroShortBreakMinutes)}
                onChangeText={(value) =>
                  void updateSettings({ pomodoroShortBreakMinutes: clamp(Number(value.replace(/\D/g, '')) || 5, 1, 60) })
                }
                keyboardType="number-pad"
              />
            </Field>
            <Field label="Long break">
              <Input
                value={String(settings.pomodoroLongBreakMinutes)}
                onChangeText={(value) =>
                  void updateSettings({ pomodoroLongBreakMinutes: clamp(Number(value.replace(/\D/g, '')) || 15, 1, 120) })
                }
                keyboardType="number-pad"
              />
            </Field>
            <Field label="Sessions before a long break">
              <Row gap={spacing.sm} wrap>
                {[2, 3, 4, 5, 6].map((rounds) => (
                  <Chip
                    key={rounds}
                    label={String(rounds)}
                    selected={settings.pomodoroSessionsBeforeLongBreak === rounds}
                    onPress={() => void updateSettings({ pomodoroSessionsBeforeLongBreak: rounds })}
                  />
                ))}
              </Row>
            </Field>
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Behaviour" />
        <Card>
          <Stack gap={spacing.xs}>
            <SwitchRow
              label="Auto-start breaks"
              description="Move straight into the break when a focus block finishes."
              value={settings.autoStartBreaks}
              onValueChange={(value) => void updateSettings({ autoStartBreaks: value })}
            />
            <SwitchRow
              label="Auto-start the next focus block"
              description="Keep the cycle going without touching the phone."
              value={settings.autoStartNextSession}
              onValueChange={(value) => void updateSettings({ autoStartNextSession: value })}
            />
            <SwitchRow
              label="Sound when a block ends"
              description="Uses the notification sound, so it works with the app closed."
              value={settings.focus.sound}
              onValueChange={(value) => void updateSettings({ focus: { sound: value } })}
            />
            <SwitchRow
              label="Haptics"
              description="A short buzz on start, pause and completion."
              value={settings.focus.haptics}
              onValueChange={(value) => void updateSettings({ focus: { haptics: value } })}
            />
            <SwitchRow
              label="Keep the screen awake"
              description="Stops the phone sleeping while a focus block is running."
              value={settings.focus.keepScreenAwake}
              onValueChange={(value) => void updateSettings({ focus: { keepScreenAwake: value } })}
            />
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Countdown style" />
        <Card>
          <Segmented
            options={[
              { value: 'ring', label: 'Ring' },
              { value: 'bar', label: 'Bar' },
              { value: 'digits', label: 'Digits' },
            ]}
            value={settings.focus.countdownStyle}
            onChange={(value) => void updateSettings({ focus: { countdownStyle: value } })}
          />
          <Type variant="caption" color={palette.textMuted} style={{ marginTop: spacing.sm }}>
            The timer is timestamp-based, so whichever style you choose, the remaining time is correct after the app has
            been in the background.
          </Type>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Daily target" subtitle="Used by the dashboard focus ring" />
        <Card>
          <Row gap={spacing.sm} wrap>
            {[60, 90, 120, 180, 240].map((minutes) => (
              <Chip
                key={minutes}
                label={`${minutes} min`}
                selected={settings.focus.dailyTargetMinutes === minutes}
                onPress={() => void updateSettings({ focus: { dailyTargetMinutes: minutes } })}
              />
            ))}
          </Row>
          <Row gap={spacing.sm} style={{ marginTop: spacing.md }}>
            <Badge label={`${settings.focus.dailyTargetMinutes} min target`} color={palette.primary} />
            <Badge label="Sustainable ceiling 300 min" color={palette.success} />
          </Row>
        </Card>
      </Stack>
    </Screen>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
