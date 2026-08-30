# Round 5 audit

Seven lenses aimed at the round-4 batch itself, on the principle that new code is where new bugs
are and the person who wrote it already believes it is correct. 32 candidates, each refuted from
three independent angles; 16 survived.

**This round was partial.** 34 of its agents died on a session limit, so the store, layout,
regression-sweep and production-gaps lenses did not finish. Their findings are not "none"; they are
"not looked at". Re-run those four before treating this round as closed.

The headline: round 4's own flush fix was **dead code in the product**, and round 4's own test was
**vacuous**. Both were caught here, neither by the tests that were supposed to cover them.

| Item | Status |
| --- | --- |
| 1. Stop handshake unreachable: `stop()` killed before `@stop` could be read, AND `stopSim()` nulled `simRunId` so the renderer discarded the flush anyway | done, `test/simStop.test.ts` |
| 2. `workspaceScopedReset` leaks 3 of 4 `.cortex/config.json` keys (compiler/std/optimization) | done, `loadProjectConfig` is authoritative with the two-level fallback chain |
| 3. `movePart` did not clamp: a dragged part could be stranded outside the viewBox and persisted | done, `clampToSpace` shared by all three producers |
| 4. Serial overload set never diffed against Arduino's `Print.h`: `print(char,int)` swallowed the base, 64-bit sign extension, unsigned printed as signed | done, 5 new cases in `test/arduinoShim.test.ts` |
| 5. `test/workspaceReset.test.ts` had three guards that could not fail | done, each mutation-checked |
| 6. Three files disagree about whether the sidebar is on screen in the simulator | done, App was right: sidebar visibility is independent of mainView |
| 7. `addPart` indexed spawn slots by array length, so an add after a delete landed on an existing part | done, `freeSpawnPoint` |
| 8. `test/zzrepro.test.ts` scratch file left in the committed suite | done, removed (an audit agent wrote it) |

## What this round is really about

Round 4 added a flush path to the shim (`__flushResidue`, `~SerialClass`, `__sim_exit`) and a test
that proved it worked. Both were true. The product still never flushed, because `simService.stop()`
wrote `@stop` and killed the child in the same tick, so the sketch never read it. Measured:

| stop sequence | exit code | stdout |
| --- | --- | --- |
| product (write then kill) | `null` | `""` |
| 250ms grace | `0` | `"@serial Ready..."` |

The test could not catch it because `runSketch` substitutes `int main(){ setup(); __sim_exit(0); }`,
which never calls `loop()` and never stops. `test/simStop.test.ts` now builds with the product's own
`SIM_MAIN` and drives the product's own stop.

And the fix needed a second file that was easy to miss: `stopSim()` nulled `simRunId` immediately,
while both sim event handlers drop events whose id does not match. Fixing only the main process
would have flushed the line and then thrown it away in the renderer.

## The lesson about tests

`test/workspaceReset.test.ts` asserted `viaSpread`, a function of the key's own name and the literal
text `'...SIM_PIN_RESET'`, never of what that constant contained. Deleting `simPinModes` from the
source left every test green, including the one called `clears simPinModes`. Its early-return scan
filtered on the same properties it then asserted, so it compared `[]` to `[]`.

Both are fixed, and each guard is now mutation-checked: break the source, confirm red, restore,
confirm green. A test that has never been seen to fail has not been shown to work.


## Round 6 (not run)

Four lenses died on a session limit and were never replaced: **store**, **layout**,
**regression-sweep**, **production-gaps**. Their absence is not a clean bill of health. Re-run them
against the current tree before shipping.

The production-gaps lens in particular never reported, so the following are believed-open and
unexamined: code signing and notarization (an unsigned build shows a SmartScreen warning on first
launch), auto-update, crash reporting, and what a first run looks like on a machine with no
compiler at all.

## Corrections this round made to earlier work

Round 4's P13 ("setSidebar ignores mainView") was fixed on a **false premise**: it assumed the
sidebar is not on screen in the Simulator. `App.tsx` renders it beside whichever main view is up,
and the screenshots show it. The real defect was that the ActivityBar's highlight was gated on
`mainView === 'editor'`, so the icon read "off" while the panel was plainly visible, and clicking it
hid a panel the user believed was already hidden. P13's fix made that worse by also yanking the user
out of the Simulator. Both are now corrected to the one model the renderer actually implements.
