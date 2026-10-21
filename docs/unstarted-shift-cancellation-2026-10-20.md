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
Backend companion has 17 focused tests. Existing DVIR gate suite also passes
all 91 tests. Both backend callables are deployed; Suite 90 build
`30143d10-ee1c-4d96-b0a7-eddd11b42b93` uses runtime source `5498834`.
Device cancellation verification pending build completion.

Suite 90 was installed on the S24 and correctly retained the shift when HOS
could not be verified. Investigation found `account-device-test` inherits
`etc-preview` with `SUITE_ETC_FIELD_TEST=1`, disabling native HOS dispatch while
still retaining an outbox request. ETC's production provider had never received
that request. Do not treat an unverified request as proof that work occurred.

Follow-up build uses `device-preview` (production provider identity, ARM64),
not the intentionally disabled HOS test target. The companion ETC 120 change
can retire a never-dispatched request only after its native authority confirms
HOS is off. Suite adds safe refusal/status diagnostics and accurate copy when
the HOS state remains unverified. Actual cancellation remains pending until
these builds are installed and the signed provider confirms the unused request.

No TicketTime laptop source or ZFold work records changed. Existing generated
SSO protocol line-ending-only status is outside this change.
