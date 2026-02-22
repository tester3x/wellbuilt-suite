import React, { useRef } from 'react';
import { View, Text, Image, StyleSheet, Pressable, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';
import { useLogin } from '@/core/hooks/useLogin';

export default function LoginScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const passcodeRef = useRef<TextInput>(null);
  const accentColor = colors.brand.primary;

  const {
    mode, displayName, setDisplayName, passcode, setPasscode,
    showPasscode, setShowPasscode, error, passcodeError, pendingName, canSubmit,
    handleLogin, handleRegister, handleCompleteRegistration,
    handleCancelRegistration, handleTryAgain, handleSwitchToRegister, handleSwitchToLogin,
  } = useLogin();

  return (
    <LinearGradient colors={colors.gradient.splash as unknown as [string, string, string]} style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { paddingTop: insets.top }]}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">

          {/* Logo */}
          <View style={styles.logoSection}>
            <Image source={require('../../../../assets/wellbuilt-logo.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.brandName}>WellBuilt Suite</Text>
          </View>

          {/* CHECKING MODE */}
          {mode === 'checking' && (
            <View style={styles.formArea}>
              <ActivityIndicator size="large" color={accentColor} />
            </View>
          )}

          {/* LOGIN MODE */}
          {mode === 'login' && (
            <View style={styles.formArea}>
              <Text style={styles.title}>Driver Login</Text>
              <Text style={styles.subtitle}>Enter your name and passcode to sign in</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Your Name</Text>
                <View style={styles.inputWrap}>
                  <MaterialCommunityIcons name="account-outline" size={18} color={colors.text.muted} />
                  <TextInput style={styles.input} value={displayName}
                    onChangeText={setDisplayName} placeholder="Your name"
                    placeholderTextColor={colors.text.muted} autoCapitalize="words"
                    autoCorrect={false} returnKeyType="next" autoFocus
                    onSubmitEditing={() => passcodeRef.current?.focus()} />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Passcode</Text>
                <View style={styles.inputWrap}>
                  <MaterialCommunityIcons name="lock-outline" size={18} color={colors.text.muted} />
                  <TextInput ref={passcodeRef} style={styles.input} value={passcode}
                    onChangeText={setPasscode} placeholder="Your passcode"
                    placeholderTextColor={colors.text.muted} secureTextEntry={!showPasscode}
                    autoCapitalize="none" returnKeyType="go" onSubmitEditing={handleLogin} />
                  <Pressable onPress={() => setShowPasscode(!showPasscode)}>
                    <MaterialCommunityIcons name={showPasscode ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.text.muted} />
                  </Pressable>
                </View>
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable onPress={handleLogin} disabled={!canSubmit}
                style={({ pressed }) => [styles.loginButton, !canSubmit && styles.buttonDisabled, pressed && styles.loginButtonPressed]}>
                <LinearGradient colors={[accentColor, `${accentColor}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.loginGradient}>
                  <Text style={styles.loginButtonText}>Sign In</Text>
                </LinearGradient>
              </Pressable>

              <Pressable onPress={handleSwitchToRegister}>
                <Text style={styles.linkText}>New driver? <Text style={styles.linkBold}>Register here</Text></Text>
              </Pressable>
            </View>
          )}

          {/* REGISTER MODE */}
          {mode === 'register' && (
            <View style={styles.formArea}>
              <Text style={styles.title}>New Driver Registration</Text>
              <Text style={styles.subtitle}>Choose a passcode and enter your display name</Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Display Name</Text>
                <View style={styles.inputWrap}>
                  <MaterialCommunityIcons name="account-outline" size={18} color={colors.text.muted} />
                  <TextInput style={styles.input} value={displayName}
                    onChangeText={setDisplayName} placeholder="Display name (e.g., MBurger)"
                    placeholderTextColor={colors.text.muted} autoCapitalize="words"
                    autoFocus returnKeyType="next"
                    onSubmitEditing={() => passcodeRef.current?.focus()} />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>Create Passcode</Text>
                <View style={styles.inputWrap}>
                  <MaterialCommunityIcons name="lock-outline" size={18} color={colors.text.muted} />
                  <TextInput ref={passcodeRef} style={styles.input} value={passcode}
                    onChangeText={setPasscode} placeholder="Create a passcode"
                    placeholderTextColor={colors.text.muted} secureTextEntry={!showPasscode}
                    autoCapitalize="none" returnKeyType="go" onSubmitEditing={handleRegister} />
                  <Pressable onPress={() => setShowPasscode(!showPasscode)}>
                    <MaterialCommunityIcons name={showPasscode ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.text.muted} />
                  </Pressable>
                </View>
              </View>

              {passcodeError ? <Text style={styles.errorText}>{passcodeError}</Text>
                : <Text style={styles.hintText}>4-12 characters</Text>}

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <Pressable onPress={handleRegister} disabled={!canSubmit}
                style={({ pressed }) => [styles.loginButton, !canSubmit && styles.buttonDisabled, pressed && styles.loginButtonPressed]}>
                <LinearGradient colors={[accentColor, `${accentColor}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.loginGradient}>
                  <Text style={styles.loginButtonText}>Submit Registration</Text>
                </LinearGradient>
              </Pressable>

              <Pressable onPress={handleSwitchToLogin}>
                <Text style={styles.linkText}>Already registered? <Text style={styles.linkBold}>Sign in</Text></Text>
              </Pressable>

              <Text style={styles.hintText}>Your registration will need to be approved by an administrator.</Text>
            </View>
          )}

          {/* VERIFYING / REGISTERING */}
          {(mode === 'verifying' || mode === 'registering') && (
            <View style={styles.formArea}>
              <Text style={styles.title}>{mode === 'verifying' ? 'Signing In...' : 'Registering...'}</Text>
              <ActivityIndicator size="large" color={accentColor} style={{ marginVertical: spacing.lg }} />
              <Text style={styles.subtitle}>{mode === 'verifying' ? 'Verifying your passcode...' : 'Submitting your registration...'}</Text>
            </View>
          )}

          {/* PENDING */}
          {mode === 'pending' && (
            <View style={styles.formArea}>
              <Text style={styles.title}>Registration Pending</Text>
              <View style={styles.infoBox}>
                <Text style={styles.infoBoxText}>Your registration as "{pendingName}" is waiting for approval.</Text>
                <Text style={[styles.infoBoxText, { marginTop: spacing.sm }]}>An administrator will review your request shortly.</Text>
              </View>
              <ActivityIndicator size="small" color={accentColor} style={{ marginVertical: spacing.md }} />
              <Text style={styles.subtitle}>Checking for approval...</Text>
              <Pressable onPress={handleCancelRegistration} style={{ marginTop: spacing.lg }}>
                <Text style={styles.linkText}><Text style={styles.linkBold}>Cancel registration</Text></Text>
              </Pressable>
            </View>
          )}

          {/* APPROVED */}
          {mode === 'approved' && (
            <View style={styles.formArea}>
              <Text style={styles.title}>Registration Approved!</Text>
              <View style={styles.successBox}>
                <Text style={styles.successBoxText}>Welcome, {pendingName}! Your registration has been approved.</Text>
              </View>
              <Pressable onPress={handleCompleteRegistration}
                style={({ pressed }) => [styles.loginButton, pressed && styles.loginButtonPressed]}>
                <LinearGradient colors={[accentColor, `${accentColor}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.loginGradient}>
                  <Text style={styles.loginButtonText}>Continue to App</Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}

          {/* REJECTED */}
          {mode === 'rejected' && (
            <View style={styles.formArea}>
              <Text style={styles.title}>Access Denied</Text>
              <View style={styles.errorBox}>
                <Text style={styles.errorBoxText}>Your registration request was denied.</Text>
                <Text style={[styles.errorBoxText, { marginTop: spacing.sm, fontSize: 13 }]}>If you believe this is a mistake, contact an administrator.</Text>
              </View>
              <Pressable onPress={handleCancelRegistration}
                style={({ pressed }) => [styles.loginButton, pressed && styles.loginButtonPressed]}>
                <LinearGradient colors={[accentColor, `${accentColor}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.loginGradient}>
                  <Text style={styles.loginButtonText}>Start Over</Text>
                </LinearGradient>
              </Pressable>
            </View>
          )}

          {/* ERROR */}
          {mode === 'error' && (
            <View style={styles.formArea}>
              <Text style={styles.title}>Sign In Failed</Text>
              <View style={styles.errorBox}>
                <Text style={styles.errorBoxText}>{error || 'Could not sign in'}</Text>
              </View>
              <Pressable onPress={handleTryAgain}
                style={({ pressed }) => [styles.loginButton, pressed && styles.loginButtonPressed]}>
                <LinearGradient colors={[accentColor, `${accentColor}CC`]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.loginGradient}>
                  <Text style={styles.loginButtonText}>Try Again</Text>
                </LinearGradient>
              </Pressable>
              <Pressable onPress={handleSwitchToRegister}>
                <Text style={styles.linkText}>Need to register? <Text style={styles.linkBold}>Register here</Text></Text>
              </Pressable>
            </View>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, justifyContent: 'center' },
  logoSection: { alignItems: 'center', marginBottom: spacing.xl },
  logo: { width: 64, height: 64, marginBottom: spacing.sm },
  brandName: { ...typography.h2, color: colors.text.primary, letterSpacing: 1 },
  formArea: { alignItems: 'center', gap: spacing.sm },
  title: { ...typography.h3, color: colors.text.primary, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { ...typography.bodySmall, color: colors.text.muted, textAlign: 'center', marginBottom: spacing.md },
  inputGroup: { width: '100%', gap: spacing.xs },
  inputLabel: { ...typography.label, color: colors.text.muted, fontSize: 11 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.bg.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border.subtle, paddingHorizontal: spacing.md, gap: spacing.sm },
  input: { flex: 1, fontSize: 16, color: colors.text.primary, paddingVertical: spacing.sm + 4 },
  errorText: { ...typography.caption, color: colors.status.error, textAlign: 'center' },
  hintText: { ...typography.caption, color: colors.text.muted, textAlign: 'center' },
  loginButton: { width: '100%', borderRadius: radius.md, overflow: 'hidden', marginTop: spacing.sm },
  loginButtonPressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  buttonDisabled: { opacity: 0.5 },
  loginGradient: { paddingVertical: spacing.md, alignItems: 'center' },
  loginButtonText: { ...typography.body, fontWeight: '700', color: colors.text.inverse },
  linkText: { ...typography.caption, color: colors.text.muted, marginTop: spacing.sm },
  linkBold: { color: colors.brand.primary, fontWeight: '600' },
  infoBox: { backgroundColor: '#1E3A5F', borderRadius: radius.md, padding: spacing.md, width: '100%' },
  infoBoxText: { ...typography.bodySmall, color: '#93C5FD', textAlign: 'center' },
  successBox: { backgroundColor: '#14532D', borderRadius: radius.md, padding: spacing.md, width: '100%' },
  successBoxText: { ...typography.bodySmall, color: '#86EFAC', textAlign: 'center' },
  errorBox: { backgroundColor: '#7F1D1D', borderRadius: radius.md, padding: spacing.md, width: '100%' },
  errorBoxText: { ...typography.bodySmall, color: '#FCA5A5', textAlign: 'center' },
});
