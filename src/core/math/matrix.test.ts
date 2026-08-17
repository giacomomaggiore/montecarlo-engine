import { describe, expect, it } from 'vitest'
import {
  choleskyDecompose,
  correlationToCovariance,
  covarianceToCorrelation,
  jacobiEigenDecomposition,
  nearestCorrelationMatrix,
  projectToPositiveSemidefinite,
} from './matrix'

describe('covarianceToCorrelation / correlationToCovariance', () => {
  it('splits a covariance into correlation and standard deviations', () => {
    const { correlation, standardDeviations } = covarianceToCorrelation([
      [4, 1.2],
      [1.2, 1],
    ])

    expect(standardDeviations).toEqual([2, 1])
    // rho = 1.2 / (2 * 1) = 0.6.
    expect(correlation[0][1]).toBeCloseTo(0.6, 12)
    expect(correlation[0][0]).toBe(1)
    expect(correlation[1][1]).toBe(1)
  })

  it('round-trips back to the original covariance', () => {
    const covariance = [
      [4, 1.2],
      [1.2, 1],
    ]
    const { correlation, standardDeviations } =
      covarianceToCorrelation(covariance)
    const rebuilt = correlationToCovariance(correlation, standardDeviations)

    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        expect(rebuilt[i][j]).toBeCloseTo(covariance[i][j], 12)
      }
    }
  })

  it('rejects a non-positive variance on the diagonal', () => {
    expect(() => covarianceToCorrelation([[0]])).toThrow(RangeError)
    expect(() =>
      covarianceToCorrelation([
        [1, 0],
        [0, -2],
      ]),
    ).toThrow(RangeError)
  })
})

describe('jacobiEigenDecomposition', () => {
  it('finds the known eigenvalues of a 2x2 symmetric matrix', () => {
    // [[2,1],[1,2]] has eigenvalues 1 and 3 (eigenvectors along the
    // diagonal and anti-diagonal directions).
    const { eigenvalues } = jacobiEigenDecomposition([
      [2, 1],
      [1, 2],
    ])
    const sorted = [...eigenvalues].sort((a, b) => a - b)

    expect(sorted[0]).toBeCloseTo(1, 12)
    expect(sorted[1]).toBeCloseTo(3, 12)
  })

  it('reconstructs the input as Q * Lambda * Q^T', () => {
    const matrix = [
      [3, 1, 0.5],
      [1, 2, 0.25],
      [0.5, 0.25, 1],
    ]
    const { eigenvalues, eigenvectors } = jacobiEigenDecomposition(matrix)

    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        let rebuilt = 0
        for (let k = 0; k < 3; k += 1) {
          rebuilt += eigenvalues[k] * eigenvectors[i][k] * eigenvectors[j][k]
        }
        expect(rebuilt).toBeCloseTo(matrix[i][j], 10)
      }
    }
  })
})

describe('projectToPositiveSemidefinite', () => {
  it('matches an independently computed NumPy projection', () => {
    // numpy.linalg.eigh-based projection of [[2,-1],[-1,-0.5]] (one negative
    // eigenvalue, -0.85078...), computed offline:
    const projected = projectToPositiveSemidefinite([
      [2, -1],
      [-1, -0.5],
    ])

    expect(projected[0][0]).toBeCloseTo(2.093216333220242, 10)
    expect(projected[0][1]).toBeCloseTo(-0.734260642832909, 10)
    expect(projected[1][0]).toBeCloseTo(-0.734260642832909, 10)
    expect(projected[1][1]).toBeCloseTo(0.25756472613797, 10)
  })

  it('leaves an already-PSD matrix unchanged', () => {
    const matrix = [
      [2, 0.5],
      [0.5, 1],
    ]
    const projected = projectToPositiveSemidefinite(matrix)

    for (let i = 0; i < 2; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        expect(projected[i][j]).toBeCloseTo(matrix[i][j], 10)
      }
    }
  })
})

describe('nearestCorrelationMatrix', () => {
  it("repairs Higham's classic indefinite example to the known answer", () => {
    // The standard test matrix from Higham (2002): unit diagonal but
    // indefinite (eigenvalues include -0.414...). The nearest correlation
    // matrix, computed independently offline with NumPy:
    // off-diagonals 0.760689853439916 and 0.157298106120742.
    const repaired = nearestCorrelationMatrix([
      [1, 1, 0],
      [1, 1, 1],
      [0, 1, 1],
    ])

    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return

    const value = repaired.value
    expect(value[0][1]).toBeCloseTo(0.760689853439916, 9)
    expect(value[1][2]).toBeCloseTo(0.760689853439916, 9)
    expect(value[0][2]).toBeCloseTo(0.157298106120742, 9)
    for (let i = 0; i < 3; i += 1) {
      expect(value[i][i]).toBe(1)
      for (let j = 0; j < 3; j += 1) {
        expect(value[i][j]).toBe(value[j][i])
      }
    }

    // The repaired matrix must actually be PSD (up to convergence
    // tolerance): its smallest eigenvalue may only be negative at noise
    // level, never materially.
    const { eigenvalues } = jacobiEigenDecomposition(value)
    expect(Math.min(...eigenvalues)).toBeGreaterThan(-1e-8)
  })

  it('returns an already-valid correlation matrix essentially unchanged', () => {
    const matrix = [
      [1, 0.3],
      [0.3, 1],
    ]
    const repaired = nearestCorrelationMatrix(matrix)

    expect(repaired.ok).toBe(true)
    if (!repaired.ok) return
    expect(repaired.value[0][1]).toBeCloseTo(0.3, 10)
  })
})

describe('choleskyDecompose', () => {
  it('matches a hand-checked 2x2 factorization', () => {
    // [[4,2],[2,5]] = L * L^T with L = [[2,0],[1,2]].
    const result = choleskyDecompose([
      [4, 2],
      [2, 5],
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0][0]).toBeCloseTo(2, 12)
    expect(result.value[1][0]).toBeCloseTo(1, 12)
    expect(result.value[1][1]).toBeCloseTo(2, 12)
    expect(result.value[0][1]).toBe(0)
  })

  it('matches a hand-checked 3x3 factorization', () => {
    // Classic textbook example: [[25,15,-5],[15,18,0],[-5,0,11]] factors to
    // L = [[5,0,0],[3,3,0],[-1,1,3]].
    const result = choleskyDecompose([
      [25, 15, -5],
      [15, 18, 0],
      [-5, 0, 11],
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value[0][0]).toBeCloseTo(5, 12)
    expect(result.value[1][0]).toBeCloseTo(3, 12)
    expect(result.value[1][1]).toBeCloseTo(3, 12)
    expect(result.value[2][0]).toBeCloseTo(-1, 12)
    expect(result.value[2][1]).toBeCloseTo(1, 12)
    expect(result.value[2][2]).toBeCloseTo(3, 12)
  })

  it('returns a structured error for an indefinite matrix', () => {
    // [[1,2],[2,1]] has determinant -3: not positive definite.
    const result = choleskyDecompose([
      [1, 2],
      [2, 1],
    ])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors[0].code).toBe('matrix.cholesky.notPositiveDefinite')
  })

  it('rejects a singular matrix at the tolerance boundary', () => {
    // Rank-1: the second pivot is exactly zero, which must fail rather than
    // produce a zero diagonal that later divides by zero.
    const result = choleskyDecompose([
      [1, 1],
      [1, 1],
    ])

    expect(result.ok).toBe(false)
  })
})
