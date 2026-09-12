# Cross-device completion and account ownership gaps

## Confirmed current behavior

Suite VC38 repairs authenticated company configuration loading. On the ZFold,
MikeS24 now restores authoritative shift `2026-09-12_020000` and receives a
successful server-authorized eQuipment handoff. The second phone still cannot
recognize a Pre-Trip that was completed on the first phone from current storage
alone. That is independent of the original configuration failure.

Suite `dvirGate/dvirReceiptStore.ts` stores completion by shift ID and phase in
local AsyncStorage. `createSuiteDvirGate.ts` reads that local store, including
the separate Pre-Trip evidence check used by End Shift. There is no production
server receipt lookup. `validateReceipt.ts` verifies a SHA-256 corruption check
and the shift, but does not match the receipt's driverHash to the current
authenticated driver. Shift IDs encode a time; they are not globally unique
driver identifiers.

eQuipment `DvirFlow.tsx` queues phase status only after sealing a signed report.
`ShiftDvirStatusQueue.processQueue` has an injectable transport but no production
drain is wired. Existing queue entries contain no company or driver identifier.
Sending all of them under whichever account is currently logged in would be
incorrect. Production full-report cloud sync is separately disabled and its
configuration explicitly isolates the DVIR project from wellbuilt-sync.

eQuipment's governed route grant expires after 30 minutes. Expiration removes
the navigation authorization, not the shift record, signed report or domain
draft. It must never be used to decide that Post-Trip is no longer due. The
active UI draft is a single pointer; domain drafts are separately mirrored by
inspection ID. Recovery must account for both when accounts or shifts change.

The existing Suite signout paths preserve DVIR receipt/pending-end-shift keys
and leave authoritative shifts open. Preserve that behavior. The global local
pending-end-shift key still needs account scoping so another driver's return
flow cannot replace the previous driver's pending navigation.

## Required implementation and verification

1. Keep minimal completion summaries in Firebase, separately from private full
   reports/PDFs. Read and write only through authenticated callables deriving
   company and driver from live canonical authority. Client payloads must not
   select another account. Match the exact owned historical/current shift.
2. Publish only from an actual sealed local report matching the authenticated
   account, never from a bare legacy status queue entry, launch URL, draft,
   expiry, or missing local receipt. Preserve unsent records across logout and
   connectivity loss. Repeated publication must be immutable and idempotent.
3. Reconcile Suite receipts from Firebase for both module entry and End Shift.
   Distinguish an unavailable lookup from a verified absence. Preserve locally
   completed work while offline; do not invent proof for a different account.
4. Migrate local keys to company + canonical driver + exact shift + phase.
   Retain old data. Only adopt a legacy receipt/draft if its ownership can be
   verified; legacy identity fields must not be relabeled as the new account.
5. Test device A completes / device B resumes, reverse account swaps, identical
   timestamp shift IDs across two drivers, old pending Post-Trip, expired
   handoff authorization, offline retry, duplicate receipt and wrong-tenant
   rejection. No live inspection should be signed merely to make a test pass.

The eQuipment retained-route conflict guard is a separate narrow repair on
branch `fix/wbe-account-shift-route-20260912`, code commit `b03757a`. It does not
implement this cross-device pipeline. No new Firebase endpoint or rules change
has been deployed for the gaps documented here. JSA must preserve lingering
post obligations too; JSA is currently disabled in company settings.
