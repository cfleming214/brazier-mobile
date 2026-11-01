/* global jest */
require('react-native-gesture-handler/jestSetup');
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
// Swipeable needs the native worklets runtime; render children directly in unit tests.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const React = require('react');
  const Swipeable = React.forwardRef(({ children }, _ref) => children);
  return { __esModule: true, default: Swipeable };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' },
  scheduleNotificationAsync: jest.fn(async () => 'notif-1'),
  cancelScheduledNotificationAsync: jest.fn(async () => {}),
  setNotificationHandler: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { from: jest.fn(), rpc: jest.fn(), auth: { getUser: jest.fn() } },
}));
