import { Linking, Alert, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import i18n from '../localization/i18n';

const SSO_APPS_KEY = 'ssoLaunchedApps';

/**
 * Track which apps were SSO'd into this session.
 * On logout, WB S only deep-link-cascades to these apps.
 */
async function trackSSOApp(scheme: string): Promise<void> {
  try {
    const existing = await SecureStore.getItemAsync(SSO_APPS_KEY);
    const apps: string[] = existing ? JSON.parse(existing) : [];
    if (!apps.includes(scheme)) {
      apps.push(scheme);
      await SecureStore.setItemAsync(SSO_APPS_KEY, JSON.stringify(apps));
    }
  } catch {}
}

/**
 * Get list of apps that were SSO'd into this session.
 */
export async function getSSOLaunchedApps(): Promise<string[]> {
  try {
    const data = await SecureStore.getItemAsync(SSO_APPS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Clear SSO tracking (called on new login).
 */
export async function clearSSOLaunchedApps(): Promise<void> {
  await SecureStore.deleteItemAsync(SSO_APPS_KEY);
}

/**
 * Send logout deep links to all apps that were SSO'd into this session.
 * Each target app checks its own authMethod — only SSO sessions will auto-logout.
 */
export async function cascadeLogoutToSSOApps(): Promise<void> {
  const apps = await getSSOLaunchedApps();
  for (const scheme of apps) {
    try {
      await Linking.openURL(`${scheme}://logout`);
    } catch {
      // App not installed or can't be opened — RTDB signal is the backup
    }
  }
  await clearSSOLaunchedApps();
}

export interface WBAppLaunchOptions {
  /** App display name (for error messages) */
  name: string;
  /** Deep link scheme (e.g. "wellbuiltmobile") */
  scheme?: string;
  /** Android package name for intent fallback */
  androidPackage?: string;
  /** Web URL for browser-based apps (opens in browser instead of deep link) */
  webUrl?: string;
  /** SSO params — auto-injected by useAppLauncher hook when driver is logged in */
  sso?: {
    hash: string;
    name: string;
    companyId?: string;
  };
}


/**
 * Check if an app can be launched via its deep link scheme.
 */
export async function canLaunchApp(scheme?: string): Promise<boolean> {
  if (!scheme) return false;
  try {
    return await Linking.canOpenURL(`${scheme}://`);
  } catch {
    return false;
  }
}

/**
 * Launch a WellBuilt ecosystem app via deep link with Android intent fallback.
 */
export async function launchWBApp(options: WBAppLaunchOptions): Promise<void> {
  const { name, scheme, androidPackage, webUrl, sso } = options;
  const t = i18n.t.bind(i18n);

  // Web apps open in the browser
  if (!scheme && webUrl) {
    try { await Linking.openURL(webUrl); } catch {
      Alert.alert(name, t('appDetail.launch.launchError', { name }), [{ text: t('common.ok') }]);
    }
    return;
  }

  if (!scheme) {
    Alert.alert(
      name,
      t('appDetail.launch.notConfigured', { name }),
      [{ text: t('common.ok') }]
    );
    return;
  }

  // Build deep link URL with optional SSO params so the target app
  // can skip its own login screen when launched from WB Suite.
  let url = `${scheme}://`;
  if (sso) {
    const paramObj: Record<string, string> = { hash: sso.hash, name: sso.name };
    if (sso.companyId) paramObj.companyId = sso.companyId;
    const params = new URLSearchParams(paramObj);
    url = `${scheme}://login?${params.toString()}`;
  }

  // Try opening directly — canOpenURL is unreliable on Android 11+
  try {
    await Linking.openURL(url);
    // Track this app as SSO'd so cascade logout knows to deep link it
    if (sso) await trackSSOApp(scheme);
    return;
  } catch {
    // Deep link failed — try Android intent fallback
  }

  if (Platform.OS === 'android' && androidPackage) {
    try {
      const intentUrl = `intent://#Intent;package=${androidPackage};end`;
      await Linking.openURL(intentUrl);
      if (sso) await trackSSOApp(scheme);
      return;
    } catch {
      // Intent also failed
    }
  }

  Alert.alert(
    t('appDetail.launch.notInstalledTitle'),
    t('appDetail.launch.notInstalled', { name }),
    [{ text: t('common.ok') }]
  );
}
