import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, spacing, radius, typography } from '@/core/theme';

interface WellBuiltLogoProps {
  size?: 'small' | 'large';
}

export function WellBuiltLogo({ size = 'small' }: WellBuiltLogoProps) {
  const { t } = useTranslation();
  const isLarge = size === 'large';

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, isLarge && styles.iconWrapLarge]}>
        <Image
          source={require('../../../assets/wellbuilt-logo.png')}
          style={[styles.logoImage, isLarge && styles.logoImageLarge]}
          resizeMode="contain"
        />
      </View>
      <View>
        <Text style={[styles.title, isLarge && styles.titleLarge]}>
          {t('companySelect.brand')}
        </Text>
        <Text style={[styles.subtitle, isLarge && styles.subtitleLarge]}>
          {t('companySelect.suite')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  iconWrap: {
    width: 40, height: 40, borderRadius: radius.md,
    backgroundColor: colors.brand.glow, justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: colors.border.active,
  },
  iconWrapLarge: { width: 60, height: 60, borderRadius: radius.lg },
  logoImage: { width: 28, height: 28 },
  logoImageLarge: { width: 40, height: 40 },
  title: { fontSize: 20, fontWeight: '700', color: colors.text.primary, letterSpacing: -0.3 },
  titleLarge: { fontSize: 32, letterSpacing: -0.5 },
  subtitle: { ...typography.label, color: colors.brand.primary, fontSize: 10, letterSpacing: 3, marginTop: -2 },
  subtitleLarge: { fontSize: 13, letterSpacing: 5, marginTop: -1 },
});
