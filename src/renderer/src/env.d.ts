/// <reference types="vite/client" />

// Vite's ?worker imports resolve to worker constructors.
declare module '*?worker' {
  const workerConstructor: {
    new (): Worker
  }
  export default workerConstructor
}
