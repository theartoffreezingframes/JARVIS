/**
 * Bottom navigation.
 *
 * Five destinations cover the daily loop — Home, Tasks, Focus, Matrix and the
 * hub — with a capture button that floats above the bar so adding a task is
 * always one tap away from anywhere in the app.
 */
import { Ionicons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Type, type IconName } from '../../components/ui';
import { radius, spacing, usePalette } from '../../lib/theme';

const TABS: Array<{ name: string; label: string; icon: IconName; activeIcon: IconName }> = [
  { name: 'index', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { name: 'tasks', label: 'Tasks', icon: 'checkbox-outline', activeIcon: 'checkbox' },
  { name: 'focus', label: 'Focus', icon: 'timer-outline', activeIcon: 'timer' },
  { name: 'matrix', label: 'Matrix', icon: 'grid-outline', activeIcon: 'grid' },
  { name: 'more', label: 'More', icon: 'ellipsis-horizontal', activeIcon: 'ellipsis-horizontal' },
];

function CaptureButton() {
  const palette = usePalette();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push('/task-new')}
      accessibilityRole="button"
      accessibilityLabel="Add a task"
      accessibilityHint="Opens quick capture with natural language"
      style={({ pressed }) => ({
        position: 'absolute',
        right: spacing.lg,
        top: -26,
        width: 56,
        height: 56,
        borderRadius: radius.pill,
        backgroundColor: palette.primary,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.85 : 1,
        shadowColor: '#0B0F19',
        shadowOpacity: 0.28,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
        elevation: 6,
      })}
    >
      <Ionicons name="add" size={28} color={palette.onPrimary} />
    </Pressable>
  );
}

type TabBarProps = React.ComponentProps<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>;

function JarvisTabBar({ state, navigation }: TabBarProps) {
  const palette = usePalette();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingBottom: Math.max(insets.bottom, spacing.sm),
        paddingTop: spacing.sm,
        backgroundColor: palette.surface,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: palette.border,
      }}
    >
      <CaptureButton />
      <View style={{ flexDirection: 'row', paddingHorizontal: spacing.sm }}>
        {state.routes.map((route, index) => {
          const tab = TABS.find((item) => item.name === route.name);
          if (!tab) return null;
          const focused = state.index === index;
          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
              }}
              onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={tab.label}
              style={{ flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 }}
            >
              <Ionicons
                name={focused ? tab.activeIcon : tab.icon}
                size={22}
                color={focused ? palette.primary : palette.textFaint}
              />
              <Type variant="micro" color={focused ? palette.primary : palette.textFaint}>
                {tab.label.toUpperCase()}
              </Type>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <JarvisTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: 'transparent' } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="tasks" options={{ title: 'Tasks' }} />
      <Tabs.Screen name="focus" options={{ title: 'Focus' }} />
      <Tabs.Screen name="matrix" options={{ title: 'Matrix' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
