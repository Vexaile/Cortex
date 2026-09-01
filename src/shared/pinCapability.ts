/**
 * Curated, conservative board pin-capability facts for the Environment Doctor's
 * hardware-aware checks. Pure and dependency-free. The rule of this module is
 * the same as the rest of the dependency system: only assert what is certain for
 * the specific target. We return a capability set only for MCUs whose pinout we
 * can state with confidence, and null otherwise, so an unknown target yields no
 * hardware claim rather than a guess.
 *
 * Capability is keyed on the MCU (the silicon), NOT on the board id in the fqbn.
 * A board-id heuristic cannot be certain: several esp32:esp32 boards are built on
 * the ESP32-S3 die (e.g. the Arduino Nano ESP32, fqbn esp32:esp32:nano_nora, and
 * the Heltec *_V3 family) yet carry ids with no "s3" token, so a name denylist
 * would admit them as classic and assert a false input-only claim. The MCU comes
 * from arduino-cli `board details` (build.mcu), which is ground truth for the die.
 */

export interface PinConflict {
  pin: string
  gpio: number
  role: string
  file: string
  line: number
  reason: string
}

export interface PinUse {
  pin: string
  role: string
  mode?: string
  file: string
  line: number
}

/**
 * GPIOs that are input-only (no output driver, no PWM) on a target MCU. Returns
 * null when the MCU's pinout is not one we can state with certainty.
 *
 * The classic ESP32 die (build.mcu === "esp32": the ESP32-WROOM/WROVER/PICO
 * modules) routes GPIO34-39 to input-only pads - a well-documented, universally
 * true hardware fact and the single most common ESP32 wiring mistake. The newer
 * variants (esp32s2, esp32s3, the C-series, esp32h2, esp32p4) have different
 * pinouts where
 * these are ordinary bidirectional GPIOs, so we make no claim for them; nor for
 * any other MCU. Matching build.mcu exactly (not a substring) keeps "esp32" from
 * also matching "esp32s3".
 */
export function inputOnlyPins(mcu: string | null | undefined): Set<number> | null {
  if (!mcu) return null
  if (mcu.trim().toLowerCase() === 'esp32') {
    return new Set([34, 35, 36, 37, 38, 39])
  }
  return null
}

/** Parse a GPIO number from a pin token like "34", "GPIO34", or "IO34". Returns
 *  null for anything else (e.g. "A0", "LED_BUILTIN") so it is never guessed. */
export function parseGpio(pin: string): number | null {
  const m = /^(?:gpio|io)?\s*(\d+)$/i.exec(pin.trim())
  return m ? Number(m[1]) : null
}

/** True when a pin role drives the pin as an output (so an input-only pad cannot
 *  satisfy it). Reads/inputs are fine on input-only pads. */
function isOutputRole(role: string, mode?: string): boolean {
  return role === 'digitalWrite' || role === 'analogWrite' || (role === 'pinMode' && /output/i.test(mode ?? ''))
}

/**
 * Find pins driven as outputs that the target MCU routes to input-only pads. Only
 * returns conflicts when the MCU's capability is known (inputOnlyPins != null) and
 * the pin parses to a concrete GPIO number.
 */
export function pinConflicts(mcu: string | null | undefined, pins: PinUse[]): PinConflict[] {
  const inputOnly = inputOnlyPins(mcu)
  if (!inputOnly) return []
  const out: PinConflict[] = []
  const seen = new Set<number>() // one finding per pad, at its first output site
  for (const p of pins) {
    if (!isOutputRole(p.role, p.mode)) continue
    const gpio = parseGpio(p.pin)
    if (gpio == null || !inputOnly.has(gpio) || seen.has(gpio)) continue
    seen.add(gpio)
    out.push({
      pin: p.pin,
      gpio,
      role: p.role,
      file: p.file,
      line: p.line,
      reason: `GPIO${gpio} is input-only on this ESP32 board, so it cannot drive an output (${p.role}). Use an output-capable GPIO.`
    })
  }
  return out
}
