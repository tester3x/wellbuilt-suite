# End-of-shift completed loads

The real end-of-shift screen reported completed loads unavailable, with pickup/drop-off time missing. Its invoice reads used company-only createdAt queries and globally scoped status/closedAt queries, followed by client-side identity filtering. The deployed Firestore rules require canonical driverId and companyId ownership in the server query. Administrative queries succeed because they bypass those driver restrictions; they do not prove the driver's request is authorized.

All four query variants now include exact canonical driverId and companyId, while preserving created/completed date coverage, ISO-string/Firestore-timestamp compatibility, document deduplication and completed-status filtering. Missing canonical identity/company returns unavailable without issuing an unauthorized request. Failed reads remain distinct from an empty shift. Tenant filtering is retained defensively for all returned rows.

The corrected query shapes require two indexes, recorded in firestore.summary-indexes.json. Only these missing indexes were requested through the Firestore Admin API; existing indexes and deployed access rules are unchanged. Readiness and final live query results are recorded below after completion.

Source baseline: laptop Suite working branch codex/suite-equipment-entry-20261012 at 34371b1, fetched and matching origin. The older divergent laptop HOS checkpoint d17f709 and desktop integration checkpoint af1d404 remain preserved; this repair builds on Suite69's start/end integration. Pre-existing generated SSO-file working-tree state was not included in the repair.

Validation: 40 summary/config tests, Android Expo export and 30 ETC start/build-target tests passed. The one-time end-of-shift screen cannot be reopened by the user; real-screen confirmation awaits the next actual shift end. No shift, load, inspection or timesheet was created or edited for testing. Build/install checkpoints follow when available.
