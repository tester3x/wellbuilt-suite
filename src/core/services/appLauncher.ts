const {checkAppAccess}=require('../../../modules/wellbuilt-platform/appAccess');
import {PLATFORM_APP_OPEN_HOST,buildPlatformAppEntryUrl} from './platformRuntime.generated';
import { isEquipmentAppTarget, equipmentAppEntryUrl } from './equipmentAppAccessCore';
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
 *
 * Cascade logout policy (4/27/2026): WB S is the global logout authority
 * for the matching driverHash. The hash is forwarded in the URL query so
 * target apps (WB T / WB JSA / WB eW) verify same-driver before honoring
 * the signal. Manual sessions on a different driver are not affected.
 * Targets that don't yet read the hash fall through to their existing
 * accept-on-arrival behavior.
 */
export async function cascadeLogoutToSSOApps(driverHash?: string): Promise<void> {
  const apps = await getSSOLaunchedApps();
  const qs = driverHash ? `?hash=${encodeURIComponent(driverHash)}` : '';
  for (const scheme of apps) {
    try {
      await Linking.openURL(`${scheme}://logout${qs}`);
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
  /**
   * Credential-free start route (vc51.9J). When set, the app is opened
   * at `scheme://startHost` carrying nothing at all — used for WB-T,
   * which mints its own PKCE attempt instead of receiving credentials.
   * Ignored when `sso` is present; the two are mutually exclusive.
   */
  startHost?: string;
  /** Noncredential owner hint used only to select a matching established app session. */
  equipmentEntryOwner?: {driverId: string; companyId: string};
  entryOwner?: {driverId: string;companyId:string};
  /** SSO params — auto-injected by useAppLauncher hook when driver is logged in */
  sso?: {
    hash: string;
    name: string;
    companyId?: string;
    truck?: string;
    trailer?: string;
    packageId?: string;
    shiftStartTime?: string;
    /** Active shiftId. Scopes the JSA in WB T / WB JSA so each shift has its own JSA. */
    shiftId?: string;
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
  const { name, scheme, androidPackage, webUrl, sso, startHost } = options;
  const t = i18n.t.bind(i18n);
  // The same cached app list protects cards, detail pages and shared actions.
  // Read again at tap time so a logout/account change cannot use a stale hook.
  try {
    if(await checkAppAccess({scheme,androidPackage})===false){
      Alert.alert('App access unavailable','This app is not included in your WellBuilt account.');
      return;
    }
  } catch {
    Alert.alert('App access unavailable','Could not read your saved account. Return to Suite and retry.');
    return;
  }
  if (isEquipmentAppTarget(scheme, androidPackage)) {
    try {
      await Linking.openURL(equipmentAppEntryUrl(options.entryOwner||options.equipmentEntryOwner));
      await trackSSOApp('wbequipment');
      return;
    } catch {
      if (Platform.OS === 'android') {
        try {
          const entry = equipmentAppEntryUrl(options.entryOwner||options.equipmentEntryOwner).replace('wbequipment://','intent://');
          await Linking.openURL(entry+'#Intent;scheme=wbequipment;package=com.wellbuilt.equipment;end');
          await trackSSOApp('wbequipment');
          return;
        } catch {}
      }
      Alert.alert(name, t('appDetail.launch.notInstalled', { name }), [{ text: t('common.ok') }]);
      return;
    }
  }

  if(startHost===PLATFORM_APP_OPEN_HOST && !sso){
    const entry=buildPlatformAppEntryUrl({scheme,androidPackage},options.entryOwner);
    if(entry){
      try{await Linking.openURL(entry);if(scheme)await trackSSOApp(scheme);return;}
      catch{Alert.alert(name,t('appDetail.launch.notInstalled',{name}),[{text:t('common.ok')}]);return;}
    }
  }

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
  // A start route carries no parameters by design — nothing to encode.
  let url = startHost ? `${scheme}://${startHost}` : `${scheme}://`;
  if (sso) {
    const paramObj: Record<string, string> = { hash: sso.hash, name: sso.name };
    if (sso.companyId) paramObj.companyId = sso.companyId;
    if (sso.truck) paramObj.truck = sso.truck;
    if (sso.trailer) paramObj.trailer = sso.trailer;
    if (sso.packageId) paramObj.packageId = sso.packageId;
    if (sso.shiftStartTime) paramObj.shiftStartTime = sso.shiftStartTime;
    if (sso.shiftId) paramObj.shiftId = sso.shiftId;
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
