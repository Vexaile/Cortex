import { describe, it, expect } from 'vitest'
import { inputOnlyPins, parseGpio, pinConflicts, type PinUse } from '../src/shared/pinCapability'

describe('inputOnlyPins', () => {
  it('knows the classic ESP32 (build.mcu esp32) input-only pads (34-39)', () => {
    const s = inputOnlyPins('esp32')
    expect(s && [...s].sort((a, b) => a - b)).toEqual([34, 35, 36, 37, 38, 39])
  })
  it('matches the MCU exactly, so esp32 does not also match esp32s3', () => {
    // The regression this fix is for: an esp32:esp32 board on the ESP32-S3 die
    // (e.g. Arduino Nano ESP32 / Heltec *_V3) reports build.mcu "esp32s3". A
    // substring test would treat it as classic and assert a false input-only
    // claim; an exact match makes no claim, which is correct for the S3.
    expect(inputOnlyPins('esp32s3')).toBeNull()
    expect(inputOnlyPins('esp32c3')).toBeNull()
    expect(inputOnlyPins('esp32s2')).toBeNull()
    expect(inputOnlyPins('esp32c6')).toBeNull()
    expect(inputOnlyPins('esp32h2')).toBeNull()
    expect(inputOnlyPins('esp32p4')).toBeNull()
  })
  it('is tolerant of case/whitespace around the MCU value', () => {
    expect(inputOnlyPins(' ESP32 ')).not.toBeNull()
  })
  it('makes no claim for other MCUs or a missing MCU', () => {
    expect(inputOnlyPins('atmega328p')).toBeNull()
    expect(inputOnlyPins('mk20dx256')).toBeNull()
    expect(inputOnlyPins(null)).toBeNull()
    expect(inputOnlyPins(undefined)).toBeNull()
    expect(inputOnlyPins('')).toBeNull()
  })
})

describe('parseGpio', () => {
  it('parses bare, GPIO-prefixed, and IO-prefixed numbers', () => {
    expect(parseGpio('34')).toBe(34)
    expect(parseGpio('GPIO34')).toBe(34)
    expect(parseGpio('IO2')).toBe(2)
  })
  it('does not guess a number out of an analog or named pin', () => {
    expect(parseGpio('A0')).toBeNull()
    expect(parseGpio('LED_BUILTIN')).toBeNull()
  })
})

function pin(over: Partial<PinUse>): PinUse {
  return { pin: '34', role: 'digitalWrite', file: 'a.ino', line: 1, ...over }
}

describe('pinConflicts', () => {
  it('flags an output on an input-only pad', () => {
    const c = pinConflicts('esp32', [pin({ pin: '34', role: 'digitalWrite' })])
    expect(c).toHaveLength(1)
    expect(c[0].gpio).toBe(34)
  })
  it('flags analogWrite and pinMode OUTPUT on input-only pads', () => {
    expect(pinConflicts('esp32', [pin({ pin: '35', role: 'analogWrite' })])).toHaveLength(1)
    expect(pinConflicts('esp32', [pin({ pin: '36', role: 'pinMode', mode: 'OUTPUT' })])).toHaveLength(1)
  })
  it('does not flag a read/input use of an input-only pad', () => {
    expect(pinConflicts('esp32', [pin({ pin: '34', role: 'analogRead' })])).toEqual([])
    expect(pinConflicts('esp32', [pin({ pin: '34', role: 'pinMode', mode: 'INPUT' })])).toEqual([])
  })
  it('does not flag an output on an output-capable pad', () => {
    expect(pinConflicts('esp32', [pin({ pin: '25', role: 'digitalWrite' })])).toEqual([])
  })
  it('makes no claim on the ESP32-S3 die, where 34-39 are ordinary GPIOs', () => {
    // The false-claim the review caught: driving GPIO34 as an output is fine on
    // the S3, so no conflict may be reported for it.
    expect(pinConflicts('esp32s3', [pin({ pin: '34', role: 'digitalWrite' })])).toEqual([])
  })
  it('makes no claim when the MCU is unknown', () => {
    expect(pinConflicts('atmega328p', [pin({ pin: '34', role: 'digitalWrite' })])).toEqual([])
    expect(pinConflicts(null, [pin({ pin: '34', role: 'digitalWrite' })])).toEqual([])
  })
  it('reports one conflict per pad even when it is misused at several sites', () => {
    const c = pinConflicts('esp32', [
      pin({ pin: '34', role: 'pinMode', mode: 'OUTPUT', line: 7 }),
      pin({ pin: '34', role: 'digitalWrite', line: 8 })
    ])
    expect(c).toHaveLength(1)
    expect(c[0].line).toBe(7) // the first output site
  })
})
