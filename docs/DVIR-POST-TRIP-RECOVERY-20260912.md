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
