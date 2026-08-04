export type ValidationError = {
  readonly code: string
  readonly message: string
}

export type ValidationResult<T> =
  | {
      readonly ok: true
      readonly value: T
    }
  | {
      readonly ok: false
      readonly errors: readonly ValidationError[]
    }
