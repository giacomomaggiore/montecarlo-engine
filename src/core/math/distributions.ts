// Distribution sampling primitives for the parametric Student's t engine
// (Phase 3.3), layered on the existing deterministic RandomGenerator --
// never on Math.random(). The exact uniform-consumption order of every
// function here is part of a run's reproducible identity: changing any
// algorithm below requires a model-version bump in parametricStudentT.ts,
// exactly as changing the bootstrap's row-selection rule would.

import type { RandomGenerator } from './random'

const TWO_PI = 2 * Math.PI

// Standard normal via the basic Box-Muller transform, one draw per call.
// u1 is drawn as 1 - nextUniform() so it lies in (0, 1] and ln(u1) is always
// finite; u2 stays in [0, 1). The radius sqrt(-2 ln u1) carries the normal's
// tail, the angle 2*pi*u2 its direction; we return the cosine component and
// deliberately DISCARD the sine companion. Trade-off: caching the spare
// normal would halve uniform consumption, but would make the sampler
// stateful -- how many uniforms a scenario consumes would then depend on the
// parity of the entire draw history, a subtle reproducibility hazard for any
// independent reimplementation. Two uniforms per normal at <= ~6.3 million
// normals per maximum-work run costs microseconds; determinism that is
// trivial to describe in prose wins. Time O(1) amortized, Space O(1).
export function nextStandardNormal(random: RandomGenerator): number {
  const u1 = 1 - random.nextUniform()
  const u2 = random.nextUniform()

  // z = sqrt(-2 ln u1) * cos(2 pi u2): exact Gaussian for exact uniforms.
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2)
}

// Gamma(shape, scale = 1) via Marsaglia-Tsang (2000), valid for shape >= 1.
// The method squeezes a gamma out of one normal and one uniform per
// attempt: x ~ N(0,1) is mapped through v = (1 + c*x)^3, and d*v is
// gamma-distributed if the draw survives an acceptance test. We use the
// exact log acceptance test unconditionally -- the common squeeze fast-path
// (accept early when u < 1 - 0.0331 x^4) saves a logarithm but adds a
// second, harder-to-describe branch to the draw-order contract; one
// predictable branch wins for reproducibility. Acceptance probability is
// > 95% for shape >= 1, so the rejection loop is short. Shape < 1 throws:
// the engine's nu >= 5 clamp guarantees shape = nu/2 >= 2.5, so the
// shape-boost transform would be dead code this module refuses to ship
// untested. Time O(1) expected (rejection loop), Space O(1).
export function nextGamma(random: RandomGenerator, shape: number): number {
  if (!Number.isFinite(shape) || shape < 1) {
    throw new RangeError('Gamma shape must be finite and at least 1.')
  }

  // d and c are Marsaglia-Tsang's constants: d re-centers the cube map so
  // its mode matches the gamma's, c scales the normal to the right width.
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)

  // Rejection sampling: each attempt consumes exactly one normal (two
  // uniforms) plus one uniform, in that order; an attempt whose v <= 0 is
  // rejected before consuming its uniform.
  for (;;) {
    const x = nextStandardNormal(random)
    const cube = 1 + c * x
    if (cube <= 0) {
      continue
    }
    const v = cube * cube * cube

    const u = random.nextUniform()
    // Exact acceptance region: ln u < x^2/2 + d - d*v + d*ln v.
    // (u = 0 accepts -- ln 0 = -Infinity is below every finite bound.)
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return d * v
    }
  }
}

// Chi-square with `degreesOfFreedom` as a gamma special case:
// chi2(k) = Gamma(shape = k/2, scale = 2). This is the Student's t mixing
// variable: dividing a correlated Gaussian vector by sqrt(chi2/nu) is what
// stretches ALL assets together in a fat-tailed period. Requires k >= 2 so
// the underlying gamma shape stays >= 1 (the engine's nu >= 5 clamp
// guarantees it). Time O(1) expected, Space O(1).
export function nextChiSquare(
  random: RandomGenerator,
  degreesOfFreedom: number,
): number {
  if (!Number.isFinite(degreesOfFreedom) || degreesOfFreedom < 2) {
    throw new RangeError('Chi-square degrees of freedom must be at least 2.')
  }

  return 2 * nextGamma(random, degreesOfFreedom / 2)
}
