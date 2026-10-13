# Suite Equipment secure entry repair — 2026-10-12

Branch: codex/suite-equipment-entry-20261012. Base af1d404, matching installed Suite 60.

Normal Equipment card and switcher now start Equipment's PKCE general-access flow instead of the retired hash/name login. Added equipment-access route, strict owned account checks, cancellation/account-change suppression and duplicate-attempt protection. Required shift-bound DVIR flow is unchanged. Existing deployed issueEquipmentAppSession endpoint is used; no backend deployment required.

Validation: 6 new core tests, 110 SSO tests, 110 regression tests passed. No TypeScript diagnostics in changed service/route files; existing baseline diagnostics remain.

Build/install and authenticated phone verification pending. No shift or inspection completion fabricated. No Shop staff role granted without a specified account.

Source checkpoint 9c2b2a0 committed and pushed. EAS Android preview build 3c5b769a-a2a7-4df7-a728-ccd7d5d48981 submitted as Suite 61 using existing remote signing credentials. Installation and authenticated verification remain pending build completion. ZFold RFGL23VJCED connected at submission.

Installed and package-verified on both RFGL23VJCED (ZFold) and R5CX15HEGQB (S24): Suite61, Equipment42, Ticket158, Mobile77, ETC111, TicketTime114. In-place installs succeeded; no uninstall or data clear. ETC111 copied as the installed base APK from ZFold to S24. Post-install Equipment app-start on ZFold reached Suite equipment-access but showed generic Could not connect error. Retired route resolved; authenticated end-to-end sign-on is not yet verified and needs further diagnosis.

Follow-up: remove Start Shift's premature preTripDone checkbox, keep preTripDone false and preserve actual post-claim required gate. Equipment screen now offers cancellation/Return during work, uses dismissTo Home, and displays/logs only closed sanitized failure categories. Six core and 110 SSO tests pass. Root cause of on-device sign-on failure still under investigation; diagnostic build is not claimed as a completed auth fix.
