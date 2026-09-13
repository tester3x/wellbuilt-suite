# Equipment launch return — unfinished checkpoint

Branch: fix/wbs-authenticated-company-config-20260912. Last installed Suite version: 47.

The ordinary equipment-access route now returns Suite to /home after dispatching the Equipment callback, records a bounded list of completed request states to suppress old Android intent replay, and shows animated dots while working. This local list is navigation history only; it grants no access and does not alter DVIR/shift authority.

Three targeted equipmentAppAccessRoute tests pass. Broader auth/shift regressions, Android export, and device restart/return verification remain pending. No new Suite build started. Timing improvement has not been measured. Investigate outstanding wait time without weakening owner/auth checks. Cancel return-to-yard remains outstanding.

build-vc38.json remains local and excluded from Git. No production shift or inspection changes were made.
