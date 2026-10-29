FIRST: Read D:/dev/workspace-control/POLICY.md in full before taking action. Then read the assigned repository's applicable AGENTS.md and CLAUDE.md. Follow the current user-authorized workspace policy over obsolete task notes.

# Shared account sign-in recovery

Mike explicitly authorized registration of the existing laptop Suite checkout and repair of the sign-in loop. Actual session: `01a139b5-d3f7-7401-bdf0-3443ec841c28`. Registered home: `C:/dev/TicketTimeExpo/tmp/suite-equipment-entry-20261012`; common Git directory `C:/dev/wellbuilt-suite/.git`; remote `https://github.com/tester3x/wellbuilt-suite.git`; branch `codex/suite-equipment-entry-20261012`. Clean starting HEAD `677476dc07d4ee337f6883b9c4621c0db9d3e561`, freshly fetched and equal to its upstream. Registry accepted baseline preserves that exact ancestry. Commit/push guard hooks installed without replacing existing hooks. No checkout created, reset, force push, or unrelated cleanup. CLAUDE.md/retirement registries were absent at this home.

## Failure and repair

During S24 JSA102 setup, its ordinary Sign Out also signed out the shared WB account. Suite104 then displayed Signed out of WellBuilt. Retry repeated the same restoration check. Sign in briefly displayed login before foreground/account/connectivity checks covered it again with the signed-out overlay. No ADB input caused Mike's reported bounce.

The common AccountGate lacked a distinct interactive-sign-in state. It now keeps login visible across signed-out background checks, invalidates results from attempts started before the Sign in action, and does not publish account readiness until actual account restoration succeeds. A real access denial or other failure still blocks normally. Signed-out state offers Sign in instead of the futile Retry; transport-error recovery retains Retry. Authentication, account ownership and grants remain enforced. Saved shifts, signed inspections and reports are untouched.

The existing Suite gate was verified byte-equivalent to JSA's pre-repair gate before integrating the tested common repair from JSA commit `77dbd21`. Added the actual gate-component test under `tools/test-accountGateSignIn.cjs`; native/React boundaries are mocked, not the gate implementation. AGENTS.md records the newly authorized registered home and current in-place workflow.

## Validation and limitations

- Gate regressions: 2 passed. Cover repeated foreground, account-change and reconnect events during login; late signed-out failure; readiness only after successful restore; access-denied blocking; no futile signed-out Retry.
- `npx tsc --noEmit`: passed.
- Broader `npm run test:auth-core`: 124 passed, 1 failed. Its unchanged ssoLaunchPolicy source-text assertion expects `return await launchWBApp` while the unchanged hook uses `return launchWBApp`; that test does not load AccountGate.
- Existing `tools/test-platformDirectEntry.mjs` cannot run its hook fixture because its mocks omit `../../../modules/wellbuilt-platform/appAccess`, imported by the unchanged hook. No tests were weakened or skipped to report a green broad suite. These two pre-existing harness issues remain for the next release validation pass.
- Whitespace check passed. Private phone captures and diagnostics remain outside Git.

Source repair only: no APK, version allocation, install, production deployment or migration. The S24 still has Suite104 and remains blocked by the installed gate until an explicitly authorized local build is installed and verified. Existing test shift/pre-trip must be preserved; do not create another shift to recover sign-in. Reconcile desktop/laptop source and immutable version reservations before building. Test sign-out → Sign in, foreground/reconnect during login, then the original Tickets-bound JSA request on S24 before any ZFold rollout. Driver performs genuine attestations.

After committing/pushing and verifying the clean remote checkpoint, release this local claim. Existing WB e and JSA lanes retain their separate unfinished release/testing tasks.
