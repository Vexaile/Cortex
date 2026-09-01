import { describe, it, expect } from 'vitest'
import {
  tokenize,
  sectionizeMarkdown,
  sectionizePlainText,
  buildIndex,
  queryIndex,
  formatCitation,
  formatDocHits,
  enrichQueryFromGraph,
  matchDeviceForDoc,
  type DatasheetDoc
} from '../src/shared/datasheet'
import { buildHardwareGraph, KNOWN_DEVICES, DEVICE_MAP } from '../src/shared/hardwareGraph'
import type { ProjectModel } from '../src/shared/ipc'

describe('tokenize', () => {
  it('keeps technical tokens whole (addresses, registers, pins)', () => {
    expect(tokenize('Write 0x68 to TIM2->PSC on GPIO5 (PA5)')).toEqual(['write', '0x68', 'to', 'tim2', 'psc', 'on', 'gpio5', 'pa5'])
  })
  it('drops empties and is case-insensitive', () => {
    expect(tokenize('  I2C,  SDA / SCL ')).toEqual(['i2c', 'sda', 'scl'])
  })
})

describe('sectionizeMarkdown', () => {
  const md = `Intro line before any heading.

# Registers
The PWR_MGMT_1 register is at 0x6B.

## Wake up
Clear the sleep bit to wake the device.`

  it('splits by heading with 1-based start lines and titles', () => {
    const s = sectionizeMarkdown(md)
    expect(s.map((x) => x.title)).toEqual([undefined, 'Registers', 'Wake up'])
    expect(s[0].line).toBe(1) // pre-heading content
    expect(s[1].line).toBe(3) // "# Registers"
    expect(s[2].line).toBe(6) // "## Wake up"
    expect(s[1].text).toContain('0x6B')
  })

  it('keeps a heading-only section', () => {
    const s = sectionizeMarkdown('# Empty section\n# Next\nbody')
    expect(s.map((x) => x.title)).toEqual(['Empty section', 'Next'])
  })
})

describe('sectionizePlainText', () => {
  it('splits into paragraphs with the line each starts on', () => {
    const txt = 'first para line1\nfirst para line2\n\n\nsecond para'
    const s = sectionizePlainText(txt)
    expect(s).toHaveLength(2)
    expect(s[0].line).toBe(1)
    expect(s[1].line).toBe(5) // after the two blank lines
    expect(s[1].text).toBe('second para')
  })
})

function docs(): DatasheetDoc[] {
  return [
    {
      id: 'mpu6050',
      name: 'MPU6050.md',
      path: '.cortex/datasheets/MPU6050.md',
      sections: [
        { line: 1, title: 'Power management', text: 'The PWR_MGMT_1 register (0x6B) controls sleep mode. On reset the device sleeps; clear bit 6 to wake it.' },
        { line: 5, title: 'I2C address', text: 'The 7-bit I2C address is 0x68, or 0x69 when AD0 is high.' }
      ]
    },
    {
      id: 'bme280',
      name: 'BME280.md',
      path: '.cortex/datasheets/BME280.md',
      sections: [{ line: 1, title: 'Humidity', text: 'The humidity measurement is enabled via ctrl_hum before ctrl_meas.' }]
    }
  ]
}

describe('buildIndex + queryIndex (BM25 retrieval with citations)', () => {
  it('ranks the most relevant section first and carries provenance', () => {
    const hits = queryIndex(buildIndex(docs()), 'how do I wake the mpu6050 from sleep', 3)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].citation).toMatchObject({ docId: 'mpu6050', docName: 'MPU6050.md', title: 'Power management', line: 1 })
    expect(hits[0].text).toContain('PWR_MGMT_1')
    // scores are descending
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score)
  })

  it('finds a section by a hex address token', () => {
    const hits = queryIndex(buildIndex(docs()), '0x68', 3)
    expect(hits[0].citation.title).toBe('I2C address')
  })

  it('never returns a zero-score (non-matching) section as a citation', () => {
    const hits = queryIndex(buildIndex(docs()), 'stepper motor microstepping', 5)
    expect(hits).toEqual([]) // nothing in the corpus matches
  })

  it('is deterministic and respects k', () => {
    const idx = buildIndex(docs())
    expect(queryIndex(idx, 'register address device', 1)).toHaveLength(1)
    expect(JSON.stringify(queryIndex(idx, 'register address device', 3))).toBe(
      JSON.stringify(queryIndex(idx, 'register address device', 3))
    )
  })

  it('returns nothing for an empty query or empty corpus', () => {
    expect(queryIndex(buildIndex(docs()), '   ', 3)).toEqual([])
    expect(queryIndex(buildIndex([]), 'anything', 3)).toEqual([])
  })

  it('never shows an empty passage for a heading-only match (falls back to the heading)', () => {
    // A heading-only section matched by its title must display the heading text,
    // not an empty body (finding 5).
    const doc: DatasheetDoc = {
      id: 'd',
      name: 'D.md',
      path: '.cortex/datasheets/D.md',
      sections: [{ line: 1, title: 'Interrupt Vectors', text: '' }]
    }
    const hits = queryIndex(buildIndex([doc]), 'interrupt vectors', 3)
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe('Interrupt Vectors') // heading, verbatim, never empty
  })
})

describe('citations are honest and verbatim', () => {
  it('formats a citation with section and line, page only when present', () => {
    expect(formatCitation({ docId: 'd', docName: 'MPU6050.md', path: 'p', line: 5, title: 'I2C address' })).toBe(
      'MPU6050.md > I2C address [L:5]'
    )
    expect(formatCitation({ docId: 'd', docName: 'X.pdf', path: 'p', line: 5, page: 12 })).toBe('X.pdf [p.12 L:5]')
  })

  it('formatDocHits emits the citation + the verbatim passage, and says so when empty', () => {
    const hits = queryIndex(buildIndex(docs()), '0x68', 1)
    const out = formatDocHits(hits)
    expect(out).toContain('MPU6050.md > I2C address [L:5]')
    expect(out).toContain('0x68') // verbatim passage text
    expect(formatDocHits([])).toMatch(/No matching passage/i)
  })
})

function model(headers: string[]): ProjectModel {
  return {
    languages: [],
    boards: [{ name: 'ESP32 Dev', platform: 'esp32', framework: 'arduino' }],
    toolchains: [],
    pins: [],
    pinsTruncated: false,
    buses: [{ file: 'm.ino', line: 6, bus: 'i2c', instance: 'Wire', role: 'begin', address: '0x68' }],
    busesTruncated: false,
    libraries: headers.map((h, i) => ({ file: 'm.ino', line: i + 1, header: h })),
    librariesTruncated: false
  }
}

describe('enrichQueryFromGraph', () => {
  it('adds the used device terms for a generic hardware question, without bare-number noise', () => {
    const graph = buildHardwareGraph(model(['Adafruit_MPU6050.h']))
    const { terms, deviceKeys } = enrichQueryFromGraph(graph, 'why is my I2C sensor not responding?')
    expect(deviceKeys).toContain('mpu6050')
    expect(terms.map((t) => t.toLowerCase())).toContain('mpu6050')
    expect(terms).toContain('MPU6050') // the label, verbatim
    expect(terms).toContain('accelerometer') // a meaningful description word
    expect(terms).not.toContain('6') // "6-axis" must not inject the bare term "6" (finding 4)
  })

  it('scopes a bus-specific query to devices on that bus, excluding off-bus parts', () => {
    // MPU6050 is on I2C; an SD card is on SPI. "the I2C sensor" must not pull in
    // the SD card's terms.
    const graph = buildHardwareGraph(model(['Adafruit_MPU6050.h', 'SD.h']))
    const { deviceKeys } = enrichQueryFromGraph(graph, 'why will the I2C sensor not respond')
    expect(deviceKeys).toContain('mpu6050')
    expect(deviceKeys).not.toContain('sd-card')
  })

  it('adds nothing device-specific for a query that names no device and no bus', () => {
    const graph = buildHardwareGraph(model(['Adafruit_MPU6050.h']))
    const { deviceKeys } = enrichQueryFromGraph(graph, 'what is the stack size')
    expect(deviceKeys).toEqual([])
  })
})

describe('matchDeviceForDoc + KNOWN_DEVICES', () => {
  it('KNOWN_DEVICES dedupes the header-keyed map by device key', () => {
    const keys = KNOWN_DEVICES.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length) // no duplicates
    // two headers collapse to one device
    expect(DEVICE_MAP['adafruit_mpu6050.h'].key).toBe(DEVICE_MAP['mpu6050.h'].key)
    expect(keys.filter((k) => k === 'mpu6050')).toHaveLength(1)
  })

  it('links a datasheet file name to a device across separators and label alternatives', () => {
    expect(matchDeviceForDoc('MPU6050-datasheet.pdf', KNOWN_DEVICES)).toBe('mpu6050')
    expect(matchDeviceForDoc('ina219.md', KNOWN_DEVICES)).toBe('ina219')
    // Manufacturers hyphenate the part number - must still link (finding 3).
    expect(matchDeviceForDoc('MPU-6050.md', KNOWN_DEVICES)).toBe('mpu6050')
    expect(matchDeviceForDoc('mpu_6050.md', KNOWN_DEVICES)).toBe('mpu6050')
    // A label alternative ("ADS1015/ADS1115") links either real part name.
    expect(matchDeviceForDoc('ADS1115.md', KNOWN_DEVICES)).toBe('ads1x15')
  })

  it('does not match on an incidental substring or a short-key coincidence', () => {
    expect(matchDeviceForDoc('observer-notes.md', KNOWN_DEVICES)).toBeUndefined()
    expect(matchDeviceForDoc('random.txt', KNOWN_DEVICES)).toBeUndefined()
    // "wiring.md" must not link the 2-char "ir" device via a loose substring.
    expect(matchDeviceForDoc('wiring.md', KNOWN_DEVICES)).toBeUndefined()
  })
})
