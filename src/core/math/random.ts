export const XOSHIRO128_STAR_STAR_VERSION = 'xoshiro128**-v1'

const UINT32_RANGE = 0x1_0000_0000
const MAX_UINT32 = 0xffff_ffff

export type RandomGenerator = {
  nextUint32(): number
  nextUniform(): number
  nextInt(upperExclusive: number): number
}

export function createXoshiro128StarStar(seed: number): RandomGenerator {
  validateSeed(seed)

  let [state0, state1, state2, state3] = expandSeed(seed)

  function nextUint32(): number {
    const result = Math.imul(rotateLeft(Math.imul(state1, 5), 7), 9) >>> 0
    const temporary = (state1 << 9) >>> 0

    state2 = (state2 ^ state0) >>> 0
    state3 = (state3 ^ state1) >>> 0
    state1 = (state1 ^ state2) >>> 0
    state0 = (state0 ^ state3) >>> 0
    state2 = (state2 ^ temporary) >>> 0
    state3 = rotateLeft(state3, 11)

    return result
  }

  function nextUniform(): number {
    return nextUint32() / UINT32_RANGE
  }

  function nextInt(upperExclusive: number): number {
    validateUpperExclusive(upperExclusive)

    const acceptedRange =
      Math.floor(UINT32_RANGE / upperExclusive) * upperExclusive
    let value = nextUint32()

    while (value >= acceptedRange) {
      value = nextUint32()
    }

    return value % upperExclusive
  }

  return { nextUint32, nextUniform, nextInt }
}

function expandSeed(seed: number): readonly [number, number, number, number] {
  let value = seed
  const state: number[] = []

  for (let index = 0; index < 4; index += 1) {
    value = (value + 0x9e37_79b9) >>> 0
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 16), 0x85eb_ca6b) >>> 0
    mixed = Math.imul(mixed ^ (mixed >>> 13), 0xc2b2_ae35) >>> 0
    state.push((mixed ^ (mixed >>> 16)) >>> 0)
  }

  if (state.every((word) => word === 0)) {
    throw new Error('Seed expansion must not create an all-zero xoshiro state.')
  }

  return [state[0], state[1], state[2], state[3]]
}

function rotateLeft(value: number, bits: number): number {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0
}

function validateSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_UINT32) {
    throw new RangeError('Seed must be an unsigned 32-bit integer.')
  }
}

function validateUpperExclusive(upperExclusive: number): void {
  if (
    !Number.isInteger(upperExclusive) ||
    upperExclusive < 1 ||
    upperExclusive > UINT32_RANGE
  ) {
    throw new RangeError(
      `Upper bound must be an integer from 1 to ${UINT32_RANGE}.`,
    )
  }
}
