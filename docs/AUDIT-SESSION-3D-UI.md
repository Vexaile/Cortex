# Session audit: 3D boards + Arduino-IDE UI

A focused adversarial regression audit of the code added in the 3D + UI session
(splash, 3D simulator, board registry, menu bar, ESP32 `ledc`, store additions).
Four lenses, each finding refuted from two independent angles before it survived.
14 candidates, 10 confirmed, collapsing to 6 distinct defects. All fixed.

The audit earned its keep: several of these render fine and only fail on
interaction, which per-iteration screenshotting missed. The Serial button bug in
particular "passed" my own capture only because the panel happened to be open.

| # | Defect | Fix | Verified |
| --- | --- | --- | --- |
| P1 | Serial Monitor/Plotter buttons re-closed the panel when it was hidden (a `toggleBottom()` reading the stale, pre-`setBottom` `bottomVisible`) - dead in exactly the state a user clicks them | Removed the trailing toggle in `MenuBar.tsx` and `TitleBar.tsx`; `setBottom` already reveals the panel | Capture from a CLOSED panel now opens it |
| P2 | Edit/Format menu items acted on a disposed Monaco editor after switching to the Simulator (`window.__cortexEditor` never cleared) | `editor.onDidDispose` clears the global in `CodeEditor.tsx` | typecheck; guard now fires |
| P3 | ESP32 `ledc` dropped resolution for any GPIO >= 16 (arrays were `[16]`), so a fade on GPIO16+ saturated at full brightness | Full-range pin->resolution map (`__ledc_pinres[48]`) in `arduinoShim.ts` | `test/arduinoShim.test.ts` (GPIO25 @ 12-bit -> 127, not 255) |
| P4 | Dragging a part on the Uno also orbited the camera | Gate `<OrbitControls enabled={!dragActive}>` on an active part drag | typecheck; renders |
| P5 | Orbiting empty space after arming a wire cancelled it (backdrop `onClick` had no moved-guard) | Backdrop cancels only on a genuine click (down/up within 5px) | typecheck; renders |
| P6 | Tapping the 3D button to drive `digitalRead` also armed a wire | The button wires from its own connector nub; its body only presses/selects | Capture: RGB + button both show nubs |
| #6 | `ledcSetup` void overload shadowed the frequency-returning one (`double f = ledcSetup(...)` failed to compile) | Single overload returning the frequency | `test/arduinoShim.test.ts` |

P2/P4/P5 are interaction fixes verified by typecheck + intact rendering rather
than a screenshot (orbit-vs-drag and click-vs-orbit are not static frames).

## A bug the fix itself introduced

While fixing P3 I put a backtick in a C++ comment inside the `String.raw` shim
template, which closed the template literal early. The fast g++ check passed (a
backtick is a fine comment in C++) but `tsc` failed to parse the file. This is
why the shim template is typechecked, not just compiled: caught before it shipped.
