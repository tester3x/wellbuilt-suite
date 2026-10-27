# Shift summary footer safe area

The Close button in the completed-shift summary overlapped Android's persistent navigation row. Its absolutely positioned parent ignored the SafeAreaView's content padding and used a fixed bottom padding instead.

The footer is now a nonshrinking sibling of the flexing ScrollView inside the existing SafeAreaView. It stays visible while the summary scrolls and follows the device's actual safe area. Removed the obsolete 100-point scroll spacer used for the overlay footer. Close still only routes home; it does not log out or change shift state. JSA numbering, counts, DVIR evidence and summary data are unchanged.

Validation: Android Metro export passed; 11 JSA display/summary regression tests passed; unchanged SSO protocol mirror verifies. Existing protocol-generated file has a pre-existing line-ending-only working-tree status and is excluded from this change.

Build and S24 acceptance pending. ZFold installation deferred by the user.
