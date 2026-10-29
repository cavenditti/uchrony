import type { Inventory } from './types'
import type { MonetaryPolicy } from './monetary-policy'
export const STRATA = ['smallholder', 'laborer', 'artisan', 'professional', 'owner'] as const
export type EconomicStratum = (typeof STRATA)[number]
export const STRATUM_LABELS: Record<EconomicStratum, string> = {
  smallholder: 'Smallholders',
  laborer: 'Laborers',
  artisan: 'Artisans',
  professional: 'Professionals',
  owner: 'Owners',
}
export interface HouseholdAccount {
  cash: number
  income: number
  taxes: number
  transfers: number
  expenditure: number
  employed: number
  laborForce: number
  foodCoverage: number
  materialCoverage: number
  consumption: Inventory
}
export interface ProducerAccount {
  previousLabor?: number
  previousJobs?: number
  previousResearchServices?: number
  educationServices?: number
  administrationServices?: number
  infrastructureServices?: number
  researchServices?: number
  militaryServices?: number
  provincialServices?: number
  previousPriceIndex?: number
  cash: number
  wage: number
  payroll: number
  sales: number
  purchases: number
  freight: number
  taxes: number
  interest: number
  profit: number
  capital: number
  investment: number
  projects: { remaining: number; capital: number; cost: number }[]
  forecast: Inventory
  planned: Inventory
  sold: Inventory
  inputTargets: Inventory
  openingStocks: Inventory
  losses: Inventory
  intermediate: Inventory
  grossOutput: number
  valueAdded: number
  realOutput: number
  publicServices: number
  realServices: number
  desiredEmployment: number
}
export interface LedgerEntry {
  from: string
  to: string
  amount: number
  category: string
}
export interface Loan {
  /** Original contract for conservatively divided household/merchant claims. */
  contract?: number
  id: number
  borrower: string
  principal: number
  arrears: number
  originated: number
  bank?: number
  rate?: number
  rateType?: 'fixed' | 'floating'
  spread?: number
  resetMonths?: number
  nextReset?: number
}
export interface Bank {
  id: number
  reserves: number
  deposits: number
  equity: number
  centralBankDebt: number
  income: number
  losses: number
  resolutions: number
  owners: Record<string, number>
}
export interface BankingSystem {
  version: 1
  banks: Bank[]
  accounts: Record<string, number>
  centralBank: { advances: number; reserves: number; equity: number; rate: number }
  lastPriceIndex: number
  policy?: MonetaryPolicy
  created: number
  destroyed: number
  discrepancy: number
}
export interface CompetitiveFirm {
  activity?: 'food' | 'tools' | 'textiles'
  locality?: number
  cell?: number
  owners?: Record<string, number>
  specialization?: 'agricultural' | 'mining' | 'industrial' | 'mixed'
  laborMix?: Inventory
  id: number
  region: number
  generation: number
  active: boolean
  cash: number
  capital: number
  productivity: number
  wage: number
  markup: number
  employment: number
  labor?: {
    opening: number
    retained: number
    hires: number
    separations: number
    vacancies: number
    unfilled: number
  }
  desiredEmployment: number
  payroll: number
  sales: number
  purchases: number
  interest: number
  taxes: number
  profit: number
  distress: number
  stocks: Inventory
  prices: Inventory
  production: Inventory
  planned: Inventory
  forecast: Inventory
  sold: Inventory
  projects: { remaining: number; capital: number; cost: number }[]
}
export interface GDPAccount {
  output: number
  intermediate: number
  wages: number
  mixedIncome: number
  operatingSurplus: number
  productTaxes: number
  consumption: number
  government: number
  fixedInvestment: number
  inventoryChange: number
  exports: number
  imports: number
  holdingGains: number
  otherAssetChanges: number
  productionGDP: number
  expenditureGDP: number
  incomeGDP: number
  discrepancy: number
}
export interface NationalAccounting {
  month: number
  territories: number[]
  nations: Record<number, GDPAccount>
  world: GDPAccount
  regionalValueAdded: Record<number, number>
  complete?: boolean
  businesses: Record<
    string,
    {
      nation: number
      receipts: number
      purchases: number
      wages: number
      ownAccount: number
      inventoryChange: number
    }
  >
  stores: Record<
    string,
    {
      nation: number
      owner: string
      region: number
      government: boolean
      opening: Inventory
      quantity: Inventory
      price: Inventory
      openingValue: number
      flows: number
      other: number
    }
  >
}
export interface EconomicSystem {
  /** Costing adoption is recorded once; legacy quotes are rebased outside GDP.
   * The signed correction is in thousands of crowns, not a cash adjustment. */
  inventoryValuation?: {
    method: 'weighted-average'
    adoptedMonth: number
    legacyAdjustment: number
  }
  /** Duration of the last goods/cash accounting period. Absent in legacy monthly saves. */
  periodMonths?: number
  version: 1
  initialized: number
  households: Record<number, Record<EconomicStratum, HouseholdAccount>>
  producers: Record<number, ProducerAccount>
  credit: { cash: number; loans: Loan[]; nextId: number; losses: number }
  supplierCredit?: Record<number, Record<string, number>>
  banking?: BankingSystem
  firms?: CompetitiveFirm[]
  firmExits?: number
  firmEntries?: number
  accounts?: NationalAccounting
  /** Carrying cost per unit in thousands of crowns; separate from selling quotes. */
  inventoryPrices?: Record<string, Inventory>
  ledger: {
    month: number
    opening: Record<string, number>
    net: Record<string, number>
    entries: LedgerEntry[]
    transactions: number
    volume: number
    discrepancy: number
    created?: number
    destroyed?: number
  }
  national: Record<
    number,
    {
      gdp: number
      realOutput: number
      priceIndex: number
      unemployment: number
      consumption: number
      investment: number
      income: number
      inequality: number
      welfarePerPerson: number
    }
  >
  goods?: { opening: Inventory; injections: Inventory; destruction: Inventory; residual: Inventory }
  totals: {
    gdp: number
    realOutput: number
    consumption: number
    investment: number
    priceIndex: number
    unemployment: number
    money: number
    debt: number
  }
}
