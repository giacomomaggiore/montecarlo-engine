import type { ValidationError, ValidationResult } from '../validation'

export const FREQUENCIES = ['weekly', 'monthly'] as const
export const BASE_CURRENCIES = ['USD', 'EUR'] as const

export type Frequency = (typeof FREQUENCIES)[number]
export type BaseCurrency = (typeof BASE_CURRENCIES)[number]

export type DatasetIdentity = {
  readonly version: string
  readonly checksum: string
  readonly frequency: Frequency
  readonly baseCurrency: BaseCurrency
}

export type AlignedDataset = {
  readonly identity: DatasetIdentity
  readonly assetIds: readonly string[]
  readonly dates: readonly string[]
  readonly assetReturns: readonly Float32Array[]
  readonly inflation: Float32Array
  readonly riskFreeRates: Float32Array
}

export function minimumObservations(frequency: Frequency): number {
  return frequency === 'weekly' ? 260 : 60
}

export function validateAlignedDataset(
  dataset: AlignedDataset,
): ValidationResult<AlignedDataset> {
  const errors: ValidationError[] = []
  const rowCount = dataset.dates.length

  if (!isNonEmptyString(dataset.identity.version)) {
    errors.push(error('dataset.version', 'Dataset version must be non-empty.'))
  }

  if (!isNonEmptyString(dataset.identity.checksum)) {
    errors.push(error('dataset.checksum', 'Dataset checksum must be non-empty.'))
  }

  if (!isFrequency(dataset.identity.frequency)) {
    errors.push(error('dataset.frequency', 'Dataset frequency must be weekly or monthly.'))
  }

  if (!isBaseCurrency(dataset.identity.baseCurrency)) {
    errors.push(error('dataset.baseCurrency', 'Base currency must be USD or EUR.'))
  }

  if (dataset.assetIds.length === 0) {
    errors.push(error('dataset.assets.empty', 'Select at least one asset.'))
  }

  if (dataset.assetIds.length > 6) {
    errors.push(error('dataset.assets.maximum', 'A portfolio may contain at most six assets.'))
  }

  if (dataset.assetIds.length !== dataset.assetReturns.length) {
    errors.push(
      error(
        'dataset.assets.columns',
        'Each asset identifier must have exactly one return column.',
      ),
    )
  }

  if (hasDuplicateOrEmptyValues(dataset.assetIds)) {
    errors.push(error('dataset.assets.identifiers', 'Asset identifiers must be unique and non-empty.'))
  }

  const requiredObservations = minimumObservations(dataset.identity.frequency)
  if (rowCount < requiredObservations) {
    errors.push(
      error(
        'dataset.observations.minimum',
        `Dataset requires at least ${requiredObservations} ${dataset.identity.frequency} observations.`,
      ),
    )
  }

  validateDates(dataset.dates, errors)
  validateSeries('inflation', dataset.inflation, rowCount, errors)
  validateSeries('risk-free rate', dataset.riskFreeRates, rowCount, errors)

  for (const [index, returns] of dataset.assetReturns.entries()) {
    validateSeries(`asset return column ${index + 1}`, returns, rowCount, errors, true)
  }

  return errors.length === 0 ? { ok: true, value: dataset } : { ok: false, errors }
}

function isFrequency(value: string): value is Frequency {
  return FREQUENCIES.includes(value as Frequency)
}

function isBaseCurrency(value: string): value is BaseCurrency {
  return BASE_CURRENCIES.includes(value as BaseCurrency)
}

function isNonEmptyString(value: string): boolean {
  return value.trim().length > 0
}

function hasDuplicateOrEmptyValues(values: readonly string[]): boolean {
  const seen = new Set<string>()

  for (const value of values) {
    if (!isNonEmptyString(value) || seen.has(value)) {
      return true
    }

    seen.add(value)
  }

  return false
}

function validateDates(dates: readonly string[], errors: ValidationError[]): void {
  let previousDate: string | undefined

  for (const date of dates) {
    if (!isIsoDate(date)) {
      errors.push(error('dataset.dates.format', 'Dates must use valid YYYY-MM-DD values.'))
      return
    }

    if (previousDate !== undefined && date <= previousDate) {
      errors.push(error('dataset.dates.order', 'Dates must be strictly increasing.'))
      return
    }

    previousDate = date
  }
}

function validateSeries(
  name: string,
  values: Float32Array,
  rowCount: number,
  errors: ValidationError[],
  isAssetReturn = false,
): void {
  if (values.length !== rowCount) {
    errors.push(
      error('dataset.series.length', `${name} must contain ${rowCount} observations.`),
    )
    return
  }

  for (const value of values) {
    if (!Number.isFinite(value)) {
      errors.push(error('dataset.series.finite', `${name} must contain only finite values.`))
      return
    }

    if (isAssetReturn && value < -1) {
      errors.push(error('dataset.returns.bound', `${name} cannot be below -100%.`))
      return
    }
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }

  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function error(code: string, message: string): ValidationError {
  return { code, message }
}