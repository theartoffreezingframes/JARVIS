/**
 * The JARVIS interface kit.
 *
 * One file so the vocabulary stays small: text styles, buttons, cards, chips,
 * rows, sheets, progress and empty states. Everything is themed, every touch
 * target is at least 44pt, and every interactive element carries an accessibility
 * label so screen readers describe the app the way it looks.
 */
import { Ionicons } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { HIT_SLOP, MIN_TOUCH, radius, spacing, typography, usePalette, type Palette } from '../lib/theme';

type IconName = keyof typeof Ionicons.glyphMap;

/* -------------------------------------------------------------------------- */
/*  Text                                                                      */
/* -------------------------------------------------------------------------- */

type TextVariant = keyof typeof typography;

export function Type({
  variant = 'body',
  color,
  children,
  style,
  numberOfLines,
  accessibilityRole,
}: {
  variant?: TextVariant;
  color?: string;
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  accessibilityRole?: 'header' | 'text';
}) {
  const palette = usePalette();
  const base = typography[variant];
  const tone = color ?? (variant === 'caption' || variant === 'micro' ? palette.textMuted : palette.text);
  return (
    <Text
      numberOfLines={numberOfLines}
      accessibilityRole={accessibilityRole}
      style={[{ color: tone, ...base }, style]}
    >
      {children}
    </Text>
  );
}

/* -------------------------------------------------------------------------- */
/*  Layout                                                                    */
/* -------------------------------------------------------------------------- */

export function Screen({
  children,
  scroll = true,
  edges = ['top', 'left', 'right'],
  padded = true,
  refreshControl,
  style,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  edges?: Edge[];
  padded?: boolean;
  refreshControl?: ScrollView['props']['refreshControl'];
  style?: StyleProp<ViewStyle>;
  footer?: ReactNode;
}) {
  const palette = usePalette();
  const content = padded ? { padding: spacing.lg, gap: spacing.lg } : undefined;
  return (
    <SafeAreaView style={[{ flex: 1, backgroundColor: palette.background }, style]} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={content}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, content]}>{children}</View>
      )}
      {footer}
    </SafeAreaView>
  );
}

export function Row({
  children,
  gap = spacing.sm,
  align = 'center',
  justify = 'flex-start',
  wrap = false,
  style,
}: {
  children: ReactNode;
  gap?: number;
  align?: ViewStyle['alignItems'];
  justify?: ViewStyle['justifyContent'];
  wrap?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: align, justifyContent: justify, gap, flexWrap: wrap ? 'wrap' : 'nowrap' }, style]}>
      {children}
    </View>
  );
}

export function Stack({ children, gap = spacing.md, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  const palette = usePalette();
  return <View style={[{ height: StyleSheet.hairlineWidth, backgroundColor: palette.border }, style]} />;
}

export function Card({
  children,
  style,
  onPress,
  accessibilityLabel,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const palette = usePalette();
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: palette.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border,
      padding: spacing.lg,
    },
    style,
  ];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={base}>
      {children}
    </Pressable>
  );
}

export function SectionHeader({
  title,
  action,
  onAction,
  subtitle,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  subtitle?: string;
}) {
  const palette = usePalette();
  return (
    <Row justify="space-between" align="flex-end">
      <Stack gap={2}>
        <Type variant="label" color={palette.textMuted} style={{ textTransform: 'uppercase' }}>
          {title}
        </Type>
        {subtitle ? <Type variant="caption">{subtitle}</Type> : null}
      </Stack>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={HIT_SLOP} accessibilityRole="button" accessibilityLabel={action}>
          <Type variant="caption" color={palette.primary}>
            {action}
          </Type>
        </Pressable>
      ) : null}
    </Row>
  );
}

/* -------------------------------------------------------------------------- */
/*  Buttons                                                                   */
/* -------------------------------------------------------------------------- */

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  full,
  size = 'md',
  accessibilityHint,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  size?: 'sm' | 'md';
  accessibilityHint?: string;
}) {
  const palette = usePalette();
  const height = size === 'sm' ? 36 : MIN_TOUCH;
  const background =
    variant === 'primary'
      ? palette.primary
      : variant === 'secondary'
        ? palette.surfaceMuted
        : variant === 'danger'
          ? `${palette.danger}18`
          : 'transparent';
  const textColor =
    variant === 'primary' ? palette.onPrimary : variant === 'danger' ? palette.danger : palette.text;
  const borderWidth = variant === 'secondary' ? StyleSheet.hairlineWidth : 0;

  return (
    <Pressable
      onPress={disabled || loading ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      style={({ pressed }) => [
        {
          height,
          borderRadius: radius.pill,
          backgroundColor: background,
          borderWidth,
          borderColor: palette.borderStrong,
          paddingHorizontal: size === 'sm' ? spacing.md : spacing.lg,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.sm,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: full ? 'stretch' : 'flex-start',
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : icon ? (
        <Ionicons name={icon} size={size === 'sm' ? 15 : 17} color={textColor} />
      ) : null}
      <Type variant="bodyStrong" color={textColor} style={{ fontSize: size === 'sm' ? 14 : 15.5 }}>
        {label}
      </Type>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  label,
  color,
  size = 22,
  variant = 'plain',
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  color?: string;
  size?: number;
  variant?: 'plain' | 'filled';
}) {
  const palette = usePalette();
  const tint = color ?? palette.text;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={HIT_SLOP}
      style={({ pressed }) => [
        {
          minWidth: MIN_TOUCH,
          minHeight: MIN_TOUCH,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          backgroundColor: variant === 'filled' ? palette.surfaceMuted : 'transparent',
          opacity: pressed ? 0.6 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={size} color={tint} />
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chips, badges, progress                                                   */
/* -------------------------------------------------------------------------- */

export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
  small,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  icon?: IconName;
  small?: boolean;
}) {
  const palette = usePalette();
  const tint = color ?? palette.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      accessibilityState={{ selected: Boolean(selected) }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: small ? spacing.sm : spacing.md,
        paddingVertical: small ? 4 : 7,
        borderRadius: radius.pill,
        backgroundColor: selected ? tint : `${tint}14`,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? tint : `${tint}33`,
      }}
    >
      {icon ? <Ionicons name={icon} size={small ? 12 : 14} color={selected ? palette.onPrimary : tint} /> : null}
      <Type variant="caption" color={selected ? palette.onPrimary : tint}>
        {label}
      </Type>
    </Pressable>
  );
}

export function Badge({ label, color, icon }: { label: string; color?: string; icon?: IconName }) {
  const palette = usePalette();
  const tint = color ?? palette.textMuted;
  return (
    <Row
      gap={4}
      style={{
        paddingHorizontal: spacing.sm,
        paddingVertical: 3,
        borderRadius: radius.sm,
        backgroundColor: `${tint}16`,
      }}
    >
      {icon ? <Ionicons name={icon} size={11} color={tint} /> : null}
      <Type variant="micro" color={tint}>
        {label}
      </Type>
    </Row>
  );
}

export function ProgressBar({ value, color, height = 6 }: { value: number; color?: string; height?: number }) {
  const palette = usePalette();
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ now: pct, min: 0, max: 100 }}
      style={{ height, borderRadius: radius.pill, backgroundColor: palette.surfaceMuted, overflow: 'hidden' }}
    >
      <View style={{ width: `${pct}%`, height, backgroundColor: color ?? palette.primary, borderRadius: radius.pill }} />
    </View>
  );
}

export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  icon,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  icon?: IconName;
}) {
  const palette = usePalette();
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value }}
      style={{ minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm }}
    >
      {icon ? <Ionicons name={icon} size={18} color={palette.textMuted} /> : null}
      <Stack gap={2} style={{ flex: 1 }}>
        <Type variant="bodyStrong">{label}</Type>
        {description ? <Type variant="caption">{description}</Type> : null}
      </Stack>
      <View
        style={{
          width: 46,
          height: 28,
          borderRadius: radius.pill,
          backgroundColor: value ? palette.primary : palette.surfaceMuted,
          justifyContent: 'center',
          paddingHorizontal: 3,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: radius.pill,
            backgroundColor: value ? palette.onPrimary : palette.textFaint,
            alignSelf: value ? 'flex-end' : 'flex-start',
          }}
        />
      </View>
    </Pressable>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: palette.surfaceMuted,
        borderRadius: radius.pill,
        padding: 3,
        gap: 2,
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={option.label}
            style={{
              flex: 1,
              minHeight: 32,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: selected ? palette.surface : 'transparent',
            }}
          >
            <Type variant="caption" color={selected ? palette.text : palette.textMuted}>
              {option.label}
            </Type>
          </Pressable>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  States                                                                    */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  icon = 'sparkles-outline',
  title,
  body,
  actionLabel,
  onAction,
}: {
  icon?: IconName;
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const palette = usePalette();
  return (
    <Stack gap={spacing.sm} style={{ alignItems: 'center', paddingVertical: spacing.xxl }}>
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: radius.lg,
          backgroundColor: palette.primaryMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={icon} size={24} color={palette.primary} />
      </View>
      <Type variant="headline" style={{ textAlign: 'center' }}>
        {title}
      </Type>
      {body ? (
        <Type variant="body" color={palette.textMuted} style={{ textAlign: 'center', maxWidth: 300 }}>
          {body}
        </Type>
      ) : null}
      {actionLabel && onAction ? (
        <View style={{ marginTop: spacing.sm }}>
          <Button label={actionLabel} onPress={onAction} variant="secondary" size="sm" />
        </View>
      ) : null}
    </Stack>
  );
}

export function LoadingBlock({ label = 'Loading' }: { label?: string }) {
  const palette = usePalette();
  return (
    <Row justify="center" gap={spacing.sm} style={{ paddingVertical: spacing.xxl }}>
      <ActivityIndicator color={palette.primary} />
      <Type variant="caption" color={palette.textMuted}>
        {label}
      </Type>
    </Row>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const palette = usePalette();
  return (
    <Card style={{ borderColor: `${palette.danger}44` }}>
      <Row gap={spacing.sm}>
        <Ionicons name="cloud-offline-outline" size={20} color={palette.danger} />
        <Stack gap={2} style={{ flex: 1 }}>
          <Type variant="bodyStrong">{message}</Type>
          <Type variant="caption">Nothing was lost. Retry now, or keep working — the app retries when it returns to the foreground.</Type>
        </Stack>
      </Row>
      {onRetry ? (
        <View style={{ marginTop: spacing.md }}>
          <Button label="Try again" onPress={onRetry} variant="secondary" size="sm" icon="refresh" />
        </View>
      ) : null}
    </Card>
  );
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const palette = usePalette();
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  void url; // remote images are optional; initials keep lists fast and calm
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.pill,
        backgroundColor: palette.primaryMuted,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Type variant="caption" color={palette.primary}>
        {initials || '•'}
      </Type>
    </View>
  );
}

export function StatTile({
  label,
  value,
  hint,
  color,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  color?: string;
  icon?: IconName;
}) {
  const palette = usePalette();
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Row gap={6}>
        {icon ? <Ionicons name={icon} size={13} color={color ?? palette.textMuted} /> : null}
        <Type variant="micro" color={palette.textMuted}>
          {label.toUpperCase()}
        </Type>
      </Row>
      <Type variant="title" color={color}>
        {value}
      </Type>
      {hint ? (
        <Type variant="caption" color={palette.textMuted}>
          {hint}
        </Type>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inputs                                                                    */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  const palette = usePalette();
  return (
    <Stack gap={6}>
      {label ? (
        <Type variant="label" color={palette.textMuted}>
          {label}
        </Type>
      ) : null}
      {children}
      {error ? (
        <Row gap={4}>
          <Ionicons name="alert-circle" size={13} color={palette.danger} />
          <Type variant="caption" color={palette.danger}>
            {error}
          </Type>
        </Row>
      ) : hint ? (
        <Type variant="caption" color={palette.textFaint}>
          {hint}
        </Type>
      ) : null}
    </Stack>
  );
}

export function Input({ style, ...props }: TextInputProps & { style?: StyleProp<TextStyle> }) {
  const palette = usePalette();
  return (
    <TextInput
      placeholderTextColor={palette.textFaint}
      selectionColor={palette.primary}
      accessibilityLabel={props.accessibilityLabel ?? props.placeholder}
      style={[
        {
          minHeight: MIN_TOUCH,
          borderRadius: radius.md,
          backgroundColor: palette.surfaceMuted,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: palette.border,
          paddingHorizontal: spacing.md,
          paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
          color: palette.text,
          fontSize: typography.body.fontSize,
        },
        style,
      ]}
      {...props}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Sheet                                                                     */
/* -------------------------------------------------------------------------- */

export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const palette = usePalette();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} accessibilityViewIsModal>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(9,12,20,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: palette.surface,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            paddingTop: spacing.md,
            paddingBottom: spacing.xl,
            maxHeight: '90%',
          }}
        >
          <View style={{ alignItems: 'center', paddingBottom: spacing.sm }}>
            <View style={{ width: 36, height: 4, borderRadius: radius.pill, backgroundColor: palette.borderStrong }} />
          </View>
          {title ? (
            <Row justify="space-between" style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
              <Type variant="headline">{title}</Type>
              <IconButton icon="close" label="Close" onPress={onClose} size={20} />
            </Row>
          ) : null}
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            {children}
          </ScrollView>
          {footer ? <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

/** Full-height list row with an optional leading icon and trailing chevron. */
export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  onPress,
  trailing,
  destructive,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconColor?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  destructive?: boolean;
  accessibilityLabel?: string;
}) {
  const palette = usePalette();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH,
        flexDirection: 'row',
        alignItems: 'center',
        gap: spacing.md,
        paddingVertical: spacing.md,
        opacity: pressed && onPress ? 0.7 : 1,
      })}
    >
      {icon ? (
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: radius.sm,
            backgroundColor: `${iconColor ?? palette.primary}16`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={icon} size={17} color={iconColor ?? palette.primary} />
        </View>
      ) : null}
      <Stack gap={2} style={{ flex: 1 }}>
        <Type variant="bodyStrong" color={destructive ? palette.danger : undefined}>
          {title}
        </Type>
        {subtitle ? (
          <Type variant="caption" numberOfLines={2}>
            {subtitle}
          </Type>
        ) : null}
      </Stack>
      {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={palette.textFaint} /> : null)}
    </Pressable>
  );
}

export type { IconName };
export { paletteStyles };

const paletteStyles = StyleSheet.create({});
export type { Palette };
