# Firebase DVIR completion and recovery return

Missing phase receipts are resolved from authenticated, exact-owner Firebase status.
Local receipts and pending end-shift routing are scoped to company and canonical
driver. Legacy receipts are adopted only with matching owner and valid checksum;
another account's data is retained. Unavailable status is not treated as completion.

Equipment returns a completed historical Post-Trip through dvir-resume. That screen
checks the active current shift and starts a fresh governed handoff for the original
request. It never consumes the old receipt as the current shift's completion.
Pending end-shift resumption additionally requires the exact current shift ID.

Requires the four Firebase DVIR callables and the matching Equipment recovery build.
Validation: 74 DVIR tests, auth/SSO regression suites and Android Expo export. Device
validation remains pending. Existing unrelated TypeScript errors are unchanged.

VC39 build f32102cd-d652-401d-bb69-2f665c674d2c (8d2032b) installed on both phones.
Normal launcher entry and the Tickets handoff succeeded with Equipment VC20.
A cold wellbuilt-suite://home link exposed a pre-existing skin redirect race:
Home mounted before authentication/root navigation and crashed both phones.
a4baa9e guards Home mounting and recovery resumption until both are ready, and
hides the native splash when entering these routes directly. The actual route
regressions pass in the 76-test DVIR suite; 266 shift-authority tests also passed.
Android export passed. Replacement VC40 build 7c912b9c-8591-4911-a4c2-45afd03993d1
is running; cold-link device validation remains pending.

VC40 finished at 18:49 UTC and is now installed on both phones. Cold Home links
survive on both; ZFold additionally passed an explicit force-stop/cold-link check.
Fresh Home screenshots show MikeS24 off shift after its completed Post-Trip closed
period 2026-09-12_020000 (authority version 7), while Mikezfold remains on
2026-09-12_110729 (version 9). The entered ending odometer was corrected to 5943
at Mike's request. This is not a claim that 5943 is the shift's total distance.

Equipment VC20 replayed its original Pre-Trip launch after successful Post-Trip
return, stealing foreground from the pending Suite close. Foregrounding Suite
allowed the already-authorized close to complete; no inspection was repeated.
Equipment's replay correction is committed separately and awaits VC21 device tests.

VC41 build ea92b319-a131-4506-a233-bb5b696d50db finished with source
ace08ad3d2da945abbb3d3d4e9b520a92942b1a9. Completion handling and recovery now
wait for verified SSO session readiness and root navigation; failed receipt
handling can retry instead of permanently marking the URL handled too early.
Validation: 77 DVIR tests, 56 SSO P0 tests and Android export pass. Existing
unrelated TypeScript failures remain.

Installed VC41 with retained app data on both phones alongside Equipment VC21.
Both survived force-stop followed by a cold Home deep link. S24 shows Start Shift;
ZFold shows its active shift. Firebase confirms S24 closed at authority version 7
and ZFold still on 2026-09-12_110729 at version 9. The actual signed Pre-Trip
return to a cold Suite remains pending, so this does not yet establish end-to-end
completion of the handoff fixes.

The driver completed Mikezfold's current Pre-Trip with Equipment VC21 after Suite
was force-stopped. The return reached Suite VC41 and Firebase contains that exact
period's Pre-Trip, no Post-Trip, with authority unchanged at version 9. Equipment
still attempted internal reauthorization after consumption; its follow-up fixes
that mounted-route transition and waits for explicit Return to Suite on reports.

The next Suite update checks authenticated Home for server-owned unfinished
Post-Trips outside the active period, including off-shift recovery. Its modal
identifies the original shift and explains that close-out does not clock in or
reopen it. Optional reason/notes are separate feedback, never inspection evidence.
Recovery handoffs require an authenticated server lookup for the current identity
generation and Post-Trip-only server issuance; normal Pre-Trip/shift checks remain.
JSA remains disabled; this implementation covers DVIR recovery only.

Validation: 80 DVIR tests, 58 SSO P0 tests and Android export pass. Recovery lookup
tests include account switches, wrong owner, malformed responses and off-shift
Home without premature SSO launch. Existing unrelated typecheck errors remain.
Replacement build and physical recovery-modal verification remain pending.

Final recovery refinements: cold auth readiness rechecks the server-owned recovery
after reconciliation, discarding results from superseded reads. After a recovered
Post-Trip returns Home, the recovery host retires the old Suite handoff only once
the server no longer lists that inspection; any next older obligation can surface
immediately. This never runs the current-shift arrival handler. VC42/43 builds
were canceled before installation to include these changes together in VC44.
The full Suite SSO suite now passes 173 tests after locating the newer JSA branch
at its expected sibling path; 80 DVIR and 266 shift-authority tests also pass.
