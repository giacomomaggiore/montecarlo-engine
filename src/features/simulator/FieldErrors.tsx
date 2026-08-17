import type { ValidationError } from '../../core/validation'

// Renders the errors addressed to ONE control, directly beside it, per the
// frontend spec's "place errors beside their controls". The element id is
// what the control's aria-describedby points at, so a screen reader hears
// the message when the broken field is focused — not only in the summary.
export function FieldErrors({
  id,
  errors,
}: {
  readonly id: string
  readonly errors: readonly ValidationError[]
}) {
  if (errors.length === 0) {
    return null
  }
  return (
    <ul className="field-errors" id={id}>
      {errors.map((error) => (
        <li key={error.code + error.message}>{error.message}</li>
      ))}
    </ul>
  )
}
