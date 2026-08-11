import '@testing-library/jest-dom/vitest'

// jsdom has no matchMedia implementation. uPlot calls it unconditionally at
// module load (to watch for device pixel ratio changes), so any test that
// merely imports a module tree containing 'uplot' — even without rendering
// a chart — needs this stub to avoid a TypeError. This is a jsdom gap, not
// a real browser limitation, unlike the Worker global (deliberately left
// unstubbed; see workers/*.test.ts for why real Worker construction is
// outside the unit-test boundary).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}
