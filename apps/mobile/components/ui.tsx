import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type PressableProps,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, radius, space } from '@/lib/theme';

export function Screen({
  children,
  style,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, style]}>
      {children}
    </SafeAreaView>
  );
}

type Variant = 'body' | 'title' | 'display' | 'mono' | 'label' | 'muted';

export function T({ variant = 'body', style, ...rest }: TextProps & { variant?: Variant }) {
  return <Text {...rest} style={[textStyles[variant], style as StyleProp<TextStyle>]} />;
}

export function Panel({
  title,
  right,
  children,
  style,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.panel, style]}>
      {title ? (
        <View style={styles.panelHeader}>
          <T variant="label" style={{ color: colors.ink }}>
            {title}
          </T>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  testID,
  ...rest
}: PressableProps & {
  label: string;
  loading?: boolean;
  variant?: 'primary' | 'ghost';
  testID?: string;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      testID={testID}
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'ghost' && styles.buttonGhost,
        (pressed || isDisabled) && { opacity: 0.6 },
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? colors.accentInk : colors.accent} />
      ) : (
        <T style={[styles.buttonLabel, variant === 'ghost' && { color: colors.accent }]}>{label}</T>
      )}
    </Pressable>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.empty}>
      <T variant="title" style={{ textAlign: 'center' }}>
        {title}
      </T>
      <T variant="muted" style={{ textAlign: 'center', marginTop: space.sm }}>
        {body}
      </T>
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

const textStyles = StyleSheet.create({
  body: { color: colors.ink, fontFamily: fonts.body, fontSize: 15, lineHeight: 21 },
  title: { color: colors.ink, fontFamily: fonts.bodySemi, fontSize: 17, lineHeight: 23 },
  display: { color: colors.ink, fontFamily: fonts.display, fontSize: 22, letterSpacing: 1.6 },
  mono: { color: colors.ink, fontFamily: fonts.mono, fontSize: 12, fontVariant: ['tabular-nums'] },
  label: {
    color: colors.muted,
    fontFamily: fonts.displaySemi,
    fontSize: 12,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  muted: { color: colors.muted, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.field },
  panel: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  panelHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  button: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  buttonLabel: {
    color: colors.accentInk,
    fontFamily: fonts.display,
    fontSize: 15,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  empty: { alignItems: 'center', padding: space.xl },
});
