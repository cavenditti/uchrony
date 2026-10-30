import { cloneInstitutions } from './institution-lifecycle'
/** Transactional settlement isolates the fields signed terms can mutate. Ordinary
 * payments copy scalar holders and financial books; territorial terms also isolate
 * cohorts, physical depots and institutions before any clause is applied. */
import { linkDistrictPeople } from './districts'
import { clonePopulationHolders } from './population-clone'
import type { World } from './types'
/** Build a trial without mutating the source, including nonserialized district views. */
export function createSettlementTrialWorld(world: World, territorial: boolean): World {
  const changes = {
    dependencies: territorial ? structuredClone(world.dependencies) : world.dependencies,
    dynasties: territorial ? structuredClone(world.dynasties) : world.dynasties,
    intelligence: territorial ? structuredClone(world.intelligence) : world.intelligence,
    institutions: territorial ? cloneInstitutions(world.institutions) : world.institutions,
    // Ordinary terms only change treasury scalars, relation scalars and army targets.
    // Territorial terms still need isolated nested records for normalization.
    nations: territorial ? structuredClone(world.nations) : world.nations.map((n) => ({ ...n })),
    regions: territorial ? clonePopulationHolders(world.regions) : world.regions,
    relations: territorial ? structuredClone(world.relations) : world.relations.map((r) => ({ ...r })),
    armies: territorial ? clonePopulationHolders(world.armies) : world.armies.map((army) => ({ ...army })),
    warfare: territorial ? structuredClone(world.warfare) : world.warfare,
    historical: territorial ? structuredClone(world.historical) : world.historical,
    // Settlement can transfer deposits/debts and return military inventories.
    // Isolate every affected ledger so a later rejected clause cannot leak writes.
    economy: world.economy
      ? {
          ...world.economy,
          ...(world.economy.firms && territorial
            ? {
                firms: world.economy.firms.map((f) => ({
                  ...f,
                  ...(f.owners ? { owners: { ...f.owners } } : {}),
                })),
              }
            : {}),
          credit: structuredClone(world.economy.credit),
          ...(world.economy.supplierCredit
            ? { supplierCredit: structuredClone(world.economy.supplierCredit) }
            : {}),
          ledger: structuredClone(world.economy.ledger),
          banking: structuredClone(world.economy.banking),
          ...(world.economy.accounts
            ? {
                accounts: territorial ? structuredClone(world.economy.accounts) : world.economy.accounts,
              }
            : {}),
        }
      : undefined,
    localEconomy:
      territorial && world.localEconomy
        ? {
            ...world.localEconomy,
            provinceSignals: structuredClone(world.localEconomy.provinceSignals),
            units: Object.fromEntries(
              Object.entries(world.localEconomy.units).map(([id, unit]) => [
                id,
                {
                  ...unit,
                  stocks: { ...unit.stocks },
                  consumption: { ...unit.consumption },
                  population: { ...unit.population },
                  residents: { ...unit.residents },
                },
              ]),
            ),
          }
        : world.localEconomy,
  } satisfies { [K in (typeof SETTLEMENT_ROOTS)[number]]-?: World[K] }
  const trial: World = { ...world, ...changes, events: [...world.events] }
  if (territorial && trial.localEconomy) {
    linkDistrictPeople(trial)
    // A province's depot is the principal market, including inside the trial.
    // Independent province copies would lose subsequent withdrawals at rollup.
    for (const region of trial.regions) {
      const depot = trial.localEconomy.units[region.id]
      region.stocks = depot.stocks
      region.consumption = depot.consumption
    }
  }
  return trial
}
/** Commit precisely the mutable settlement roots; events are published by the referee. */
export function commitSettlementTrialWorld(world: World, trial: World) {
  for (const key of SETTLEMENT_ROOTS) {
    if ((key === 'economy' || key === 'localEconomy') && !trial[key]) continue
    // The isolated trial declares all roots, including absent optional systems.
    // Do not materialize those as undefined: JSON drops them on save, making an
    // otherwise identical restored continuation differ from the live world.
    if (trial[key] === undefined && !Object.hasOwn(world, key)) continue
    Object.assign(world, { [key]: trial[key] })
  }
}
const SETTLEMENT_ROOTS = [
  'dependencies',
  'dynasties',
  'economy',
  'localEconomy',
  'institutions',
  'intelligence',
  'nations',
  'regions',
  'relations',
  'armies',
  'warfare',
  'historical',
] as const satisfies readonly (keyof World)[]
