/**
 * App Check bootstrap (Suite security branch). Enforcement not enabled in prod yet.
 * Debug token via EXPO_PUBLIC_WB_APPCHECK_DEBUG_TOKEN only — never commit secrets.
 */
export async function initAppCheckIfConfigured(): Promise<boolean> {
  try {
    const debugToken =
      (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_WB_APPCHECK_DEBUG_TOKEN) || '';
    if (!debugToken) {
      console.log('[AppCheck] Suite: provider deferred until native modules + debug/prod config');
      return false;
    }
    console.log('[AppCheck] Suite: debug config present (token not logged)');
    return true;
  } catch {
    return false;
  }
}
