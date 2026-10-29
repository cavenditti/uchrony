import { parameterGroup } from './configuration-context'
import type { City } from './district-types'

/** Classification conventions, not targets for population or administrative size.
 * Inspired by the Degree of Urbanisation: 500 / 5,000 / 50,000 residents.
 * Developed cover separates a compact settlement from a densely farmed catchment.
 */
export const SETTLEMENT = parameterGroup('settlements')

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
