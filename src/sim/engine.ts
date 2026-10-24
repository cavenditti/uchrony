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
import { produce, trade, consume, transportGraph, shortestPaths, pathTo } from './economy'
import { makeNation } from './generate'

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
    n.population =
      regions.reduce((s, r) => s + population(r), 0) +
      w.armies.filter((a) => a.nation === n.id).reduce((s, a) => s + a.soldiers, 0)
    n.gdp = regions.reduce((s, r) => s + r.gdp, 0)
    if (!regions.length) {
      n.income = 0
      n.spending = 0
      continue
    }
    n.income =
      ((n.gdp * n.policies.tax) / 100) * (0.6 + n.technologies.governance * 0.045) * (n.stability / 200 + 0.5)
    const revenue = n.income
    // A service floor can create a deficit at low tax rates; healthy states
    // otherwise retain a reserve instead of structurally overspending forever.
    const desiredServices = Math.max(n.gdp * 0.09, revenue * 0.85)
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
    const armyUpkeep = w.armies.filter((a) => a.nation === n.id).reduce((s, a) => s + a.soldiers * 0.008, 0)
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
  for (const r of w.regions) {
    const n = w.nations[r.nation],
      pop = population(r)
    const services = n.budget.welfare / Math.max(1, n.population / 10000)
    const school = n.budget.education / Math.max(1, n.population / 10000)
    const healthTarget = clamp(
      0.44 + services * 0.014 + n.technologies.medicine * 0.05 + r.foodCoverage * 0.2 - r.devastation * 0.35,
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
        n.policies.conscription * 0.012,
    )
    r.happiness = clamp(r.happiness + (happinessTarget - r.happiness) * 0.09)
    r.unrest = clamp(
      r.unrest +
        ((1 - r.happiness) * 65 + (r.culture !== r.nation ? 13 : 0) + r.devastation * 35 - r.unrest) * 0.06,
      0,
      100,
    )
    const shortage = 1 - r.foodCoverage
    const births = Math.round(r.population.adults * 0.0032 * (1 - r.literacy * 0.3) * (1 - shortage * 0.7))
    const modifier = 1.35 - r.health * 0.65
    const childDeaths = Math.min(
      r.population.children,
      Math.round(r.population.children * (0.0005 * modifier + shortage * 0.012)),
    )
    const adultDeaths = Math.min(
      r.population.adults,
      Math.round(r.population.adults * (0.0005 * modifier + shortage * 0.007)),
    )
    const elderDeaths = Math.min(
      r.population.elders,
      Math.round(r.population.elders * (0.007 * modifier + shortage * 0.018)),
    )
    const mature = Math.floor((r.population.children - childDeaths) / (18 * 12))
    const retire = Math.floor((r.population.adults - adultDeaths) / (47 * 12))
    r.population.children += births - childDeaths - mature
    r.population.adults += mature - adultDeaths - retire
    r.population.elders += retire - elderDeaths
    r.births = births
    r.deaths = childDeaths + adultDeaths + elderDeaths
    w.totals.births += births
    w.totals.deaths += r.deaths
    const investment = n.budget.infrastructure / Math.max(1, n.population / 10000)
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
  // Migration is a transfer of each age cohort, never population creation.
  const transfers: { from: number; to: number; amount: number }[] = []
  for (const r of w.regions) {
    const n = w.nations[r.nation]
    const attractiveness = (x: Region) =>
      x.happiness * 0.45 +
      x.health * 0.25 +
      x.infrastructure * 0.15 +
      x.foodCoverage * 0.15 -
      x.devastation * 0.4
    const destinations = r.neighbors
      .map((id) => w.regions[id])
      .filter((b) => {
        if (b.nation === r.nation) return true
        return (
          n.policies.migration !== 'closed' &&
          w.nations[b.nation].policies.migration !== 'closed' &&
          relation(w, r.nation, b.nation)?.treaty !== 'war'
        )
      })
      .sort((a, b) => attractiveness(b) - attractiveness(a))
    const to = destinations[0]
    if (!to) continue
    const delta = attractiveness(to) - attractiveness(r)
    const borderFactor =
      to.nation === r.nation ? 1 : w.nations[to.nation].policies.migration === 'controlled' ? 0.2 : 0.55
    const amount = Math.floor(population(r) * clamp(delta - 0.02, 0, 0.7) * 0.018 * borderFactor)
    if (amount > 0) transfers.push({ from: r.id, to: to.id, amount })
  }
  for (const t of transfers) {
    const from = w.regions[t.from],
      to = w.regions[t.to],
      total = population(from)
    let moved = 0
    for (const cohort of ['children', 'adults', 'elders'] as const) {
      const count = Math.min(
        from.population[cohort],
        Math.floor((t.amount * from.population[cohort]) / Math.max(1, total)),
      )
      from.population[cohort] -= count
      to.population[cohort] += count
      moved += count
    }
    from.migration -= moved
    to.migration += moved
    w.totals.migration += moved
  }
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
      (n.budget.research / 7) * (0.35 + literacy) * (1 + n.technologies.governance * 0.07)
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
        const preferred =
          n.foodCoverage < 0.95
            ? 'agriculture'
            : n.personality === 'expansionist' && n.technologies.military < 3
              ? 'military'
              : FIELDS[Math.floor(random(w) * FIELDS.length)]
        n.researchFocus = preferred
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
  for (const rel of w.relations) {
    if (!isAlive(w, rel.a) || !isAlive(w, rel.b)) continue
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
      if (rel.warExhaustion > 38 && a.ai && b.ai) {
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
      if (w.month - rel.since >= 60) rel.treaty = 'neutral'
      continue
    }
    if (w.month % 3 !== 0) continue
    if (a.ai && b.ai && rel.opinion > 35 && rel.treaty === 'neutral' && random(w) < 0.16) {
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
    if (a.ai && b.ai && rel.opinion > 68 && rel.treaty === 'trade' && random(w) < 0.07) {
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
    const aggressor = a.personality === 'expansionist' ? a : b.personality === 'expansionist' ? b : null
    if (
      aggressor?.ai &&
      rel.treaty === 'neutral' &&
      bordering(w, a.id, b.id) &&
      random(w) < (rel.opinion < 0 ? 0.075 : 0.017) &&
      aggressor.stability > 50
    ) {
      rel.treaty = 'war'
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
    if (n.ai && isAlive(w, n.id)) {
      if (w.month % 6 === 0) {
        n.policies.priority =
          n.foodCoverage < 0.97
            ? 'agriculture'
            : w.relations.some((r) => (r.a === n.id || r.b === n.id) && r.treaty === 'war')
              ? 'military'
              : n.personality === 'agrarian'
                ? 'agriculture'
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
  r.population.adults -= soldiers
  w.armies.push({
    id: w.nextArmy++,
    nation: n.id,
    name: `${n.shortName} ${w.nextArmy - 1} Corps`,
    region: r.id,
    target: null,
    soldiers,
    morale: 0.75,
    supply: 1,
    experience: 0.05,
    casualties: 0,
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

function military(w: World) {
  const graphs = new Map<number, ReturnType<typeof transportGraph>>()
  for (const army of w.armies) {
    const n = w.nations[army.nation],
      r = w.regions[army.region]
    if (!isAlive(w, n.id)) {
      r.population.adults += army.soldiers
      army.soldiers = 0
      continue
    }
    const foodNeed = army.soldiers * 0.034,
      ammoNeed = army.soldiers * 0.0005
    const access =
      r.nation === n.id ||
      relation(w, r.nation, n.id)?.treaty === 'alliance' ||
      relation(w, r.nation, n.id)?.treaty === 'war'
    const food = access ? Math.min(r.stocks.food, foodNeed) : 0
    const arms = access ? Math.min(r.stocks.arms, ammoNeed) : 0
    r.stocks.food -= food
    r.stocks.arms -= arms
    r.consumption.food += food
    r.consumption.arms += arms
    army.supply = clamp((0.8 * food) / Math.max(1, foodNeed) + (0.2 * arms) / Math.max(1, ammoNeed))
    const forceSize = w.armies.filter((a) => a.nation === n.id).reduce((sum, a) => sum + a.soldiers, 0)
    const training = clamp(n.budget.military / Math.max(1, forceSize * 0.012), 0, 2)
    army.experience = clamp(army.experience + training * 0.0015)
    army.morale = clamp(
      army.morale + (army.supply - 0.78) * 0.07 + n.technologies.military * 0.002 + (training - 0.5) * 0.003,
      0.12,
      1,
    )
    const attrition = Math.min(army.soldiers, Math.floor(army.soldiers * (1 - army.supply) * 0.022))
    army.soldiers -= attrition
    army.casualties += attrition
    n.casualties += attrition
    w.totals.deaths += attrition
    if (n.ai && army.target === null) {
      const enemyRegions = w.regions.filter((x) => relation(w, n.id, x.nation)?.treaty === 'war')
      const at = w.cells[r.center]
      enemyRegions.sort(
        (a, b) =>
          Math.hypot(w.cells[a.center].x - at.x, w.cells[a.center].y - at.y) -
          Math.hypot(w.cells[b.center].x - at.x, w.cells[b.center].y - at.y),
      )
      army.target = enemyRegions[0]?.id ?? null
    }
    if (army.target === null || army.target === army.region) {
      army.target = null
      continue
    }
    if (!graphs.has(n.id)) graphs.set(n.id, transportGraph(w, n.id))
    const graph = graphs.get(n.id)!,
      paths = shortestPaths(graph, army.region),
      path = pathTo(paths.previous, army.region, army.target)
    if (path.length < 2) {
      army.target = null
      continue
    }
    const next = w.regions[path[1]],
      hostile = relation(w, n.id, next.nation)?.treaty === 'war'
    if (!hostile) {
      if (next.nation !== n.id && relation(w, n.id, next.nation)?.treaty !== 'alliance') {
        army.target = null
        continue
      }
      army.region = next.id
      continue
    }
    const defenders = w.armies.filter(
      (a) => a.nation === next.nation && a.region === next.id && a.soldiers > 0,
    )
    const garrison = Math.min(next.population.adults * 0.012, 1400)
    const defenseBonus =
      next.terrain === 'mountains' ? 1.8 : next.terrain === 'hills' || next.terrain === 'forest' ? 1.3 : 1
    const defenderTech = w.nations[next.nation].technologies.military
    const attack =
      army.soldiers *
      army.morale *
      (0.5 + army.supply * 0.5) *
      (1 + n.technologies.military * 0.16 + army.experience * 0.3)
    const defense =
      (garrison + defenders.reduce((s, a) => s + a.soldiers * a.morale, 0)) *
      defenseBonus *
      (1 + defenderTech * 0.16)
    const attackLoss = Math.min(army.soldiers, Math.round(defense * (0.065 + random(w) * 0.05)))
    const defenderLoss = Math.round(attack * (0.07 + random(w) * 0.045))
    army.soldiers -= attackLoss
    army.casualties += attackLoss
    n.casualties += attackLoss
    w.totals.deaths += attackLoss
    let remainingLoss = defenderLoss
    for (const d of defenders) {
      const loss = Math.min(d.soldiers, Math.round(defenderLoss / Math.max(1, defenders.length + 1)))
      d.soldiers -= loss
      d.casualties += loss
      w.nations[d.nation].casualties += loss
      remainingLoss -= loss
      w.totals.deaths += loss
    }
    const civilLoss = Math.min(next.population.adults, remainingLoss)
    next.population.adults -= civilLoss
    next.deaths += civilLoss
    w.totals.deaths += civilLoss
    next.devastation = clamp(next.devastation + 0.06)
    army.experience = clamp(army.experience + 0.025)
    if (attack > defense * 1.15 && army.soldiers > 350) {
      const former = w.nations[next.nation]
      next.nation = n.id
      next.unrest = clamp(next.unrest + 20, 0, 100)
      army.region = next.id
      army.target = null
      graphs.clear()
      for (const d of defenders) {
        const retreat = next.neighbors.find((id) => w.regions[id].nation === former.id)
        if (retreat !== undefined) {
          d.region = retreat
          d.target = null
          d.morale *= 0.8
        } else {
          next.population.adults += d.soldiers
          d.soldiers = 0
        }
      }
      event(
        w,
        'war',
        `${n.shortName} takes ${next.name}`,
        `The province changes hands after a battle. Occupation disrupts production and increases unrest.`,
        n.id,
        next.id,
      )
      if (former.capital === next.id) {
        const remaining = nationRegions(w, former.id).sort((a, b) => population(b) - population(a))
        if (remaining.length) {
          former.capital = remaining[0].id
          former.stability = Math.max(5, former.stability - 15)
        } else
          event(
            w,
            'world',
            `The fall of ${former.shortName}`,
            'The state loses its final province. Surviving troops return to civilian life.',
            former.id,
          )
      }
    }
  }
  w.armies = w.armies.filter((a) => a.soldiers > 0)
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
  if (w.month % 6 === 0 && w.nations.length < 18) {
    const r = w.regions.find(
      (r) => r.unrest > 82 && population(r) > 25000 && nationRegions(w, r.nation).length > 2,
    )
    if (r && random(w) < 0.25) {
      const former = r.nation,
        n = makeNation(w.nations.length, r.id)
      n.name = `Free State of ${r.name}`
      n.shortName = r.name
      n.treasury = 1000
      n.technologies = { ...w.nations[former].technologies }
      w.nations.push(n)
      r.nation = n.id
      r.culture = n.id
      r.unrest = 35
      n.population = population(r)
      for (const other of w.nations.slice(0, -1))
        w.relations.push({
          a: other.id,
          b: n.id,
          opinion: other.id === former ? -65 : 0,
          treaty: other.id === former ? 'war' : 'neutral',
          since: w.month,
          warExhaustion: 0,
          grievance: 0,
        })
      if (w.nations[former].capital === r.id) w.nations[former].capital = nationRegions(w, former)[0].id
      event(
        w,
        'world',
        `${r.name} declares independence`,
        'Sustained unrest breaks a province away from its former government.',
        n.id,
        r.id,
      )
    }
  }
}

export function summarize(w: World, record = true) {
  for (const n of w.nations) {
    const regions = nationRegions(w, n.id)
    n.population =
      regions.reduce((s, r) => s + population(r), 0) +
      w.armies.filter((a) => a.nation === n.id).reduce((s, a) => s + a.soldiers, 0)
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
  worldEvents(w)
  produce(w)
  trade(w)
  consume(w)
  fiscalPolicy(w)
  demographics(w)
  science(w)
  diplomacy(w)
  military(w)
  summarize(w)
  return w
}

export function applyCommand(w: World, command: Command): string {
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
    if (command.building === 'school') r.literacy = Math.min(0.99, r.literacy + 0.08)
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
    if (target.nation !== army.nation && rel?.treaty !== 'war' && rel?.treaty !== 'alliance')
      return 'Military access requires an alliance or a declared war.'
    const paths = shortestPaths(transportGraph(w, army.nation), army.region)
    if (!Number.isFinite(paths.distance[target.id]))
      return 'No accessible land or maritime route reaches this province.'
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
      rel.treaty = 'trade'
    } else if (command.action === 'alliance') {
      if (rel.opinion < 45 || rel.treaty === 'war')
        return `${other.shortName} declines. An alliance requires relations of at least +45 and peace.`
      if (rel.treaty === 'alliance') return 'An alliance is already in effect.'
      rel.treaty = 'alliance'
    } else if (command.action === 'war') {
      if (rel.treaty === 'war') return 'These states are already at war.'
      if (rel.treaty === 'truce' && w.month - rel.since < 60)
        return 'The armistice prevents another declaration of war for five years.'
      rel.treaty = 'war'
      rel.opinion = -85
      rel.warExhaustion = 0
      n.legitimacy = clamp(n.legitimacy - 5, 0, 100)
    } else if (command.action === 'peace') {
      if (rel.treaty !== 'war') return 'These states are not at war.'
      if (rel.warExhaustion < 5 && rel.opinion < -50)
        return `${other.shortName} rejects an early armistice. War exhaustion must reach 5.`
      rel.treaty = 'truce'
      rel.warExhaustion = 0
      rel.opinion = -10
    } else if (command.action === 'embargo') {
      if (rel.treaty === 'war') return 'Wartime borders are already closed.'
      rel.treaty = 'neutral'
      rel.opinion = clamp(rel.opinion - 15, -100, 100)
    } else throw new Error('Unknown diplomatic action.')
    rel.since = w.month
    event(
      w,
      command.action === 'war' ? 'war' : command.action === 'peace' ? 'peace' : 'diplomacy',
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
