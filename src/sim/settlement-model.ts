import type { City } from './district-types'

/** Classification conventions, not targets for population or administrative size.
 * Inspired by the Degree of Urbanisation: 500 / 5,000 / 50,000 residents.
 * Developed cover separates a compact settlement from a densely farmed catchment.
 */
export const SETTLEMENT = {
  villagePopulation: 500,
  townPopulation: 5000,
  cityPopulation: 50000,
  minimumDensity: 300, // residents / km² of the physical footprint
  entryBuiltCover: 0.03,
  retainedBuiltCover: 0.02,
  movingFriction: 0.08,
  annualMovingHazard: 0.08,
  accessMinutes: 60,
} as const

export function settlementKind(people: number): City['kind'] {
  return people >= SETTLEMENT.cityPopulation
    ? 'city'
    : people >= SETTLEMENT.townPopulation
      ? 'town'
      : 'village'
}

export function isVisibleSettlement(people: number) {
  return people >= SETTLEMENT.villagePopulation
}
