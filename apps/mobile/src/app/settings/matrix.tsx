/**
 * Settings → Customize → Eisenhower matrix.
 *
 * Rename quadrants, rewrite their descriptions, choose what a new task defaults
 * to, and pick the display style. Names are used everywhere the matrix appears —
 * including the dashboard shortcuts.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Badge, Button, Card, Field, Input, Row, Screen, SectionHeader, Segmented, Stack, SwitchRow, Type } from '../../components/ui';
import { priorityColor } from '../../components/tasks';
import { useAuth } from '../../lib/auth';
import { QUADRANTS } from '@jarvis/shared';
import { spacing, usePalette } from '../../lib/theme';

type Quadrant = (typeof QUADRANTS)[number];

export default function MatrixSettingsScreen() {
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

  const matrix = settings.matrix;

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Preview matrix" variant="ghost" onPress={() => router.replace('/(tabs)/matrix')} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Eisenhower matrix
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Classification stays automatic — importance and urgency decide the quadrant. You decide what the quadrants
          are called and how they are shown.
        </Type>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Quadrant names & descriptions" />
        {QUADRANTS.map((quadrant) => (
          <Card key={quadrant}>
            <Stack gap={spacing.md}>
              <Row gap={spacing.sm} align="center">
                <Type variant="label" color={palette.quadrant[quadrant as Quadrant]}>
                  {quadrant.replace('_', ' ').toUpperCase()}
                </Type>
                <Badge label="Automatic" color={palette.quadrant[quadrant as Quadrant]} />
              </Row>
              <Field label="Name">
                <Input
                  value={matrix.quadrantNames[quadrant as Quadrant]}
                  onChangeText={(value) =>
                    void updateSettings({ matrix: { quadrantNames: { [quadrant]: value.slice(0, 28) } } })
                  }
                  placeholder="Name this quadrant"
                />
              </Field>
              <Field label="Description">
                <Input
                  value={matrix.quadrantDescriptions[quadrant as Quadrant]}
                  onChangeText={(value) =>
                    void updateSettings({ matrix: { quadrantDescriptions: { [quadrant]: value.slice(0, 160) } } })
                  }
                  multiline
                  style={{ minHeight: 68, textAlignVertical: 'top' }}
                />
              </Field>
            </Stack>
          </Card>
        ))}
        <Button
          label="Restore default wording"
          variant="ghost"
          onPress={() =>
            void updateSettings({
              matrix: {
                quadrantNames: { do_now: 'Do Now', schedule: 'Schedule', delegate: 'Delegate', eliminate: 'Eliminate' },
                quadrantDescriptions: {
                  do_now: 'Important and urgent — handle these first.',
                  schedule: 'Important, not urgent — the work that compounds. Book time for it.',
                  delegate: 'Urgent, not important — hand off, batch or automate.',
                  eliminate: 'Neither — question whether it needs doing at all.',
                },
              },
            })
          }
        />
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="New tasks" subtitle="What a captured task defaults to before you classify it" />
        <Card>
          <Stack gap={spacing.md}>
            <Field label="Initial classification">
              <Row gap={spacing.sm} wrap>
                <ChoiceChip
                  label="Ask me each time"
                  value="inbox"
                  current={matrix.defaultClassification}
                  onSelect={(value) => void updateSettings({ matrix: { defaultClassification: value } })}
                />
                {QUADRANTS.map((quadrant) => (
                  <ChoiceChip
                    key={quadrant}
                    label={matrix.quadrantNames[quadrant as Quadrant]}
                    value={quadrant}
                    current={matrix.defaultClassification}
                    color={palette.quadrant[quadrant as Quadrant]}
                    onSelect={(value) => void updateSettings({ matrix: { defaultClassification: value } })}
                  />
                ))}
              </Row>
            </Field>
            <SwitchRow
              label="Show the quadrant hint text"
              description="A one-line explanation under each quadrant header."
              value={matrix.showHints}
              onValueChange={(value) => void updateSettings({ matrix: { showHints: value } })}
            />
          </Stack>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Display style" />
        <Card>
          <Segmented
            options={[
              { value: 'grid', label: 'Four quadrants' },
              { value: 'list', label: 'Single list' },
            ]}
            value={matrix.displayStyle}
            onChange={(value) => void updateSettings({ matrix: { displayStyle: value } })}
          />
          <Type variant="caption" color={palette.textMuted} style={{ marginTop: spacing.sm }}>
            {matrix.displayStyle === 'grid'
              ? 'Drag tasks between the four quadrants to re-classify them.'
              : 'One list with the quadrant shown on each row — easier on small screens.'}
          </Type>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="How tasks get their flags" />
        <Card>
          <Stack gap={spacing.sm}>
            {QUADRANTS.map((quadrant) => (
              <Row key={quadrant} justify="space-between">
                <Type variant="caption">{matrix.quadrantNames[quadrant as Quadrant]}</Type>
                <Type variant="caption" color={palette.textMuted}>
                  {quadrant === 'do_now'
                    ? 'Important + urgent'
                    : quadrant === 'schedule'
                      ? 'Important, not urgent'
                      : quadrant === 'delegate'
                        ? 'Urgent, not important'
                        : 'Neither'}
                </Type>
              </Row>
            ))}
            <Type variant="caption" color={palette.textFaint}>
              Changing importance or urgency anywhere in the app moves the task instantly — the matrix has no separate
              data of its own.
            </Type>
          </Stack>
        </Card>
      </Stack>

      {settings.taskDefaults.classifyAtCreation ? (
        <Badge label="Capture asks for importance and urgency" color={palette.primary} icon="checkmark" />
      ) : (
        <Badge label="Capture uses defaults — enable in Tasks settings" color={palette.textMuted} />
      )}
      <Row gap={spacing.sm} wrap>
        {QUADRANTS.map((quadrant) => (
          <Badge
            key={quadrant}
            label={matrix.quadrantNames[quadrant as Quadrant]}
            color={palette.quadrant[quadrant as Quadrant]}
          />
        ))}
      </Row>
      <Type variant="micro" color={palette.textFaint}>
        Priority colours stay consistent: low, medium, high and urgent are always the same hues
        ({['low', 'medium', 'high', 'urgent'].map((value) => priorityColor(value, palette)).join(', ')}).
      </Type>
    </Screen>
  );
}

function ChoiceChip({
  label,
  value,
  current,
  color,
  onSelect,
}: {
  label: string;
  value: string;
  current: string;
  color?: string;
  onSelect: (value: never) => void;
}) {
  const [selected] = useState(current === value);
  return (
    <Button
      label={label}
      size="sm"
      variant={selected ? 'primary' : 'secondary'}
      onPress={() => onSelect(value as never)}
    />
  );
}
