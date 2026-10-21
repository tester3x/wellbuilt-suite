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


## Built and installed

Suite 93: EAS e0070957-eeae-4144-ad07-04b3a0abd719, runtime source
c0e0ce6d98d715eedae96b295f410d461f89e159. APK SHA-256:
68d4c0fe6fcaba3ef9e23a5be90850bc6ec58a2366f5fad2e3cd4dfbb37ba6b3.
The downloaded APK has production profile, enabled dispatch, production package
and authority, and the expected ETC signer pin. The cloud native-profile hook
also emitted enabled production configuration. APK cryptographic signature,
package/version, ARM64 ABI and shared-account provider are verified. Production
ETC 119 signer matches the pin; its compiled trusted-caller array accepts the
actual Suite signer. Previous Suite 90 APK also carried the disabled target.

Suite 93 was installed with adb install -r on S24 and ZFold. Package version 93
was confirmed on each. No app was launched by validation, no session was started
or ended, no duty time was backdated, and no active customer ticket was changed.
No ETC APK or backend deployment was necessary. A future fresh shift-start
remains the device acceptance of actual HOS activation; APK/config verification
and the 31 protocol/target tests do not claim that runtime event already occurred.
The existing stale-start rule is retained: reopening reconciles the same request
and cannot manufacture an hours-old start as part of this installation.
