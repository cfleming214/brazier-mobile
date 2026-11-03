import { router } from 'expo-router';
import { Tabs } from 'expo-router/js-tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '@/components/Icon';
import { colors, fonts, radius } from '@/lib/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.panel, borderTopColor: colors.line },
        tabBarLabelStyle: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 1 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'RADAR',
          tabBarButtonTestID: 'tab-radar',
          tabBarIcon: ({ color }) => <Icon name="radar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="calendar"
        options={{
          title: 'CALENDAR',
          tabBarButtonTestID: 'tab-calendar',
          tabBarIcon: ({ color }) => <Icon name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: '',
          tabBarAccessibilityLabel: 'Add watch',
          tabBarButton: () => (
            <View style={styles.addWrap}>
              <Pressable
                testID="tab-add"
                accessibilityRole="button"
                accessibilityLabel="Add watch"
                onPress={() => router.push('/add-watch')}
                style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.8 }]}
              >
                <Icon name="add" color={colors.accentInk} size={24} />
              </Pressable>
            </View>
          ),
        }}
        listeners={{ tabPress: (e) => e.preventDefault() }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'FEED',
          tabBarButtonTestID: 'tab-feed',
          tabBarIcon: ({ color }) => <Icon name="feed" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'PROFILE',
          tabBarButtonTestID: 'tab-profile',
          tabBarIcon: ({ color }) => <Icon name="profile" color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  addWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  addButton: {
    width: 48,
    height: 40,
    borderRadius: radius.lg,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
