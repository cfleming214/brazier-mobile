import { Link } from 'expo-router';
import { View } from 'react-native';
import { Screen, T } from '@/components/ui';
import { colors, space } from '@/lib/theme';

export default function NotFound() {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md }}>
        <T variant="title">This screen doesn't exist.</T>
        <Link href="/" style={{ color: colors.accent }}>
          Back to Radar
        </Link>
      </View>
    </Screen>
  );
}
