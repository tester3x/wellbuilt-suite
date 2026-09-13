# Equipment launch return checkpoint

Branch: fix/wbs-authenticated-company-config-20260912. Prior installed Suite: vc47.

Ordinary equipment-access returns Suite to /home after dispatching the Equipment callback, remembers up to 20 completed request states to suppress Android intent replay, and shows animated dots while waiting. This list is navigation history only and grants no access. Existing owner checks and DVIR/shift authority remain intact.

Validation: 84 DVIR gate tests, 133 auth core tests plus boundary/migration checks, 173 SSO tests, and 266 shift-authority tests passed. Android Expo export passed. Full TypeScript check retains existing AppSwitcher/SignaturePad/Settings errors; no equipment-access errors. Native build and phone restart/return verification follow.

The total handoff delay has not yet been measured or optimized. Cancel return-to-yard remains outstanding. build-vc38.json stays local and is now ignored to exclude its signed build URLs from subsequent source uploads. No Firebase deployment or inspection/shift mutations.

## Installed verification — 2026-09-13

EAS 73c317e6-4daf-4dcf-b9a1-ee5ac4762e32 finished successfully from cf0f7be0211e0229ec92bb7076c41974256bfc9c. APK version 1.0.0 / 48, SHA-256 43088AD0BB3D45AA608DC94AEFFF5414982A0777A8281AD8CAA11BAA7E509323. Installed with adb install -r on ZFold and S24; both package managers report vc48.

On both phones, Suite opened its main page under the expected existing owner. The Equipment card completed ordinary sign-on and opened Documents under that same owner. Force-stopping and reopening Suite through its launcher returned to the main page, not Equipment access. No shift was started, inspection signed, or app data cleared. This verifies the ordinary launch/reopen path; it does not claim every Android task restoration case or reduced total handoff latency.
