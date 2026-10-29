/** Narrative projections expose each government's knowledge rather than world truth.
 * The referee projection separately includes evidence needed to validate settlement. */
import { advisorContext } from './advisors'
import { agreementReference, agreementReferenceIndex } from './agreement-references'
import { currentAgreements } from './agreements'
import { strategicPressures } from './ambitions'
import { characterContext } from './character'
import { foreignOfficeContext } from './diplomatic-friction'
import { ensureHistory } from './history'
import { populationIdentitySummary } from './identities'
import {
  foreignIntelligence,
  intelligenceContext,
  intelligenceService,
  knownMap,
  visibleInstitutions,
} from './intelligence'
import { narrativeProjection } from './narrative'
import { portAt } from './navy'
import { identityDistribution } from './population'
import { ensureStatecraft } from './statecraft'
import type { DiplomaticOffer } from './statecraft-types'
import { sovereigntyAssessment } from './strategic-assessment'
import { supplierCreditRoom, supplierDebt } from './supplier-credit'
import { isAlive } from './territory-index'
import { population, type World } from './types'
const alive = (world: World, id: number) => !!world.nations[id] && isAlive(world, id)
/** Project knowledge available to this cabinet, with bounded history and private advice. */
export function stateAgentContext(world: World, nation: number, strategic: boolean) {
  const state = ensureStatecraft(world),
    knowledge = intelligenceService(world, nation),
    n = world.nations[nation],
    agent = state.agents.find((entry) => entry.nation === nation)!,
    visible = [
      ...state.offers.filter((offer) => offer.parties.includes(nation)),
      ...knowledge.agreements.map((report) => report.offer),
    ],
    inbox = state.messages
      .filter(
        (message) =>
          message.to.includes(nation) || message.from === nation || knowledge.broadcasts.includes(message.id),
      )
      .slice(-(strategic ? 24 : 6))
  const { character: _profile, personality: _legacyPersonality, ...government } = n
  const currentOffers = visible
    .filter((offer) => offer.status === 'proposed' || offer.status === 'ratified')
    .slice(-30)
  const referenceTexts = [
    agent.assessment,
    agent.strategy,
    agent.memory,
    ...agent.goals,
    ...inbox.flatMap((message) => [message.subject, message.body, agreementReference(message.offer)]),
    ...currentOffers.flatMap((offer) => [
      offer.title,
      offer.ruling,
      agreementReference(offer.supersedes),
      ...offer.terms.map((term) => term.text),
    ]),
  ]
  return narrativeProjection({
    month: world.month,
    nation,
    strategic,
    adviser: advisorContext(agent, strategic),
    intelligence: intelligenceContext(world, nation),
    foreignOffice: foreignOfficeContext(world, nation),
    institutions: visibleInstitutions(world, nation),
    strategicLandscape: strategicPressures(world, n),
    government,
    supplierCompensation: {
      owed: supplierDebt(world, nation),
      availableCredit: supplierCreditRoom(world, nation),
    },
    character: characterContext(n),
    agent: {
      strategy: agent.strategy,
      memory: agent.memory,
      goals: agent.goals,
      credibility: agent.integrity,
      escalation: agent.escalation,
    },
    populationIdentity: populationIdentitySummary(world, nation),
    society: ensureHistory(world).societies.find((entry) => entry.nation === nation),
    provinces: world.regions
      .filter((region) => region.nation === nation)
      .map((region) => ({
        id: region.id,
        name: region.name,
        people: population(region),
        food: region.foodCoverage,
        materialCoverage: region.materialCoverage ?? 1,
        security:
          world.sovereignty?.provinces.find((report) => report.region === region.id)?.stage ?? 'unreported',
        production: region.production,
        consumption: region.consumption,
        deposits: region.deposits,
        unrest: region.unrest,
        infrastructure: region.infrastructure,
        publicWorks: region.publicWorks,
        militaryControl: region.control,
        delegation: region.delegation,
        industry: region.industry,
        stocks: region.stocks,
        port: !!portAt(world, region.id),
      })),
    occupiedEnemyProvinces: world.regions
      .filter((r) => r.control?.nation === nation)
      .map((r) => ({
        id: r.id,
        name: r.name,
        legalOwner: r.nation,
        controlledSince: r.control!.since,
        spoils: r.control!.spoils,
      })),
    // Leaders receive operational forces and the summarized census, not every troop community.
    armies: world.armies
      .filter((army) => army.nation === nation)
      .map(({ communities: _census, ...army }) => army),
    fleets:
      world.warfare?.fleets
        .filter((f) => f.nation === nation)
        .map(({ communities: _crew, ...fleet }) => fleet) ?? [],
    foreignStates: foreignIntelligence(world, nation),
    map: strategic ? knownMap(world, nation) : [],
    inbox,
    offers: currentOffers.map(({ ruling, ...offer }) => ({
      reported: offer.parties.includes(nation)
        ? null
        : {
            month: knowledge.agreements.find((r) => r.offer.id === offer.id)?.month,
            warning: 'Third-party report; status and fulfillment may have changed since collection.',
          },
      sovereigntyAssessment: sovereigntyAssessment(world, nation, { ...offer, ruling }),
      ...offer,
      development:
        offer.status === 'ratified'
          ? 'Recorded commitments entered into force.'
          : offer.status === 'proposed'
            ? 'Negotiation or practical implementation remains pending.'
            : 'The undertaking did not proceed or is no longer in force.',
      reference: agreementReference(offer.id),
    })),
    agreementReferences: agreementReferenceIndex(visible, referenceTexts),
    recentPublicHistory: world.events
      .filter((event) => event.nation === nation || knowledge.news.includes(event.id))
      .slice(0, 8)
      .map((event) =>
        event.nation === nation
          ? {
              id: event.id,
              month: event.month,
              type: event.type,
              title: event.title,
              detail: event.detail,
              region: event.region,
            }
          : {
              id: event.id,
              month: event.month,
              title: event.title,
              type: event.type,
              source: 'Reported foreign news; details and consequences are unverified.',
            },
      ),
    developments: state.rulings
      .filter(
        (entry) =>
          entry.parties.includes(nation) ||
          (entry.visibility === 'public' &&
            knowledge.agreements.some((r) => r.offer.id === entry.offer) &&
            entry.month <= world.month - 6),
      )
      .slice(0, 8)
      .map((entry) => ({
        month: entry.month,
        agreement: agreementReference(entry.offer),
        situation:
          entry.verdict === 'approve'
            ? 'Recorded commitments entered into force.'
            : entry.verdict === 'reject'
              ? 'The undertaking did not proceed.'
              : 'Practical implementation remains unresolved.',
        outcome:
          entry.verdict === 'approve'
            ? 'in force'
            : entry.verdict === 'reject'
              ? 'did not proceed'
              : 'delayed',
      })),
    warnings: state.audit.filter((entry) => entry.nation === nation).slice(0, 4),
  })
}
/** Project ground truth needed to review signed diplomatic commitments. */
export function refereeContext(world: World, offers: DiplomaticOffer[]) {
  return {
    month: world.month,
    submitted: offers.map((offer) => ({ ...offer, reference: agreementReference(offer.id) })),
    agreementReferences: agreementReferenceIndex(
      ensureStatecraft(world).offers,
      offers.flatMap((offer) => [
        offer.title,
        offer.ruling,
        agreementReference(offer.supersedes),
        ...offer.terms.map((term) => term.text),
      ]),
    ),
    groundTruth: {
      institutions: world.institutions?.organizations,
      nations: world.nations.map((nation) => ({ ...nation, character: characterContext(nation) })),
      identities: world.nations
        .filter((nation) => alive(world, nation.id))
        .map((nation) => ({ nation: nation.id, ...populationIdentitySummary(world, nation.id) })),
      provinces: world.regions.map((region) => ({
        id: region.id,
        name: region.name,
        nation: region.nation,
        cultures: identityDistribution(region.communities ?? [], 'culture').slice(0, 3),
        socialCohesion: region.populationDynamics?.cohesion,
        population: population(region),
        coastal: region.coastal,
        terrain: region.terrain,
        neighbors: region.neighbors,
        unrest: region.unrest,
        infrastructure: region.infrastructure,
        delegation: region.delegation,
        stocks: region.stocks,
      })),
      armies: world.armies.map(({ communities: _census, ...army }) => army),
      fleets: world.warfare?.fleets.map(({ communities: _crew, ...fleet }) => fleet) ?? [],
      relations: world.relations,
    },
    agreements: currentAgreements(world).map((offer) => ({
      ...offer,
      reference: agreementReference(offer.id),
    })),
    messages: ensureStatecraft(world).messages.slice(-40),
    institutions: world.historical?.societies,
    recentHistory: world.events.slice(0, 12),
  }
}
