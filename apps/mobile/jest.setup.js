/* global jest */
require('react-native-gesture-handler/jestSetup');
jest.mock('expo-symbols', () => ({ SymbolView: () => null }));
// Swipeable needs the native worklets runtime; render children directly in unit tests.
jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => {
  const React = require('react');
  const Swipeable = React.forwardRef(({ children }, _ref) => children);
  return { __esModule: true, default: Swipeable };
});
