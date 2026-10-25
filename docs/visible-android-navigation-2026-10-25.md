# Visible Android navigation

Base: `a1e8099`, branch `codex/suite-equipment-entry-20261012`.

Suite now shows Android navigation at startup and resume instead of hiding it for immersive swipe navigation. It follows WB M's existing visible/inset-touch policy; each API failure remains isolated. Day Summary and Timesheet now use safe-area-context's Android-aware SafeAreaView instead of React Native's iOS-only SafeAreaView. Existing screen-specific inset handling remains intact. Shift, JSA, DVIR, SSO and HOS behavior was not changed.

Exact Expo v57 docs were read; SDK unchanged. TypeScript check passed. The unrelated pre-existing generated SSO protocol working-tree change is excluded from this checkpoint. No APK build or installation was performed. Physical navigation-mode, modal and keyboard acceptance remains for the next build.

Android JS export passed. Generated bundles and command logs remain outside Git.

## APK build completed 2026-10-25

- Source: 7f4f07472920a38bdebaf0c99ff56dee30d7d79a.
- EAS build: e33b7fd1-9b1a-4a97-af0f-c0a8a36627b6; profile account-device-test; Android versionCode 97; FINISHED.
- Artifact: WellBuiltSuite-v97.apk (arm64-v8a).
- SHA-256: 200bc0b94227ed1b25324a51d586ec5e5cabab7f181f2118343abaf18adc8c22.
- APK package/version and cryptographic signature verified; signing certificate matches the previous app APK.
- Built and downloaded; not installed in this task. Device acceptance of navigation, keyboard, camera and dialogs remains pending.

## Installation 2026-10-25

Installed the verified APK above on both ZFold and S24 using ADB replace-install with app data retained. All installs returned Success. Android package-manager reads on both phones confirmed the expected versionCode. This verifies installation only; drawer/nav/offline UI acceptance remains pending.
