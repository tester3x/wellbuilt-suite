# Suite Equipment secure entry repair — 2026-10-12

Branch: codex/suite-equipment-entry-20261012. Base af1d404, matching installed Suite 60.

Normal Equipment card and switcher now start Equipment's PKCE general-access flow instead of the retired hash/name login. Added equipment-access route, strict owned account checks, cancellation/account-change suppression and duplicate-attempt protection. Required shift-bound DVIR flow is unchanged. Existing deployed issueEquipmentAppSession endpoint is used; no backend deployment required.

Validation: 6 new core tests, 110 SSO tests, 110 regression tests passed. No TypeScript diagnostics in changed service/route files; existing baseline diagnostics remain.

Build/install and authenticated phone verification pending. No shift or inspection completion fabricated. No Shop staff role granted without a specified account.
