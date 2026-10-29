/** Constitutional records keep identity, membership and obligations independent of signed proposals. */
export const INSTITUTION_POWERS = ['defense', 'trade', 'research', 'taxation', 'foreignPolicy'] as const
export const INSTITUTION_OPERATIONS = [
  'found',
  'join',
  'withdraw',
  'amend',
  'rename',
  'expel',
  'reinstate',
  'dissolve',
] as const
export const PROVINCIAL_POWERS = ['taxation', 'education', 'policing', 'infrastructure'] as const
export interface Charter {
  operation: (typeof INSTITUTION_OPERATIONS)[number]
  id: number
  form: 'defense-league' | 'customs-union' | 'research-community' | 'confederation' | 'federation' | 'bespoke'
  powers: (typeof INSTITUTION_POWERS)[number][]
  rule: 'unanimity' | 'majority' | 'weighted'
  contribution: number
  exit: 'free' | 'notice'
  /** Older charters permit funded aid or deployed forces, with six months to respond. */
  defense?: 'military' | 'aid' | 'either'
  responseMonths?: number
}
export interface InstitutionVersion {
  name: string
  members: number[]
  charter: Charter
  status: 'active' | 'crisis' | 'dissolved'
  suspended: number[]
  withdrawals: { nation: number; due: number }[]
  crisis?: { since: number; due: number; reason: string }
  dissolved?: number
}
export interface DefenseResponse {
  nation: number
  notified: number
  due: number
  requiredAid: number
  aid: number
  status: 'pending' | 'fulfilled' | 'refused' | 'overdue' | 'released'
  updated: number
}
export interface DefenseCall {
  id: string
  victim: number
  aggressor: number
  since: number
  opened: number
  closed?: number
  requirement: 'military' | 'aid' | 'either'
  responses: DefenseResponse[]
}
export interface InstitutionEvent {
  id: number
  month: number
  kind:
    | 'baseline'
    | 'founded'
    | 'joined'
    | 'withdrawal'
    | 'left'
    | 'amended'
    | 'renamed'
    | 'expelled'
    | 'reinstated'
    | 'crisis'
    | 'recovered'
    | 'dissolved'
    | 'succession'
    | 'defense'
  detail: string
  offer?: number
  nations: number[]
  /** An immutable constitutional revision; defense-only updates carry just their call. */
  version?: InstitutionVersion
  call?: DefenseCall
}
export interface Institution {
  id: number
  name: string
  founded: number
  members: number[]
  charter: Charter
  visibility: 'public' | 'secret'
  treasury: number
  income: number
  grants: number
  status: InstitutionVersion['status']
  sourceOffer: number
  suspended?: number[]
  withdrawals?: InstitutionVersion['withdrawals']
  crisis?: InstitutionVersion['crisis']
  dissolved?: number
  events?: InstitutionEvent[]
  calls?: DefenseCall[]
}
export interface InstitutionalState {
  nextId: number
  organizations: Institution[]
}
export interface ProvincialDelegation {
  autonomy: number
  powers: (typeof PROVINCIAL_POWERS)[number][]
  income: number
  budget: number
  treasury: number
  since: number
}
