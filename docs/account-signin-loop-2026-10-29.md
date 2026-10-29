FIRST: Read D:/dev/workspace-control/POLICY.md in full before taking action. Then read the assigned repository's applicable AGENTS.md and CLAUDE.md. Follow the current user-authorized workspace policy over obsolete task notes.

# Shared account sign-in recovery

Mike explicitly authorized registration of the existing laptop Suite checkout and repair of the sign-in loop. Actual session: `01a139b5-d3f7-7401-bdf0-3443ec841c28`. Registered home: `C:/dev/TicketTimeExpo/tmp/suite-equipment-entry-20261012`; common Git directory `C:/dev/wellbuilt-suite/.git`; remote `https://github.com/tester3x/wellbuilt-suite.git`; branch `codex/suite-equipment-entry-20261012`. Clean starting HEAD `677476dc07d4ee337f6883b9c4621c0db9d3e561`, freshly fetched and equal to its upstream. Registry accepted baseline preserves that exact ancestry. Commit/push guard hooks installed without replacing existing hooks. No checkout created, reset, force push, or unrelated cleanup. CLAUDE.md/retirement registries were absent at this home.

## Failure and repair

During S24 JSA102 setup, its ordinary Sign Out also signed out the shared WB account. Suite104 then displayed Signed out of WellBuilt. Retry repeated the same restoration check. Sign in briefly displayed login before foreground/account/connectivity checks covered it again with the signed-out overlay. No ADB input caused Mike's reported bounce.

The common AccountGate lacked a distinct interactive-sign-in state. It now keeps login visible across signed-out background checks and invalidates results from attempts started before the Sign in action. A real access denial or other failure still blocks normally. Signed-out state offers Sign in instead of the futile Retry; transport-error recovery retains Retry. Authentication, account ownership and grants remain enforced. Saved shifts, signed inspections and reports are untouched.

S109 device acceptance caught a second problem: login was visible but its auth startup was waiting on the gate's readiness context, leaving a blank screen. That context releases local session initialization; it is not authentication authority. Interactive sign-in now releases it after local sign-out completes. The new regression executes the actual AuthProvider startup effect, verifies loading finishes with no local session, and verifies no authenticated identity is fabricated.

The existing Suite gate was verified byte-equivalent to JSA's pre-repair gate before integrating the tested common repair from JSA commit `77dbd21`. Added the actual gate-component test under `tools/test-accountGateSignIn.cjs`; native/React boundaries are mocked, not the gate implementation. AGENTS.md records the newly authorized registered home and current in-place workflow.

## Validation and limitations

- Gate regressions: 3 passed. Cover repeated foreground, account-change and reconnect events during login; late signed-out failure; actual AuthProvider startup during login; access-denied blocking; no futile signed-out Retry.
- `npx tsc --noEmit`: passed.
- Broader `npm run test:auth-core`: 125 passed after correcting its stale optional-await source assertion; its credential-free security checks remain intact.
- `tools/test-platformDirectEntry.mjs`: passed after adding the missing appAccess boundary mock. DVIR gate: 95 passed. ETC profile: 6 passed. Local runner: 2 passed.
- Whitespace check passed. Private phone captures and diagnostics remain outside Git.

Mike subsequently authorized a local build. S105–108 reservations are consumed by failed local build attempts (Windows native output paths / generated-file cleanliness); none installed. S109 built and installed on S24 but failed acceptance with the blank login described above. Its source is `f451ae0c44ae03b3d7a17517aacb78263b5311ad`, APK SHA-256 `fabad2a52981c525d75507b9437b7873490b81cb2a5e536e01d40db57ddadd6f`, signing SHA-256 `a7d1b6fb35c848239ccdc52e0e1c36be9a96b0786ff5628fa9b98bae80fa6aa6`. APK: `C:/dev/release-artifacts/suite-109-f451ae0/com.wellbuilt.suite-vc109.apk`. S110 is the next intended reservation, subject to a fresh remote evidence check. No ZFold rollout, cloud build, production deployment or migration. Preserve existing test shift/pre-trip. Driver performs genuine attestations.

After committing/pushing and verifying the clean remote checkpoint, release this local claim. Existing WB e and JSA lanes retain their separate unfinished release/testing tasks.
