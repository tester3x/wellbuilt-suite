# Shared account gate rollout

Mirrors the canonical protected account gate, bounded transport/superseded recovery, reconnect wake and queued account-change checks from Equipment73. All apps retain their existing identity and business-operation authorization. Companion apps offer Return to Suite on gate error without clearing login. The hub remains the hub; ETC/TicketTime remain standalone local tools with no new WB login requirement.

JSA and Mobile app-open paths wait for the outer gate and do not run a competing restore. Suite/Tickets/Mobile/JSA local owner reads are fenced against replacement of the live SDK user. Equipment already has its SDK lease fence and installed73 recovery.

## All-app installation verification

This app: Android versionCode 85; runtime source checkpoint 6ea03074069f. All seven apps now use the canonical gate and recovery policy. Verified APK package, signer, account provider and source checkpoint before installing with data preserved on ZFold and S24. S10 was not connected.

The ZFold completed 21 interrupted-entry/reopen cases across all seven apps, online, radios off and reconnected. Reviewed screenshots show app content without a new account login or stranded gate. No WB_ACCOUNT_GATE failure, fatal exception or ANR appeared in that run. Actual Suite buttons for Equipment, Mobile, Tickets and JSA also opened usable content online and offline. These checks do not prove every business workflow works offline. No shifts, inspections, jobs or photos were submitted.

Canonical mirror verification, 19 shared recovery/device tests, eight actual account-adapter cases and four actual entry-readiness cases pass. TicketTime comparable baseline retains the same 39 failing suites/86 failing tests on old and new gate; no clean full-suite claim. Its internal APK preserves the authoritative laptop working source in an isolated WIP checkpoint; original laptop changes remain intact.

Private evidence remains outside Git. No backend, Hosting or demo changes. See the shared platform rollout report for the final broader sweep results.
