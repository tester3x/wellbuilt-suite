# Physical split-load totals

Branch: codex/suite-equipment-entry-20261012. Source-only checkpoint; no build,
installation or deployment requested for this patch.

The completed-load REST projection now retains dispatch split group/sequence.
Shift totals and per-source well statistics count one physical cargo per split
family, selecting A before B regardless of query order. A lone completed leg
still represents its cargo. Distinct split families remain separate. Multi-haul
grouping does not collapse separate pickup quantities.

All original invoice events remain in the activity timeline. Neither invoice
quantities nor billing tickets are rewritten by this reporting calculation.

Validation: 39 focused day-summary tests pass under America/Chicago, including
REST identity projection, order independence, split vs multi-haul quantities,
both split legs' activity, completed/created joins and cross-midnight windows.
The actual audited private split pairs now reproduce one load per family using
the source calculation. Operational records remain outside Git.
Project TypeScript checking also passes after the focused test-fixture types were
corrected; no application build was run.

The unrelated generated SSO file was already modified before this work and is
excluded from this checkpoint. Next device acceptance awaits a requested build.
