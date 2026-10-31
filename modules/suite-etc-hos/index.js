let native = null;
function loadNative() {
  if (native) return native;
  try {
    const { requireNativeModule } = require('expo-modules-core');
    native = requireNativeModule('SuiteEtcHos');
  } catch (error) {
    console.warn('[ETC bridge] Native module unavailable:', error instanceof Error ? error.message : 'module load failed');
  }
  return native;
}

function callProvider(args) {
  // Retry resolution after startup; a failed early lookup must not disable
  // every later shift handoff for the lifetime of the JavaScript process.
  loadNative();
  if (!native || typeof native.callProvider !== 'function') {
    return JSON.stringify({ ok: false, reason: 'native_unavailable' });
  }
  // AsyncFunction returns a Promise. A string is tolerated if the native
  // function is still synchronous. Callers must await this.
  return native.callProvider(
    args.method,
    args.payload,
    args.expectedPackage || '',
    args.expectedCertSha256 || '',
    !!args.activityVisible,
  );
}

module.exports = {
  callProvider,
  nativeAvailable: () => !!loadNative(),
};
