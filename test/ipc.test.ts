import { describe, it, expect } from 'vitest'
import { IPC } from '../src/shared/ipc'

describe('IPC contract', () => {
  it('has unique channel string values', () => {
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })

  it('namespaces every channel with a "<domain>:<action>" shape', () => {
    for (const v of Object.values(IPC)) {
      expect(v).toMatch(/^[a-z]+:[A-Za-z]+$/)
    }
  })
})
