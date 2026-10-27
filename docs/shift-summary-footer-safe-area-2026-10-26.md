# Shift summary footer safe area

The Close button in the completed-shift summary overlapped Android's persistent navigation row. Its absolutely positioned parent ignored the SafeAreaView's content padding and used a fixed bottom padding instead.

The footer is now a nonshrinking sibling of the flexing ScrollView inside the existing SafeAreaView. It stays visible while the summary scrolls and follows the device's actual safe area. Removed the obsolete 100-point scroll spacer used for the overlay footer. Close still only routes home; it does not log out or change shift state. JSA numbering, counts, DVIR evidence and summary data are unchanged.

Validation: Android Metro export passed; 11 JSA display/summary regression tests passed; unchanged SSO protocol mirror verifies. Existing protocol-generated file has a pre-existing line-ending-only working-tree status and is excluded from this change.

Build and S24 acceptance pending. ZFold installation deferred by the user.

## Built and verified

WB S99: EAS 9038e9e9-af8a-49cc-a25d-9f40099879c5, exact source f1caab7b9d70b168beaddb3b3cfff7660a72bc43, FINISHED. APK SHA256 5505FD6878F6E9D4883F3A020B63DD96FBD8D4440418329D294845BDAB2C30D7. Certificate matches S98. Replacement-installed on S24 with data retained; package manager confirms versionCode99.

Actual summary UI/screenshot: Close bounds y2026–2162, fully above the Android navigation row beginning at y2214. Before: y2110–2246 (32px overlap). Its bounds remain identical at the top and bottom of the scroll. Existing six-digit JSA number, counts and completed DVIR summary remain visible. Tapping Close returns to the signed-in home. Independent before/after server reads confirm unchanged shift authority; no shift lifecycle action or logout was submitted. S24 remains on home. Private evidence: C:/dev/tmp/suite99-footer-top-private.png, suite99-footer-bottom-private.png and suite99-close-home-private.png.

Source and acceptance notes pushed. ZFold installation remains deferred; use S99 instead of the earlier S98 when it becomes available.
