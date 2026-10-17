# Suite72 ETC regression and reconciled source — 2026-10-17

ZFold verified Suite72 and ETC115. ETC UI shows OFF SHIFT and no active ETC Android service. Suite's real shift was already open; no new shift, synthetic HOS, backdating or inspection was created during investigation. Raw logs/UI remain private under C:/dev/tmp/zfold-etc-*.

Root cause: Suite72 EAS63e8f853-f77f-4ec7-82db-084a01c03f0e built8464453 on codex/suite-etc-start-hos, whose lineage lacks the working durable ETC start/end native module and dispatch integration. The orphan suiteHosProtocol file is not that integration. Prior Suite71 sourcef577d1a on codex/suite-equipment-entry-20261012 contains848272f (enabled verified production ETC),34371b1 (durable end),86feab2 (shift-bound mileage). This is a source-selection regression, not proof of an ETC115 defect.

Reconciliation stays on codex/suite-equipment-entry-20261012 authoritative prior field build source. Applied Suite72 functional fixes370f6cf (60-second authority cold-start budget) and8464453 (preserve governed metadata in Android fallback) as233485a and48fbe2b. Resolved authority-test conflict by retaining both test sets. Restored source=server_binding marker in URL builder; this does not grant authorization or add identity. Did not replace the entry branch with the stale72 checkout or merge away its fuller shift/summary/arrival behavior. Pre-existing modified generated SSO file has no textual diff and is left untouched.

Validation: ETC start/build-target30, authority/lifecycle45, DVIR86, profile/native target6:167pass. Full TypeScript retains existing AppSwitcher/SignaturePad and ETC test narrowing diagnostics; no clean full-typecheck claim. The integrated source still needs an APK build/install and real device flow confirmation. Future Suite builds must include both the verified ETC production integration and the current DVIR fixes. Do not build from the misleadingly named codex/suite-etc-start-hos branch without reconciling it.

Current-day HOS gap remains for driver review; no historical activity is inferred from Suite start or repaired automatically.

Suite73 submitted2026-10-17 09:55CDT from8350b104d9825e6f616bce264dc86f14e854aa58, device-preview, EAS0819a2ff-73db-4e0a-be15-ec1ac327a03a. Submitted only; not installed or verified on phone. ZFold remains Suite72/ETC115. No HOS edits performed.

Suite73 completed and installed on ZFold RFGL23VJCED on2026-10-17. Update install success with existing data preserved; package version73 confirmed and MainActivity starts successfully. APK SHA256186004B0D5C2FF12EDB4B16BBBD34E8D0764FF112B8DF2845883F1929B84B1D2. No shift/HOS history edited. Actual ETC auto-start still requires field testing with a future real shift.
