/**
 * Editor-group layout: the logic behind splitting the editor into two
 * side-by-side groups (like VS Code / JetBrains / Visual Studio split panes).
 * Kept pure and store-agnostic so every transition (open, focus, close, move to
 * the other group, reorder, split) is unit-tested without the store or a DOM.
 *
 * Model: each open tab carries a `group` number (0 or 1). Content and identity
 * still live on the tab; this only decides which pane shows it and which tab is
 * active in each pane. `activePath` (what the rest of the app treats as the
 * focused file) is always the active tab of the active group.
 */

export const MAX_GROUPS = 2

export interface GroupTab {
  path: string
  group: number
}

export interface GroupState<T extends GroupTab> {
  tabs: T[]
  activeGroup: number
  groupActive: Record<number, string | null>
}

export interface ResolvedGroups<T extends GroupTab> extends GroupState<T> {
  /** The active tab of the active group; the rest of the app reads this. */
  activePath: string | null
  /** True when a second group exists (the editor is split). */
  split: boolean
}

const inGroup = <T extends GroupTab>(tabs: T[], g: number): T[] => tabs.filter((t) => t.group === g)

/**
 * Enforce the layout invariants after any mutation:
 *  - at most two groups (0 and 1), group 0 always the left pane;
 *  - if group 0 is empty but group 1 is not, group 1 slides left into group 0
 *    (the split collapses back to a single pane);
 *  - tabs are clustered group 0 then group 1, preserving order within each;
 *  - each group's active path points at a tab actually in that group;
 *  - the active group is a non-empty group.
 */
export function resolve<T extends GroupTab>(state: GroupState<T>): ResolvedGroups<T> {
  let tabs = state.tabs
  const groupActive: Record<number, string | null> = { 0: state.groupActive[0] ?? null, 1: state.groupActive[1] ?? null }
  let activeGroup = state.activeGroup === 1 ? 1 : 0

  // Collapse: never leave group 1 populated while group 0 is empty.
  if (inGroup(tabs, 0).length === 0 && inGroup(tabs, 1).length > 0) {
    tabs = tabs.map((t) => (t.group === 1 ? { ...t, group: 0 } : t))
    groupActive[0] = groupActive[1]
    groupActive[1] = null
    activeGroup = 0
  }

  // Cluster group 0 then group 1, order preserved within each (filter is stable).
  tabs = [...inGroup(tabs, 0), ...inGroup(tabs, 1)]

  // Repair each group's active path.
  for (const g of [0, 1]) {
    const paths = inGroup(tabs, g).map((t) => t.path)
    if (groupActive[g] === null || !paths.includes(groupActive[g] as string)) {
      groupActive[g] = paths.length ? paths[paths.length - 1] : null
    }
  }

  // The active group must be non-empty.
  if (inGroup(tabs, activeGroup).length === 0) {
    activeGroup = inGroup(tabs, 0).length ? 0 : inGroup(tabs, 1).length ? 1 : 0
  }

  return {
    tabs,
    activeGroup,
    groupActive,
    activePath: groupActive[activeGroup] ?? null,
    split: inGroup(tabs, 1).length > 0
  }
}

/** Add a new tab to the active group and focus it. */
export function addTab<T extends GroupTab>(state: GroupState<T>, tab: Omit<T, 'group'> & Partial<Pick<T, 'group'>>): ResolvedGroups<T> {
  const group = state.activeGroup === 1 ? 1 : 0
  const full = { ...tab, group } as T
  return resolve({
    tabs: [...state.tabs, full],
    activeGroup: group,
    groupActive: { ...state.groupActive, [group]: full.path }
  })
}

/** Focus an already-open path in whichever group holds it. */
export function focusPath<T extends GroupTab>(state: GroupState<T>, path: string): ResolvedGroups<T> {
  const tab = state.tabs.find((t) => t.path === path)
  if (!tab) return resolve(state)
  return resolve({
    tabs: state.tabs,
    activeGroup: tab.group,
    groupActive: { ...state.groupActive, [tab.group]: path }
  })
}

/** Focus a path within a specific group (a tab-strip click). */
export function focusInGroup<T extends GroupTab>(state: GroupState<T>, group: number, path: string): ResolvedGroups<T> {
  return resolve({ tabs: state.tabs, activeGroup: group, groupActive: { ...state.groupActive, [group]: path } })
}

/** Make a group the active one (a click inside its pane). */
export function focusGroup<T extends GroupTab>(state: GroupState<T>, group: number): ResolvedGroups<T> {
  return resolve({ ...state, activeGroup: group })
}

/** Remove a tab, choosing a sensible neighbor to activate in its group. */
export function removeTab<T extends GroupTab>(state: GroupState<T>, path: string): ResolvedGroups<T> {
  const tab = state.tabs.find((t) => t.path === path)
  if (!tab) return resolve(state)
  const siblings = inGroup(state.tabs, tab.group)
  const idx = siblings.findIndex((t) => t.path === path)
  const neighbor = siblings[idx - 1]?.path ?? siblings[idx + 1]?.path ?? null
  const groupActive = { ...state.groupActive }
  if (groupActive[tab.group] === path) groupActive[tab.group] = neighbor
  return resolve({ tabs: state.tabs.filter((t) => t.path !== path), activeGroup: state.activeGroup, groupActive })
}

/**
 * Move a tab into a target group (drag-to-split, or drag between groups). A
 * target of 1 when no second group exists is what creates the split; moving the
 * last tab out of group 0 collapses through resolve().
 */
export function moveTab<T extends GroupTab>(state: GroupState<T>, path: string, targetGroup: number): ResolvedGroups<T> {
  const tab = state.tabs.find((t) => t.path === path)
  if (!tab) return resolve(state)
  const g = targetGroup === 1 ? 1 : 0
  const groupActive = { ...state.groupActive }
  // Give the source group a neighbor to fall back to, and focus the moved tab in the target.
  if (g !== tab.group) {
    const siblings = inGroup(state.tabs, tab.group)
    const idx = siblings.findIndex((t) => t.path === path)
    if (groupActive[tab.group] === path) groupActive[tab.group] = siblings[idx - 1]?.path ?? siblings[idx + 1]?.path ?? null
  }
  groupActive[g] = path
  return resolve({
    tabs: state.tabs.map((t) => (t.path === path ? { ...t, group: g } : t)),
    activeGroup: g,
    groupActive
  })
}

/** Reorder a tab within its own group to `toIndex` (clamped). */
export function reorderTab<T extends GroupTab>(state: GroupState<T>, path: string, toIndex: number): ResolvedGroups<T> {
  const tab = state.tabs.find((t) => t.path === path)
  if (!tab) return resolve(state)
  const g = tab.group
  const siblings = inGroup(state.tabs, g)
  const from = siblings.findIndex((t) => t.path === path)
  const [moved] = siblings.splice(from, 1)
  siblings.splice(Math.max(0, Math.min(toIndex, siblings.length)), 0, moved)
  const other = inGroup(state.tabs, g === 0 ? 1 : 0)
  const tabs = g === 0 ? [...siblings, ...other] : [...other, ...siblings]
  return resolve({ tabs, activeGroup: state.activeGroup, groupActive: state.groupActive })
}
