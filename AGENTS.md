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
