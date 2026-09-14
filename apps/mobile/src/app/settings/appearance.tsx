/**
 * Settings → Customize → Appearance.
 *
 * Theme mode, preset, accent colour, interface density, corner style, motion and
 * text size. Every change applies instantly (so you can see it) and is saved to
 * the account (so it follows you).
 *
 * The accent colour is contrast-checked against the surface it is used on by the
 * theme engine, so a low-contrast choice can never make text unreadable.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Badge, Button, Card, Chip, Row, Screen, SectionHeader, Segmented, Stack, Type } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { ACCENT_SWATCHES, THEME_PRESETS, applyThemeSettings, contrastRatio, usePalette } from '../../lib/theme';
import { spacing } from '../../lib/theme';

export default function AppearanceSettingsScreen() {
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

  const appearance = settings.appearance;

  return (
    <Screen edges={['top']}>
      <Row justify="space-between" align="center">
        <Button label="Back" variant="ghost" icon="chevron-back" onPress={() => router.back()} />
        <Button label="Reset" variant="ghost" onPress={() => void updateSettings({ appearance: { preset: 'indigo', density: 'comfortable', radiusStyle: 'rounded', animationLevel: 'full', fontScale: 1 }, accentColor: '#6C5CE7' })} />
      </Row>

      <Stack gap={2}>
        <Type variant="title" accessibilityRole="header">
          Appearance
        </Type>
        <Type variant="caption" color={palette.textMuted}>
          Applies to every screen and is saved to your account.
        </Type>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Theme" />
        <Card>
          <Segmented
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            value={settings.theme}
            onChange={(value) => {
              applyThemeSettings({ preference: value });
              void updateSettings({ theme: value });
            }}
          />
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Preset" subtitle="Surface tints tuned for contrast in both modes" />
        <Row gap={spacing.sm} wrap>
          {THEME_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              onPress={() => {
                applyThemeSettings({ preset: preset.id, accentColor: preset.accent });
                void updateSettings({ appearance: { preset: preset.id }, accentColor: preset.accent });
              }}
              accessibilityRole="button"
              accessibilityLabel={`${preset.label} theme`}
              accessibilityState={{ selected: appearance.preset === preset.id }}
              style={{
                width: 104,
                borderRadius: 14,
                borderWidth: appearance.preset === preset.id ? 2 : 1,
                borderColor: appearance.preset === preset.id ? palette.primary : palette.border,
                overflow: 'hidden',
              }}
            >
              <View style={{ height: 42, backgroundColor: preset.background.light, padding: 6 }}>
                <View style={{ flex: 1, backgroundColor: preset.surface.light, borderRadius: 6, padding: 4 }}>
                  <View style={{ width: 26, height: 6, borderRadius: 3, backgroundColor: preset.accent }} />
                </View>
              </View>
              <View style={{ backgroundColor: preset.background.dark, padding: 6, height: 34 }}>
                <View style={{ flex: 1, backgroundColor: preset.surface.dark, borderRadius: 6, padding: 4 }}>
                  <View style={{ width: 26, height: 6, borderRadius: 3, backgroundColor: preset.accent }} />
                </View>
              </View>
              <View style={{ padding: 6, backgroundColor: palette.surface }}>
                <Type variant="micro" color={palette.text}>
                  {preset.label.toUpperCase()}
                </Type>
              </View>
            </Pressable>
          ))}
        </Row>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Accent colour" subtitle="Contrast is corrected automatically" />
        <Card>
          <Row gap={spacing.sm} wrap>
            {ACCENT_SWATCHES.map((color) => {
              const ratio = contrastRatio(color, palette.surface);
              return (
                <Pressable
                  key={color}
                  onPress={() => {
                    applyThemeSettings({ accentColor: color });
                    void updateSettings({ accentColor: color });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Accent ${color}, contrast ${ratio.toFixed(1)} to one`}
                  accessibilityState={{ selected: settings.accentColor === color }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: color,
                    borderWidth: settings.accentColor === color ? 3 : 0,
                    borderColor: palette.text,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {settings.accentColor === color ? (
                    <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                  ) : null}
                </Pressable>
              );
            })}
          </Row>
          <Row gap={spacing.sm} style={{ marginTop: spacing.md }}>
            <Badge label="Text stays readable on every accent" color={palette.success} icon="checkmark-circle" />
          </Row>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Density" subtitle="How much fits on screen" />
        <Card>
          <Segmented
            options={[
              { value: 'comfortable', label: 'Comfortable' },
              { value: 'compact', label: 'Compact' },
            ]}
            value={appearance.density}
            onChange={(value) => {
              applyThemeSettings({ density: value });
              void updateSettings({ appearance: { density: value } });
            }}
          />
          <Type variant="caption" color={palette.textMuted} style={{ marginTop: spacing.sm }}>
            Compact tightens spacing only — touch targets stay at least 44pt so nothing becomes hard to tap.
          </Type>
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Corners" />
        <Card>
          <Segmented
            options={[
              { value: 'rounded', label: 'Rounded' },
              { value: 'soft', label: 'Soft' },
            ]}
            value={appearance.radiusStyle}
            onChange={(value) => {
              applyThemeSettings({ radiusStyle: value });
              void updateSettings({ appearance: { radiusStyle: value } });
            }}
          />
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Motion" subtitle="Reduced motion is respected system-wide" />
        <Card>
          <Segmented
            options={[
              { value: 'full', label: 'Full' },
              { value: 'reduced', label: 'Reduced' },
              { value: 'none', label: 'None' },
            ]}
            value={appearance.animationLevel}
            onChange={(value) => {
              applyThemeSettings({ animationLevel: value });
              void updateSettings({ appearance: { animationLevel: value } });
            }}
          />
        </Card>
      </Stack>

      <Stack gap={spacing.sm}>
        <SectionHeader title="Text size" subtitle={`${Math.round(appearance.fontScale * 100)}%`} />
        <Card>
          <Row gap={spacing.sm} wrap>
            {[0.85, 0.95, 1, 1.15, 1.3].map((scale) => (
              <Chip
                key={scale}
                label={`${Math.round(scale * 100)}%`}
                selected={Math.abs(appearance.fontScale - scale) < 0.01}
                onPress={() => {
                  applyThemeSettings({ fontScale: scale });
                  void updateSettings({ appearance: { fontScale: scale } });
                }}
              />
            ))}
          </Row>
          <Stack gap={6} style={{ marginTop: spacing.md }}>
            <Type variant="headline">Headings stay clear</Type>
            <Type variant="body">Body text scales with your choice and keeps a readable line height.</Type>
            <Type variant="caption" color={palette.textMuted}>
              Sizes are clamped between 85% and 130% so layouts never break.
            </Type>
          </Stack>
        </Card>
      </Stack>
    </Screen>
  );
}
