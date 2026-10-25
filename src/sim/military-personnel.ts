import { marketStore, armyStore, recordGift, recordUse } from './national-accounts'
import { publicExpense } from './ledger'
import { MAX_ARMIES } from './military-limits'
import { addCommunity, takeCivilianAdults, coalesceCommunities } from './population'
import { clamp, population, type Army, type World } from './types'
import { ensureWarfare, warEvent } from './navy'

/** Established formations are standing commitments, including under manual government. */
export function initializeEstablishments(world: World) {
  for (const army of world.armies) army.establishment ??= Math.max(3000, army.soldiers)
}
export function reinforceArmies(world: World) {
  initializeEstablishments(world)
  const remaining = new Map(world.nations.map((n) => [n.id, Math.max(0, n.budget.military * 0.15)]))
  for (const nation of world.nations) {
    const own = world.regions.filter((r) => r.nation === nation.id)
    if (!own.length || nation.policies.military <= 0 || nation.policies.conscription <= 0) continue
    if (world.armies.length < MAX_ARMIES && !world.armies.some((a) => a.nation === nation.id)) {
      const source = own
        .filter(
          (r) =>
            r.foodCoverage > 0.9 &&
            r.unrest < 65 &&
            r.population.adults > 500 &&
            r.stocks.arms >= 1.2 &&
            r.stocks.food >= population(r) * 0.025 + 4,
        )
        .sort(
          (a, b) =>
            (b.id === nation.capital ? 1 : 0) - (a.id === nation.capital ? 1 : 0) ||
            b.infrastructure - a.infrastructure,
        )[0]
      if (source && nation.treasury >= 20 && (remaining.get(nation.id) ?? 0) >= 20) {
        const communities = takeCivilianAdults(world, source, 100)
        publicExpense(world, nation.id, 20, 'military cadre', source.id)
        remaining.set(nation.id, remaining.get(nation.id)! - 20)
        recordUse(world, marketStore(source.id), 'arms', 1.2)
        source.stocks.arms -= 1.2
        source.consumption.arms += 1.2
        const army: Army = {
          id: world.nextArmy++,
          nation: nation.id,
          name: `${nation.shortName} Territorial Corps`,
          region: source.id,
          target: null,
          soldiers: 100,
          establishment: Math.min(3000, Math.max(500, Math.floor(nation.population * 0.002))),
          morale: 0.65,
          supply: 1,
          experience: 0.05,
          casualties: 0,
          communities,
        }
        world.armies.push(army)
        ensureWarfare(world)
        recordGift(world, marketStore(source.id), armyStore(army.id), 'food', 4)
        source.stocks.food -= 4
        army.operations!.food = 4
        warEvent(
          world,
          `${nation.shortName} rebuilds its military cadre`,
          'Existing military appropriations fund a small cadre. Further recruitment requires local people, arms, food and training capacity.',
          nation.id,
          source.id,
        )
      }
    }
  }
  for (const army of world.armies) {
    const n = world.nations[army.nation],
      r = world.regions[army.region],
      o = army.operations!
    army.communities = coalesceCommunities(army.communities!)
    army.replacements = 0
    if (
      !o ||
      r.nation !== army.nation ||
      o.embarkedOn !== null ||
      o.disorder ||
      army.supply < 0.65 ||
      r.foodCoverage < 0.85 ||
      n.policies.conscription <= 0
    )
      continue
    const formations = world.armies.filter((a) => a.nation === n.id).length,
      nationalTarget = Math.floor(
        n.population * (0.0015 + n.policies.conscription * 0.0007) * (0.6 + n.policies.military / 50),
      ),
      target = Math.min(
        army.establishment!,
        Math.max(0, Math.floor(nationalTarget / Math.max(1, formations))),
      ),
      willingness = clamp(0.9 - r.unrest / 120, 0.1, 1),
      recruits = Math.max(
        0,
        Math.min(
          target - army.soldiers,
          Math.ceil(army.establishment! * 0.04),
          Math.floor(r.population.adults * 0.003 * willingness),
          Math.floor(Math.max(0, n.treasury) / 0.2),
          Math.floor((remaining.get(n.id) ?? 0) / 0.2),
          Math.floor(r.stocks.arms / 0.012),
          Math.floor(Math.max(0, r.stocks.food - population(r) * 0.025) / 0.04),
        ),
      )
    if (!recruits) continue
    const communities = takeCivilianAdults(world, r, recruits),
      before = army.soldiers
    for (const group of communities) addCommunity(army.communities!, group)
    army.soldiers += recruits
    army.replacements = recruits
    army.experience = (army.experience * before + 0.02 * recruits) / army.soldiers
    publicExpense(world, n.id, recruits * 0.2, 'military recruitment', r.id)
    remaining.set(n.id, remaining.get(n.id)! - recruits * 0.2)
    recordUse(world, marketStore(r.id), 'arms', recruits * 0.012)
    recordGift(world, marketStore(r.id), armyStore(army.id), 'food', recruits * 0.04)
    r.stocks.arms -= recruits * 0.012
    r.consumption.arms += recruits * 0.012
    r.stocks.food -= recruits * 0.04
    o.food += recruits * 0.04
  }
}
