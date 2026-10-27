import { recordRequisition } from './national-accounts'
import { publicTransfer } from './ledger'
import { MAX_ARMIES } from './military-limits'
import { MAX_STATE_IDENTITIES } from './types'
import { ensureStatecraft } from './statecraft'
import { clamp, population, relation, type Army, type Nation, type World } from './types'
import { makeNation } from './generate'
import { ensureCharacters, replaceStateLeader } from './character'
import {
  ensurePopulation,
  takeCivilianAdults,
  returnArmyPeople,
  coalesceCommunities,
  rollupPopulation,
} from './population'
import { ensureHistory } from './history'
import { ensureWarfare, warEvent } from './navy'
import { allForces } from './forces'
import { sharedInstitution } from './institutions'
import { provincialServiceLookup } from './public-services'

export interface ProvincialAuthority {
  region: number
  nation: number
  since: number
  protection: number
  neglect: number
  contested: number
  movement: number
  organization: number
  support: number
  mobilizable: number
  loyalStrength: number
  stage: 'stable' | 'fragile' | 'organizing' | 'contested'
  warned: number
}
export interface SovereigntyState {
  provinces: ProvincialAuthority[]
  successors: { nation: number; parent: number; movement: number }[]
}
export function ensureSovereignty(world: World) {
  return (world.sovereignty ??= { provinces: [], successors: [] })
}
const strength = (army: Army) => army.soldiers * army.supply * army.morale * (army.operations?.loyalty ?? 0.6)
function alertGovernment(world: World, nation: number, message: string) {
  const agent = world.statecraft?.agents.find((entry) => entry.nation === nation)
  if (agent) {
    agent.escalation = message
    agent.nextDecision = Math.min(agent.nextDecision, world.month)
    agent.nextStrategy = Math.min(agent.nextStrategy, world.month)
  }
}
function normalizeAfterLoss(world: World, nation: Nation) {
  const remaining = world.regions.filter((region) => region.nation === nation.id)
  if (remaining.length) {
    if (!remaining.some((region) => region.id === nation.capital))
      nation.capital = remaining.sort((a, b) => population(b) - population(a))[0].id
    return
  }
  // A government without territory capitulates; troops disperse into the local civilian census.
  for (const force of allForces(world).filter((army) => army.nation === nation.id))
    returnArmyPeople(world, force, world.regions[force.region])
  world.armies = world.armies.filter((army) => army.soldiers > 0)
  if (world.warfare) {
    world.warfare.fleets = world.warfare.fleets.filter((fleet) => fleet.soldiers > 0)
    for (const fleet of world.warfare.fleets)
      fleet.embarked = fleet.embarked.filter((id) => world.armies.some((army) => army.id === id))
    world.warfare.revision++
  }
}
function transferAuthority(world: World, report: ProvincialAuthority) {
  const r = world.regions[report.region],
    former = world.nations[r.nation],
    state = ensureSovereignty(world),
    movement = world.demography!.identities[report.movement],
    armedForeign = world.armies
      .filter(
        (army) =>
          army.nation !== former.id &&
          army.region === r.id &&
          army.soldiers > 100 &&
          army.supply > 0.65 &&
          strength(army) > report.loyalStrength * 1.5,
      )
      .find(
        (army) =>
          relation(world, army.nation, former.id)?.treaty === 'war' ||
          (report.support > 0.65 &&
            (world.nations[army.nation].character?.effective.assertiveness ?? 0) > 0.65),
      ),
    ally = state.successors.find(
      (entry) =>
        entry.parent === former.id &&
        entry.movement === report.movement &&
        r.neighbors.some((id) => world.regions[id].nation === entry.nation),
    ),
    restoration =
      r.occupation &&
      r.occupation.former !== former.id &&
      r
        .communities!.filter((g) => g.movement === report.movement && g.allegiance === r.occupation!.former)
        .reduce((sum, g) => sum + g.population.adults, 0) >
        r.population.adults * 0.45
        ? world.nations[r.occupation.former]
        : undefined,
    coup =
      !armedForeign &&
      !ally &&
      !restoration &&
      ((world.nations.length >= MAX_STATE_IDENTITIES && r.id === former.capital) ||
        world.regions.filter((region) => region.nation === former.id).length === 1)
  if (!armedForeign && !ally && !restoration && !coup && world.nations.length >= MAX_STATE_IDENTITIES) return
  let successor: Nation
  if (armedForeign) successor = world.nations[armedForeign.nation]
  else if (restoration) successor = restoration
  else if (ally) successor = world.nations[ally.nation]
  else if (coup) successor = former
  else {
    successor = makeNation(world.nations.length, r.id)
    successor.name = `${r.name} ${movement.orientation === 'communal' ? 'Commonwealth' : 'Free State'}`
    successor.shortName = r.name
    successor.government = movement.orientation === 'communal' ? 'Commonwealth' : 'Republic'
    successor.treasury = 0
    successor.debt = 0
    successor.policies = { ...former.policies }
    successor.technologies = { ...former.technologies }
    successor.researchFocus = former.researchFocus
    successor.stability = 40
    successor.legitimacy = 50
    world.nations.push(successor)
    for (const other of world.nations.slice(0, -1))
      world.relations.push({
        a: other.id,
        b: successor.id,
        opinion: other.id === former.id ? -65 : 0,
        treaty: other.id === former.id ? 'war' : 'neutral',
        since: world.month,
        warExhaustion: 0,
        grievance: other.id === former.id ? 35 : 0,
      })
    state.successors.push({ nation: successor.id, parent: former.id, movement: report.movement })
  }
  const share =
      population(r) /
      Math.max(
        1,
        world.regions
          .filter((region) => region.nation === former.id)
          .reduce((sum, region) => sum + population(region), 0),
      ),
    funds = coup
      ? 0
      : Math.min(
          Math.max(0, former.treasury) * Math.min(0.2, share),
          Math.max(0, former.budget.administration) * 2,
        )
  publicTransfer(world, former.id, successor.id, funds, 'state succession')
  r.nation = successor.id
  if (r.occupation?.former === successor.id) delete r.occupation
  if (world.regions[successor.capital].nation !== successor.id) successor.capital = r.id
  if (coup) {
    replaceStateLeader(world, former.id, `${r.name} provisional council`)
    former.stability = 35
    former.legitimacy = 45
  }
  // Muster only actual organized supporters, using existing arms or a limited supply of improvised tools.
  if (!armedForeign && world.armies.length < MAX_ARMIES) {
    const recruits = Math.min(report.mobilizable, Math.floor(r.population.adults * 0.04), 1500),
      regular = Math.min(recruits, Math.floor(r.stocks.arms / 0.012)),
      improvised = recruits - regular,
      communities = takeCivilianAdults(world, r, recruits, (group) => group.movement === report.movement)
    recordRequisition(world, r.id, 'arms', regular * 0.012)
    r.stocks.arms -= regular * 0.012
    r.consumption.arms += regular * 0.012
    const tools = Math.min(improvised, Math.floor(r.stocks.tools / 0.02)),
      timber = improvised - tools
    recordRequisition(world, r.id, 'tools', tools * 0.02)
    r.stocks.tools -= tools * 0.02
    r.consumption.tools += tools * 0.02
    const timberUsed = Math.min(r.stocks.timber, timber * 0.04)
    recordRequisition(world, r.id, 'timber', timberUsed)
    r.stocks.timber -= timberUsed
    r.consumption.timber += timberUsed
    for (const group of communities) {
      group.host = successor.id
      if (group.movement === report.movement) {
        group.allegiance = successor.id
        group.loyalty = Math.max(0.6, group.loyalty)
      }
    }
    if (recruits)
      world.armies.push({
        id: world.nextArmy++,
        nation: successor.id,
        name: `${r.name} Civic Guard`,
        region: r.id,
        target: null,
        soldiers: recruits,
        establishment: recruits,
        morale: 0.6,
        supply: 0.8,
        experience: 0.05,
        casualties: 0,
        communities: coalesceCommunities(communities),
      })
  }
  for (const group of r.communities ?? [])
    if (group.movement === report.movement) {
      group.allegiance = successor.id
      group.host = successor.id
      group.loyalty = Math.max(0.55, group.loyalty)
      group.grievance *= 0.75
    }
  r.unrest = Math.max(35, r.unrest - 25)
  rollupPopulation(r)
  report.nation = successor.id
  report.since = world.month
  report.neglect = 0
  report.contested = 0
  report.stage = 'fragile'
  report.organization = 0.35
  report.support = 0.3
  former.stability = Math.max(5, former.stability - (coup ? 0 : 8))
  former.legitimacy = Math.max(5, former.legitimacy - (coup ? 0 : 5))
  normalizeAfterLoss(world, former)
  ensurePopulation(world)
  ensureCharacters(world)
  ensureHistory(world)
  if (world.statecraft) ensureStatecraft(world)
  ensureWarfare(world)
  const title = coup
      ? `${r.name} movement replaces the government`
      : armedForeign
        ? `${successor.shortName} takes control in ${r.name}`
        : restoration
          ? `${r.name} restores ${successor.shortName} authority`
          : `${r.name} breaks with ${former.shortName}`,
    detail = coup
      ? 'An organized local coalition displaces a government that could no longer command loyal forces or maintain order. Its guard is drawn from existing residents and equipment.'
      : armedForeign
        ? 'Organized local opposition turns to a foreign force already present in the province. The former government loses effective control.'
        : 'Sustained insecurity, mobilized opposition and weak loyal forces allow a local coalition to seize institutions and establish its own authority. People and resources remain in place.'
  warEvent(world, title, detail, successor.id, r.id)
  alertGovernment(
    world,
    former.id,
    `Territorial crisis: ${title}. Restore credible protection, address grievances and reassess the remaining coalition.`,
  )
  alertGovernment(
    world,
    successor.id,
    `New responsibilities: ${title}. Secure food, pay the guard and establish legitimate institutions; success is not guaranteed.`,
  )
}

/** Loss of authority develops monthly from actual protection, organized support and available resources. */
export function advanceSovereignty(world: World) {
  ensurePopulation(world)
  ensureWarfare(world)
  const state = ensureSovereignty(world),
    indexed = new Map(state.provinces.map((report) => [report.region, report])),
    pending: ProvincialAuthority[] = []
  const provincialService = provincialServiceLookup(world)
  for (const r of world.regions) {
    if (r.nation < 0) continue
    const n = world.nations[r.nation],
      groups = r.communities!,
      adult = Math.max(1, r.population.adults),
      movements = new Map<number, number>()
    let loyalty = 0,
      grievance = 0,
      rootedness = 0
    for (const group of groups) {
      const size = group.population.adults
      // A common political identity is not itself an opposition organization.
      const dissent = clamp(((group.grievance + 1 - group.loyalty + r.unrest / 100) / 3 - 0.35) / 0.65)
      movements.set(group.movement, (movements.get(group.movement) ?? 0) + size * dissent)
      loyalty += size * group.loyalty
      grievance += size * group.grievance
      rootedness += size * group.rootedness
    }
    loyalty /= adult
    grievance /= adult
    rootedness /= adult
    const dominant = [...movements].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0],
      movement = dominant?.[0] ?? -1,
      share = (dominant?.[1] ?? 0) / adult
    let report = indexed.get(r.id)
    if (!report || report.nation !== r.nation) {
      report = {
        region: r.id,
        nation: r.nation,
        since: world.month,
        protection: 1,
        neglect: 0,
        contested: 0,
        movement,
        organization: 0.12,
        support: 0.1,
        mobilizable: 0,
        loyalStrength: 0,
        stage: 'stable',
        warned: 0,
      }
      if (indexed.has(r.id)) Object.assign(indexed.get(r.id)!, report)
      else state.provinces.push(report)
      report = indexed.get(r.id) ?? report
    }
    if (report.movement !== movement) {
      report.organization *= 0.5
      report.support *= 0.7
      report.movement = movement
    }
    let loyal = 0,
      hostile = 0
    for (const army of world.armies) {
      if (army.operations?.embarkedOn !== null || !army.soldiers) continue
      const reach =
        Math.min(1, r.infrastructure / 0.5) *
        (r.terrain === 'mountains' ? 0.5 : r.terrain === 'forest' ? 0.8 : 1) *
        (1 - r.devastation * 0.5)
      const nearby = army.region === r.id ? 1 : r.neighbors.includes(army.region) ? 0.3 * reach : 0
      if (!nearby) continue
      if (
        army.nation === n.id ||
        relation(world, n.id, army.nation)?.treaty === 'alliance' ||
        sharedInstitution(world, n.id, army.nation, 'defense')
      )
        loyal += strength(army) * nearby * (army.nation === n.id ? 1 : 0.5)
      else if (relation(world, n.id, army.nation)?.treaty === 'war') hostile += strength(army) * nearby
    }
    const targetSupport = clamp(((grievance + 1 - loyalty + r.unrest / 100) / 3 - 0.35) / 0.65),
      targetOrganization = clamp(
        Math.sqrt(share) * (0.5 + r.literacy * 0.25 + rootedness * 0.15) -
          Math.min(0.2, loyal / Math.max(1, population(r) * 0.02)),
      )
    report.support += (targetSupport - report.support) * 0.08
    report.organization += (targetOrganization - report.organization) * 0.06
    const regular = Math.floor(r.stocks.arms / 0.012),
      improvised = Math.min(300, Math.floor(r.stocks.tools / 0.02) + Math.floor(r.stocks.timber / 0.04)),
      potential = Math.floor(
        Math.min(adult * share * report.support * report.organization * 0.08, regular + improvised),
      )
    report.mobilizable = potential
    report.loyalStrength = loyal
    const need = Math.max(80, population(r) * 0.0015 * (0.7 + r.unrest / 80)),
      challenge = report.organization > 0.4 && report.support > 0.35 ? potential : 0,
      civil =
        clamp(
          0.2 +
            n.stability * 0.002 +
            n.legitimacy * 0.0025 +
            r.infrastructure * 0.15 +
            loyalty * 0.35 +
            0.15 *
              (1 -
                Math.exp(
                  -(provincialService(r, 'administration') + provincialService(r, 'policing')) /
                    Math.max(1, population(r) * 0.00001),
                )),
        ) *
        (1 - (r.unrest / 100) * 0.3) *
        (0.75 + r.foodCoverage * 0.25),
      civilSafe = civil / (1 + Math.max(0, hostile + challenge - loyal) / need),
      armed = clamp(loyal / (need + hostile * 0.8 + challenge)),
      protection = clamp(civilSafe + (1 - civilSafe) * armed)
    report.protection = protection
    report.neglect = protection < 0.5 ? report.neglect + 1 : Math.max(0, report.neglect - 2)
    if (report.neglect >= 3) {
      r.unrest = clamp(r.unrest + (0.5 - protection) * 5 + report.organization * report.support * 0.6, 0, 100)
      for (const group of groups) {
        group.grievance = clamp(group.grievance + (0.5 - protection) * 0.008)
        group.loyalty = clamp(group.loyalty - (0.5 - protection) * 0.005)
      }
    }
    const organized = report.organization >= 0.55 && report.support >= 0.45 && potential >= 75,
      canChallenge = organized && potential > loyal * 1.2 && r.unrest >= 60 && report.neglect >= 6
    report.contested = canChallenge ? report.contested + 1 : Math.max(0, report.contested - 1)
    const prior = report.stage
    report.stage = canChallenge
      ? 'contested'
      : organized && report.neglect >= 3
        ? 'organizing'
        : report.neglect >= 3
          ? 'fragile'
          : 'stable'
    if (report.stage !== 'stable' && (prior !== report.stage || world.month - report.warned >= 12)) {
      report.warned = world.month
      const name = world.demography!.identities[movement]?.name ?? 'Local networks',
        detail =
          report.stage === 'contested'
            ? `${name} can mobilize an armed challenge in ${r.name}. Loyal forces are outmatched and public order is failing; loss of control is imminent without protection, concessions or relief.`
            : `Protection is failing in ${r.name}. Public grievances and organized local networks are gaining ground. Fund and supply forces, restore services or negotiate before control becomes contested.`
      warEvent(
        world,
        `${r.name}: ${report.stage === 'contested' ? 'authority contested' : 'protection deteriorates'}`,
        detail,
        n.id,
        r.id,
      )
      alertGovernment(world, n.id, `Security emergency: ${detail}`)
    }
    if (report.contested >= 3 && world.month - report.since >= 12) pending.push(report)
  }
  // Sequential transitions re-check ownership and force balances after each territorial loss.
  for (const report of pending)
    if (world.regions[report.region].nation === report.nation) transferAuthority(world, report)
}
export function authoritySummary(world: World, nation: number) {
  const reports =
    world.sovereignty?.provinces.filter((report) => world.regions[report.region].nation === nation) ?? []
  return {
    fragile: reports.filter((report) => report.stage !== 'stable').length,
    contested: reports.filter((report) => report.stage === 'contested').length,
    emergencies: reports
      .filter((report) => report.stage !== 'stable')
      .sort((a, b) => b.contested - a.contested || b.neglect - a.neglect)
      .slice(0, 8)
      .map((report) => ({
        ...report,
        place: world.regions[report.region].name,
        organizationName: world.demography?.identities[report.movement]?.name ?? 'Local networks',
        monthsToPossibleLoss:
          report.stage === 'contested'
            ? Math.max(0, 3 - report.contested, 12 - (world.month - report.since))
            : null,
      })),
  }
}
