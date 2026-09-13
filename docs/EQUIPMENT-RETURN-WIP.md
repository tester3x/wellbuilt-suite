# Equipment launch return checkpoint

Branch: fix/wbs-authenticated-company-config-20260912. Prior installed Suite: vc47.

Ordinary equipment-access returns Suite to /home after dispatching the Equipment callback, remembers up to 20 completed request states to suppress Android intent replay, and shows animated dots while waiting. This list is navigation history only and grants no access. Existing owner checks and DVIR/shift authority remain intact.

Validation: 84 DVIR gate tests, 133 auth core tests plus boundary/migration checks, 173 SSO tests, and 266 shift-authority tests passed. Android Expo export passed. Full TypeScript check retains existing AppSwitcher/SignaturePad/Settings errors; no equipment-access errors. Native build and phone restart/return verification follow.

The total handoff delay has not yet been measured or optimized. Cancel return-to-yard remains outstanding. build-vc38.json stays local and is now ignored to exclude its signed build URLs from subsequent source uploads. No Firebase deployment or inspection/shift mutations.
