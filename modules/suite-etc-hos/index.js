let native = null;
try {
  const { requireNativeModule } = require('expo-modules-core');
  native = requireNativeModule('SuiteEtcHos');
} catch {
  native = null;
}

function callProvider(args) {
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
  nativeAvailable: () => !!native,
};
