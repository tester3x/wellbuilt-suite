# Current equipment receipts within a driver shift

Branch codex/suite-equipment-entry-20261012; base f040b02. User requested breakdown and replacement inspections without ending the driver shift. Existing uncommitted src/core/services/ssoProtocol.generated.ts remains untouched and excluded.

Production pre/post gate checks now validate cached receipts against the canonical driver's current server DVIR pair. A prior truck post-trip cannot satisfy the replacement truck. The read-only resolveDriverDvirStatus request supplies expected canonical owner guards, never establishes identity from a deep link, and requires exact period, inspection and completion timestamp agreement. Unverifiable current equipment completion is not treated as complete; offline equipment reporting remains local in WB e and does not end a driver shift.

A verified, newer receipt for a different equipment inspection can replace that phase's current receipt, with the earlier receipt archived first. An unverified URL cannot replace it; replaying an older truck receipt cannot roll it back. Archive write failure preserves the old receipt and leaves the new one retryable. This updates current completion evidence only: Mark Arrived/final mileage and driver confirmation still own ending the shift. No automatic shift-close action is added.

Validation: 95 DVIR gate tests pass, including the four new current-cycle receipt checks, original arrival state transitions and pending-end controls. Full TypeScript check passes. Companion Equipment tests pass 727 and backend ledger tests pass 11.

Local build / S24 acceptance / ZFold rollout pending. No real shift, equipment assignment or signed inspection was changed in this source work.

## Local Suite 100 / S24 checkpoint

Local APK built from exact 185465f commit using a separate detached clean source worktree; the original generated-file working-copy modification remains untouched. Preview profile; remote 99 checked and 100 reserved. APK SHA256 c24e2dd606d763f5936fbf36c776741b75f4faf9d3e2f493bf011439c66af22e; existing Suite signer a7d1b6fb35c848239ccdc52e0e1c36be9a96b0786ff5628fa9b98bae80fa6aa6 matches the approved baseline. S24 replace-install succeeded and package manager confirms 100. No cloud build.

Actual S24 Home remains signed in with Start Shift available. Its Equipment button now opens Equipment Home through E98's compatible verified bridge. Both Equipment breakdown-post-trip and replacement-pre-trip setup screens are reachable while off shift. No shift start, close, return, mileage or inspection-signature action was performed by the agent. Full signed multi-vehicle acceptance remains represented by automated domain/gate/server tests until the user finishes the requested S24 inspection/signature. ZFold is not connected and no rollout has occurred.

## ZFold rollout acceptance

The user completed and signed S24's equipment pre-trip; Home card and the signed report were physically verified with post-trip still due. Installed the tested Suite 100 alongside Equipment 98 and WB T274 on ZFold with replace-install; package manager confirms the versions. Actual WB T general Equipment and Breakdown handoffs reach Equipment Home and Shop respectively; existing open vehicle pre-trip remains visible. No driver-shift or inspection completion operation was submitted by the agent.

First ZFold attempt returned functions/deadline-exceeded in Suite. A retry left Equipment opening; restarting only Equipment recovered fresh handoff. Later ordinary and Breakdown handoffs succeeded without another restart. This is recorded as a timeout/retry limitation, not a fixed issue. Detailed evidence is in Equipment docs/equipment-breakdown-cycles-2026-10-27.md. Existing unrelated generated protocol working-copy modification is preserved.
