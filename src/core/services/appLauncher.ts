import { Linking, Alert, Platform } from 'react-native';
import i18n from '../localization/i18n';

export interface WBAppLaunchOptions {
  /** App display name (for error messages) */
  name: string;
  /** Deep link scheme (e.g. "wellbuiltmobile") */
  scheme?: string;
  /** Android package name for intent fallback */
  androidPackage?: string;
  /** SSO params — auto-injected by useAppLauncher hook when driver is logged in */
  sso?: {
    hash: string;
    name: string;
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
  const { name, scheme, androidPackage, sso } = options;
  const t = i18n.t.bind(i18n);

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
    const params = new URLSearchParams({ hash: sso.hash, name: sso.name });
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
 */
export async function launchExternalApp(options: ExternalLaunchOptions): Promise<void> {
  const { url, webUrl } = options;

  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else if (webUrl) {
      await Linking.openURL(webUrl);
    }
  } catch {
    if (webUrl) {
      await Linking.openURL(webUrl);
    }
  }
}
