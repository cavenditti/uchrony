/** Recruitment transfers existing people, money and equipment; each institution retains its own eligibility rules. */
import { publicExpense } from './ledger'
import { MAX_ARMIES } from './military-limits'
import { armyStore, marketStore, recordGift, recordRequisition, recordUse } from './national-accounts'
import { ensureWarfare } from './navy'
import { takeCivilianAdults } from './population'
import type { PopulationCommunity } from './population-types'
import { event } from './simulation-events'
import type { Army } from './types'
import { type Nation, type Region, type World } from './types'

/** Check cabinet recruitment eligibility before moving real adults and equipment. */
export function recruit(w: World, n: Nation, r: Region): string {
  if (r.nation !== n.id) return 'Recruitment requires a province controlled by this state.'
  if (w.armies.length >= MAX_ARMIES) return 'This world has reached its supported number of army formations.'
  const soldiers = Math.min(3000, Math.floor(r.population.adults * (0.025 + n.policies.conscription * 0.012)))
  const cost = soldiers * 0.2
  if (soldiers < 500) return 'Not enough adult recruits in this province.'
  if (n.treasury < cost || r.stocks.arms < soldiers * 0.012)
    return 'Recruitment needs treasury funds and locally available arms.'
  musterArmy(w, r, {
    nation: n.id,
    name: `${n.shortName} ${w.nextArmy} Corps`,
    soldiers,
    establishment: soldiers,
    morale: 0.75,
    supply: 1,
    experience: 0.05,
    armsPerSoldier: 0.012,
    expense: { amount: cost, category: 'public recruitment' },
  })
  event(
    w,
    'war',
    `${n.shortName} raises a new corps`,
    `${soldiers.toLocaleString()} adults leave civilian work and join the army in ${r.name}.`,
    n.id,
    r.id,
  )
  return `Recruited ${soldiers.toLocaleString()} soldiers in ${r.name}.`
}

/** Formation stats describe different institutions: paid corps, mobilized reserves,
 * and emergency levies keep distinct readiness and equipment costs. */
export interface MusterPlan {
  nation: number
  name: string
  soldiers: number
  establishment: number
  morale: number
  supply: number
  experience: number
  armsPerSoldier: number
  foodPerSoldier?: number
  expense?: { amount: number; category: string }
  requisition?: boolean
  eligible?: (group: PopulationCommunity) => boolean
  stance?: 'march' | 'hold' | 'entrench'
  entrenchment?: number
}
/** Callers decide affordability and willingness; this is the single conserved
 * transfer of adults, equipment and provisions into a newly registered formation. */
export function musterArmy(w: World, region: Region, plan: MusterPlan): Army {
  const communities = takeCivilianAdults(w, region, plan.soldiers, plan.eligible)
  if (plan.expense) publicExpense(w, plan.nation, plan.expense.amount, plan.expense.category, region.id)
  const arms = plan.soldiers * plan.armsPerSoldier,
    food = plan.soldiers * (plan.foodPerSoldier ?? 0)
  if (plan.requisition) recordRequisition(w, region.id, 'arms', arms)
  else recordUse(w, marketStore(region.id), 'arms', arms)
  region.stocks.arms -= arms
  region.consumption.arms += arms
  if (food) region.stocks.food -= food
  const army: Army = {
    id: w.nextArmy++,
    nation: plan.nation,
    name: plan.name,
    region: region.id,
    target: null,
    soldiers: plan.soldiers,
    establishment: plan.establishment,
    morale: plan.morale,
    supply: plan.supply,
    experience: plan.experience,
    casualties: 0,
    communities,
  }
  w.armies.push(army)
  ensureWarfare(w)
  if (food) {
    recordGift(w, marketStore(region.id), armyStore(army.id), 'food', food)
    army.operations!.food = food
  }
  if (plan.stance) army.operations!.stance = plan.stance
  if (plan.entrenchment !== undefined) army.operations!.entrenchment = plan.entrenchment
  return army
}
