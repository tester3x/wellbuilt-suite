# Shared shift reference discussion — 2026-10-23

The user proposes one shared, human-readable Shift reference for records made
throughout a shift, including shifts spanning midnight. A calendar date alone
is insufficient. This is a discussed direction, not an implemented feature.

Normal records should expose two primary references: their own ticket/JSA/DVIR
number, and the Shift number they belong to. Internal database identifiers and
idempotent delivery receipts remain necessary and need no extra manual numbers.

Split tickets also need a shared split/load reference. It belongs to the original
physical pickup and groups A, B, C and later-added stops. Adding C keeps that same
reference, and all delivered/disposed amounts count against the original pickup.
A new physical pickup starts a new group. Existing individual ticket numbers remain.

An overall job can span shifts or transfer between drivers. Proposed handling is
to retain each action's original shift association and allow the overall job to
link multiple shifts; do not overwrite the earlier shift when work continues.

Audit observation from the current software-only offline test: the governed JSA
binding carries associatedPeriodId back to Suite, while the invoice had no direct
shift/period field. Some summaries use time-based association. A common Shift
reference would make this relationship explicit. No record identifiers have been
changed as part of this discussion.
