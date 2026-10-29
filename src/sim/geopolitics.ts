import {
  ensureCabinet,
  nativeStrategicControl,
  setCabinetAgenda,
  cabinetOrderReserved,
} from './cabinet-state'
import {
  advanceCampaignPreparation,
  directTheaters,
  hasCampaignCause,
  rememberWars,
  seekCampaignSupport,
} from './campaign-ai'
import { reportedExpansionInterests } from './ambitions'
import { competitivePressure } from './competitive-pressure'
import { decisionPolicy, recruitmentCost } from './decision-policy'
import { nativeDomesticControl } from './domestic-policy'
import { expansionParameters } from './expansion-parameters'
import { militaryImpression, recordMilitaryInfluence } from './influence'
import { foreignPolicyMandate, sharedInstitution } from './institutions'
import { intelligenceService, perceivedAllies, perceivedPower, reportedWar } from './intelligence'
import { publicExpense } from './ledger'
import { annexProvince, annexationObstacle } from './military-control'
import { MAX_ARMIES } from './military-limits'
import { warEvent } from './navy'
import { advancePeaceNegotiations } from './peace'
import { hashSeed, random } from './random'
import { musterArmy } from './recruitment'
import { crossedPeriodMonth } from './simulation-period'
import {
  admitDiplomaticConsent,
  ensureStatecraft,
  settleConventionalOffers,
  tryStandingOffer as submitStandingOffer,
} from './statecraft'
import { sovereigntyAssessment } from './strategic-assessment'
import { territorialIndex } from './territory-index'
import { clamp, population, relation, type Nation, type World } from './types'

export interface Occupation {
  former: number
  since: number
  resistance: number
  settled: number
}
export interface StrategicCountry {
  nation: number
  lastInitiative: number
  lastMobilized: number
  threat: number
  initialTerritory: number
  lastTerritory: number
  expansion: number
}
export interface Geopolitics {
  rng: number
  owners: number[]
  countries: StrategicCountry[]
  observedWars: string[]
}
export function ensureGeopolitics(world: World) {
  const state = (world.geopolitics ??= {
    rng: hashSeed(`${world.seed}:power-politics`),
    owners: world.regions.map((r) => r.nation),
    countries: [],
    observedWars: [],
  })
  const territory = territorialIndex(world)
  for (const n of world.nations)
    if (!state.countries.some((c) => c.nation === n.id)) {
      const count = territory.regions(n.id).length
      state.countries.push({
        nation: n.id,
        lastInitiative: world.month - 12,
        lastMobilized: world.month - 3,
        threat: 0,
        initialTerritory: count,
        lastTerritory: count,
        expansion: 0,
      })
    }
  return state
}
export function markOccupation(world: World, region: number, former: number) {
  const r = world.regions[region]
  if (r.nation === former) return
  if (r.occupation?.former === r.nation) {
    delete r.occupation
    return
  }
  r.occupation ??= { former, since: world.month, resistance: 0.75, settled: 0 }
  r.unrest = Math.max(r.unrest, 65)
  for (const g of r.communities ?? []) {
    g.grievance = clamp(g.grievance + 0.12)
    g.loyalty = clamp(g.loyalty * 0.75)
  }
}
function mobilize(world: World, n: Nation, province: number, limit: number) {
  const r = world.regions[province],
    unitCost = recruitmentCost(world, n.id),
    minimum = decisionPolicy().realCosts ? 20 : 100,
    amount = Math.floor(
      Math.min(
        limit,
        r.population.adults * 0.02,
        Math.max(0, n.treasury) / unitCost,
        (Math.max(0, n.budget.military) * 0.4) / unitCost,
        r.stocks.arms / 0.012,
        Math.max(0, r.stocks.food - population(r) * 0.02) / 0.06,
      ),
    )
  if (amount < minimum || world.armies.length >= MAX_ARMIES) return
  musterArmy(world, r, {
    nation: n.id,
    name: `${r.name} mobilized corps`,
    soldiers: amount,
    establishment: decisionPolicy().realCosts ? Math.max(50, amount) : Math.max(1000, amount),
    morale: 0.55,
    supply: 0.85,
    experience: 0.02,
    armsPerSoldier: 0.012,
    foodPerSoldier: 0.06,
    expense: { amount: amount * unitCost, category: 'mobilization' },
    stance: 'entrench',
  })
  recordMilitaryInfluence(world, n.id, -1, r.id, 'mobilization', amount / 2000)
  warEvent(
    world,
    `${n.shortName} mobilizes in ${r.name}`,
    `${amount.toLocaleString()} residents join a locally equipped force as the government prepares for military pressure. They draw on actual public funds, weapons and provisions.`,
    n.id,
    r.id,
  )
}
function regionalDefenseMembers(
  world: World,
  attacker: number,
  victims: number[],
  alive: Nation[],
  territory: ReturnType<typeof territorialIndex> = territorialIndex(world),
) {
  return alive
    .filter(
      (member) =>
        member.ai &&
        member.id !== attacker &&
        (victims.includes(member.id) || territory.bordering(member.id, attacker)) &&
        perceivedPower(world, member.id, member.id) < perceivedPower(world, member.id, attacker) * 1.2 &&
        victims.some((id) => reportedWar(world, member.id, attacker, id)),
    )
    .map((member) => member.id)
    .slice(0, 12)
}
export function advanceGeopolitics(world: World) {
  const state = ensureGeopolitics(world)
  if (world.statecraft) settleConventionalOffers(world)
  // Conventional settlements above may alter ownership; snapshot only after they finish.
  const territory = territorialIndex(world)
  const alive = world.nations.filter((n) => territory.alive(n.id)),
    countries = new Map(state.countries.map((c) => [c.nation, c]))
  const aliveIds = new Set(alive.map((n) => n.id))
  for (const r of world.regions) {
    const old = state.owners[r.id]
    if (old !== undefined && old !== r.nation) {
      if (countries.has(r.nation)) countries.get(r.nation)!.expansion += 1
      const rel = relation(world, old, r.nation)
      if (rel?.treaty === 'war') markOccupation(world, r.id, old)
    }
    state.owners[r.id] = r.nation
    const occupation = r.occupation
    if (!occupation) continue
    if (occupation.former === r.nation) {
      delete r.occupation
      continue
    }
    const local = world.armies
        .filter((a) => a.nation === r.nation && a.region === r.id && a.operations?.embarkedOn === null)
        .reduce((s, a) => s + a.soldiers * a.supply * a.morale, 0),
      loyal =
        (r.communities ?? []).reduce(
          (s, g) =>
            s +
            (g.allegiance === r.nation
              ? g.population.children + g.population.adults + g.population.elders
              : 0),
          0,
        ) / Math.max(1, population(r)),
      demand = population(r) * (0.002 + 0.003 * occupation.resistance),
      cost = population(r) * 0.0003,
      n = world.nations[r.nation],
      paid = Math.min(Math.max(0, n.treasury), cost)
    publicExpense(world, n.id, paid, 'occupation administration', r.id)
    occupation.resistance = clamp(
      occupation.resistance +
        (local < demand ? 0.015 : -0.006) +
        (paid < cost ? 0.01 : 0) +
        (1 - r.foodCoverage) * 0.02 -
        (loyal > 0.65 ? 0.015 : 0),
      0.05,
      1,
    )
    r.unrest = Math.max(r.unrest, 35 + occupation.resistance * 50)
    if (local < demand)
      for (const g of r.communities ?? []) g.grievance = clamp(g.grievance + 0.003 * occupation.resistance)
    const atPeace = relation(world, r.nation, occupation.former)?.treaty !== 'war'
    occupation.settled = atPeace && occupation.resistance < 0.2 && loyal > 0.65 ? occupation.settled + 1 : 0
    if (occupation.settled >= 36) delete r.occupation
  }
  const newWars = world.relations.filter(
    (rel) =>
      rel.treaty === 'war' &&
      aliveIds.has(rel.a) &&
      aliveIds.has(rel.b) &&
      !state.observedWars.includes(`${rel.a}:${rel.b}:${rel.since}`),
  )
  for (const war of newWars) {
    state.observedWars.push(`${war.a}:${war.b}:${war.since}`)
    for (const id of [war.a, war.b]) {
      const agent = world.statecraft?.agents.find((a) => a.nation === id)
      if (agent) {
        agent.escalation =
          'Wartime emergency: mobilize, defend exposed provinces and organize support; act before the frontier is lost.'
        agent.nextDecision = world.month
        agent.nextStrategy = world.month
      }
    }
  }
  state.observedWars = state.observedWars.slice(-512)
  for (const n of alive) {
    const c = countries.get(n.id)!,
      own = territory.regions(n.id),
      neighbors = new Set(
        own
          .flatMap((r) => r.neighbors.map((id) => world.regions[id].nation))
          .filter((id) => id !== n.id && world.nations[id] !== undefined),
      ),
      wars = world.relations.filter((r) => r.treaty === 'war' && (r.a === n.id || r.b === n.id)),
      enemies = new Set(wars.map((r) => (r.a === n.id ? r.b : r.a))),
      power = perceivedPower(world, n.id, n.id),
      strongest = Math.max(
        0,
        ...[...neighbors]
          .filter(
            (id) =>
              relation(world, n.id, id)?.treaty !== 'alliance' &&
              !sharedInstitution(world, n.id, id, 'defense'),
          )
          .map((id) => perceivedPower(world, n.id, id)),
      ),
      expansionThreat = Math.max(
        0,
        ...[...neighbors].map(
          (id) => intelligenceService(world, n.id).dossiers.find((d) => d.nation === id)?.expansion ?? 0,
        ),
      ),
      threat = clamp(
        wars.length * 0.7 +
          (strongest / Math.max(1000, power)) * 0.15 +
          expansionThreat * 0.07 +
          Math.max(0, ...[...neighbors].map((id) => militaryImpression(world, n.id, id)?.fear ?? 0)) * 0.25,
      )
    c.threat = threat
    c.expansion *= 0.998
    c.lastTerritory = own.length
    if (!n.ai) continue
    const cabinet = ensureCabinet(world, n)
    rememberWars(world, n)
    const preparing = cabinet.posture === 'prepare-war'
    const drives = n.character!.leader.politics!.drives
    const competition = expansionParameters().militaryDrive > 0 ? competitivePressure(world, n) : undefined
    if (wars.length || preparing || threat > 0.55) {
      if (!cabinetOrderReserved(world, n, 'policy:military'))
        n.policies.military = Math.max(n.policies.military, Math.round(25 + threat * 25))
      if (!cabinetOrderReserved(world, n, 'policy:priority')) n.policies.priority = 'military'
      if (!cabinetOrderReserved(world, n, 'policy:conscription'))
        n.policies.conscription = Math.max(n.policies.conscription, 1.5 + threat * 2)
    }
    const frontier = own.filter((r) =>
        r.neighbors.some(
          (id) =>
            enemies.has(world.regions[id].nation) ||
            (preparing && world.regions[id].nation === cabinet.target),
        ),
      ),
      defended = (r: (typeof own)[number]) =>
        world.armies
          .filter((a) => a.nation === n.id && a.region === r.id)
          .reduce((s, a) => s + a.soldiers, 0),
      desired = n.population * (wars.length || preparing ? 0.008 : threat > 0.55 ? 0.004 : 0.0015),
      current = world.armies.filter((a) => a.nation === n.id).reduce((s, a) => s + a.soldiers, 0)
    if (
      current < desired &&
      world.month - c.lastMobilized >= 3 &&
      (wars.length || preparing || threat > 0.5)
    ) {
      const location = [...(frontier.length ? frontier : own)]
        .filter((r) => !r.control && r.foodCoverage > 0.75 && r.unrest < 80)
        .sort((a, b) => defended(a) - defended(b) || b.infrastructure - a.infrastructure)[0]
      if (location) {
        mobilize(world, n, location.id, Math.min(1500, desired - current))
        c.lastMobilized = world.month
      }
    }
    if (wars.length) directTheaters(world, n, enemies)
    if (advanceCampaignPreparation(world, n)) {
      if (cabinet.posture === 'consolidate') c.lastInitiative = world.month
      continue
    }
    if (!nativeStrategicControl(world, n) || (cabinet.source === 'model' && cabinet.review > world.month))
      continue
    if (!crossedPeriodMonth(world.month, n.id % 3, 3) || world.month - c.lastInitiative < 18) continue
    if (!foreignPolicyMandate(world, n.id, [n.id])) continue
    if (wars.length && drives.riskTolerance < 0.95) continue
    const options = [...neighbors]
      .map((id) => world.nations[id])
      .filter((other) => {
        const rel = relation(world, n.id, other.id)
        return rel && hasCampaignCause(world, n, other.id)
      })
      .map((other) => {
        const rel = relation(world, n.id, other.id)!,
          ratio =
            power / Math.max(decisionPolicy().realCosts ? 30 : 500, perceivedPower(world, n.id, other.id)),
          deterrence = perceivedAllies(world, n.id, other.id).reduce(
            (sum, id) => sum + perceivedPower(world, n.id, id),
            0,
          ),
          // Allies contribute discounted deterrence; perceived power has a floor
          // so missing reports never imply an infinitely weak opponent.
          superiority =
            power /
            Math.max(
              decisionPolicy().realCosts ? 30 : 500,
              perceivedPower(world, n.id, other.id) + deterrence * 0.6,
            ),
          interests = reportedExpansionInterests(world, n, other.id),
          motive =
            drives.ambition * 0.35 +
            drives.dominance * 0.45 +
            drives.opportunism * 0.2 +
            drives.opportunism * interests.economic * Math.min(0.2, Math.max(0, superiority - 1) * 0.1) +
            Math.max(0, -rel.opinion) / 160 +
            rel.grievance / 150 +
            (interests.economic * 0.35 + interests.cultural * 0.4) * (0.35 + drives.ambition * 0.65) +
            expansionParameters().militaryDrive *
              (interests.economic + (competition?.peer ?? 0)) *
              drives.riskTolerance,
          // Motivation is tempered by relative strength, current threats and
          // remembered fear. These are bounded decision scores, not probabilities.
          score =
            motive +
            Math.min(0.4, (ratio - 1) * 0.2) -
            Math.max(0, 1 - superiority) * 0.6 -
            threat * 0.15 -
            (militaryImpression(world, n.id, other.id)?.fear ?? 0) * 0.35
        return { other, score, superiority }
      })
      .sort((a, b) => b.score - a.score)
    const best = options[0]
    if (
      !best ||
      n.foodCoverage < 0.85 ||
      n.stability < 30 ||
      n.treasury < (decisionPolicy().realCosts ? recruitmentCost(world, n.id) * 50 : 200) ||
      best.score < decisionPolicy().warThreshold
    )
      continue
    setCabinetAgenda(world, n, 'prepare-war', best.other.id)
    seekCampaignSupport(world, n, best.other.id)
    c.lastInitiative = world.month
  }
  if (world.statecraft) {
    // Each cabinet independently accepts a shared-defense pact; no participant supplies another's consent.
    for (const war of world.relations.filter(
      (r) => r.treaty === 'war' && r.aggressor !== undefined && aliveIds.has(r.a) && aliveIds.has(r.b),
    )) {
      const aggressor = war.aggressor!,
        victim = war.a === aggressor ? war.b : war.a,
        regional = regionalDefenseMembers(world, aggressor, [victim], alive, territory)
      for (const partner of alive.filter((n) => n.ai && n.id !== aggressor && n.id !== victim)) {
        const exposed = territory.bordering(partner.id, aggressor),
          rel = relation(world, partner.id, victim),
          aggression =
            intelligenceService(world, partner.id).dossiers.find((d) => d.nation === aggressor)?.expansion ??
            0
        if (
          !exposed ||
          sharedInstitution(world, partner.id, victim, 'defense') ||
          (regional.length >= 3 && regional.includes(victim) && regional.includes(partner.id)) ||
          !reportedWar(world, partner.id, aggressor, victim) ||
          !rel ||
          rel.treaty === 'war' ||
          rel.treaty === 'alliance' ||
          rel.opinion < -20 ||
          (perceivedPower(world, partner.id, aggressor) <
            perceivedPower(world, partner.id, partner.id) * 1.3 &&
            aggression < 2)
        )
          continue
        const statecraft = ensureStatecraft(world),
          existing = statecraft.offers.find(
            (o) =>
              o.status === 'proposed' &&
              o.parties.includes(partner.id) &&
              o.parties.includes(victim) &&
              o.terms.some((t) => t.kind === 'alliance'),
          )
        const offer =
          existing ??
          submitStandingOffer(world, partner.id, {
            title: `Defense compact against ${world.nations[aggressor].shortName} expansion`,
            parties: [partner.id, victim],
            terms: [
              {
                kind: 'alliance',
                from: partner.id,
                to: victim,
                amount: 0,
                good: '',
                field: '',
                regions: [],
                duration: 60,
                text: 'Mutual access and support in response to a shared external threat.',
              },
            ],
            visibility: 'public',
            duration: 12,
            supersedes: 0,
          })
        if (!offer) continue
        if (world.nations[partner.id].ai) admitDiplomaticConsent(world, partner.id, offer)
        if (world.nations[victim].ai) admitDiplomaticConsent(world, victim, offer)
      }
    }
    settleConventionalOffers(world)
    for (const war of [...world.relations].filter(
      (r) => r.treaty === 'war' && r.aggressor !== undefined && aliveIds.has(r.a) && aliveIds.has(r.b),
    )) {
      const attacker = war.aggressor!,
        victim = war.a === attacker ? war.b : war.a
      const partners = alive.filter(
        (n) =>
          n.id !== victim &&
          (relation(world, n.id, victim)?.treaty === 'alliance' ||
            sharedInstitution(world, n.id, victim, 'defense')),
      )
      for (const ally of partners) {
        const partner = ally.id,
          rel = relation(world, partner, attacker)
        if (
          !aliveIds.has(partner) ||
          !reportedWar(world, partner, attacker, victim) ||
          !world.nations[partner].ai ||
          !rel ||
          rel.treaty === 'war' ||
          rel.treaty === 'truce' ||
          rel.treaty === 'alliance'
        )
          continue
        const combined = perceivedPower(world, partner, partner) + perceivedPower(world, partner, victim),
          risk = world.nations[partner].character!.leader.politics!.drives.riskTolerance
        if (combined < perceivedPower(world, partner, attacker) * (1.3 - risk * 0.6)) continue
        submitStandingOffer(world, partner, {
          title: `${world.nations[partner].shortName} intervenes in defense of ${world.nations[victim].shortName}`,
          parties: [partner],
          terms: [
            {
              kind: 'war',
              from: partner,
              to: attacker,
              amount: 0,
              good: '',
              field: '',
              regions: [],
              duration: 0,
              text: 'The cabinet commits actual forces to its defense obligations.',
            },
          ],
          visibility: 'public',
          duration: 12,
          supersedes: 0,
        })
      }
    }
    for (const attacker of alive) {
      const victimIds = world.relations
        .filter(
          (rel) =>
            rel.treaty === 'war' &&
            rel.aggressor === attacker.id &&
            aliveIds.has(rel.a) &&
            aliveIds.has(rel.b),
        )
        .map((rel) => (rel.a === attacker.id ? rel.b : rel.a))
      if (!victimIds.length) continue
      const members = regionalDefenseMembers(world, attacker.id, victimIds, alive)
      if (
        members.length >= 3 &&
        !world.institutions?.organizations.some(
          (body) =>
            body.status === 'active' &&
            body.charter.powers.includes('defense') &&
            members.every((id) => body.members.includes(id)),
        ) &&
        !ensureStatecraft(world).offers.some(
          (offer) =>
            offer.status === 'proposed' &&
            offer.terms.some((term) => term.kind === 'institution') &&
            members.every((id) => offer.parties.includes(id)),
        )
      ) {
        const offer = submitStandingOffer(world, members[0], {
          title: `League for protection against ${attacker.shortName}`,
          parties: members,
          terms: [
            {
              kind: 'institution',
              from: members[0],
              to: -1,
              amount: 0,
              good: '',
              field: '',
              regions: [],
              duration: 0,
              text: `League of ${members
                .map((id) => world.nations[id].shortName)
                .slice(0, 3)
                .join(', ')}`.slice(0, 140),
              charter: {
                operation: 'found',
                id: 0,
                form: 'defense-league',
                powers: ['defense'],
                rule: 'unanimity',
                contribution: 0.02,
                exit: 'notice',
              },
            },
          ],
          visibility: 'public',
          duration: 18,
          supersedes: 0,
        })
        if (offer)
          for (const member of members)
            if (world.nations[member].ai) admitDiplomaticConsent(world, member, offer)
      }
      if (!crossedPeriodMonth(world.month, attacker.id % 12, 12)) continue
      const peers = alive.filter(
        (member) =>
          member.ai &&
          member.id !== attacker.id &&
          world.regions.filter((region) => region.nation === member.id).length <= 3 &&
          perceivedPower(world, member.id, member.id) < perceivedPower(world, member.id, attacker.id) * 0.5 &&
          victimIds.some((id) => reportedWar(world, member.id, attacker.id, id)) &&
          (member.character?.leader.politics?.drives.dominance ?? 1) < 0.55,
      )
      for (const smaller of peers) {
        const peer = peers.find(
          (other) =>
            other.id !== smaller.id &&
            (intelligenceService(world, smaller.id).dossiers.find((d) => d.nation === other.id)?.economy
              ?.values.population.estimate ?? 0) >= smaller.population &&
            (relation(world, smaller.id, other.id)?.opinion ?? -100) > 10 &&
            world.regions.some(
              (region) =>
                region.nation === smaller.id &&
                region.neighbors.some((id) => world.regions[id].nation === other.id),
            ),
        )
        if (
          !peer ||
          ensureStatecraft(world).offers.some(
            (offer) =>
              offer.status === 'proposed' &&
              offer.parties.includes(smaller.id) &&
              offer.terms.some((term) => term.kind === 'merge'),
          )
        )
          continue
        const proposal = {
          title: `Survival union of ${smaller.shortName} and ${peer.shortName}`.slice(0, 140),
          parties: [smaller.id, peer.id],
          terms: [
            {
              kind: 'merge' as const,
              from: smaller.id,
              to: peer.id,
              amount: 0,
              good: '' as const,
              field: '' as const,
              regions: [],
              duration: 0,
              text: `Union of ${smaller.shortName} and ${peer.shortName}`.slice(0, 140),
            },
          ],
          visibility: 'public' as const,
          duration: 24,
          supersedes: 0,
        }
        const hypothetical = {
          ...proposal,
          id: 0,
          author: smaller.id,
          month: world.month,
          digest: '',
          signatures: [],
          status: 'proposed' as const,
          expires: world.month + 24,
          activated: 0,
          ends: 0,
          ruling: '',
          resolved: [],
          breaches: 0,
          delivered: 0,
        }
        if (!sovereigntyAssessment(world, smaller.id, hypothetical).domesticUnionMandate) continue
        const offer = submitStandingOffer(world, smaller.id, proposal)
        if (offer) admitDiplomaticConsent(world, peer.id, offer)
        break
      }
    }
    settleConventionalOffers(world)
  }
  advanceNativeAccords(world)
}

/** A diplomacy record is bookkeeping, not a switch that disables native peace
 * and commerce. Each autonomous signatory consents through the ordinary rules. */
export function advanceNativeAccords(world: World) {
  const statecraft = ensureStatecraft(world)
  advancePeaceNegotiations(world)
  for (const r of world.regions) {
    const id = r.control?.nation
    if (id === undefined || !nativeDomesticControl(world, world.nations[id])) continue
    const n = world.nations[id]
    if (
      nativeStrategicControl(world, n) &&
      (n.character?.leader.politics?.drives.ambition ?? 0) > 0.6 &&
      n.stability > 40 &&
      n.foodCoverage > 0.85 &&
      !annexationObstacle(world, id, r.id)
    )
      annexProvince(world, id, r.id)
  }
  const state = ensureGeopolitics(world)
  for (const rel of world.relations) {
    const a = world.nations[rel.a],
      b = world.nations[rel.b]
    if (
      !a?.ai ||
      !b?.ai ||
      !nativeStrategicControl(world, a) ||
      !nativeStrategicControl(world, b) ||
      a.extinct !== undefined ||
      b.extinct !== undefined ||
      !world.regions.some((r) => r.nation === a.id) ||
      !world.regions.some((r) => r.nation === b.id)
    )
      continue
    let kind: 'trade' | 'alliance' | undefined
    if (rel.treaty === 'war') continue
    if (crossedPeriodMonth(world.month, 0, 3)) {
      const commerce = (a.character!.effective.commercialism + b.character!.effective.commercialism) / 2
      const patience = (a.character!.effective.patience + b.character!.effective.patience) / 2
      if (rel.treaty === 'neutral' && rel.opinion > 35 && random(state) < 0.05 + commerce * 0.2)
        kind = 'trade'
      else if (rel.treaty === 'trade' && rel.opinion > 68 && random(state) < 0.025 + patience * 0.08)
        kind = 'alliance'
    }
    if (!kind) continue
    const pending = statecraft.offers.find(
      (o) =>
        o.status === 'proposed' &&
        o.parties.includes(a.id) &&
        o.parties.includes(b.id) &&
        o.terms.some((t) => t.kind === kind),
    )
    const offer =
      pending ??
      submitStandingOffer(world, a.id, {
        title: `${a.shortName}–${b.shortName} ${kind === 'trade' ? 'trade accord' : 'alliance'}`.slice(
          0,
          140,
        ),
        parties: [a.id, b.id],
        visibility: 'public',
        duration: 12,
        supersedes: 0,
        terms: [
          {
            kind,
            from: a.id,
            to: b.id,
            amount: 0,
            good: '',
            field: '',
            regions: [],
            duration: 0,
            text: 'Both cabinets accept closer relations on the strength of their established relationship.',
          },
        ],
      })
    if (offer) {
      admitDiplomaticConsent(world, a.id, offer)
      admitDiplomaticConsent(world, b.id, offer)
    }
  }
  settleConventionalOffers(world)
}
