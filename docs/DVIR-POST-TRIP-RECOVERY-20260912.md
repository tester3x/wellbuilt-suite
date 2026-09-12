# Firebase DVIR completion and recovery return

Missing phase receipts are resolved from authenticated, exact-owner Firebase status.
Local receipts and pending end-shift routing are scoped to company and canonical
driver. Legacy receipts are adopted only with matching owner and valid checksum;
another account's data is retained. Unavailable status is not treated as completion.

Equipment returns a completed historical Post-Trip through dvir-resume. That screen
checks the active current shift and starts a fresh governed handoff for the original
request. It never consumes the old receipt as the current shift's completion.
Pending end-shift resumption additionally requires the exact current shift ID.

Requires the four Firebase DVIR callables and the matching Equipment recovery build.
Validation: 74 DVIR tests, auth/SSO regression suites and Android Expo export. Device
validation remains pending. Existing unrelated TypeScript errors are unchanged.

VC39 build f32102cd-d652-401d-bb69-2f665c674d2c (8d2032b) installed on both phones.
Normal launcher entry and the Tickets handoff succeeded with Equipment VC20.
A cold wellbuilt-suite://home link exposed a pre-existing skin redirect race:
Home mounted before authentication/root navigation and crashed both phones.
a4baa9e guards Home mounting and recovery resumption until both are ready, and
hides the native splash when entering these routes directly. The actual route
regressions pass in the 76-test DVIR suite; 266 shift-authority tests also passed.
Android export passed. Replacement VC40 build 7c912b9c-8591-4911-a4c2-45afd03993d1
is running; cold-link device validation remains pending.
