/**
 * Shell-style command-history navigation for a single-line input.
 *
 * Pure so it can be unit-tested away from React: given the history (oldest
 * first), the current cursor index, and a direction, it returns the next index
 * and what the input field should show. `index` is -1 while the user is editing
 * a fresh (un-recalled) line; ArrowUp walks toward older entries and ArrowDown
 * back toward the fresh line. `input === null` means "there is nothing to
 * navigate, leave the field (and the caller's default key handling) alone".
 */
export interface HistoryStep {
  index: number
  input: string | null
}

export function stepHistory(history: string[], index: number, dir: 'up' | 'down'): HistoryStep {
  if (dir === 'up') {
    if (history.length === 0) return { index, input: null }
    // From a fresh line jump to the most recent; otherwise step one older,
    // clamping at the oldest entry.
    const next = index < 0 ? history.length - 1 : Math.max(0, index - 1)
    return { index: next, input: history[next] }
  }
  // down
  if (index < 0) return { index: -1, input: null } // already on the fresh line
  const next = index + 1
  // Past the newest entry returns to an empty fresh line.
  if (next >= history.length) return { index: -1, input: '' }
  return { index: next, input: history[next] }
}
