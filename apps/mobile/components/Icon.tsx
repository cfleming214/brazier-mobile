import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

type SymbolName = ComponentProps<typeof SymbolView>['name'];

/** Cross-platform icon names: SF Symbols on iOS, Material Symbols on Android/web. */
export const icons = {
  radar: { ios: 'scope', android: 'radar', web: 'radar' },
  calendar: { ios: 'calendar', android: 'calendar_month', web: 'calendar_month' },
  add: { ios: 'plus', android: 'add', web: 'add' },
  feed: { ios: 'list.bullet', android: 'list', web: 'list' },
  profile: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  bell: { ios: 'bell', android: 'notifications', web: 'notifications' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
} satisfies Record<string, SymbolName>;

export function Icon({
  name,
  color,
  size = 22,
}: {
  name: keyof typeof icons;
  color: ColorValue;
  size?: number;
}) {
  return <SymbolView name={icons[name] as SymbolName} tintColor={color} size={size} />;
}
