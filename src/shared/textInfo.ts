/**
 * Small pure helpers describing the active file's text, for the status bar.
 * Kept here (not in a component) so they are unit-testable and cannot claim a
 * value the file does not actually have.
 */

/**
 * The line-ending style of a file, read from its own content: CRLF if any
 * carriage-return + newline pair is present, otherwise LF. A file with no line
 * break yet reads as LF, the editor's default for a new document.
 */
export function lineEnding(content: string): 'CRLF' | 'LF' {
  return content.includes('\r\n') ? 'CRLF' : 'LF'
}
