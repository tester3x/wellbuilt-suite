# End-shift Equipment handoff follow-up

Branch `codex/suite-etc-start-hos`, based on `6bafd6f`.

Driver reports first Arrived at Yard attempt opened Equipment's front door; returning to Suite and tapping again completed the governed path. Also reports a long handoff delay.

Confirmed source defect: the Android intent fallback in `launchEquipmentPhase` discarded all query metadata, including shiftId, phase, source=server_binding and returnUrl. The normal scheme retained it. Fixed fallback to preserve the same metadata-only URL with the explicit Android package. No driver credentials, token, or identity added; backend authorization remains required. The 24 gate-service tests pass, including fallback for both inspection phases and unchanged failed-launch shift behavior.

This is a possible explanation for the reported first attempt, not a confirmed device trace: the earlier process log buffer did not retain it. No shift, HOS, receipt or inspection record was changed. No Suite build/install/deploy performed.

Latency remains unresolved. Existing Suite code forces current identity claims and records refresh duration; Equipment then performs code exchange, SDK sign-in, and owned DVIR binding resolution. Existing source documents foreground/background refresh stalls. Do not remove authorization or declare this fallback change a speed fix. Next verification should capture sanitized stage timings for a fresh governed handoff, separating Suite refresh/issuance from Equipment exchange/auth/binding and foreground transitions. The driver need not manufacture a real shift solely for this test.

Separate WB E checkpoint `0c7ddef` fixes pending-item signing recovery. Separate WB T APK 181 is building from `cddfbd4`; neither Suite nor WB E changes are part of that WB T APK.
