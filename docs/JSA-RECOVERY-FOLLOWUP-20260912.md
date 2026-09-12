# JSA recovery follow-up (read-only census)

Mike approved the same owner/original-period recovery policy for lingering JSAs:
browsing creates no new work obligation, but an existing unfinished obligation
must be closed even off shift. Optional reason/notes are diagnostic context, not
a replacement for required review or signature. JSA enforcement remains disabled.

The installed DVIR update does not implement JSA recovery. Findings in the local
JSA checkout need reconciliation with its current security work before editing:

- `C:/dev/wellbuilt-jsa/services/jsaStatus.ts` queries `jsaCompleted == false`,
  truncates at 50, restricts results to previous dates within 30 days, and converts
  failed unauthenticated Firebase REST requests into an empty result.
- `C:/dev/wellbuilt-jsa/app/_layout.tsx` then filters those previous-date results
  to the active shift, or to today when off shift. The off-shift predicates are
  contradictory, so older unfinished work cannot reach the modal. Remind-later
  suppression is scoped to shift/date rather than canonical owner.
- Its discard-with-reason path writes `discarded=true`; that is not equivalent
  to completing the required JSA. Do not substitute discard for close-out.
- Suite `app/day-summary.tsx` uses unauthenticated direct/read-query requests for
  `jsa_day_status`, converts failures to no records and logs query success.
- Suite `src/core/services/jsaShiftAck.ts` writes completion through unauthenticated
  REST. Its period/owner handling and every operator-scoped record must be checked
  before re-enabling the shift-end JSA gate.

The JSA checkout already has uncommitted authentication changes; they were not
modified. Suite's full SSO test additionally expects a sibling
`C:/dev/JSA/services/sso/jsaLaunch.ts` which is absent here. 172/173 tests passed;
the remaining test fails because the source file is absent, not from an assertion
about the changed DVIR code. The dedicated 59-test SSO P0 suite passes.

Next work: locate the current canonical JSA security branch, preserve its pending
changes, add authenticated owner/company/operator-scoped recovery without age-based
silencing, and use actual review/sign-off completion before acknowledging success.
Exercise account switches, legacy periods, multiple operators, offline retry and
off-shift recovery. No JSA setting or live JSA record was changed for this census.
