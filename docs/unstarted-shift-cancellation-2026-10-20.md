# Unstarted shift cancellation

Branch: `codex/suite-equipment-entry-20261012`.

Adds an explicit, authenticated cancellation path under the missing Pre-Trip
recovery button. The driver supplies a reason and confirms no inspection,
driving, or work was performed. It does not call normal End Shift, submit a
DVIR, manufacture a signature, or end an HOS work record.

Local inspection receipts block cancellation. Any existing HOS request must be
atomically cancelled/confirmed not started by ETC's existing signed provider;
processing, started, unknown, mismatched, or corrupt state blocks cancellation.
The backend independently checks current ownership, shift history, inspection
ledger, and JSA evidence in its transaction. Original start evidence goes to
an immutable cancellation record; the operational timeline contains a distinct
`shift_cancelled` event, so the unworked test does not accrue phantom time.
The account remains signed in. Only a verified server acknowledgement permits
Suite to refresh authoritative shift state.

Validation before build: 16 focused client tests pass; TypeScript and Android
export pass. Broader shift authority suite: 212/214 pass; two existing source
assertions expect `mayUseDateFallback` in unchanged `app/day-summary.tsx`.
Backend companion has 17 focused tests. Deployment/device verification pending.

No TicketTime laptop source or ZFold work records changed. Existing generated
SSO protocol line-ending-only status is outside this change.
