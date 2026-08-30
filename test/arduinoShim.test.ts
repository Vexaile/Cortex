import { describe, it, expect, beforeAll } from 'vitest'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ARDUINO_SHIM } from '../src/main/services/arduinoShim'

const run = promisify(execFile)

/**
 * Compiles real sketches against the shim with the host g++ and asserts what
 * the user sees on stdout. The shim's job is to behave like the Arduino core;
 * only compiling and running it can prove that. Skipped where g++ is absent.
 */

const hasGpp = spawnSync('g++', ['--version']).status === 0

/**
 * skipIf is a trapdoor: without this, a CI image that lost g++ would skip every
 * assertion below and still report green. Local machines without a compiler
 * skip quietly, which is the point of skipIf; CI must not.
 */
describe('test environment', () => {
  it.skipIf(!process.env.CI)('has a host g++, so the shim suite is not silently skipped', () => {
    expect(hasGpp).toBe(true)
  })
})

/**
 * Mirrors simService: Arduino.h + sketch.cpp + a main that runs setup once and
 * leaves through __sim_exit. Going out the same door as the real SIM_MAIN is
 * the point: `return 0` races the shim's detached stdin reader against static
 * destruction and aborts nondeterministically under load.
 *
 * Async, not execFileSync. Sync exec blocks the event loop, which made
 * describe.concurrent a lie (the compiles serialised anyway), stopped vitest's
 * timeouts from ever firing, and reported every test's duration as the whole
 * batch's. Each case spawns its own g++, so async is what actually parallelises.
 */
async function runSketch(body: string): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'cortex-shim-'))
  writeFileSync(join(dir, 'Arduino.h'), ARDUINO_SHIM)
  writeFileSync(join(dir, 'sketch.cpp'), `#include "Arduino.h"\n${body}\nint main(){ setup(); __sim_exit(0); }\n`)
  const exe = join(dir, 'a.exe')
  await run('g++', ['-std=c++23', '-I', dir, join(dir, 'sketch.cpp'), '-o', exe])
  const { stdout } = await run(exe, [], { encoding: 'utf8' })
  return stdout
}

/**
 * Splits the way simService does. Windows stdout translates \n to \r\n, so a
 * bare split('\n') leaves a \r on every payload; the real reader uses /\r?\n/
 * and this must match it or the test measures its own parsing, not the shim's.
 */
const outLines = (out: string): string[] => out.split(/\r?\n/)

/** The @serial payloads only, in order, which is what the Serial pane renders. */
function serialLines(out: string): string[] {
  return outLines(out)
    .filter((l) => l.startsWith('@serial '))
    .map((l) => l.slice('@serial '.length))
}

describe.skipIf(!hasGpp).concurrent('arduinoShim Serial', () => {
  beforeAll(() => {
    expect(ARDUINO_SHIM).toContain('struct SerialClass')
  })

  it('prints floats with 2 decimals like the Arduino core', async () => {
    const out = await runSketch(`void setup(){ Serial.println(3.14159); Serial.println(1.0); }`)
    expect(serialLines(out)).toEqual(['3.14', '1.00'])
  })

  it('does not fall back to scientific notation for large floats', async () => {
    const out = await runSketch(`void setup(){ Serial.println(1000000.0); }`)
    expect(serialLines(out)).toEqual(['1000000.00'])
  })

  // The reason this test file exists: Serial.println(v, 2) is one of the most
  // common Arduino idioms and it did not compile. Because simService injects
  // #line, the error was squiggled onto the user's own correct sketch.
  it('accepts the float-with-digits overload', async () => {
    const out = await runSketch(`void setup(){ float v = 3.14159; Serial.println(v, 3); Serial.println(v, 0); }`)
    expect(serialLines(out)).toEqual(['3.142', '3'])
  })

  it('accepts println(millis(), DEC) without an ambiguous overload', async () => {
    const out = await runSketch(`void setup(){ Serial.println(millis(), DEC); Serial.println(42UL, HEX); }`)
    const lines = serialLines(out)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toBe('2A')
  })

  it('prints a byte as a number, not as a character', async () => {
    const out = await runSketch(`void setup(){ byte b = 200; Serial.println(b); }`)
    expect(serialLines(out)).toEqual(['200'])
  })

  // A byte of 10 is '\n': printing it as a character split one line into two.
  it('does not let a numeric byte inject a line break', async () => {
    const out = await runSketch(`void setup(){ byte b = 10; Serial.print("a"); Serial.print(b); Serial.println("z"); }`)
    expect(serialLines(out)).toEqual(['a10z'])
  })

  it('prints hex in uppercase like the Arduino core', async () => {
    const out = await runSketch(`void setup(){ Serial.println(255, HEX); Serial.println(255, BIN); }`)
    expect(serialLines(out)).toEqual(['FF', '11111111'])
  })

  it('keeps char as a character', async () => {
    const out = await runSketch(`void setup(){ Serial.println('A'); }`)
    expect(serialLines(out)).toEqual(['A'])
  })

  // The core has no print(char, int), so a char promotes to int and the base
  // applies. An exact-match char overload here beat that promotion and threw
  // the base away, printing 'A' for both of these.
  it('applies the base to a char, because the core has no char overload', async () => {
    const out = await runSketch(`void setup(){ Serial.println('A', HEX); Serial.println('A', DEC); }`)
    expect(serialLines(out)).toEqual(['41', '65'])
  })

  // Arduino's long is 32 bits and its Print has no 64-bit overload, so a
  // non-decimal base shows 32 bits however wide the host's type is.
  it('prints a negative at the core width, not the host width', async () => {
    const out = await runSketch(`void setup(){
      Serial.println(-1, HEX);
      Serial.println((long)-1, HEX);
      int r = -5; Serial.println(r, HEX);
      short s = -1; Serial.println(s, HEX);
      Serial.println(-1, BIN);
    }`)
    expect(serialLines(out)).toEqual(['FFFFFFFF', 'FFFFFFFF', 'FFFFFFFB', 'FFFFFFFF', '1'.repeat(32)])
  })

  it('still prints a negative decimal as signed', async () => {
    const out = await runSketch(`void setup(){ Serial.println(-1); Serial.println(-42, DEC); }`)
    expect(serialLines(out)).toEqual(['-1', '-42'])
  })

  // Routing an unsigned through a signed parameter printed ULLONG_MAX as -1.
  it('prints a large unsigned as unsigned', async () => {
    const out = await runSketch(`void setup(){ Serial.println(18446744073709551615ULL); Serial.println(4294967295UL); }`)
    expect(serialLines(out)).toEqual(['18446744073709551615', '4294967295'])
  })

  // Without a flush at exit, a sketch that never prints a newline printed
  // nothing at all for its entire run.
  it('emits a trailing print that has no newline', async () => {
    const out = await runSketch(`void setup(){ Serial.print("Ready..."); }`)
    expect(serialLines(out)).toEqual(['Ready...'])
  })
})

describe.skipIf(!hasGpp).concurrent('arduinoShim pins', () => {
  it('reads back what digitalWrite latched', async () => {
    const out = await runSketch(
      `void setup(){ pinMode(13, OUTPUT); digitalWrite(13, HIGH); Serial.println(digitalRead(13)); }`
    )
    expect(serialLines(out)).toEqual(['1'])
  })

  // digitalRead must return exactly HIGH or LOW. The analog sliders write the
  // same slot with 0..1023, so an unnormalized read leaked 512 into a boolean.
  it('normalizes digitalRead to 0 or 1', async () => {
    const out = await runSketch(
      `void setup(){ pinMode(A0, INPUT); Serial.println(digitalRead(A0) == HIGH || digitalRead(A0) == LOW); }`
    )
    expect(serialLines(out)).toEqual(['1'])
  })

  // @pwm's contract is 0..255 (simProtocol.ts). Emitting raw made the canvas
  // compute brightness and servo angles out of range.
  it('clamps analogWrite to the 8-bit protocol range', async () => {
    const out = await runSketch(`void setup(){ analogWrite(9, 300); analogWrite(10, -5); }`)
    const pwm = outLines(out).filter((l) => l.startsWith('@pwm '))
    expect(pwm).toEqual(['@pwm 9 255', '@pwm 10 0'])
  })

  // ESP32 code (not Uno): the LEDC peripheral. ledcWrite drives the attached
  // pin, scaled from the channel resolution to the 8-bit range the canvas uses.
  // Both the channel API and the 3.0 pin API must work, or ESP32 sketches will
  // not compile against the shim.
  it('drives ESP32 ledc PWM on the attached pin, scaled by resolution', async () => {
    const out = await runSketch(`void setup(){
      ledcSetup(0, 5000, 8); ledcAttachPin(9, 0); ledcWrite(0, 128);
      ledcSetup(1, 5000, 10); ledcAttachPin(10, 1); ledcWrite(1, 512);
      ledcAttach(5, 5000, 8); ledcWrite(5, 64);
    }`)
    const pwm = outLines(out).filter((l) => l.startsWith('@pwm '))
    expect(pwm).toEqual(['@pwm 9 128', '@pwm 10 127', '@pwm 5 64'])
  })

  // The pin-API resolution store must cover the whole GPIO range: GPIO16+ are
  // the common ESP32 PWM pins, and dropping their resolution saturated the duty.
  it('keeps ledc resolution for a high GPIO on the pin API', async () => {
    const out = await runSketch(`void setup(){ ledcAttach(25, 5000, 12); ledcWrite(25, 2048); }`)
    const pwm = outLines(out).filter((l) => l.startsWith('@pwm '))
    // 2048 of 12-bit (4095) is ~50%, i.e. 127/255, NOT saturated at 255.
    expect(pwm).toEqual(['@pwm 25 127'])
  })

  // ledcSetup returns the frequency, so the value can be captured.
  it('lets ledcSetup return the frequency', async () => {
    const out = await runSketch(
      `void setup(){ double f = ledcSetup(0, 5000, 8); Serial.println((int)f); ledcAttachPin(3, 0); ledcWrite(0, 255); }`
    )
    expect(serialLines(out)).toEqual(['5000'])
    expect(outLines(out).filter((l) => l.startsWith('@pwm '))).toEqual(['@pwm 3 255'])
  })

  it('maps analogRead(0) and analogRead(A0) to the same pin', async () => {
    // Drive A0's slot through the named macro, read it back through the bare
    // index. A sketch that mixes the two must see one pin, not two.
    const out = await runSketch(
      `void setup(){ pinMode(A0, OUTPUT); digitalWrite(A0, HIGH); Serial.println(analogRead(0)); }`
    )
    expect(serialLines(out)).toEqual(['1023'])
  })
})
