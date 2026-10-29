# Unfinished WB T job at End Shift

Source-only companion to Dashboard `5fdec5e5` and WB T `d0c5c0db`. No APK build/install or backend deployment. No shift, DVIR, ticket or real job changed.

Incident evidence: shift close7:05 PM America/Chicago, unfinished split A finally closed7:56 PM. The enforced authoritative close endpoint previously checked period ownership but not unfinished ticket work. Dashboard source now blocks that transaction before logout/authority/odometer writes when the authenticated driver has real open invoice work or an in-progress/paused dispatch; queued dispatches alone do not block.

WB S now explains `unfinished_ticket_jobs` with Finish your WB T job first and directs the driver back to resolve the delivery/load. Failed close already retains active local shift state and avoids JSA/ETC finalization. This patch does not add an automatic cancellation, auto-close a job, restart a shift or claim legacy direct-write shift policy is newly verified.

Validation:18 existing actual explicit-shift lifecycle tests passed and TypeScript noEmit passed. The backend companion has90 passing focused tests. Native end-shift behavior remains pending backend deployment and a separately authorized local release/test. Pre-existing generated `ssoProtocol.generated.ts` working-tree state was left untouched and excluded.

## Authorized S102 build checkpoint

Local build completed from `060c9da` with the original Suite signing certificate, profile preview, version102/1.0.0. APK `C:/dev/lb/mvsv8te2-060c9da/com.wellbuilt.suite-vc102.apk`, SHA256 `ef0d32bc3920cf61dc5b52f0baffcad328772416edd66e00cb9c24a997d9d90a`, certificate SHA256 `a7d1b6fb35c848239ccdc52e0e1c36be9a96b0786ff5628fa9b98bae80fa6aa6`. Shared laptop runner checkpoint `cb08a48` was freshly verified; exact committed source export is allowed by this app's build policy. Source and native version injection agree. Read-only EAS allocation101 and S24-installed101 were checked; immutable `android-release-v102` reserved before build. All25 remote heads fetched; master is ancestor, historical divergent lanes were reviewed against S101's already-tested equivalent handoff/lifecycle implementation and preserved. No new other-machine update appeared; unpushed work cannot be discovered. Full delta from S101 source `deea301` reviewed. The previously flagged generated SSO file had zero semantic diff; refreshing its index cleared the stale modified status without a source change.

18 lifecycle tests and TypeScript passed again. APK hash, signer and embedded unfinished-job alert verified. Backend5fdec5e5 is now deployed and byte-verified. Native S24 acceptance and ZFold rollout are still pending; this is a build checkpoint, not an installation/pass claim. Private receipt `C:/dev/tmp/s102-apk-receipt-private.json`, build log `s102-local-build-private.log`.

## S24 acceptance and corrected S103

S102's native close attempt kept the authoritative open shift pointer unchanged but showed only the generic retry message: shiftAuthorityClient's reason-token allowlist omittedunfinished_ticket_jobs. S102 is therefore not approved for rollout. Source3f365e9 adds that reason at the actual Firebase error boundary;44 callable/lifecycle regressions and TypeScript pass. Do not rely only on stubbing the later close result to test server refusals.

Locally built S103 from3f365e9, preview/arm64, using the same signer. Artifact C:/dev/lb/mvsx3q8e-3f365e9/com.wellbuilt.suite-vc103.apk; SHA256ea2de8cee3840cd1e92f6278eeb49c167f4381e88d2ab436a1e44397c75cd1d2. Read-only EAS counter remains101; S24 installed floor102 was separately accounted for; immutableandroid-release-v103 reserved. Fetched25 heads, only this active lane moved, master remains ancestor; full S102..S103 delta is token/test/version. No cloud build.

S103 installed S24 with independently matching installed base.apk hash/version103. User completed/signed actual pre-trip and post-trip. Native End Shift showsFinish your WB T job first while the isolated unfinished software split exists. Authoritative driver_shift_authority document is byte-equivalent before/after refusal (same openPeriodId and version); no close/log-out committed. Positive close after fixture cleanup and ZFold rollout remain pending. Private screenshots and server proofs stay underC:/dev/tmp. Evidence docs are not embedded in the earlier APK.

## Final S104 recovery acceptance and paired rollout

S103 was held after native recovery exposed a stuck Ending Shift button: ShiftArrivalModal never released busy after an onConfirm refusal when retained error/odometer props stayed unchanged. S104 source96fcbfa returns explicit close outcomes from ActionCardRow and releases busy on refusal/exception while keeping successful close guarded until parent dismissal. The actual modal handler runtime proves repeated identical refusals recover, concurrent taps are blocked and success stays guarded;44 callable/lifecycle tests and TypeScript pass.

All25 GitHub heads fetched/reconciled; only active branch moved, master remains ancestor; full S103..S104 delta reviewed. Read-only EAS counter101 and installed/local reservation103 recorded separately; immutableandroid-release-v104. Exact committed source exported by verified shared runner. Original signer, preview/arm64, no cloud build. Artifact C:/dev/lb/mvsytzno-96fcbfa/com.wellbuilt.suite-vc104.apk; SHA2562b85a18921f5d2893429a812187d63f3467d64aefe9cd4429f71b6a71ed53b4c; receipt beside APK.

Native S24: two End Shift attempts with unfinished software C each showedFinish your WB T job first, kept authority unchanged and returned enabled End Shift (no stuck busy). Then exact isolated test C was administratively cancelled, no real ticket/delivery created. The next End Shift succeeded WITHOUT restarting Suite, cleared authority open pointer, set lastClosedPeriodId to the correct period and advanced version once. Shift Complete appeared with genuine user-signed pre/post-trip evidence. Only the test fixture was changed; this is not a route for real last-split water cancellation.

Same tested S104 and WB T282 installed ZFold after S24 acceptance. Both phones' installed base.apk hashes/version independently match artifacts. ZFold Suite opens normally at Start Shift; WB T retains7queued jobs with no job action taken. WB E queued signature spacing/PDF copy source is not in these APKs; no handoff speed improvement claimed. Private native proofs/screenshots/receipts underC:/dev/tmp. Final documentation commits are not in the APK snapshot.
