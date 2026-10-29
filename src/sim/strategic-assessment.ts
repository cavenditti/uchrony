import { population, type World } from './types'
import type { DiplomaticOffer } from './statecraft-types'
import { intelligenceService, perceivedPower, knownRelation } from './intelligence'

export function effectiveForce(world: World, nation: number) {
  return world.armies
    .filter((a) => a.nation === nation)
    .reduce(
      (sum, a) => sum + a.soldiers * a.morale * (0.25 + 0.75 * a.supply) * (a.operations?.cohesion ?? 0.7),
      0,
    )
}
export function sovereigntyAssessment(world: World, nation: number, offer: DiplomaticOffer) {
  const n = world.nations[nation],
    own = world.regions.filter((r) => r.nation === nation),
    merges = offer.terms.filter((t) => t.kind === 'merge' && t.from === nation),
    lost = new Set(
      merges.length
        ? own.map((r) => r.id)
        : offer.terms
            .filter((t) => ['cede', 'create'].includes(t.kind) && t.from === nation)
            .flatMap((t) => t.regions),
    ),
    provinces = own.filter((r) => lost.has(r.id)),
    total = own.reduce((s, r) => s + population(r), 0),
    share = provinces.reduce((s, r) => s + population(r), 0) / Math.max(1, total),
    capital = lost.has(n.capital),
    output = provinces.reduce((s, r) => s + Math.max(r.gdp, population(r) / 1000), 0),
    compensation = offer.terms.reduce(
      (s, t) =>
        s +
        (t.to === nation && t.kind === 'payment'
          ? t.amount
          : t.to === nation && t.kind === 'tribute'
            ? t.amount * Math.min(t.duration || 36, 36)
            : 0),
      0,
    ),
    enemies = world.relations
      .filter((r) => r.treaty === 'war' && (r.a === nation || r.b === nation))
      .map((r) => (r.a === nation ? r.b : r.a)),
    force = effectiveForce(world, nation),
    strongest = Math.max(0, ...enemies.map((id) => perceivedPower(world, nation, id))),
    occupied = world.regions.filter((r) => (r.occupation?.former === nation && r.nation !== nation) ||
      (r.nation === nation && r.control && r.control.nation !== nation)).length,
    defeated =
      enemies.length > 0 &&
      (strongest > Math.max(200, force) * 1.8 ||
        occupied >= Math.max(1, own.length * 0.3) ||
        n.stability < 25),
    beneficiary = merges[0]?.to,
    partner = world.nations[beneficiary],
    partnerReport = partner
      ? intelligenceService(world, nation).dossiers.find((d) => d.nation === partner.id)?.politics
      : undefined,
    shared = partnerReport
      ? own
          .flatMap((r) => r.communities ?? [])
          .reduce(
            (s, g) =>
              s +
              (g.culture === partnerReport.culture || g.language === partnerReport.language
                ? g.population.children + g.population.adults + g.population.elders
                : 0),
            0,
          ) / Math.max(1, total)
      : 0,
    commonThreat =
      partner && enemies.some((id) => knownRelation(world, nation, partner.id, id)?.treaty === 'war'),
    union =
      !!partner &&
      shared > 0.65 &&
      n.legitimacy >= 70 &&
      (partnerReport?.values.legitimacy.estimate ?? 0) >= 65 &&
      (commonThreat ||
        (/federation|commonwealth/i.test(n.government) && n.character!.effective.solidarity > 0.7)),
    costly = share >= 0.1 || capital || merges.length > 0,
    fairPrice = compensation >= output * 36,
    separatist =
      provinces.length > 0 && provinces.every((r) => r.unrest > 75) && n.stability < 35 && force < 1000,
    acceptable = !lost.size || defeated || union || (!costly && fairPrice) || (separatist && fairPrice)
  return {
    acceptable,
    populationShare: share,
    capitalAtStake: capital,
    endsSovereignty: merges.length > 0,
    compensation,
    referenceValue: output * 36,
    militaryDefeat: defeated,
    domesticUnionMandate: union,
    reasoning: !lost.size
      ? 'No territorial authority is surrendered.'
      : defeated
        ? 'A credible military defeat can justify painful territorial concessions.'
        : union
          ? 'A shared constituency and institutional mandate can support political union.'
          : acceptable
            ? 'A limited, compensated territorial settlement is within the government’s mandate.'
            : 'The governing coalition and affected constituencies oppose surrendering core territory or independence without a credible defeat, adequate compensation for a limited sale, or a genuine mandate for political union.',
  }
}
