# Cached account app entry

The canonical protected device-account cache already holds the account owner and allowed apps for all seven installed apps. Matching local SDK/session restores return without an exchange; refreshing access is background work. Shared logout writes a revoked marker and removes its credential, so another app cannot restore an older login. This cache is separate from inspection/shift completion evidence.

Suite home cards in all four skins now filter against the same local app list used by its switcher. The shared Equipment action dims and disables when excluded. The central launcher reads the protected current list again on every tap, including detail pages, and shows an access modal instead of opening a denied app. No Firebase call, truck lookup or shift check is added by that list check. Off-shift general app entry remains allowed.

The canonical appAccess.js module is mirrored across all seven apps; existing target gates retain their current-owner, revocation and pending-work checks. No app data, shifts, reports, credentials or generated protocol changes are included in this checkpoint.

Validation: six actual launcher cases cover Equipment, Tickets, Mobile, JSA, ETC and TicketTime through allow, deny and reallow transitions. Canonical cache tests cover seven-app local restore, changed account, logout, offline refresh and denied access. Suite TypeScript and 91 DVIR gate tests pass. Build and device acceptance are pending; Equipment has its separate launch-metadata correction and acceptance build.
