## Expo/EAS build authorization — all apps, both computers

- Batch fixes and features into substantial updates. Do not create cosmetic-only builds.
- Never start an Expo/EAS cloud build unless Mike specifically requests that build in the current work. A significant batch of changes alone is not authorization.
- This applies to every app, computer, build profile and platform, including builds started through scripts, CI, API calls or expo.dev. Do not launch additional builds or retries unless the explicit request covers them.
- Earlier blanket permission to build/install, autonomous-work instructions and old build requests do not authorize new builds under this policy.
- Continue coding, local validation, tests, commits and pushes while updates accumulate. Keep work preserved without spending cloud-build credits.
- Urgent fixes have no automatic exception: explain the need and wait for Mike's explicit build instruction.

## Local Android builds are the default

- Build Android APKs on the laptop with its Android SDK, JDK and the project's Gradle wrapper. Do not use paid Expo/EAS cloud builds as the normal build path, and never fall back to cloud automatically when a local build fails.
- Keep batching meaningful updates; local tooling does not authorize cosmetic-only releases or unrequested installs. Expo/EAS cloud builds still require Mike's specific current approval.
- Shared laptop runner: `C:/dev/TicketTimeExpo/scripts/android-local-build.cjs`; instructions: `C:/dev/TicketTimeExpo/docs/local-android-builds.md` on `wip/etc-hos-timesheet`. Fetch and verify the laptop checkpoint before using it from another computer.
- Preserve the existing release signing key, application ID, build-profile environment, config plugins and native hooks. Never replace a release key with a debug/new key or uninstall an app to get a build installed.
- Allocate a version code above the latest installed AND remotely allocated version, coordinate it across computers, and verify the APK signature/package/version against an approved baseline before installation. EAS remote auto-increment does not run during a direct Gradle build.
- Build an exact committed source snapshot in a separate short-path workspace. Keep signing credentials and generated APKs outside Git. Record source commit, profile, version, APK hash and signing fingerprint; test on S24 before a ZFold rollout.

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

