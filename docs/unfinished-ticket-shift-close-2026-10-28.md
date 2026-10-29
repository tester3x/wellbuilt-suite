# Unfinished WB T job at End Shift

Source-only companion to Dashboard `5fdec5e5` and WB T `d0c5c0db`. No APK build/install or backend deployment. No shift, DVIR, ticket or real job changed.

Incident evidence: shift close7:05 PM America/Chicago, unfinished split A finally closed7:56 PM. The enforced authoritative close endpoint previously checked period ownership but not unfinished ticket work. Dashboard source now blocks that transaction before logout/authority/odometer writes when the authenticated driver has real open invoice work or an in-progress/paused dispatch; queued dispatches alone do not block.

WB S now explains `unfinished_ticket_jobs` with Finish your WB T job first and directs the driver back to resolve the delivery/load. Failed close already retains active local shift state and avoids JSA/ETC finalization. This patch does not add an automatic cancellation, auto-close a job, restart a shift or claim legacy direct-write shift policy is newly verified.

Validation:18 existing actual explicit-shift lifecycle tests passed and TypeScript noEmit passed. The backend companion has90 passing focused tests. Native end-shift behavior remains pending backend deployment and a separately authorized local release/test. Pre-existing generated `ssoProtocol.generated.ts` working-tree state was left untouched and excluded.
