import type { World } from './types'
import { generatedLeaderName } from './character'
import type { HistoricalEffect, HistoricalOpportunity, HistoricalProposal } from './history-types'

/** Small contextual developments keep history moving while richer drafts are in flight. */
export function proceduralEvent(world: World, opportunity: HistoricalOpportunity): HistoricalProposal {
  const n = world.nations[opportunity.nation],
    r = world.regions[opportunity.region],
    effect = (
      kind: HistoricalEffect['kind'],
      stat: HistoricalEffect['stat'],
      amount = 0,
      duration = 0,
      text = '',
      scope: HistoricalEffect['scope'] = 'nation',
    ): HistoricalEffect => ({
      kind,
      stat,
      amount,
      duration,
      text,
      scope,
      target: scope === 'region' ? r.id : n.id,
      other: -1,
      delay: 0,
      curve: 'steady',
      field: '',
    }),
    proposal: HistoricalProposal = {
      category: opportunity.category,
      nation: n.id,
      region: r.id,
      causeEvent: 0,
      conditions: [],
      title: '',
      description: '',
      effects: [],
      responses: [],
      followUps: [],
    }
  switch (opportunity.category) {
    case 'succession': {
      const leader = generatedLeaderName(world, n, (n.character?.leader.generation ?? 0) + 1)
      proposal.title = `New leadership in ${n.shortName}`
      proposal.description = `${leader} assumes authority after negotiations among the state's leading institutions. The transition briefly unsettles established loyalties.`
      proposal.effects = [
        effect('leadership', 'leader', 0, 0, leader),
        effect('change', 'legitimacy', -2),
        effect('modifier', 'cohesion', -0.04, 8),
      ]
      break
    }
    case 'discovery': {
      const boost = effect('change', 'researchProgress', 14)
      boost.field = n.researchFocus
      proposal.title = `${r.name} scholars circulate new findings`
      proposal.description = `A practical study draws attention to improvements in ${n.researchFocus}. Local institutions begin comparing its findings with established methods.`
      proposal.effects = [boost, effect('modifier', 'research', 0.05, 18)]
      break
    }
    case 'literature': {
      const name = `Letters from ${r.name}`
      proposal.title = `${name} finds an audience`
      proposal.description = `A collection of essays draws on local experience to question inherited assumptions. Its circulation encourages discussion among teachers and civic societies.`
      proposal.effects = [
        effect('legacy', 'literature', 0, 0, name),
        effect('change', 'prestige', 2),
        effect('modifier', 'education', 0.05, 18),
      ]
      break
    }
    case 'belief': {
      const name = `${r.name} fellowship`
      proposal.title = `A new fellowship takes root in ${r.name}`
      proposal.description = `A fellowship emphasizes mutual aid and a renewed interpretation of local traditions. Its gatherings create new bonds while unsettling some established authorities.`
      proposal.effects = [
        effect('legacy', 'belief', 0, 0, name),
        effect('change', 'pluralism', 1),
        effect('change', 'unrest', 2, 0, '', 'region'),
        effect('modifier', 'cohesion', 0.04, 18),
      ]
      break
    }
    case 'institutions':
      proposal.title = `${r.name} formalizes a civic council`
      proposal.description = `Local administrators put customary responsibilities into a more regular form. Clearer procedures modestly improve the government's reach.`
      proposal.effects = [
        effect('legacy', 'institution', 0, 0, `${r.name} civic council`),
        effect('modifier', 'taxIncome', 0.04, 24),
      ]
      break
    case 'social':
      proposal.title = `Petitions gather in ${r.name}`
      proposal.description = `Residents organize petitions over the distribution of public burdens. Officials face growing pressure to answer grievances before they deepen.`
      proposal.effects = [
        effect('change', 'unrest', 3, 0, '', 'region'),
        effect('modifier', 'cohesion', -0.04, 9),
      ]
      break
    case 'commerce':
      proposal.title = `${r.name} merchants pool their resources`
      proposal.description = `Merchants coordinate storage and carriage along established routes. The arrangement makes local distribution more reliable for a time.`
      proposal.effects = [
        effect('modifier', 'tradeCapacity', 0.06, 18, '', 'region'),
        effect('modifier', 'tradeCost', -0.04, 18, '', 'region'),
      ]
      break
    case 'disaster':
      proposal.title = `Illness disrupts life in ${r.name}`
      proposal.description = `An outbreak strains local care and keeps some households from their usual work. Its severity will depend on food, health and public services.`
      proposal.effects = [
        effect('modifier', 'mortality', 0.07, 6, '', 'region'),
        effect('modifier', 'extraction', -0.04, 6, '', 'region'),
      ]
      break
    case 'diplomacy':
      proposal.title = `${n.shortName} renews diplomatic correspondence`
      proposal.description = `Officials clarify their intentions through an exchange of letters. The effort improves the institutions supporting future negotiations.`
      proposal.effects = [effect('modifier', 'research', 0.02, 9), effect('change', 'prestige', 1)]
      break
  }
  return proposal
}
