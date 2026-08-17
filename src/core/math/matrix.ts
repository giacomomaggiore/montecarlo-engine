// Dense symmetric-matrix routines for the parametric Student's t engine
// (Phase 3.2): covariance/correlation conversion, Jacobi eigendecomposition,
// positive-semidefinite projection, Higham's nearest-correlation repair, and
// Cholesky factorization with an explicit tolerance.
//
// Memory layout: every matrix is a plain number[][] (row-major array of
// rows). The portfolio dimension is capped at D = 6 assets, so the largest
// matrix here holds 36 numbers -- readability and reviewability beat any
// typed-array or flat-buffer gain at this size. The per-period simulation
// hot loop never calls these functions; it only reuses the Cholesky factor
// they produce once at fit time.

import type { ValidationResult } from '../validation'

// Off-diagonal magnitudes below this are treated as numerically zero by the
// Jacobi sweep -- around 1e2 ULPs at unit scale, far below any economically
// meaningful correlation.
const JACOBI_TOLERANCE = 1e-14
const JACOBI_MAX_SWEEPS = 50

// Alternating-projections stopping rule: stop when one full iteration moves
// no entry by more than this. Correlations are unit-scale, so 1e-10 is far
// tighter than estimation noise while leaving margin above double-precision
// rounding.
const HIGHAM_TOLERANCE = 1e-10
const HIGHAM_MAX_ITERATIONS = 200

// A Cholesky pivot at or below maxDiagonal * this relative tolerance is
// treated as "not positive definite": the matrix has a direction with
// numerically zero (or negative) variance, and factoring it would put a
// sqrt of a non-positive number -- i.e. NaN -- into every later sample.
const CHOLESKY_RELATIVE_TOLERANCE = 1e-12

export type EigenDecomposition = {
  // eigenvalues[k] pairs with the k-th eigenvector column:
  // eigenvectors[i][k] is component i of eigenvector k, so
  // matrix = Q * diag(eigenvalues) * Q^T with Q = eigenvectors.
  readonly eigenvalues: readonly number[]
  readonly eigenvectors: readonly (readonly number[])[]
}

// Splits a covariance matrix into its correlation matrix and per-asset
// standard deviations. This decomposition is what makes "repair the
// correlation while preserving asset variances" implementable: shape (the
// correlation) is repaired in isolation, scale (the variances) re-enters
// untouched afterward. Time O(D^2), Space O(D^2).
export function covarianceToCorrelation(
  covariance: readonly (readonly number[])[],
): { correlation: number[][]; standardDeviations: number[] } {
  const dimension = covariance.length
  const standardDeviations: number[] = []

  for (let i = 0; i < dimension; i += 1) {
    const variance = covariance[i][i]
    if (!Number.isFinite(variance) || variance <= 0) {
      throw new RangeError(
        'Covariance diagonal must be finite and strictly positive.',
      )
    }
    standardDeviations.push(Math.sqrt(variance))
  }

  const correlation: number[][] = []
  for (let i = 0; i < dimension; i += 1) {
    const row: number[] = []
    for (let j = 0; j < dimension; j += 1) {
      // rho_ij = sigma_ij / (sigma_i * sigma_j): unit-variance rescaling.
      row.push(
        covariance[i][j] / (standardDeviations[i] * standardDeviations[j]),
      )
    }
    correlation.push(row)
  }

  return { correlation, standardDeviations }
}

// Reassembles a covariance matrix from a correlation matrix and standard
// deviations: sigma_ij = rho_ij * sigma_i * sigma_j. Time O(D^2).
export function correlationToCovariance(
  correlation: readonly (readonly number[])[],
  standardDeviations: readonly number[],
): number[][] {
  return correlation.map((row, i) =>
    row.map(
      (value, j) => value * standardDeviations[i] * standardDeviations[j],
    ),
  )
}

// Cyclic Jacobi eigendecomposition for real symmetric matrices: repeatedly
// apply 2x2 rotations that zero one off-diagonal pair at a time until every
// off-diagonal entry is numerically zero. Chosen over a library
// decomposition because the Maintenance Policy forbids adding packages for
// short deterministic algorithms, and over faster methods (QR, divide and
// conquer) because at D <= 6 Jacobi converges in a handful of sweeps and is
// simple enough to review line by line. For symmetric matrices Jacobi is
// also among the most accurate methods available.
// Time O(D^3) per sweep with a small constant number of sweeps in practice;
// Space O(D^2).
export function jacobiEigenDecomposition(
  matrix: readonly (readonly number[])[],
): EigenDecomposition {
  const dimension = matrix.length
  // Work on copies: inputs are never mutated anywhere in core/.
  const work = matrix.map((row) => [...row])
  const vectors: number[][] = []
  for (let i = 0; i < dimension; i += 1) {
    vectors.push(Array.from({ length: dimension }, (_, j) => (i === j ? 1 : 0)))
  }

  for (let sweep = 0; sweep < JACOBI_MAX_SWEEPS; sweep += 1) {
    // Sum of squared off-diagonal magnitudes: the quantity each rotation
    // strictly decreases, and the convergence criterion.
    let offDiagonal = 0
    for (let p = 0; p < dimension; p += 1) {
      for (let q = p + 1; q < dimension; q += 1) {
        offDiagonal += work[p][q] * work[p][q]
      }
    }
    if (Math.sqrt(offDiagonal) < JACOBI_TOLERANCE) {
      break
    }

    for (let p = 0; p < dimension - 1; p += 1) {
      for (let q = p + 1; q < dimension; q += 1) {
        if (Math.abs(work[p][q]) < JACOBI_TOLERANCE) {
          continue
        }

        // The rotation angle that zeroes work[p][q]: solve
        // tan(2*angle) = 2*a_pq / (a_qq - a_pp) using the numerically stable
        // smaller-root formula for t = tan(angle).
        const theta = (work[q][q] - work[p][p]) / (2 * work[p][q])
        const t =
          Math.sign(theta === 0 ? 1 : theta) /
          (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c

        // Apply the rotation G(p,q) on both sides: work = G^T * work * G.
        for (let k = 0; k < dimension; k += 1) {
          const workKp = work[k][p]
          const workKq = work[k][q]
          work[k][p] = c * workKp - s * workKq
          work[k][q] = s * workKp + c * workKq
        }
        for (let k = 0; k < dimension; k += 1) {
          const workPk = work[p][k]
          const workQk = work[q][k]
          work[p][k] = c * workPk - s * workQk
          work[q][k] = s * workPk + c * workQk
        }

        // Accumulate the same rotation into the eigenvector columns.
        for (let k = 0; k < dimension; k += 1) {
          const vectorKp = vectors[k][p]
          const vectorKq = vectors[k][q]
          vectors[k][p] = c * vectorKp - s * vectorKq
          vectors[k][q] = s * vectorKp + c * vectorKq
        }
      }
    }
  }

  return {
    eigenvalues: work.map((row, i) => row[i]),
    eigenvectors: vectors,
  }
}

// Projection onto the positive-semidefinite cone: eigendecompose, floor
// negative eigenvalues at zero, reconstruct Q * max(Lambda, 0) * Q^T. This is
// the nearest PSD matrix in Frobenius norm -- the canonical answer to "what
// is the closest valid covariance-like matrix to this slightly broken one" --
// and the P_S step of Higham's algorithm below. A negative eigenvalue means
// some portfolio direction would have negative variance: a statistical
// impossibility introduced by estimation, not a feature of the data.
// Time O(D^3), Space O(D^2).
export function projectToPositiveSemidefinite(
  matrix: readonly (readonly number[])[],
): number[][] {
  const dimension = matrix.length
  const { eigenvalues, eigenvectors } = jacobiEigenDecomposition(matrix)

  const projected: number[][] = []
  for (let i = 0; i < dimension; i += 1) {
    projected.push(new Array<number>(dimension).fill(0))
  }

  // Reconstruct from the flooring of the spectrum: sum_k max(lambda_k, 0) *
  // q_k * q_k^T. Time O(D^3).
  for (let k = 0; k < dimension; k += 1) {
    const flooredEigenvalue = Math.max(eigenvalues[k], 0)
    if (flooredEigenvalue === 0) {
      continue
    }
    for (let i = 0; i < dimension; i += 1) {
      for (let j = 0; j < dimension; j += 1) {
        projected[i][j] +=
          flooredEigenvalue * eigenvectors[i][k] * eigenvectors[j][k]
      }
    }
  }

  // Symmetrize to remove the last-ULP asymmetry rounding can introduce, so
  // downstream symmetric algorithms see an exactly symmetric input.
  for (let i = 0; i < dimension; i += 1) {
    for (let j = i + 1; j < dimension; j += 1) {
      const symmetrized = (projected[i][j] + projected[j][i]) / 2
      projected[i][j] = symmetrized
      projected[j][i] = symmetrized
    }
  }

  return projected
}

// Higham's (2002) alternating-projections nearest-correlation algorithm.
// An estimated correlation matrix can be indefinite (nearly collinear return
// series, rounding); sampling from it would mean sampling a "distribution"
// with negative variance in some direction. A true correlation matrix lives
// in the intersection of two convex sets: the PSD cone (set S) and the
// unit-diagonal matrices (set U). Alternating the two projections with
// Dykstra's correction converges to the NEAREST point of the intersection in
// Frobenius norm -- without the correction the plain alternation would still
// reach the intersection but not necessarily the closest point.
// Time O(D^3) per iteration, Space O(D^2).
export function nearestCorrelationMatrix(
  matrix: readonly (readonly number[])[],
): ValidationResult<number[][]> {
  const dimension = matrix.length
  let current = matrix.map((row) => [...row])
  // Dykstra's correction: the accumulated adjustment removed before each PSD
  // projection so successive projections do not "double count" movement.
  let correction: number[][] = current.map((row) => row.map(() => 0))

  for (let iteration = 0; iteration < HIGHAM_MAX_ITERATIONS; iteration += 1) {
    // R = Y - deltaS: undo the previous correction before projecting.
    const shifted = current.map((row, i) =>
      row.map((value, j) => value - correction[i][j]),
    )
    // P_S: project onto the PSD cone.
    const projected = projectToPositiveSemidefinite(shifted)
    // deltaS = X - R: record how much the PSD projection moved the iterate.
    correction = projected.map((row, i) =>
      row.map((value, j) => value - shifted[i][j]),
    )
    // P_U: restore the exact unit diagonal (projection onto set U).
    const unitDiagonal = projected.map((row, i) =>
      row.map((value, j) => (i === j ? 1 : value)),
    )

    // Converged when a full iteration no longer moves any entry.
    let maxChange = 0
    for (let i = 0; i < dimension; i += 1) {
      for (let j = 0; j < dimension; j += 1) {
        maxChange = Math.max(
          maxChange,
          Math.abs(unitDiagonal[i][j] - current[i][j]),
        )
      }
    }
    current = unitDiagonal
    if (maxChange < HIGHAM_TOLERANCE) {
      return { ok: true, value: current }
    }
  }

  // A structured failure, never an infinite loop or a silently unconverged
  // matrix passed downstream, per the Financial Rules.
  return {
    ok: false,
    errors: [
      {
        code: 'matrix.nearestCorrelation.maxIterations',
        message: `Nearest-correlation repair did not converge within ${HIGHAM_MAX_ITERATIONS} iterations.`,
      },
    ],
  }
}

// Cholesky factorization: the lower-triangular L with L * L^T = matrix.
// L is the "square root" of the covariance/scale matrix that turns D
// independent unit-variance draws z into one correlated draw L*z -- computed
// once at fit time, then reused for every one of the up to 10,000,000
// scenario draws a maximum-work run makes. A non-positive pivot (beyond the
// documented relative tolerance) means the matrix is not positive definite:
// that is a structured error, never a NaN quietly propagated into samples.
// Time O(D^3), Space O(D^2).
export function choleskyDecompose(
  matrix: readonly (readonly number[])[],
): ValidationResult<number[][]> {
  const dimension = matrix.length
  const factor: number[][] = []
  for (let i = 0; i < dimension; i += 1) {
    factor.push(new Array<number>(dimension).fill(0))
  }

  // Pivot failure is judged relative to the matrix's own scale so the same
  // tolerance works for a unit-scale correlation and a tiny weekly-variance
  // scale matrix alike.
  let maxDiagonal = 0
  for (let i = 0; i < dimension; i += 1) {
    maxDiagonal = Math.max(maxDiagonal, Math.abs(matrix[i][i]))
  }
  const pivotFloor = maxDiagonal * CHOLESKY_RELATIVE_TOLERANCE

  for (let i = 0; i < dimension; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      // Standard inner-product form: subtract the already-factored part.
      let sum = matrix[i][j]
      for (let k = 0; k < j; k += 1) {
        sum -= factor[i][k] * factor[j][k]
      }

      if (i === j) {
        // The pivot is the variance left in direction i after removing what
        // directions 0..i-1 already explain.
        if (!(sum > pivotFloor)) {
          return {
            ok: false,
            errors: [
              {
                code: 'matrix.cholesky.notPositiveDefinite',
                message: `Cholesky pivot ${sum} at index ${i} is not positive beyond tolerance; the matrix is not positive definite.`,
              },
            ],
          }
        }
        factor[i][i] = Math.sqrt(sum)
      } else {
        factor[i][j] = sum / factor[j][j]
      }
    }
  }

  return { ok: true, value: factor }
}
