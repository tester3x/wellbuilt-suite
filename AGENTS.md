## Build authorization - user amendment October 30, 2026

- Local Android APK builds and rebuilds have Mike's standing authorization for user-authorized development, fixes and validation. Use the laptop Android SDK, JDK and project Gradle wrapper; do not ask for separate permission to build locally.
- Batch meaningful changes. Standing local-build permission does not authorize unrelated features, cosmetic-only releases, unrequested installations or live-data changes. Carry forward installation/testing authorization already given for the task.
- Any Expo.dev/EAS cloud build, cloud retry, submission or upload requires Mike's explicit permission in the current work. Local-build authorization never grants cloud authorization. Never fall back to cloud automatically when a local build fails.
- Preserve ownership guards, registered existing homes, fresh cross-computer source reconciliation, exact committed clean build source, immutable remote version reservations, existing package ID/release signer, required checks and durable source/version/APK/signing receipts. Keep signing credentials and APKs outside Git. Test on S24 before a ZFold rollout.
- Build in the registered home under the current workspace policy; do not create a separate source/build checkout. The registered-home runner and current app instructions override historical source-copy examples.
- This amendment supersedes older instructions requiring a fresh request or separate approval for a local APK build. Historical release receipts remain historical evidence. Expo/EAS cloud approval remains explicit.

## Cross-computer source checkpoint before every build

- Commit and push intended changes before switching computers or handing work off. Preserve unrelated local work separately; never sweep credentials, logs or generated builds into a commit.
- Before any build, fetch GitHub and compare the active laptop branch, the active desktop branch, and the last installed source checkpoint for that app. Review and integrate relevant changes from both computers before taking the exact committed build snapshot. A commit existing on another branch does not put it into an APK.
- Preserve both histories and resolve conflicts deliberately. Never reset or force-push over the other computer. Record the merged source commit in the build receipt and handoff note.
- If another computer pushes changes while an APK is already building, that immutable snapshot does not contain them. Fetch and integrate before the next authorized build; never describe the in-progress APK as containing later commits.
## Registered laptop home — October 29, 2026

- First read `C:/dev/workspace-control/POLICY.md` fully. Desktop D: control paths map to C: on this laptop; current user-authorized policy supersedes old task/build notes.
- Mike authorized registering the existing `C:/dev/TicketTimeExpo/tmp/suite-equipment-entry-20261012` checkout, branch `codex/suite-equipment-entry-20261012`, remote `https://github.com/tester3x/wellbuilt-suite.git`. Common Git directory: `C:/dev/wellbuilt-suite/.git`. Preserve the accepted `677476dc07d4ee337f6883b9c4621c0db9d3e561` baseline.
- Claim/check/finish through `C:/dev/workspace-control/guard.cjs` using the actual session ID. One writer per repository; do not steal ownership or bypass Git hooks.
- Use this registered existing home. No new checkouts or source-copy build folders, resets, force pushes, uninstalls or clearing app data. Any authorized local build must use exact clean committed reconciled source in this home with the existing signer and immutable version reservation; preserve generated native files and private artifacts outside Git.
