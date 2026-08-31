// Vite (electron-vite's main build) inlines `?raw` imports as the file's text.
// This ambient declaration lets tsc accept them. Used to ship the agent's
// operating-manual markdown as a system prompt without a runtime file read.
declare module '*.md?raw' {
  const content: string
  export default content
}
