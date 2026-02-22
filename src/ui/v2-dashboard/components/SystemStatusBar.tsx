import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, typography } from '@/core/theme';
import { isOnline, onConnectivityChange } from '@/core/services/connectivity';

export function SystemStatusBar() {
  const { t } = useTranslation();
  const [online, setOnline] = useState(isOnline());
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  useEffect(() => {
    const unsub = onConnectivityChange((nowOnline) => {
      setOnline(nowOnline);
    });
    return unsub;
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.item}>
        <MaterialCommunityIcons
          name="server"
          size={12}
          color={online ? colors.status.online : colors.status.error}
        />
        <Text style={styles.text}>{online ? 'Firebase OK' : 'Offline'}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.item}>
        <MaterialCommunityIcons name="clock-outline" size={12} color={colors.text.muted} />
        <Text style={styles.text}>{timeStr}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.item}>
        <Text style={styles.text}>{t('home.footer.version')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: spacing.md, gap: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  divider: { width: 1, height: 10, backgroundColor: colors.border.subtle },
  text: { ...typography.caption, color: colors.text.muted, fontSize: 10 },
});
