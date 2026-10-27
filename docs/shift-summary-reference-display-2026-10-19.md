# Shift summary reference display — 2026-10-19

Suite shift-complete JSA card shows the server-assigned human JSA number; legacy opaque cached references show Pending sync until the separate backend numbering update is deployed and refreshed. Human-readable numbers remain unchanged. Removes the raw shift ID row. Evidence IDs, counts, lifecycle and storage remain intact.

Coded only, for the next Suite build. Does not change the JSA 70, WB T 196 or Equipment 62 login builds already underway. Preexisting modified ssoProtocol.generated.ts is excluded from this checkpoint.

## Six-digit shift-card display â€” 2026-10-26

Owner reaffirmed the intended display convention: six digits for each document, with the existing full reference retained for identity/lookup. The shift card now extracts only the final six-digit suffix from the recognized server-number format JSA-YYYYMMDD-HHMMSS-NNNNNN. Leading zeros are retained. Opaque legacy identities still display Pending sync, rather than arbitrary characters being misrepresented as a number. Canonical references, authorization, stored evidence and counts are unchanged. Short numbers are display references, never globally unique keys.

All compact references are shown on the card rather than truncating the list to three and hiding the rest. A read-only audit established that a five-job evidence count can correctly include an earlier canceled job's signed full read and four later completed jobs' acknowledgements; this is distinct from a completed-load count and is not double-counting one job. Signed records were preserved; no production records were changed.

Validation: ten focused display/summary boundary tests pass, including canonical-reference preservation, leading zeros, legacy opaque references, account changes and verified-versus-unavailable states. Project TypeScript retains unrelated existing errors and reports none in the changed screen/helper/tests. Source only: no new APK built or installed for this change.

The shared cross-app Shift reference remains the separately documented design in shared-shift-reference-discussion-2026-10-23.md: one reference spanning midnight, plus each ticket/JSA/DVIR's own reference, with original associations preserved across transfers. It has not yet been implemented across record writers/readers. The proposed Back to WB S / Equipment navigation replacement is also separate; no Switcher behavior changed here.
