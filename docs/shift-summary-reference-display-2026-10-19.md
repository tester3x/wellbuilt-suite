# Shift summary reference display � 2026-10-19

Suite shift-complete JSA card shows the server-assigned human JSA number; legacy opaque cached references show Pending sync until the separate backend numbering update is deployed and refreshed. Human-readable numbers remain unchanged. Removes the raw shift ID row. Evidence IDs, counts, lifecycle and storage remain intact.

Coded only, for the next Suite build. Does not change the JSA 70, WB T 196 or Equipment 62 login builds already underway. Preexisting modified ssoProtocol.generated.ts is excluded from this checkpoint.

## Six-digit shift-card display — 2026-10-26

Owner reaffirmed the intended display convention: six digits for each document, with the existing full reference retained for identity/lookup. The shift card now extracts only the final six-digit suffix from the recognized server-number format JSA-YYYYMMDD-HHMMSS-NNNNNN. Leading zeros are retained. Opaque legacy identities still display Pending sync, rather than arbitrary characters being misrepresented as a number. Canonical references, authorization, stored evidence and counts are unchanged. Short numbers are display references, never globally unique keys.

All compact references are shown on the card rather than truncating the list to three and hiding the rest. A read-only audit established that a five-job evidence count can correctly include an earlier canceled job's signed full read and four later completed jobs' acknowledgements; this is distinct from a completed-load count and is not double-counting one job. Signed records were preserved; no production records were changed.

Validation: ten focused display/summary boundary tests pass, including canonical-reference preservation, leading zeros, legacy opaque references, account changes and verified-versus-unavailable states. Project TypeScript retains unrelated existing errors and reports none in the changed screen/helper/tests. Source only: no new APK built or installed for this change.

The shared cross-app Shift reference remains the separately documented design in shared-shift-reference-discussion-2026-10-23.md: one reference spanning midnight, plus each ticket/JSA/DVIR's own reference, with original associations preserved across transfers. It has not yet been implemented across record writers/readers. The proposed Back to WB S / Equipment navigation replacement is also separate; no Switcher behavior changed here.

Owner clarified document versus acknowledgement identity: read-once acknowledgements share the signed full read's visible number. Separate full reads keep separate numbers. Backend correction is preserved in codex/jsa-document-number-complete-20261026. The card now uses singular number for a single reference; counts remain separate. Eleven focused display/summary tests pass. No APK built or installed for this source change.

## Suite 98 build and S24 acceptance — 2026-10-26

Built source 689539a32e2f15cc5c613a4be731e5aa79e0fea1 using account-device-test. EAS build 0581e685-98bf-4646-bbcb-2538d60891d6 FINISHED; Android package com.wellbuilt.suite, versionCode 98, versionName 1.0.0, ARM64. APK SHA-256 0F87BC1CC4019B806CDF5288A251CB57051AA02E45DC82430994C8EEA94353FA. Signing certificate SHA-256 a7d1b6fb35c848239ccdc52e0e1c36be9a96b0786ff5628fa9b98bae80fa6aa6 matches the prior Suite APK. APK and EAS logs remain private outside Git.

Prebuild validation passed the eleven display/summary cases, six Suite/ETC production-target checks and SSO mirror verification. The existing generated SSO file reports a working-tree status due to line endings, with no content diff; it was not edited or committed for this work.

Data-preserving replacement on S24 returned Success; Android package manager confirms versionCode 98. Opened the existing summary read-only, without starting, ending or canceling a shift or submitting any load. Fresh accessibility output and screenshot show one singular six-digit JSA reference, while the existing signed-read, acknowledgement and unique-job counts remain separate. The long date/time reference is absent from the card. Independent server read-back confirms the same test shift authority/version, records and shared reference as before installation. Device screenshots/XML remain private outside Git.

S24 acceptance passed. ZFold installation remains pending USB reconnection: ADB currently detects only S24. Do not describe Suite 98 as installed on ZFold yet.
