/** Synthetic physical coefficients for the extended catalogue. Each commodity
 * has one productive sector and a real downstream buyer; precious metal is a
 * commodity, never an instruction to create currency or bank deposits. */
interface CommodityDefinition {
  label: string
  price: number
  sector: 'mineral' | 'crop' | 'workshop' | 'fishery'
  facility: string
  rate: number
  laborShare: number
  technology: number
  inputs: Readonly<Record<string, number>>
  opening: number
  decay: number
}
export const COMMODITIES = {
  clay: {
    label: 'Clay',
    price: 12,
    sector: 'mineral',
    facility: 'clay-pit',
    rate: 0.18,
    laborShare: 0.025,
    technology: 0,
    inputs: {},
    opening: 0.005,
    decay: 0.001,
  },
  bricks: {
    label: 'Bricks',
    price: 40,
    sector: 'workshop',
    facility: 'brick-kiln',
    rate: 0.1,
    laborShare: 0.025,
    technology: 0,
    inputs: { clay: 1.25, coal: 0.15 },
    opening: 0.003,
    decay: 0.001,
  },
  grain: {
    label: 'Grain',
    price: 10,
    sector: 'crop',
    facility: 'grain-farm',
    rate: 0.2,
    laborShare: 0.04,
    technology: 0,
    inputs: {},
    opening: 0.01,
    decay: 0.015,
  },
  flour: {
    label: 'Flour',
    price: 18,
    sector: 'workshop',
    facility: 'flour-mill',
    rate: 0.15,
    laborShare: 0.015,
    technology: 0,
    inputs: { grain: 1.25 },
    opening: 0.003,
    decay: 0.025,
  },
  bread: {
    label: 'Bread',
    price: 28,
    sector: 'workshop',
    facility: 'bakery',
    rate: 0.15,
    laborShare: 0.02,
    technology: 0,
    inputs: { flour: 1, charcoal: 0.04 },
    opening: 0,
    decay: 0.08,
  },
  salt: {
    label: 'Salt',
    price: 22,
    sector: 'mineral',
    facility: 'salt-works',
    rate: 0.1,
    laborShare: 0.015,
    technology: 0,
    inputs: {},
    opening: 0.001,
    decay: 0.001,
  },
  fish: {
    label: 'Fish',
    price: 12,
    sector: 'fishery',
    facility: 'fishery',
    rate: 0.16,
    laborShare: 0.035,
    technology: 0,
    inputs: {},
    opening: 0,
    decay: 0.12,
  },
  preservedFood: {
    label: 'Preserved food',
    price: 32,
    sector: 'workshop',
    facility: 'preserving-works',
    rate: 0.1,
    laborShare: 0.015,
    technology: 0,
    inputs: { fish: 1.15, salt: 0.1 },
    opening: 0,
    decay: 0.008,
  },
  coke: {
    label: 'Coke',
    price: 65,
    sector: 'workshop',
    facility: 'coking-works',
    rate: 0.1,
    laborShare: 0.02,
    technology: 1,
    inputs: { coal: 1.5 },
    opening: 0.001,
    decay: 0.001,
  },
  steel: {
    label: 'Steel',
    price: 205,
    sector: 'workshop',
    facility: 'steel-works',
    rate: 0.07,
    laborShare: 0.02,
    technology: 2,
    inputs: { iron: 1.05, coke: 0.25 },
    opening: 0.001,
    decay: 0.001,
  },
  flax: {
    label: 'Flax',
    price: 32,
    sector: 'crop',
    facility: 'flax-farm',
    rate: 0.065,
    laborShare: 0.015,
    technology: 0,
    inputs: {},
    opening: 0.002,
    decay: 0.006,
  },
  cotton: {
    label: 'Cotton',
    price: 36,
    sector: 'crop',
    facility: 'cotton-farm',
    rate: 0.06,
    laborShare: 0.015,
    technology: 1,
    inputs: {},
    opening: 0.002,
    decay: 0.006,
  },
  hemp: {
    label: 'Hemp',
    price: 26,
    sector: 'crop',
    facility: 'hemp-farm',
    rate: 0.075,
    laborShare: 0.015,
    technology: 0,
    inputs: {},
    opening: 0.002,
    decay: 0.006,
  },
  rope: {
    label: 'Rope',
    price: 65,
    sector: 'workshop',
    facility: 'rope-works',
    rate: 0.1,
    laborShare: 0.015,
    technology: 0,
    inputs: { hemp: 1.3 },
    opening: 0.001,
    decay: 0.006,
  },
  preciousOre: {
    label: 'Precious-metal ore',
    price: 180,
    sector: 'mineral',
    facility: 'precious-mine',
    rate: 0.015,
    laborShare: 0.01,
    technology: 0,
    inputs: {},
    opening: 0.00002,
    decay: 0.001,
  },
  preciousMetal: {
    label: 'Precious metal',
    price: 12000,
    sector: 'workshop',
    facility: 'precious-refinery',
    rate: 0.002,
    laborShare: 0.008,
    technology: 1,
    inputs: { preciousOre: 50, charcoal: 2 },
    opening: 0.000001,
    decay: 0.001,
  },
  jewelry: {
    label: 'Jewelry',
    price: 15000,
    sector: 'workshop',
    facility: 'jeweler',
    rate: 0.0015,
    laborShare: 0.007,
    technology: 1,
    inputs: { preciousMetal: 0.95 },
    opening: 0,
    decay: 0.001,
  },
} as const satisfies Record<string, CommodityDefinition>
export type ExtendedGood = keyof typeof COMMODITIES
export const EXTENDED_GOODS = Object.freeze(Object.keys(COMMODITIES) as ExtendedGood[])
/** Every configuration vector receives the same exhaustive catalogue keys. */
export function commodityValues(value: (good: ExtendedGood) => number): Record<ExtendedGood, number> {
  return Object.fromEntries(EXTENDED_GOODS.map((good) => [good, value(good)])) as Record<ExtendedGood, number>
}
export const EXTENDED_PRICES = commodityValues((good) => COMMODITIES[good].price)
export const ZERO_EXTENDED = commodityValues(() => 0)
export const EXTENDED_RECIPES = Object.fromEntries(
  EXTENDED_GOODS.filter((good) => Object.keys(COMMODITIES[good].inputs).length).map((good) => [
    good,
    COMMODITIES[good].inputs,
  ]),
) as Partial<
  Record<ExtendedGood, Readonly<Partial<Record<ExtendedGood | 'iron' | 'coal' | 'charcoal', number>>>>
>
export const EXTENDED_FACILITIES = Object.freeze(EXTENDED_GOODS.map((good) => COMMODITIES[good].facility))
export type ExtendedFacility = (typeof COMMODITIES)[ExtendedGood]['facility']
