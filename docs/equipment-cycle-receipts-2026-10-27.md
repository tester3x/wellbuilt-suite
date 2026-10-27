# Current equipment receipts within a driver shift

Branch codex/suite-equipment-entry-20261012; base f040b02. User requested breakdown and replacement inspections without ending the driver shift. Existing uncommitted src/core/services/ssoProtocol.generated.ts remains untouched and excluded.

Production pre/post gate checks now validate cached receipts against the canonical driver's current server DVIR pair. A prior truck post-trip cannot satisfy the replacement truck. The read-only resolveDriverDvirStatus request supplies expected canonical owner guards, never establishes identity from a deep link, and requires exact period, inspection and completion timestamp agreement. Unverifiable current equipment completion is not treated as complete; offline equipment reporting remains local in WB e and does not end a driver shift.

A verified, newer receipt for a different equipment inspection can replace that phase's current receipt, with the earlier receipt archived first. An unverified URL cannot replace it; replaying an older truck receipt cannot roll it back. Archive write failure preserves the old receipt and leaves the new one retryable. This updates current completion evidence only: Mark Arrived/final mileage and driver confirmation still own ending the shift. No automatic shift-close action is added.

Validation: 95 DVIR gate tests pass, including the four new current-cycle receipt checks, original arrival state transitions and pending-end controls. Full TypeScript check passes. Companion Equipment tests pass 727 and backend ledger tests pass 11.

Local build / S24 acceptance / ZFold rollout pending. No real shift, equipment assignment or signed inspection was changed in this source work.
