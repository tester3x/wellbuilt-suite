import { Linking, Alert, Platform } from 'react-native';
import i18n from '../localization/i18n';

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

export interface ExternalLaunchOptions {
  /** Primary URL/scheme to open */
  url: string;
  /** Fallback web URL if scheme fails */
  webUrl?: string;
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

  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      // Try Android package intent as fallback
      if (Platform.OS === 'android' && androidPackage) {
        const intentUrl = `intent://#Intent;package=${androidPackage};end`;
        const intentSupported = await Linking.canOpenURL(intentUrl);
        if (intentSupported) {
          await Linking.openURL(intentUrl);
          return;
        }
      }
      Alert.alert(
        t('appDetail.launch.notInstalledTitle'),
        t('appDetail.launch.notInstalled', { name }),
        [{ text: t('common.ok') }]
      );
    }
  } catch {
    Alert.alert(
      t('appDetail.launch.launchErrorTitle'),
      t('appDetail.launch.launchError', { name }),
      [{ text: t('common.ok') }]
    );
  }
}

/**
 * Launch an external/BYOA app via URL scheme with web fallback.
 * Shows alert if neither native nor web launch succeeds.
 */
export async function launchExternalApp(options: ExternalLaunchOptions): Promise<void> {
  const { url, webUrl } = options;
  const t = i18n.t.bind(i18n);

  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
      return;
    }
  } catch {
    // Native scheme failed — try web fallback
  }

  // Web fallback
  if (webUrl) {
    try {
      await Linking.openURL(webUrl);
      return;
    } catch {
      // Web fallback also failed
    }
  }

  // Nothing worked — tell the user
  Alert.alert(
    t('common.appNotFound', { defaultValue: 'App Not Found' }),
    t('common.appNotInstalled', { defaultValue: 'This app doesn\'t appear to be installed on your device.' }),
    [{ text: t('common.ok') }]
  );
}
