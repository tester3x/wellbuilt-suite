# Suite typecheck repair — 2026-10-18

Source only; no APK built or installed. The existing unrelated ssoProtocol.generated.ts working change is preserved and excluded.

Fixed registry snapshot typing, the supported WebView forceDarkOn prop, Settings brand.accent references, duplicated test imports, and discriminated refusal assertions in ETC tests. No signing/certificate/dispatch configuration or HOS behavior changed.

Verification: full npx tsc --noEmit passes; ETC start/build-target tests and all27 shift-authority client tests pass. The previous JSA/arrival tests remain passing at the source checkpoint.
