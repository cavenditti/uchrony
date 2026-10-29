/** Commands apply one typed handler under world configuration, then reconcile derived views. */
import { refreshAdaptiveTotals } from './adaptive-world'
import { diplomaticAccess } from './agreements'
import { buildFarm } from './agriculture'
import { refreshCityLabels } from './cities'
import { applyConfiguration, withWorldConfiguration } from './configuration'
import { foreignOfficeContext } from './diplomatic-friction'
import { aggregateDistricts, linkDistrictPeople } from './districts'
import { nativeDomesticControl } from './domestic-policy'
import { shortestPaths } from './economy'
import { foundSettlement } from './founding'
import { governance } from './governance'
import { collectiveDefense, foreignPolicyMandate } from './institutions'
import { configureIntelligence } from './intelligence'
import { reconcileJurisdictionSovereignty } from './jurisdictions'
import { publicExpense } from './ledger'
import { landGraph } from './military'
import { annexProvince } from './military-control'
import { inventoryFlow, marketStore, reconcileGDP, recordUse } from './national-accounts'
import { commissionFleet, embarkArmy, ensureWarfare, orderFleet } from './navy'
import { acceptablePeace, proposePeace } from './peace'
import { policyCommandValue } from './policy-rules'
import { ensurePopulation } from './population'
import { buildProductiveActivity } from './productive-investment'
import { buildTransport } from './public-works'
import { recruit } from './recruitment'
import { TECH_NAMES } from './research'
import { syncResidentialPopulation } from './residential-sites'
import { validateSettings } from './settings'
import { event } from './simulation-events'
import { refreshSpatial } from './spatial'
import {
  admitDiplomaticConsent,
  settleConventionalOffers,
  submitStandingOffer,
  tryStandingOffer,
} from './statecraft'
import { absorbUnclaimedEnclaves } from './territorial-expansion'
import { isAlive } from './territory-index'
import { type Command, type World, clamp, FIELDS, population, relation } from './types'
import { summarize } from './world-summary'

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

/** Apply one intervention and reconcile local, spatial and national views. */
export function applyCommand(w: World, command: Command): string {
  return withWorldConfiguration(w, () => applyCommandConfigured(w, command))
}

function applyCommandConfigured(w: World, command: Command): string {
  if (w.localEconomy) {
    linkDistrictPeople(w)
    aggregateDistricts(w)
  }
  const result = executeCommand(w, command)
  if (command.type === 'found-settlement' && absorbUnclaimedEnclaves(w)) {
    reconcileJurisdictionSovereignty(w)
    refreshCityLabels(w)
  }
  if (w.localEconomy) {
    linkDistrictPeople(w)
    aggregateDistricts(w)
  }
  syncResidentialPopulation(w)
  if (w.adaptive) refreshAdaptiveTotals(w)
  if (w.economy?.accounts) {
    reconcileGDP(w)
    summarize(w, false)
  }
  refreshSpatial(w)
  return result
}

/** Exhaustive dispatch keeps each command's narrowed payload with its handler. */
const COMMAND_HANDLERS = {
  annex: (w, command) => {
    return annexProvince(w, command.nation, command.region)
  },
  'peace-proposal': (w, command) => {
    const offer = proposePeace(
      w,
      command.nation,
      command.target,
      command.payer,
      command.payment,
      command.cede,
      true,
    )
    if (!offer) return foreignOfficeContext(w, command.nation).notice
    if (nativeDomesticControl(w, w.nations[command.target]) && acceptablePeace(w, command.target, offer))
      admitDiplomaticConsent(w, command.target, offer)
    return 'Peace terms dispatched. Each government must sign, and funds and territory are checked again before settlement.'
  },
  'peace-answer': (w, command) => {
    const offer = w.statecraft?.offers.find(
      (p) =>
        p.id === command.offer &&
        p.status === 'proposed' &&
        p.parties.includes(command.nation) &&
        p.terms.some((t) => t.kind === 'peace'),
    )
    if (!offer) throw new Error('Choose a pending peace proposal addressed to this government.')
    if (command.accept) {
      if (!admitDiplomaticConsent(w, command.nation, offer))
        return foreignOfficeContext(w, command.nation).notice
      settleConventionalOffers(w)
      return 'Peace terms signed. Settlement follows diplomatic preparation and final resource checks.'
    }
    offer.status = 'rejected'
    offer.ruling = 'The government rejected the proposed peace terms.'
    return offer.ruling
  },
  'found-settlement': (w, command) => {
    return foundSettlement(w, command.nation, command.cell)
  },
  intelligence: (w, command) => {
    configureIntelligence(w, command.nation, command.budgetShare, command.priority, command.focus)
    return 'Intelligence priorities updated. Reports improve through funded collection over time.'
  },
  'charter-proposal': (w, command) => {
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
  },
  devolution: (w, command) => {
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
  },
  configuration: (w, command) => {
    return applyConfiguration(w, command.values, command.revision)
  },
  conditions: (w, command) => {
    w.simulation = validateSettings(command.settings)
    if (w.configuration) {
      w.configuration = {
        ...w.configuration,
        revision: w.configuration.revision + 1,
        values: { ...w.configuration.values, conditions: w.simulation },
      }
    }
    return 'Simulation conditions updated. Existing people, stocks and commitments are preserved.'
  },
  commission: (w, command) => {
    return commissionFleet(w, command.nation, command.region, command.warships, command.transports)
  },
  'fleet-order': (w, command) => {
    return orderFleet(w, command.fleet, command.target, command.mission)
  },
  embark: (w, command) => {
    return embarkArmy(w, command.army, command.fleet)
  },
  'army-orders': (w, command) => {
    ensureWarfare(w)
    const army = w.armies.find((a) => a.id === command.army)
    if (
      !army ||
      !['march', 'hold', 'entrench'].includes(command.stance) ||
      !['restrained', 'requisition', 'pillage'].includes(command.conduct)
    )
      throw new Error('Choose a valid army stance and civilian conduct.')
    army.operations!.stance = command.stance
    army.operations!.conduct = command.conduct
    return 'Standing army orders updated.'
  },
  'identity-policy': (w, command) => {
    ensurePopulation(w)
    const nation = w.nations[command.nation],
      identity = w.demography!.identities[command.identity]
    if (!nation || !identity || identity.kind !== command.key)
      throw new Error('That official identity does not exist in this world.')
    nation.identity![command.key] = identity.id
    nation.ai = false
    return `${nation.shortName} recognizes ${identity.name}. Population identities will change through institutions and contact, not by decree.`
  },
  control: (w, command) => {
    if (command.nation !== null && !w.nations[command.nation]) throw new Error('That state does not exist.')
    w.nations.forEach((n) => (n.ai = n.extinct === undefined && n.id !== command.nation))
    return command.nation === null
      ? 'Observer mode: all states govern themselves.'
      : `You now govern ${w.nations[command.nation].name}.`
  },
  build: (w, command) => {
    const r = w.regions[command.region]
    if (!r) throw new Error('That province does not exist.')
    const n = governance(w, r.nation)
    if (
      command.building === 'industry' ||
      command.building === 'food-works' ||
      command.building === 'textile-works'
    )
      return buildProductiveActivity(
        w,
        r.id,
        command.building === 'industry' ? 'tools' : command.building === 'food-works' ? 'food' : 'textiles',
      )
    if (command.building === 'farm') return buildFarm(w, r.id)
    if (command.building === 'paved-road' || command.building === 'railway' || command.building === 'port')
      return buildTransport(w, r.id, command.building)
    const cost = { road: 600, school: 500 }[command.building]
    if (!cost) throw new Error('Unknown building.')
    if (n.treasury < cost) return `Construction requires ${cost}k crowns in the treasury.`
    if (r.stocks.timber < 50 || r.stocks.stone < 70)
      return 'Construction requires 50 t of timber and 70 t of stone in this province.'
    const maxed = command.building === 'road' ? r.infrastructure >= 1.5 : r.literacy >= 0.99
    if (maxed) return 'This province has reached the development limit for this investment.'
    publicExpense(w, n.id, cost, 'public construction', r.id)
    recordUse(w, marketStore(r.id), 'timber', 50)
    recordUse(w, marketStore(r.id), 'stone', 70)
    r.stocks.timber -= 50
    r.stocks.stone -= 70
    r.consumption.timber += 50
    r.consumption.stone += 70
    if (command.building === 'road') {
      r.infrastructure = Math.min(1.5, r.infrastructure + 0.2)
      r.publicWorks = { ...r.publicWorks, road: r.publicWorks?.road ?? 'gravel' }
    }
    if (command.building === 'school') {
      r.literacy = Math.min(0.99, r.literacy + 0.08)
      for (const group of r.communities ?? []) group.literacy = Math.min(0.99, group.literacy + 0.08)
    }
    event(
      w,
      'economy',
      `${r.name} invests in ${command.building === 'road' ? 'transport' : command.building === 'school' ? 'education' : 'industry'}`,
      `The project uses ${cost}k crowns, 50 t timber, and 70 t stone.`,
      n.id,
      r.id,
    )
    return `Investment completed in ${r.name}.`
  },
  disaster: (w, command) => {
    const r = w.regions[command.region]
    if (!r) throw new Error('That province does not exist.')
    if (command.disaster === 'drought') {
      if (w.economy?.goods) w.economy.goods.destruction.food += r.stocks.food * 0.82
      inventoryFlow(w, marketStore(r.id), 'food', -r.stocks.food * 0.82, undefined, true)
      r.stocks.food *= 0.18
      r.devastation = clamp(r.devastation + 0.45)
    } else if (command.disaster === 'epidemic') {
      r.health = clamp(r.health - 0.4)
      for (const group of r.communities ?? []) group.health = clamp(group.health - 0.4)
      r.devastation = clamp(r.devastation + 0.15)
    } else if (command.disaster === 'abundance') {
      const added = population(r) * 0.08
      inventoryFlow(w, marketStore(r.id), 'food', added, undefined, true)
      r.stocks.food += added
      if (w.economy?.goods) w.economy.goods.injections.food += added
    } else throw new Error('Unknown intervention.')
    event(
      w,
      'world',
      `${command.disaster === 'abundance' ? 'A bumper harvest' : command.disaster === 'drought' ? 'Drought' : 'An epidemic'} in ${r.name}`,
      'A sandbox intervention changes local conditions. Its consequences unfold through the simulation.',
      r.nation,
      r.id,
    )
    return `Intervention applied to ${r.name}.`
  },
  move: (w, command) => {
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
  },
  policy: (w, command) => {
    const n = activeNation(w, command.nation)

    const key = command.key
    if (!(key in n.policies)) throw new Error('Unknown policy.')
    Object.assign(n.policies, { [key]: policyCommandValue(key, command.value) })
    n.ai = false
    return `${n.shortName}: ${key} policy updated. Manual government enabled.`
  },
  research: (w, command) => {
    const n = activeNation(w, command.nation)

    if (!FIELDS.includes(command.field)) throw new Error('Unknown research field.')
    if (n.technologies[command.field] >= 6) return 'All discoveries in this field are complete.'
    n.researchFocus = command.field
    n.ai = false
    return `${n.shortName} is now researching ${TECH_NAMES[command.field][n.technologies[command.field]]}.`
  },
  recruit: (w, command) => {
    const n = activeNation(w, command.nation)

    const r = w.regions[command.region]
    if (!r) throw new Error('Select a valid province.')
    return recruit(w, n, r)
  },
  diplomacy: (w, command) => {
    const n = activeNation(w, command.nation)

    const other = w.nations[command.target],
      rel = relation(w, n.id, command.target)
    if (!other || !rel || !isAlive(w, other.id)) throw new Error('Select another active state.')
    if (command.action === 'improve') {
      if (n.treasury < 150) return 'A diplomatic mission costs 150k crowns.'
      if (rel.treaty === 'war') return 'Negotiate peace before sending a diplomatic mission.'
      publicExpense(w, n.id, 150, 'diplomatic mission')
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
      const offer = proposePeace(w, n.id, other.id, n.id, 0, [], true)
      if (offer && nativeDomesticControl(w, other) && acceptablePeace(w, other.id, offer))
        admitDiplomaticConsent(w, other.id, offer)
      return offer
        ? 'Armistice proposed. A government holding enemy land may require concessions.'
        : foreignOfficeContext(w, n.id).notice
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
  },
} satisfies { [K in Command['type']]: (world: World, command: Extract<Command, { type: K }>) => string }
function activeNation(w: World, id: number) {
  const nation = w.nations[id]
  if (!nation || !isAlive(w, id)) throw new Error('Select an active state first.')
  return nation
}
function executeCommand(w: World, command: Command): string {
  if (!Object.hasOwn(COMMAND_HANDLERS, command.type)) throw new Error('Unknown simulation command.')
  // Annexation and peace retain their own historical eligibility/consent checks.
  if (
    !['annex', 'peace-proposal', 'peace-answer'].includes(command.type) &&
    'nation' in command &&
    command.nation !== null &&
    w.nations[command.nation]?.extinct !== undefined
  )
    throw new Error('That state has ceased to exist.')
  // TypeScript loses the correlation when indexing a heterogeneous handler table;
  // the exhaustive mapped contract above and this same discriminant make it safe.
  const handler = COMMAND_HANDLERS[command.type] as (world: World, command: Command) => string
  return handler(w, command)
}
