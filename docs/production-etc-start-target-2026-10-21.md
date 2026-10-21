# Production ETC shift-start target

The installed Suite 92 APK has extra.suiteEtc.profile=field-test and
extra.suiteEtc.dispatchEnabled=false. Its account-device-test EAS profile
inherited etc-preview, which sets SUITE_ETC_FIELD_TEST=1. This disables both
native and JavaScript HOS dispatch, even with production ETC installed. Earlier
account/speed acceptance did not verify this independent HOS build target.

Fix: account-device-test inherits preview instead. The explicitly isolated
etc-preview profile stays disabled and unchanged. The production target keeps
its verified package, provider authority and signer. No duty record, protocol,
trust list, or automatic clock adjustment is changed.

A regression resolves actual EAS env inheritance: all normal installed profiles
must select enabled production ETC, and only explicit etc-preview selects the
isolated disabled field target. It failed before the one-line profile fix, then
passed. All 31 ETC start/target cases pass; Suite TypeScript check passes.

A replacement Suite APK is required because the setting is compiled into the
native module as well as Expo configuration. APK target/signature/provider
verification and installation are pending at this checkpoint. Existing stale
requests must remain status-only; do not start or backdate a real duty session
as an incidental result of verification. Any missing actual duty time requires
a separately reviewed correction.
