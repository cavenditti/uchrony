/** Discovery names and costs share one six-level progression. */
import { type Research } from './types'

export const TECH_NAMES: Record<Research, string[]> = {
  agriculture: [
    'Crop rotation',
    'Selective breeding',
    'Mechanized farming',
    'Synthetic fertilizers',
    'Precision agriculture',
    'Resilient agriculture',
  ],
  industry: [
    'Water-powered mills',
    'Steam power',
    'Machine tooling',
    'Electrification',
    'Assembly lines',
    'Industrial automation',
  ],
  medicine: ['Sanitation', 'Vaccination', 'Germ theory', 'Antibiotics', 'Public health', 'Advanced medicine'],
  logistics: [
    'Paved roads',
    'Canal networks',
    'Rail transport',
    'Steam shipping',
    'Motor transport',
    'Integrated logistics',
  ],
  military: [
    'Standardized drill',
    'Supply corps',
    'Rifled weapons',
    'Field hospitals',
    'Combined arms',
    'Modern doctrine',
  ],
  governance: [
    'Civil service',
    'Public schooling',
    'Constitutional law',
    'Social insurance',
    'Public administration',
    'Institutional reform',
  ],
}
/** Later discoveries require superlinear accumulated knowledge, in research units. */
export const researchCost = (level: number) => 140 * (level + 1) ** 1.45
