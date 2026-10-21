# Cached account app entry

The canonical protected device-account cache already holds the account owner and allowed apps for all seven installed apps. Matching local SDK/session restores return without an exchange; refreshing access is background work. Shared logout writes a revoked marker and removes its credential, so another app cannot restore an older login. This cache is separate from inspection/shift completion evidence.

Suite home cards in all four skins now filter against the same local app list used by its switcher. The shared Equipment action dims and disables when excluded. The central launcher reads the protected current list again on every tap, including detail pages, and shows an access modal instead of opening a denied app. No Firebase call, truck lookup or shift check is added by that list check. Off-shift general app entry remains allowed.

The canonical appAccess.js module is mirrored across all seven apps; existing target gates retain their current-owner, revocation and pending-work checks. No app data, shifts, reports, credentials or generated protocol changes are included in this checkpoint.

Validation: six actual launcher cases cover Equipment, Tickets, Mobile, JSA, ETC and TicketTime through allow, deny and reallow transitions. Canonical cache tests cover seven-app local restore, changed account, logout, offline refresh and denied access. Suite TypeScript and 91 DVIR gate tests pass. Build and device acceptance are pending; Equipment has its separate launch-metadata correction and acceptance build.


## Installed acceptance

Suite 92 (source b40a586, EAS 98048ad5-1747-46fa-8248-8f6c07696e6a)
and Equipment 85 (source 2afe4b6, EAS 08569cc5-092c-42e5-b96b-980415e0b4a6)
are installed and package-version verified on the dedicated S24 and field ZFold.
Installation preserved data. No field-device screen interaction was performed.

Seven established apps reached usable signed-in screens by two-second samples
online and offline; six also passed offline process-death checks. ETC remained
running to preserve HOS. A real Suite Equipment-card tap showed Documents by
one second. All five WB-account login providers publish shared allowed-app access;
ETC and TicketTime consume the same record for their independent local tools.

The separate Equipment correction projects parsed launch metadata to the exact
shiftId/phase binding. The former extra returnUrl key caused rejection before the
existing account could be tried. Real device diagnostics now show SDK/native
account reuse without a PKCE round trip. The approved warm backend is deployed
as resolveequipmentdvirentry-00005-dax. Fresh binding route times were
2.870/1.594/4.023 seconds; a separate cold-process visible-ready sample was 4.208
seconds. Already-authorized inspection reopening after process death fully
offline resumed its route in 1.087 seconds. These results do not imply a universal
two-second first inspection authorization or first-ever SDK enrollment.

The S24 existing active period and original Pre-Trip remained unchanged; no
inspection was started, signed or fabricated. Live benchmarks used its unfinished
Post-Trip setup only. Both Pre/Post callback shapes have production parser and
validator regression coverage. Exact field-shift first Pre-Trip behavior remains
a field acceptance observation, not a fabricated laboratory result. Current
ZFold versions were re-read after the unrelated split-ticket server repair;
Equipment remains 85 and Suite 92.
