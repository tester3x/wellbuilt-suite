# Visible Android navigation

Base: `a1e8099`, branch `codex/suite-equipment-entry-20261012`.

Suite now shows Android navigation at startup and resume instead of hiding it for immersive swipe navigation. It follows WB M's existing visible/inset-touch policy; each API failure remains isolated. Day Summary and Timesheet now use safe-area-context's Android-aware SafeAreaView instead of React Native's iOS-only SafeAreaView. Existing screen-specific inset handling remains intact. Shift, JSA, DVIR, SSO and HOS behavior was not changed.

Exact Expo v57 docs were read; SDK unchanged. TypeScript check passed. The unrelated pre-existing generated SSO protocol working-tree change is excluded from this checkpoint. No APK build or installation was performed. Physical navigation-mode, modal and keyboard acceptance remains for the next build.

Android JS export passed. Generated bundles and command logs remain outside Git.
