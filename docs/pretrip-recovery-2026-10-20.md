# Pre-Trip recovery after interrupted app handoff

Branch: codex/suite-equipment-entry-20261012. Base 01f1d11 (Suite81).

Added dvir-resume recovery route and Resume Pre-Trip DVIR control when an active shift lacks its local completion receipt. Rechecks on foreground with stale-result fencing. Recovery resolves current Suite shift, rejects conflicting explicit shift/phase requests, checks completion before relaunch and retains retry after launch failure. Off-shift users are not sent into an inspection. No shift start/close or inspection completion is synthesized. Equipment fallback links to this route.

Validation: 47 recovery/gate/arrival tests pass, including interrupted unscoped recovery, duplicate prevention, off-shift/foreign shift rejection, explicit phase preservation and retry. No TypeScript diagnostic in changed files. Existing ticketsLaunchDvir source assertion still expects obsolete sso-start after the earlier platform app-open change; not represented as passing. Pre-existing generated protocol modification preserved and excluded from commit. Not built/installed at this checkpoint.
