import { describe, it, expect } from 'vitest'
import {
  resolve,
  addTab,
  focusPath,
  focusInGroup,
  focusGroup,
  removeTab,
  moveTab,
  reorderTab,
  type GroupState
} from '../src/shared/editorGroups'

interface T {
  path: string
  group: number
}
const tab = (path: string, group = 0): T => ({ path, group })
const state = (tabs: T[], activeGroup = 0, groupActive: Record<number, string | null> = {}): GroupState<T> => ({
  tabs,
  activeGroup,
  groupActive
})
const paths = (tabs: T[], g: number): string[] => tabs.filter((t) => t.group === g).map((t) => t.path)

describe('resolve', () => {
  it('is single-pane when everything is in group 0', () => {
    const r = resolve(state([tab('a'), tab('b')], 0, { 0: 'b' }))
    expect(r.split).toBe(false)
    expect(r.activePath).toBe('b')
  })

  it('collapses group 1 into group 0 when group 0 empties', () => {
    const r = resolve(state([tab('a', 1), tab('b', 1)], 1, { 0: null, 1: 'a' }))
    expect(r.split).toBe(false)
    expect(paths(r.tabs, 0)).toEqual(['a', 'b'])
    expect(r.activeGroup).toBe(0)
    expect(r.activePath).toBe('a')
  })

  it('clusters group 0 before group 1 while preserving order', () => {
    const r = resolve(state([tab('a', 1), tab('b', 0), tab('c', 1), tab('d', 0)], 0, { 0: 'b', 1: 'a' }))
    expect(r.tabs.map((t) => t.path)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('repairs a group active path that points at nothing', () => {
    const r = resolve(state([tab('a'), tab('b')], 0, { 0: 'gone' }))
    expect(r.activePath).toBe('b') // last tab in the group
  })
})

describe('addTab / focus', () => {
  it('adds to the active group and focuses it', () => {
    const r = addTab(state([tab('a')], 0, { 0: 'a' }), { path: 'b' })
    expect(paths(r.tabs, 0)).toEqual(['a', 'b'])
    expect(r.activePath).toBe('b')
  })

  it('adds to group 1 when group 1 is active (a split)', () => {
    const s = state([tab('a', 0), tab('b', 1)], 1, { 0: 'a', 1: 'b' })
    const r = addTab(s, { path: 'c' })
    expect(paths(r.tabs, 1)).toEqual(['b', 'c'])
    expect(r.activeGroup).toBe(1)
    expect(r.activePath).toBe('c')
  })

  it('focusPath activates the group that holds the path', () => {
    const s = state([tab('a', 0), tab('b', 1)], 0, { 0: 'a', 1: 'b' })
    const r = focusPath(s, 'b')
    expect(r.activeGroup).toBe(1)
    expect(r.activePath).toBe('b')
  })

  it('focusInGroup and focusGroup set the active group', () => {
    const s = state([tab('a', 0), tab('b', 1)], 0, { 0: 'a', 1: 'b' })
    expect(focusInGroup(s, 1, 'b').activePath).toBe('b')
    expect(focusGroup(s, 1).activePath).toBe('b')
  })
})

describe('removeTab', () => {
  it('activates the previous sibling', () => {
    const r = removeTab(state([tab('a'), tab('b'), tab('c')], 0, { 0: 'c' }), 'c')
    expect(r.activePath).toBe('b')
  })

  it('falls back to the next sibling when removing the first', () => {
    const r = removeTab(state([tab('a'), tab('b')], 0, { 0: 'a' }), 'a')
    expect(r.activePath).toBe('b')
  })

  it('collapses the split when the last tab of group 1 closes', () => {
    const s = state([tab('a', 0), tab('b', 1)], 1, { 0: 'a', 1: 'b' })
    const r = removeTab(s, 'b')
    expect(r.split).toBe(false)
    expect(r.activeGroup).toBe(0)
    expect(r.activePath).toBe('a')
  })

  it('leaves an empty editor when the last tab of all closes', () => {
    const r = removeTab(state([tab('a')], 0, { 0: 'a' }), 'a')
    expect(r.activePath).toBeNull()
    expect(r.split).toBe(false)
  })
})

describe('moveTab (split)', () => {
  it('creates a second group when a tab moves to group 1', () => {
    const s = state([tab('a'), tab('b')], 0, { 0: 'b' })
    const r = moveTab(s, 'b', 1)
    expect(r.split).toBe(true)
    expect(paths(r.tabs, 0)).toEqual(['a'])
    expect(paths(r.tabs, 1)).toEqual(['b'])
    expect(r.activeGroup).toBe(1)
    expect(r.activePath).toBe('b')
  })

  it('moving the moved tab back collapses the split', () => {
    const s = state([tab('a', 0), tab('b', 1)], 1, { 0: 'a', 1: 'b' })
    const r = moveTab(s, 'b', 0)
    expect(r.split).toBe(false)
    expect(paths(r.tabs, 0)).toEqual(['a', 'b'])
  })

  it('moving the only tab of group 0 to group 1 collapses back to a single pane', () => {
    const s = state([tab('a')], 0, { 0: 'a' })
    const r = moveTab(s, 'a', 1)
    // group 0 would be empty, so resolve slides group 1 back to 0
    expect(r.split).toBe(false)
    expect(paths(r.tabs, 0)).toEqual(['a'])
  })
})

describe('reorderTab', () => {
  it('reorders within the group', () => {
    const r = reorderTab(state([tab('a'), tab('b'), tab('c')], 0, { 0: 'a' }), 'a', 2)
    expect(paths(r.tabs, 0)).toEqual(['b', 'c', 'a'])
  })

  it('clamps an out-of-range index', () => {
    const r = reorderTab(state([tab('a'), tab('b')], 0, { 0: 'a' }), 'a', 99)
    expect(paths(r.tabs, 0)).toEqual(['b', 'a'])
  })

  it('does not touch the other group', () => {
    const s = state([tab('a', 0), tab('b', 0), tab('x', 1), tab('y', 1)], 0, { 0: 'a', 1: 'x' })
    const r = reorderTab(s, 'a', 1)
    expect(paths(r.tabs, 0)).toEqual(['b', 'a'])
    expect(paths(r.tabs, 1)).toEqual(['x', 'y'])
  })
})
