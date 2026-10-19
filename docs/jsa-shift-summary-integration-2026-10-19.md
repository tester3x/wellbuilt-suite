# Suite shift-based JSA summary integration - 2026-10-19

Source only: no APK built/installed. Uses new jsaShiftSummary callable with canonical SDK auth. Preserves exact shiftId from shift events, falls back to the retained finalized DVIR shift ID after active storage clears, and permits the server to select its canonical last closed shift only when no explicit scope is available. No calendar date is sent as a JSA scope.

The JSA section independently checks signed full reads, later acknowledgements, jobs with evidence, once-per-shift coverage, JSA numbers, first-read timestamp and finalized context metadata. It says Recorded rather than asserting all jobs satisfied policy. No evidence, partial evidence and network/authorization failure are different states. JSA-only Retry does not reload or block time/load/mileage sections. Owner-bound scope, before/after SDK identity checks and cancelled effects prevent stale results after an account change/unmount. The response is allowlisted; signatures and private artifact contents are never returned.

Removed legacy jsa_day_status queries and unreachable old logout acknowledgment/deep-link handlers from this screen. The summary does not author evidence, start/end a shift, or offer a post-shift completion shortcut. Shift/HOS closure gates elsewhere are unchanged.

Validation: full Suite tsc and37 client/day-summary cases passed. Client cases cover exact overnight closed scope, server fallback without a date, account change during a pending call, malformed/cross-tenant/cross-shift replies, explicit network failure and partial vs absent evidence. Companion backend compilation and31 tests passed; deployment evidence in Dashboard docs/jsa-shift-summary-reader-2026-10-19.md. New APK/device layout and authenticated callable verification remain pending.

Supersedes the evidence-source limitation in docs/jsa-summary-start-job-policy-2026-10-19.md. Preserve the pre-existing generated protocol stat/line-ending change; it is not included in this commit.

Backend ready: source762648176616cf95813a667ff805533b0f38f214 deployed only jsaShiftSummary. Live revision jsashiftsummary-00001-weg verified ACTIVE with signed-out401 at2026-10-19T06:16:21Z. No rules/index/Hosting release. Existing installed Suite74 still uses its older code; a new Suite APK is required to exercise this integration. Source b14c052f60ad592937f6a54807dfd77e4204a92a is committed/pushed, but no APK has been built or installed for it.
