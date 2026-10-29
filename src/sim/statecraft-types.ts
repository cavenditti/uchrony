import type { Charter, ProvincialDelegation } from './institutions'
import type { HistoricalEffect } from './history-types'
import type { Good, Research } from './types'

export type Visibility = 'public' | 'secret'
export interface DiplomaticClause {
  charter?: Charter
  delegation?: Pick<ProvincialDelegation, 'powers'>
  kind:
    | 'institution'
    | 'devolution'
    | 'payment'
    | 'tribute'
    | 'goods'
    | 'trade'
    | 'alliance'
    | 'peace'
    | 'nonaggression'
    | 'access'
    | 'guarantee'
    | 'cede'
    | 'merge'
    | 'create'
    | 'research'
    | 'custom'
    | 'war'
  from: number
  to: number
  amount: number
  good: '' | Good
  field: '' | Research
  regions: number[]
  duration: number
  text: string
}
export interface DiplomaticOffer {
  notBefore?: number
  id: number
  author: number
  month: number
  title: string
  visibility: Visibility
  parties: number[]
  terms: DiplomaticClause[]
  digest: string
  signatures: { nation: number; digest: string; month: number }[]
  status: 'proposed' | 'ratified' | 'rejected' | 'withdrawn' | 'expired' | 'breached'
  supersedes: number
  expires: number
  activated: number
  ends: number
  ruling: string
  resolved: DiplomaticClause[]
  breaches: number
  delivered: number
  reviewAfter?: number
  nativeReview?: string
}
export interface DiplomaticMessage {
  id: number
  month: number
  from: number
  to: number[]
  visibility: Visibility
  subject: string
  body: string
  offer: number
}
/** One action vocabulary is shared by provider schemas, saved receipts and execution. */
export const DOMESTIC_ORDER_KINDS = [
  'intelligence',
  'policy',
  'identity',
  'research',
  'recruit',
  'move',
  'build',
  'commission',
  'naval',
  'embark',
  'army',
  'annex',
  'found',
  'strategy',
] as const
export interface DomesticOrder {
  kind: (typeof DOMESTIC_ORDER_KINDS)[number]
  target: number
  key: string
  value: number
  text: string
}
export interface AdvisorNote {
  id: number
  month: number
  text: string
  status: 'pending' | 'delivered' | 'answered' | 'withdrawn'
  handledMonth?: number
  response?: string
}
export interface StateAgentPlan {
  adviceResponses?: { advice: number; response: string }[]
  assessment: string
  strategy: string
  memory: string
  goals: string[]
  escalate: boolean
  reason: string
  orders: DomesticOrder[]
  messages: { to: number[]; visibility: Visibility; subject: string; body: string; offer: number }[]
  offers: {
    title: string
    visibility: Visibility
    parties: number[]
    terms: DiplomaticClause[]
    supersedes: number
    duration: number
  }[]
  answers: { offer: number; digest: string; answer: 'accept' | 'reject' | 'withdraw'; reason: string }[]
}
export interface StateAgent {
  orderResults?: { month: number; kind: DomesticOrder['kind']; target: number; result: string }[]
  advisor?: { nextId: number; notes: AdvisorNote[] }
  nation: number
  assessment: string
  strategy: string
  memory: string
  goals: string[]
  nextDecision: number
  nextStrategy: number
  lastDecision: number
  lastStrategy: number
  lastModel: string
  escalation: string
  integrity: number
  seenOffers?: number[]
  lastMessage: number
}
export interface RefereeRuling {
  offer: number
  digest: string
  verdict: 'approve' | 'reject' | 'defer'
  reasoning: string
  resolved: DiplomaticClause[]
  effects: HistoricalEffect[]
  misconduct: { nation: number; reason: string; severity: number }[]
}
export interface RefereeDecision {
  rulings: RefereeRuling[]
}
export interface Statecraft {
  nextId: number
  revision: number
  agents: StateAgent[]
  messages: DiplomaticMessage[]
  offers: DiplomaticOffer[]
  rulings: {
    id: number
    month: number
    offer: number
    visibility: Visibility
    parties: number[]
    verdict: string
    reasoning: string
    model: string
    effects: HistoricalEffect[]
  }[]
  audit: {
    id: number
    month: number
    nation: number
    visibility: Visibility
    message: string
    severity: number
  }[]
}
export interface AgentServiceStatus {
  pending: number
  active: { nation: number; role: 'decision' | 'strategy'; since: number }[]
  decisionModel: string
  strategyModel: string
  error: string
}
