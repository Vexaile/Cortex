# Production readiness

Written to be read by someone deciding whether to ship, so it leads with what is not done.

## Blockers

These are the things that make the current build unshippable to strangers, not merely imperfect.

1. **The build is unsigned and unnotarized.** `electron-builder.yml` has no `certificateFile`,
   no `notarize`. On Windows the first launch shows a SmartScreen "unrecognized app" wall that most
   people will not click through; on macOS Gatekeeper refuses outright. Needs an Authenticode cert
   (Windows) and an Apple Developer ID plus notarization (macOS). This is procurement and CI
   secrets, not code.
2. **No auto-update.** No `electron-updater`, no feed. Every fix after v1 requires the user to find
   and download a new installer, so in practice they never get it.
3. **No crash reporting.** `src/main/index.ts` has global `uncaughtException` and
   `unhandledRejection` handlers, so a crash does not silently white-screen, but nothing reports it.
   The first thing a real user base produces is crashes you cannot see.
4. **Never installed from an installer.** Everything here was verified with `electron .` against
   `out/`. `npm run build` passes, but the packaged NSIS/dmg output has not been produced or run
   once. Until it has, the app is unverified in the one configuration users get.

## Verified working

Claims here were checked by running the thing, not by reading it.

- **C++23 is real.** A sketch using `if consteval`, `std::to_underlying` and ranges pipelines
  compiles and runs (`examples/cpp23/main.cpp`); forcing `-std=c++11` fails it. This is the core
  pitch and it holds.
- **The simulator runs the user's actual code.** Their real `setup()`/`loop()` compile against a
  host shim and drive the canvas. Verified end to end, including stop, flush and exit code
  (`test/simStop.test.ts` builds with the product's own `SIM_MAIN`).
- **The Arduino surface matches the real core** for the idioms that were tested: float formatting,
  base formatting and width, byte vs char, pin round-trips, PWM range, the A0 remap
  (`test/arduinoShim.test.ts`, 17 cases, each compiled and run with host g++).
- **Diagnostics point at the user's file.** `#line` injection means a compile error names
  `mysketch.ino:4:15`, not the generated `sketch.cpp`.
- **Workspace switching is clean.** Opening another folder stops running processes and resets every
  workspace-scoped key (`test/workspaceReset.test.ts`, each guard mutation-checked).
- **The layout survives a small window.** Verified at 1000x680 with every panel open: no control is
  clipped or unreachable.
- **Contrast meets WCAG AA** for every token pair the app renders text in (`test/contrast.test.ts`,
  26 pairs computed, not eyeballed).

## Known gaps, deliberate

- **No LSP.** No clangd/pyright/rust-analyzer, so there is no go-to-definition, no real
  completion, no hover types. Monaco gives syntax highlighting and nothing more. This is the
  largest gap between Cortex and CLion, and it is a project, not a patch.
- **The AI assistant is a chat panel, not an agent.** It streams from a provider the user configures
  and can read the current file. It cannot edit, run, or iterate. The pitch is "Cursor for
  embedded"; this is not yet that.
- **The simulator is a logic model, not an electrical one.** It says so on the canvas. No current,
  no timing accuracy, no analog behaviour beyond a value on a pin. A cycle-accurate AVR core
  (avr8js) is the honest next step.
- **The simulator models an Uno only.** Selecting another board shows a chip saying so.
- **Uploading to hardware needs arduino-cli** installed separately. The toolbar says so and gives
  the install command.
- **No ROS2.** See `docs/SIMULATOR.md`.

## Test suite

302 tests, 13 files. What they do and do not cover:

- `arduinoShim`, `simStop` compile and run real binaries with host g++. They are skipped where g++
  is absent, and a CI-only guard fails if CI ever loses its compiler, so the suite cannot silently
  become vacuous.
- `workspaceReset`, `settingsDefaults` read source text rather than importing the store (the test
  env is node, the store reaches for `window`). This is a real limitation: they assert on the shape
  of the code, not its behaviour, and a harmless refactor can break them. Each guard has been
  mutation-checked (break the source, confirm red) so at least they are known to fail when they
  should.
- **There is no renderer test.** No jsdom, so no component renders in the suite. Every UI claim
  above rests on screenshots of a real boot. This is the biggest hole in the suite.

## Honest note on process

Two rounds of multi-agent audit found, in the code written by the previous round: a flush path that
was dead in the product while its test was green, and a reset test with three guards that could not
fail. Both were written by someone (me) who believed they worked and had a green suite to point at.
The lesson worth keeping is in `docs/AUDIT-ROUND5.md`: a test that has never been seen to fail has
not been shown to work.
