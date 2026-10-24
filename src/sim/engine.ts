import {
  allocateProvincialTaxes,
  advanceInstitutions,
  foreignPolicyMandate,
  collectiveDefense,
  provincialServiceBudget,
} from './institutions'
import {
  submitStandingOffer,
  tryStandingOffer,
  settleConventionalOffers,
  admitDiplomaticConsent,
} from './statecraft'
import { advanceGeopolitics } from './geopolitics'
import { advanceIntelligence, configureIntelligence } from './intelligence'
import { advanceDiplomaticOffices, foreignOfficeContext } from './diplomatic-friction'
import { advanceSovereignty } from './sovereignty'
import { reinforceArmies } from './military-personnel'
import { advancePressures } from './pressures'
import { validateSettings } from './settings'
import { allForces, militaryPeople } from './forces'
import { advanceArmies, landGraph } from './military'
import { advanceNavy, ensureWarfare, commissionFleet, orderFleet, embarkArmy } from './navy'
import {
  type World,
  type Region,
  type Nation,
  type Command,
  type SimEvent,
  type Policies,
  type Research,
  FIELDS,
  population,
  relation,
  clamp,
} from './types'
import { random } from './random'
import { produce, trade, consume, shortestPaths } from './economy'
import { advanceStatecraft } from './statecraft'
import { diplomaticAccess, agreementTerms } from './agreements'
import {
  ensurePopulation,
  updateCommunityDemography,
  populationTension,
  takeCivilianAdults,
  ageMilitaryPopulation,
  migrateCommunities,
} from './population'
import { beginPopulationMonth, evolveIdentities } from './identities'
import { advanceCharacters, characterPolicyTargets, characterResearch } from './character'
import { advanceHistory } from './history'
import { effectMultiplier, effectValue } from './effects'

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
export const researchCost = (level: number) => 140 * (level + 1) ** 1.45
export const nationRegions = (w: World, id: number) => w.regions.filter((r) => r.nation === id)
export function event(
  w: World,
  type: SimEvent['type'],
  title: string,
  detail: string,
  nation?: number,
  region?: number,
) {
  w.events.unshift({
    id: w.nextEvent++,
    month: w.month,
    type,
    title,
    detail,
    ...(nation !== undefined ? { nation } : {}),
    ...(region !== undefined ? { region } : {}),
  })
  w.events = w.events.slice(0, 240)
}

function fiscalPolicy(w: World) {
  for (const n of w.nations) {
    const regions = nationRegions(w, n.id)
    n.population = regions.reduce((s, r) => s + population(r), 0) + militaryPeople(w, n.id)
    n.gdp = regions.reduce((s, r) => s + r.gdp, 0)
    if (!regions.length) {
      n.income = 0
      n.spending = 0
      continue
    }
    n.income =
      ((n.gdp * n.policies.tax) / 100) *
      (0.6 + n.technologies.governance * 0.045) *
      (n.stability / 200 + 0.5) *
      effectMultiplier(w, 'taxIncome', n.id)
    const grossIncome = n.income
    n.income -= allocateProvincialTaxes(w, n.id, n.income)
    const revenue = n.income
    // A service floor can create a deficit at low tax rates; healthy states
    // otherwise retain a reserve instead of structurally overspending forever.
    const desiredServices = Math.max(n.gdp * 0.09 * (revenue / Math.max(0.001, grossIncome)), revenue * 0.85)
    const available = Math.min(desiredServices, revenue + Math.max(0, n.treasury) * 0.01)
    const weights = {
      welfare: n.policies.welfare,
      education: n.policies.education,
      military: n.policies.military,
      research: n.policies.research,
      administration: 12,
      infrastructure: 18,
    }
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    for (const k of Object.keys(weights) as (keyof typeof weights)[])
      n.budget[k] = (available * weights[k]) / sum
    const armyUpkeep =
      allForces(w)
        .filter((a) => a.nation === n.id)
        .reduce((s, a) => s + a.soldiers * 0.008, 0) +
      (w.warfare?.fleets
        .filter((f) => f.nation === n.id)
        .reduce((sum, f) => sum + f.warships * 12 + f.transports * 5, 0) ?? 0)
    n.spending = Object.values(n.budget).reduce((a, b) => a + b, 0) + armyUpkeep + n.debt * 0.003
    n.treasury += revenue - n.spending
    if (n.treasury < 0) {
      n.debt += -n.treasury
      n.treasury = 0
      n.legitimacy = clamp(n.legitimacy - 0.4, 0, 100)
    }
    if (n.treasury > 500 && n.debt > 0) {
      const repayment = Math.min(n.debt, n.treasury * 0.02)
      n.debt -= repayment
      n.treasury -= repayment
    }
    const debtLimit = Math.max(1000, n.gdp * 24)
    if (n.debt > debtLimit) {
      const writtenOff = n.debt - debtLimit * 0.35
      n.debt = debtLimit * 0.35
      n.legitimacy = clamp(n.legitimacy - 12, 0, 100)
      n.stability = clamp(n.stability - 10, 5, 99)
      event(
        w,
        'economy',
        `${n.shortName} restructures its debt`,
        `${Math.round(writtenOff).toLocaleString()}k crowns of unsustainable debt are written off. The default damages legitimacy and public stability.`,
        n.id,
      )
    } else if (revenue > n.spending) {
      n.legitimacy = clamp(n.legitimacy + 0.04, 0, 100)
    }
    const civilians = regions.reduce((s, r) => s + population(r), 0)
    n.foodCoverage = regions.reduce((s, r) => s + r.foodCoverage * population(r), 0) / Math.max(1, civilians)
    n.manpower = regions.reduce((s, r) => s + r.population.adults * 0.08, 0)
    const happy = regions.reduce((s, r) => s + r.happiness * population(r), 0) / Math.max(1, civilians)
    n.stability = clamp(
      n.stability + (happy * 80 + n.legitimacy * 0.2 - n.stability) * 0.05 - (n.debt > n.gdp * 24 ? 0.3 : 0),
      5,
      99,
    )
  }
}

function demographics(w: World) {
  ensurePopulation(w)
  for (const r of w.regions) {
    const n = w.nations[r.nation],
      pop = population(r)
    const services =
      (n.budget.welfare / Math.max(1, n.population / 10000)) * effectMultiplier(w, 'healthcare', n.id, r.id)
    const school =
      provincialServiceBudget(r, 'education') / Math.max(1, pop / 10000) +
      (n.budget.education / Math.max(1, n.population / 10000)) * effectMultiplier(w, 'education', n.id, r.id)
    const healthTarget = clamp(
      0.44 +
        services * 0.014 +
        n.technologies.medicine * 0.05 +
        r.foodCoverage * 0.2 -
        r.devastation * 0.35 -
        (1 - (r.materialCoverage ?? 1)) * 0.06,
    )
    r.health = clamp(r.health + (healthTarget - r.health) * 0.035)
    r.literacy = clamp(
      r.literacy + school * 0.0003 * (1 - r.literacy) + n.technologies.governance * 0.00003,
      0,
      0.99,
    )
    const happinessTarget = clamp(
      0.6 +
        n.policies.welfare * 0.003 -
        Math.max(0, n.policies.tax - 20) * 0.006 +
        r.health * 0.2 -
        (1 - r.foodCoverage) * 0.55 -
        r.devastation * 0.4 -
        (1 - (r.materialCoverage ?? 1)) * 0.14 -
        n.policies.conscription * 0.012,
    )
    r.happiness = clamp(r.happiness + (happinessTarget - r.happiness) * 0.09)
    r.unrest = clamp(
      r.unrest +
        ((1 - r.happiness) * 65 +
          populationTension(w, r) -
          effectValue(w, 'cohesion', n.id, r.id) * 15 +
          r.devastation * 35 -
          r.unrest) *
          0.06,
      0,
      100,
    )
    updateCommunityDemography(w, r)
    const investment =
      n.budget.infrastructure / Math.max(1, n.population / 10000) +
      provincialServiceBudget(r, 'infrastructure') / Math.max(1, pop / 10000)
    r.infrastructure = clamp(
      r.infrastructure + investment * 0.00012 - 0.0007 - r.devastation * 0.0007,
      0.08,
      1.5,
    )
    r.industry = clamp(
      r.industry +
        (n.policies.priority === 'industry' ? 0.0008 : 0.00015) * r.infrastructure -
        r.devastation * 0.0004,
      0.05,
      1.7,
    )
    r.urban = clamp(r.urban + (r.industry * 0.5 - r.urban) * 0.001, 0.03, 0.92)
    r.devastation = clamp(r.devastation - 0.008)
    if (r.foodCoverage < 0.75 && w.month % 6 === r.id % 6 && pop > 1000)
      event(
        w,
        'population',
        `Food shortage in ${r.name}`,
        `Households receive ${Math.round(r.foodCoverage * 100)}% of their food requirement. Mortality and migration are rising.`,
        r.nation,
        r.id,
      )
  }
  ageMilitaryPopulation(w)
  migrateCommunities(w)
  evolveIdentities(w)
}

function science(w: World) {
  for (const n of w.nations) {
    const regions = nationRegions(w, n.id)
    if (!regions.length) continue
    const literacy = regions.reduce((s, r) => s + r.literacy, 0) / regions.length
    const focus = n.researchFocus,
      level = n.technologies[focus]
    if (level >= 6) {
      if (n.ai) n.researchFocus = FIELDS.find((f) => n.technologies[f] < 6) ?? focus
      continue
    }
    n.researchProgress[focus] +=
      (n.budget.research / 7) *
      (0.35 + literacy) *
      (1 + n.technologies.governance * 0.07) *
      effectMultiplier(w, 'research', n.id)
    if (n.researchProgress[focus] >= researchCost(level)) {
      n.researchProgress[focus] -= researchCost(level)
      n.technologies[focus]++
      event(
        w,
        'research',
        `${n.shortName} discovers ${TECH_NAMES[focus][level]}`,
        `${focus[0].toUpperCase() + focus.slice(1)} advances to level ${level + 1}. The discovery now affects production, institutions, or survival.`,
        n.id,
      )
      if (n.ai) {
        n.researchFocus = characterResearch(n)
      }
    }
  }
}

function isAlive(w: World, id: number) {
  return w.regions.some((r) => r.nation === id)
}
export function bordering(w: World, a: number, b: number) {
  return w.regions.some((r) => r.nation === a && r.neighbors.some((id) => w.regions[id].nation === b))
}

function diplomacy(w: World) {
  const alive = new Set(w.regions.map((region) => region.nation))
  for (const rel of w.relations) {
    if (!alive.has(rel.a) || !alive.has(rel.b)) continue
    const a = w.nations[rel.a],
      b = w.nations[rel.b]
    const exchange = w.routes.some(
      (r) =>
        r.international &&
        [a.id, b.id].includes(w.regions[r.from].nation) &&
        [a.id, b.id].includes(w.regions[r.to].nation),
    )
    rel.opinion = clamp(rel.opinion + (exchange ? 0.15 : -0.015) - rel.grievance * 0.001, -100, 100)
    rel.grievance = Math.max(0, rel.grievance - 0.08)
    if (rel.treaty === 'war') {
      rel.warExhaustion += 0.7 + (2 - a.foodCoverage - b.foodCoverage) * 1.5
      const resolve = (a.character!.effective.assertiveness + b.character!.effective.assertiveness) / 2
      if (!w.statecraft && rel.warExhaustion > 30 + resolve * 20 && a.ai && b.ai) {
        rel.treaty = 'truce'
        rel.since = w.month
        rel.warExhaustion = 0
        rel.opinion = -15
        event(
          w,
          'peace',
          `${a.shortName} and ${b.shortName} sign an armistice`,
          'War exhaustion forces a settlement. Current territorial control becomes the new border.',
          a.id,
        )
      }
      continue
    }
    if (rel.treaty === 'truce') {
      if (
        w.month - rel.since >= 60 &&
        !agreementTerms(w, 'peace').some(
          ({ term }) => [term.from, term.to].includes(a.id) && [term.from, term.to].includes(b.id),
        )
      )
        rel.treaty = 'neutral'
      continue
    }
    if (w.statecraft || w.month % 3 !== 0) continue
    const commerce = (a.character!.effective.commercialism + b.character!.effective.commercialism) / 2
    const patience = (a.character!.effective.patience + b.character!.effective.patience) / 2
    if (a.ai && b.ai && rel.opinion > 35 && rel.treaty === 'neutral' && random(w) < 0.05 + commerce * 0.2) {
      rel.treaty = 'trade'
      rel.since = w.month
      event(
        w,
        'diplomacy',
        `${a.shortName}–${b.shortName} trade accord`,
        'The two states remove tariff friction from cross-border shipments.',
        a.id,
      )
    }
    if (a.ai && b.ai && rel.opinion > 68 && rel.treaty === 'trade' && random(w) < 0.025 + patience * 0.08) {
      rel.treaty = 'alliance'
      rel.since = w.month
      event(
        w,
        'diplomacy',
        `${a.shortName} and ${b.shortName} form an alliance`,
        'Mutual military access is granted. Relations and commerce reinforce the pact.',
        a.id,
      )
    }
    const aggressor = [a, b]
      .filter((n) => n.ai && n.character!.effective.assertiveness > 0.62)
      .sort((a, b) => b.character!.effective.assertiveness - a.character!.effective.assertiveness)[0]
    if (
      aggressor?.ai &&
      foreignPolicyMandate(w, aggressor.id, [aggressor.id]) &&
      rel.treaty === 'neutral' &&
      bordering(w, a.id, b.id) &&
      random(w) < (rel.opinion < 0 ? 0.09 : 0.02) * aggressor.character!.effective.assertiveness &&
      aggressor.stability > 50
    ) {
      rel.treaty = 'war'
      rel.aggressor = aggressor.id
      rel.since = w.month
      rel.opinion = -75
      rel.warExhaustion = 0
      event(
        w,
        'war',
        `${a.shortName} and ${b.shortName} go to war`,
        'Borders close to commerce. Armies mobilize, drawing food, equipment, and recruits from the civilian economy.',
        aggressor.id,
      )
    }
  }
  for (const n of w.nations)
    if (!w.statecraft && n.ai && isAlive(w, n.id)) {
      if (w.month % 6 === 0) {
        const targets = characterPolicyTargets(n)
        for (const key of [
          'tax',
          'welfare',
          'education',
          'military',
          'research',
          'tariff',
          'conscription',
        ] as const)
          n.policies[key] += clamp(
            targets[key] - n.policies[key],
            key === 'conscription' ? -0.2 : -2,
            key === 'conscription' ? 0.2 : 2,
          )
        n.policies.priority =
          n.foodCoverage < 0.97
            ? 'agriculture'
            : w.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war')
              ? 'military'
              : n.character!.effective.commercialism > 0.6
                ? 'industry'
                : 'balanced'
        if (n.treasury < 1000) n.policies.tax = clamp(n.policies.tax + 1, 10, 38)
        if (n.stability < 45) n.policies.welfare = clamp(n.policies.welfare + 3, 0, 80)
        const fighting = w.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war')
        if (fighting && w.armies.filter((a) => a.nation === n.id).length < 4 && n.treasury > 1200)
          recruit(w, n, w.regions[n.capital])
      }
    }
}

function recruit(w: World, n: Nation, r: Region): string {
  if (r.nation !== n.id) return 'Recruitment requires a province controlled by this state.'
  const soldiers = Math.min(3000, Math.floor(r.population.adults * (0.025 + n.policies.conscription * 0.012)))
  const cost = soldiers * 0.2
  if (soldiers < 500) return 'Not enough adult recruits in this province.'
  if (n.treasury < cost || r.stocks.arms < soldiers * 0.012)
    return 'Recruitment needs treasury funds and locally available arms.'
  n.treasury -= cost
  r.stocks.arms -= soldiers * 0.012
  const communities = takeCivilianAdults(w, r, soldiers)
  w.armies.push({
    communities,
    id: w.nextArmy++,
    nation: n.id,
    name: `${n.shortName} ${w.nextArmy - 1} Corps`,
    region: r.id,
    target: null,
    soldiers,
    establishment: soldiers,
    morale: 0.75,
    supply: 1,
    experience: 0.05,
    casualties: 0,
  })
  ensureWarfare(w)
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

function worldEvents(w: World) {
  if (w.month % 12 === 0) {
    w.climate = 0.82 + random(w) * 0.34
    if (w.climate < 0.9)
      event(
        w,
        'economy',
        'A dry year begins',
        'Rainfall is below average. Harvests fall across the world; reserves and trade will determine which regions cope.',
      )
    else if (w.climate > 1.1)
      event(
        w,
        'economy',
        'Favorable growing conditions',
        'A wetter growing season improves harvests and replenishes food reserves.',
      )
  }
}

export function summarize(w: World, record = true) {
  for (const n of w.nations) {
    const regions = nationRegions(w, n.id)
    n.population = regions.reduce((s, r) => s + population(r), 0) + militaryPeople(w, n.id)
    n.gdp = regions.reduce((s, r) => s + r.gdp, 0)
  }
  w.totals.population = w.nations.reduce((s, n) => s + n.population, 0)
  w.totals.gdp = w.nations.reduce((s, n) => s + n.gdp, 0)
  w.totals.trade = w.routes.reduce((s, r) => s + r.volume, 0)
  w.totals.wars = w.relations.filter((r) => r.treaty === 'war' && isAlive(w, r.a) && isAlive(w, r.b)).length
  if (record) {
    w.history.push({
      month: w.month,
      population: w.totals.population,
      gdp: w.totals.gdp,
      trade: w.totals.trade,
      wars: w.totals.wars,
      food:
        w.regions.reduce((s, r) => s + r.foodCoverage * population(r), 0) /
        Math.max(
          1,
          w.regions.reduce((s, r) => s + population(r), 0),
        ),
      nations: w.nations.map((n) => ({
        id: n.id,
        population: n.population,
        gdp: n.gdp,
        treasury: n.treasury,
        territory: nationRegions(w, n.id).length,
      })),
    })
    // Retain annual history indefinitely, plus monthly detail for the last ten years.
    w.history = w.history.filter((p) => p.month >= w.month - 120 || p.month % 12 === 0)
  }
}

export function tick(w: World): World {
  w.month++
  w.totals.births = 0
  w.totals.deaths = 0
  w.totals.migration = 0
  ensureWarfare(w)
  beginPopulationMonth(w)
  worldEvents(w)
  advanceHistory(w)
  advancePressures(w)
  advanceCharacters(w)
  if (w.statecraft) advanceStatecraft(w)
  produce(w)
  advanceNavy(w)
  trade(w)
  consume(w)
  fiscalPolicy(w)
  advanceDiplomaticOffices(w)
  advanceInstitutions(w)
  advanceIntelligence(w)
  advanceGeopolitics(w)
  demographics(w)
  science(w)
  diplomacy(w)
  advanceArmies(w)
  reinforceArmies(w)
  advanceSovereignty(w)
  summarize(w)
  return w
}

function proposeTreaty(w: World, from: number, to: number, kind: 'trade' | 'alliance' | 'peace') {
  const offer = tryStandingOffer(
    w,
    from,
    {
      title: `${w.nations[from].shortName}–${w.nations[to].shortName} ${kind} accord`,
      parties: [from, to],
      visibility: 'public',
      duration: 24,
      supersedes: 0,
      terms: [
        {
          kind,
          from,
          to,
          amount: 0,
          good: '',
          field: '',
          regions: [],
          duration: kind === 'peace' ? 60 : 0,
          text:
            kind === 'peace'
              ? 'A negotiated armistice.'
              : 'A standing arrangement, continuing until revoked or replaced.',
        },
      ],
    },
    true,
  )
  if (!offer) return foreignOfficeContext(w, from).notice
  if (w.nations[to].ai) admitDiplomaticConsent(w, to, offer)
  return 'The proposal is dispatched. Consent, diplomatic preparation and review are required before it takes effect.'
}
export function applyCommand(w: World, command: Command): string {
  if (command.type === 'intelligence') {
    configureIntelligence(w, command.nation, command.budgetShare, command.priority, command.focus)
    return 'Intelligence priorities updated. Reports improve through funded collection over time.'
  }
  if (command.type === 'charter-proposal') {
    const offer = tryStandingOffer(
      w,
      command.nation,
      {
        title: command.name,
        parties: command.members,
        terms: [
          {
            kind: 'institution',
            from: command.nation,
            to: -1,
            amount: 0,
            good: '',
            field: '',
            regions: [],
            duration: 0,
            text: command.name,
            charter: command.charter,
          },
        ],
        visibility: 'public',
        supersedes: 0,
        duration: 24,
      },
      true,
    )
    return offer
      ? 'The charter has been proposed. Other governments must consent before it takes effect.'
      : foreignOfficeContext(w, command.nation).notice
  }
  if (command.type === 'devolution') {
    submitStandingOffer(
      w,
      command.nation,
      {
        title: `Provincial charter of ${w.nations[command.nation].shortName}`,
        parties: [command.nation],
        terms: [
          {
            kind: 'devolution',
            from: command.nation,
            to: command.nation,
            amount: command.autonomy,
            good: '',
            field: '',
            regions: command.regions,
            duration: 0,
            text: 'Delegated provincial responsibilities',
            delegation: { powers: command.powers },
          },
        ],
        visibility: 'public',
        supersedes: 0,
        duration: 12,
      },
      true,
    )
    settleConventionalOffers(w)
    return 'Provincial responsibilities have been delegated under the recorded charter.'
  }
  if (command.type === 'conditions') {
    w.simulation = validateSettings(command.settings)
    return 'Simulation conditions updated. Existing people, stocks and commitments are preserved.'
  }
  if (command.type === 'commission')
    return commissionFleet(w, command.nation, command.region, command.warships, command.transports)
  if (command.type === 'fleet-order') return orderFleet(w, command.fleet, command.target, command.mission)
  if (command.type === 'embark') return embarkArmy(w, command.army, command.fleet)
  if (command.type === 'army-orders') {
    ensureWarfare(w)
    const army = w.armies.find((a) => a.id === command.army)
    if (
      !army ||
      !['march', 'hold', 'entrench'].includes(command.stance) ||
      !['restrained', 'requisition'].includes(command.conduct)
    )
      throw new Error('Choose a valid army stance and civilian conduct.')
    army.operations!.stance = command.stance
    army.operations!.conduct = command.conduct
    return 'Standing army orders updated.'
  }
  if (command.type === 'identity-policy') {
    ensurePopulation(w)
    const nation = w.nations[command.nation],
      identity = w.demography!.identities[command.identity]
    if (!nation || !identity || identity.kind !== command.key)
      throw new Error('That official identity does not exist in this world.')
    nation.identity![command.key] = identity.id
    nation.ai = false
    return `${nation.shortName} recognizes ${identity.name}. Population identities will change through institutions and contact, not by decree.`
  }
  if (command.type === 'control') {
    if (command.nation !== null && !w.nations[command.nation]) throw new Error('That state does not exist.')
    w.nations.forEach((n) => (n.ai = n.id !== command.nation))
    return command.nation === null
      ? 'Observer mode: all states govern themselves.'
      : `You now govern ${w.nations[command.nation].name}.`
  }
  if (command.type === 'build') {
    const r = w.regions[command.region]
    if (!r) throw new Error('That province does not exist.')
    const n = w.nations[r.nation]
    const cost = { farm: 450, industry: 900, road: 600, school: 500 }[command.building]
    if (!cost) throw new Error('Unknown building.')
    if (n.treasury < cost) return `Construction requires ${cost}k crowns in the treasury.`
    if (r.stocks.timber < 50 || r.stocks.stone < 70)
      return 'Construction requires 50 t of timber and 70 t of stone in this province.'
    const maxed =
      command.building === 'farm'
        ? r.fertility >= 1.2
        : command.building === 'industry'
          ? r.industry >= 1.7
          : command.building === 'road'
            ? r.infrastructure >= 1.5
            : r.literacy >= 0.99
    if (maxed) return 'This province has reached the development limit for this investment.'
    n.treasury -= cost
    r.stocks.timber -= 50
    r.stocks.stone -= 70
    if (command.building === 'farm') r.fertility = Math.min(1.2, r.fertility + 0.12)
    if (command.building === 'industry') r.industry = Math.min(1.7, r.industry + 0.18)
    if (command.building === 'road') r.infrastructure = Math.min(1.5, r.infrastructure + 0.2)
    if (command.building === 'school') {
      r.literacy = Math.min(0.99, r.literacy + 0.08)
      for (const group of r.communities ?? []) group.literacy = Math.min(0.99, group.literacy + 0.08)
    }
    event(
      w,
      'economy',
      `${r.name} invests in ${command.building === 'farm' ? 'agriculture' : command.building === 'road' ? 'transport' : command.building === 'school' ? 'education' : 'industry'}`,
      `The project uses ${cost}k crowns, 50 t timber, and 70 t stone.`,
      n.id,
      r.id,
    )
    return `Investment completed in ${r.name}.`
  }
  if (command.type === 'disaster') {
    const r = w.regions[command.region]
    if (!r) throw new Error('That province does not exist.')
    if (command.disaster === 'drought') {
      r.stocks.food *= 0.18
      r.devastation = clamp(r.devastation + 0.45)
    } else if (command.disaster === 'epidemic') {
      r.health = clamp(r.health - 0.4)
      for (const group of r.communities ?? []) group.health = clamp(group.health - 0.4)
      r.devastation = clamp(r.devastation + 0.15)
    } else if (command.disaster === 'abundance') r.stocks.food += population(r) * 0.08
    else throw new Error('Unknown intervention.')
    event(
      w,
      'world',
      `${command.disaster === 'abundance' ? 'A bumper harvest' : command.disaster === 'drought' ? 'Drought' : 'An epidemic'} in ${r.name}`,
      'A sandbox intervention changes local conditions. Its consequences unfold through the simulation.',
      r.nation,
      r.id,
    )
    return `Intervention applied to ${r.name}.`
  }
  if (command.type === 'move') {
    const army = w.armies.find((a) => a.id === command.army),
      target = w.regions[command.target]
    if (!army || !target) throw new Error('Select a valid army and destination.')
    const rel = relation(w, army.nation, target.nation)
    if (
      target.nation !== army.nation &&
      rel?.treaty !== 'war' &&
      rel?.treaty !== 'alliance' &&
      !diplomaticAccess(w, army.nation, target.nation)
    )
      return 'Military access requires an alliance or a declared war.'
    const paths = shortestPaths(landGraph(w, army.nation), army.region)
    if (!Number.isFinite(paths.distance[target.id]))
      return 'No accessible land route reaches this province. Overseas movement requires a transport fleet.'
    ensureWarfare(w)
    army.operations!.stance = 'march'
    army.operations!.progress = 0
    army.target = target.id
    return `${army.name} ordered to ${target.name}. Movement begins next month.`
  }
  const n = w.nations[command.nation]
  if (!n || !isAlive(w, n.id)) throw new Error('Select an active state first.')
  if (command.type === 'policy') {
    const key = command.key
    if (!(key in n.policies)) throw new Error('Unknown policy.')
    if (key === 'priority') {
      if (!['balanced', 'agriculture', 'industry', 'military'].includes(String(command.value)))
        throw new Error('Invalid production priority.')
      n.policies.priority = command.value as Policies['priority']
    } else if (key === 'migration') {
      if (!['open', 'controlled', 'closed'].includes(String(command.value)))
        throw new Error('Invalid migration policy.')
      n.policies.migration = command.value as Policies['migration']
    } else if (key === 'citizenship' || key === 'languagePolicy' || key === 'beliefPolicy') {
      const allowed = {
        citizenship: ['civic', 'pluralist', 'heritage'],
        languagePolicy: ['local', 'common', 'multilingual'],
        beliefPolicy: ['protected', 'favored', 'restricted'],
      }
      if (!allowed[key].includes(String(command.value))) throw new Error('Invalid identity policy.')
      Object.assign(n.policies, { [key]: command.value })
    } else {
      const max = key === 'tax' ? 55 : key === 'tariff' ? 40 : key === 'conscription' ? 5 : 80
      const min = key === 'tax' ? 5 : 0
      if (typeof command.value !== 'number' || !Number.isFinite(command.value))
        throw new Error('Policy values must be finite numbers.')
      n.policies[key] = clamp(command.value, min, max)
    }
    n.ai = false
    return `${n.shortName}: ${key} policy updated. Manual government enabled.`
  }
  if (command.type === 'research') {
    if (!FIELDS.includes(command.field)) throw new Error('Unknown research field.')
    if (n.technologies[command.field] >= 6) return 'All discoveries in this field are complete.'
    n.researchFocus = command.field
    n.ai = false
    return `${n.shortName} is now researching ${TECH_NAMES[command.field][n.technologies[command.field]]}.`
  }
  if (command.type === 'recruit') {
    const r = w.regions[command.region]
    if (!r) throw new Error('Select a valid province.')
    return recruit(w, n, r)
  }
  if (command.type === 'diplomacy') {
    const other = w.nations[command.target],
      rel = relation(w, n.id, command.target)
    if (!other || !rel || !isAlive(w, other.id)) throw new Error('Select another active state.')
    if (command.action === 'improve') {
      if (n.treasury < 150) return 'A diplomatic mission costs 150k crowns.'
      if (rel.treaty === 'war') return 'Negotiate peace before sending a diplomatic mission.'
      n.treasury -= 150
      rel.opinion = clamp(rel.opinion + 12, -100, 100)
      return `Relations with ${other.shortName} improved by 12.`
    }
    if (command.action === 'trade') {
      if (rel.opinion < 10 || rel.treaty === 'war')
        return `${other.shortName} declines. A trade agreement requires relations of at least +10 and peace.`
      if (rel.treaty === 'alliance' || rel.treaty === 'trade')
        return 'Tariff-free trade is already in effect.'
      return proposeTreaty(w, n.id, other.id, 'trade')
    } else if (command.action === 'alliance') {
      if (rel.opinion < 45 || rel.treaty === 'war')
        return `${other.shortName} declines. An alliance requires relations of at least +45 and peace.`
      if (rel.treaty === 'alliance') return 'An alliance is already in effect.'
      return proposeTreaty(w, n.id, other.id, 'alliance')
    } else if (command.action === 'war') {
      if (!foreignPolicyMandate(w, n.id, [n.id]) && !collectiveDefense(w, n.id, command.target))
        return 'Foreign policy is delegated. Obtain the member authorization required by the charter.'
      if (rel.treaty === 'war') return 'These states are already at war.'
      if (rel.treaty === 'truce' && w.month - rel.since < 60)
        return 'The armistice prevents another declaration of war for five years.'
      rel.treaty = 'war'
      rel.aggressor = n.id
      rel.opinion = -85
      rel.warExhaustion = 0
      n.legitimacy = clamp(n.legitimacy - 5, 0, 100)
    } else if (command.action === 'peace') {
      if (rel.treaty !== 'war') return 'These states are not at war.'
      if (rel.warExhaustion < 5 && rel.opinion < -50)
        return `${other.shortName} rejects an early armistice. War exhaustion must reach 5.`
      return proposeTreaty(w, n.id, other.id, 'peace')
    } else if (command.action === 'embargo') {
      if (rel.treaty === 'war') return 'Wartime borders are already closed.'
      rel.treaty = 'neutral'
      rel.opinion = clamp(rel.opinion - 15, -100, 100)
    } else throw new Error('Unknown diplomatic action.')
    rel.since = w.month
    event(
      w,
      command.action === 'war' ? 'war' : 'diplomacy',
      `${n.shortName} → ${other.shortName}: ${rel.treaty}`,
      command.action === 'embargo'
        ? 'Preferential access is revoked. Standard tariffs apply.'
        : 'Diplomatic status changes military access, commerce, and future decisions.',
      n.id,
    )
    return `Diplomatic status with ${other.shortName}: ${rel.treaty}.`
  }
  throw new Error('Unknown simulation command.')
}
