import { describe, expect, it } from 'vitest'
import {
  createXoshiro128StarStar,
  XOSHIRO128_STAR_STAR_VERSION,
} from './random'

describe('createXoshiro128StarStar', () => {
  it.each([
    [
      0,
      [
        3_809_008_728, 1_133_695_204, 53_579_671, 2_891_528_803, 139_681_546,
        2_203_266_335, 104_831_812, 1_587_294_886,
      ],
    ],
    [
      1,
      [
        2_442_144_158, 3_238_099_751, 3_819_917_871, 2_104_621_829,
        2_021_136_066, 4_223_536_128, 1_515_984_730, 2_298_887_649,
      ],
    ],
  ])('matches the reference vector for seed %i', (seed, expected) => {
    const random = createXoshiro128StarStar(seed)

    expect(
      Array.from({ length: expected.length }, () => random.nextUint32()),
    ).toEqual(expected)
  })

  it('reports its versioned algorithm identifier', () => {
    expect(XOSHIRO128_STAR_STAR_VERSION).toBe('xoshiro128**-v1')
  })

  it('repeats the same sequence for the same seed', () => {
    const first = createXoshiro128StarStar(123)
    const second = createXoshiro128StarStar(123)

    expect(Array.from({ length: 20 }, () => first.nextUint32())).toEqual(
      Array.from({ length: 20 }, () => second.nextUint32()),
    )
  })

  it('diverges for different seeds', () => {
    const first = createXoshiro128StarStar(123)
    const second = createXoshiro128StarStar(124)

    expect(Array.from({ length: 20 }, () => first.nextUint32())).not.toEqual(
      Array.from({ length: 20 }, () => second.nextUint32()),
    )
  })

  it('produces unsigned 32-bit integers and uniforms below one', () => {
    const integers = createXoshiro128StarStar(456)
    const uniforms = createXoshiro128StarStar(456)

    for (let index = 0; index < 1_000; index += 1) {
      expect(integers.nextUint32()).toSatisfy(
        (value: number) =>
          Number.isInteger(value) && value >= 0 && value <= 0xffff_ffff,
      )
      expect(uniforms.nextUniform()).toSatisfy(
        (value: number) => Number.isFinite(value) && value >= 0 && value < 1,
      )
    }
  })

  it.each([1, 7, 260, 0x1_0000_0000])(
    'returns indexes inside the bound %i',
    (upperExclusive) => {
      const random = createXoshiro128StarStar(789)

      for (let index = 0; index < 1_000; index += 1) {
        const value = random.nextInt(upperExclusive)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThan(upperExclusive)
      }
    },
  )

  it.each([-1, 0.5, 0x1_0000_0000])('rejects an invalid seed %s', (seed) => {
    expect(() => createXoshiro128StarStar(seed)).toThrow(RangeError)
  })

  it.each([0, 1.5, 0x1_0000_0001])(
    'rejects an invalid upper bound %s',
    (upperExclusive) => {
      const random = createXoshiro128StarStar(0)

      expect(() => random.nextInt(upperExclusive)).toThrow(RangeError)
    },
  )
})
