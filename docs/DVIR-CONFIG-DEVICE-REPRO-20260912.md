# DVIR company configuration reproduction

## Verified defect

Suite VC37 reads company settings through an anonymous Firestore REST request.
Live rules require authenticated company-scoped access. Without a usable local
configuration cache, the read fails and the caller interprets null as legacy
enforcement. The UI can show a locally started shift without claiming a server
period; equipment authorization then fails because no authoritative binding exists.

The fix in 68f5b3d authenticates the existing REST request with the boundary-owned
Firebase SDK ID token. It does not loosen Firebase rules, fabricate a shift, or
complete a DVIR. Missing sessions make no anonymous request; denied/offline reads
retain the existing unavailable/cache outcomes. Tokens are not stored in the cache.

## Device evidence before the fix

Both phones were aligned to Suite VC37 and eQuipment VC17 using the same APKs.

| Account | Device | Observed result |
| --- | --- | --- |
| MikeS24 | S24 | Cached enforced configuration; server shift restored; Post-Trip handoff issued successfully and reached Begin inspection. |
| Mikezfold | ZFold | Configuration unreadable; legacy local shift; Pre-Trip rejected with callback_not_authorized. |
| MikeS24 | ZFold | Configuration unreadable after login; Start Shift shown despite an existing open server period. |
| Mikezfold | S24 | Cached enforced configuration; server correctly returned none, then successfully claimed a new period on Start Shift. |

The user authorized closing Mikezfold's August 23 period. Suite's ordinary
server-backed End Shift closed exactly 2026-08-23_232617; a subsequent Firestore
read confirmed openPeriodId=null and authority version 8. A retry on unfixed
ZFold VC37 still started a legacy local shift and failed Pre-Trip, so the old
period was not sufficient to explain the remaining failure.

On the reverse-account test, S24 claimed Mikezfold period 2026-09-12_110729,
authority version 9. The eQuipment launch parsed that new Pre-Trip but resumed
MikeS24's retained Post-Trip route instead. This is a separate retained-route
issue and was not counted as successful Pre-Trip authorization. No inspection
was submitted during these tests. eQuipment VC18 changes tests only.

The user confirmed that lingering Post-Trip DVIR and JSA obligations must be
completed, not discarded by logout/sign-out. Any retained-route repair must
preserve those obligations and their owning account/period, and make the owner
explicit when blocking a different account. Do not clear inspection caches as
a shortcut. JSA is currently disabled in company settings and was not exercised.

## Validation and delivery

- Production loader exercised with mocked storage/auth/network: 3 tests pass.
- Configuration, equipment readiness, composite readiness, and End Shift: 93 pass.
- Authentication core: 133 pass; SSO P0: 56 pass (overlapping coverage).
- Android Expo export passed.
- Suite VC38 build: 2db330e8-cfbe-4f6a-af34-acf61f37096b.
- VC38 finished successfully, built from 68f5b3d. Installed over VC37 on the
  ZFold without clearing data or signing in again. MikeS24's server period
  2026-09-12_020000 restored immediately; the UI changed from Start Shift to
  the running shift, and the log confirmed server restoration.
- ZFold VC38 -> Tickets -> Pre-Trip succeeded: equipment_issued after a 111 ms
  token refresh; eQuipment displayed MikeS24, Truck 102 / Trailer T30, Pre-Trip,
  and Begin inspection. No report was submitted.
- The completed Pre-Trip receipt from the S24 was not recognized on the ZFold:
  a separate cross-device receipt synchronization issue remains. This result
  verifies authorization/routing, not end-to-end inspection completion.

Device evidence and before/after server snapshots are saved outside the repository
under C:/dev/output/dashboard-audit-20260912. Do not commit raw device logs or
credentials. Preserve the unrelated dirty Suite and eQuipment checkouts.
