# Shift authority cold-start timeout — 2026-10-16

ZFold Suite vc71 displayed Could not start shift / callable unavailable. Device diagnostics at 08:21:57 CDT show resolve.invoke followed by refusal after 15 seconds, without claim.outcome or claim.error. Live resolveActiveDriverShift request at 13:21:58.929699Z returned HTTP 200 after 25.614200943 seconds; instance startup began 13:21:58.972802Z and startup probe succeeded 13:22:23.887185Z. A second resolve succeeded and returned none. Thus the initial read-only resolve exceeded the 15-second client budget during service cold start; it never progressed to shift creation. No manual shift creation or authority changes performed.

Client timeout raised to 60 seconds, covering cold-start time before handler execution. Server timeout/configuration unchanged; no minimum-instance cost or automatic mutation retry added. Identity, exact payload, server authority, generation gates and single-flight guards unchanged.

Validation: shiftAuthorityClient and explicitShiftLifecycle tests 20/20 pass, including simulated observed latency and one resolve/one claim transport invocation. TypeScript has existing AppSwitcher/SignaturePad diagnostics; this change adds no diagnostics in changed files. Source only: not built/installed/deployed. ZFold remains Suite vc71. A fresh driver retry was requested while checking logs; live start acceptance is pending.

Live retry verified: driver retry resolved none at 08:24:55 CDT, then claim.outcome claimed=1 at 08:24:56.567 CDT. Corresponding authenticated live requests returned HTTP 200 (resolve 0.1608s, claim 0.8965s). Existing installed Suite successfully started the shift once warm. Timeout source change still awaits APK delivery.
