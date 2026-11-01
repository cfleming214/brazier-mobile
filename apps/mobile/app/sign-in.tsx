import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';
import { Button, Screen, T } from '@/components/ui';
import { sendSignInEmail, verifyEmailCode } from '@/lib/auth';
import { colors, fonts, radius, space } from '@/lib/theme';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSend() {
    if (!EMAIL_RE.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendSignInEmail(email);
      setStep('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the email. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function onVerify() {
    if (!/^\d{6}$/.test(code.trim())) {
      setError('Enter the 6-digit code from the email.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyEmailCode(email, code);
      // AuthProvider picks up the new session and the router guard switches to the tabs.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That code did not work. Request a new one.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.wrap}
      >
        <View style={{ gap: space.sm }}>
          <T variant="display" style={{ fontSize: 30 }}>
            DROPHAWK
          </T>
          <T variant="muted">Track the drop. Win the checkout.</T>
        </View>

        {step === 'email' ? (
          <View style={styles.form}>
            <T variant="label">Email</T>
            <TextInput
              testID="email-input"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              inputMode="email"
              style={styles.input}
              onSubmitEditing={onSend}
            />
            <Button testID="send-link" label="Send sign-in link" onPress={onSend} loading={busy} />
          </View>
        ) : (
          <View style={styles.form}>
            <T variant="muted">
              We sent a link and a 6-digit code to {email.trim()}. Tap the link on this phone, or
              enter the code.
            </T>
            <T variant="label">Code</T>
            <TextInput
              testID="code-input"
              value={code}
              onChangeText={setCode}
              placeholder="123456"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={6}
              style={[styles.input, styles.codeInput]}
              onSubmitEditing={onVerify}
            />
            <Button testID="verify-code" label="Sign in" onPress={onVerify} loading={busy} />
            <Button
              label="Use a different email"
              variant="ghost"
              onPress={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            />
          </View>
        )}

        {error ? (
          <T testID="auth-error" style={{ color: colors.dead }}>
            {error}
          </T>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, justifyContent: 'center', gap: space.xl },
  form: { gap: space.md },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.ink,
    fontFamily: fonts.body,
    fontSize: 16,
    paddingHorizontal: space.md,
    paddingVertical: 14,
  },
  codeInput: { fontFamily: fonts.monoSemi, fontSize: 22, letterSpacing: 8, textAlign: 'center' },
});
