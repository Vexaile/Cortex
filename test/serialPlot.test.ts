import { describe, it, expect } from 'vitest'
import { extractSeries } from '../src/shared/serialPlot'

describe('extractSeries', () => {
  it('parses labelled key: value pairs', () =>
    expect(extractSeries('temp: 24.5 voltage: 3300')).toEqual({ temp: 24.5, voltage: 3300 }))
  it('parses key=value form', () => expect(extractSeries('rpm=1200')).toEqual({ rpm: 1200 }))
  it('maps a CSV row of bare numbers to channels', () =>
    expect(extractSeries('1, 2, 3')).toEqual({ ch0: 1, ch1: 2, ch2: 3 }))
  it('maps whitespace-separated numbers to channels', () =>
    expect(extractSeries('10 20 30')).toEqual({ ch0: 10, ch1: 20, ch2: 30 }))
  it('handles negatives and decimals', () => expect(extractSeries('x: -1.5')).toEqual({ x: -1.5 }))
  it('returns nothing for non-numeric noise', () => expect(extractSeries('hello world')).toEqual({}))
  it('parses a full decimal value (the chunk-boundary fix keeps 24.5 intact)', () =>
    expect(extractSeries('t:24.5')).toEqual({ t: 24.5 }))
})
