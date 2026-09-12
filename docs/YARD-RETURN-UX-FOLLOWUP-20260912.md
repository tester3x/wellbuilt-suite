# Yard return follow-up

Mike requested these changes during the final DVIR phone test. Keep that test
running and do not replace the in-progress VC44 build for these UI changes.

- Remove the premature arrival checkbox claiming the Post-Trip is completed.
  The arrival form still captures odometer and paperwork confirmation; its
  existing onConfirm enters the governed Post-Trip flow. Completion remains
  based on accepted inspection receipts in the final shift summary.
- Add Cancel return to yard on the En Route / The Yard panel. A driver can be
  reassigned before reaching the yard. Cancel the return intent while keeping
  the same shift open and preserving recorded travel. This requires checking
  the server shift transition, not just hiding the card. Implementation pending.

The checkbox removal is a source change after VC44 and is not in that APK.
