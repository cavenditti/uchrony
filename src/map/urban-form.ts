import type { SpatialBounds, PointMeters } from '../sim/adaptive-types'

export type UrbanDistrict = 'center' | 'apartments' | 'residential' | 'gardens' | 'industrial' | 'mining'
export type UrbanForm = {
  district: UrbanDistrict
  parcel: SpatialBounds
  center: PointMeters
  metersPerMapUnit: number
  floorAreaRatio: number
  coverage: number
  angle?: number
  planSeed?: number
  neighbors?: SpatialBounds[]
}

/** A readable form for the modeled housing stock, not a separate building census.
 * Forty square metres per place matches the land-use model's ground-capacity unit.
 */
export function urbanForm(
  capacity: number,
  parcel: SpatialBounds,
  center: PointMeters,
  scale: number,
  activity: string | undefined,
  civic: boolean,
  distance: number,
  reach: number,
): UrbanForm {
  const far = (capacity * 40) / (parcel.size * parcel.size)
  const district: UrbanDistrict =
    activity === 'mining'
      ? 'mining'
      : activity === 'industrial'
        ? 'industrial'
        : far < 0.35
          ? 'gardens'
          : civic || distance < Math.max(150, reach * 0.3)
            ? 'center'
            : far >= 1
              ? 'apartments'
              : far < 0.35
                ? 'gardens'
                : 'residential'
  return {
    district,
    parcel,
    center,
    metersPerMapUnit: scale,
    floorAreaRatio: far,
    coverage: Math.min(far, 0.24 + 0.3 * (1 - Math.exp(-far))),
  }
}

/** Smooth, irregular support for built form. Adjacent supports overlap, so a
 * city edge follows connected development rather than exposing parcel corners. */
export function urbanEnvelope(form: UrbanForm, x: number, y: number) {
  let support = 0
  for (const p of [form.parcel, ...(form.neighbors ?? [])]) {
    const dx = x - p.x - p.size / 2,
      dy = y - p.y - p.size / 2
    const theta = Math.atan2(dy, dx) - (form.angle ?? 0)
    const radius =
      p.size *
      (0.43 + 0.035 * Math.sin(3 * theta + ((form.planSeed ?? 0) % 17)) + 0.025 * Math.cos(5 * theta))
    support += Math.exp(-Math.pow(Math.hypot(dx, dy) / Math.max(1, radius), 4))
  }
  return support >= 0.38
}
