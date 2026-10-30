import { FACILITY_DEFINITIONS, type FacilityKind } from './facility-types'
import { IDENTITY_POLICY_FIELDS, type IdentityPolicyKey } from './identity-policy'
import type { ConfigurationValues } from './configuration-defaults'

/** User-facing meanings live beside the configuration schema. A missing entry
 * fails registration instead of silently exposing another unexplained control. */
const GROUP_HELP: Partial<Record<keyof ConfigurationValues, Readonly<Record<string, string>>>> = {
  starting: {
    treasury:
      'Opening cash given to every state in Frontier settlements mode, in thousands of crowns. 500 means 500,000 crowns. Later spending can reduce it.',
    settledTreasury:
      'Opening cash given to every state in Established states mode, in thousands of crowns. Frontier worlds use the separate frontier treasury value.',
    debt: 'Opening government debt per state, in thousands of crowns. It creates an existing loan obligation, not additional treasury cash.',
    year: 'Calendar year shown at the beginning of the simulation. New worlds begin in January.',
    capitalPopulation:
      'Residents in each frontier state’s initial settlement, before the population multiplier. Established states use generated populations.',
    populationScale:
      'Multiplier for opening civilian populations before recruitment. It retains the generated differences between settlements.',
    ai: 'Lets each starting state make autonomous government decisions. Disable it to begin with manually controlled governments.',
    policyFromLeaders:
      'Uses each generated leader’s preferences for opening policies. Disable it to use the explicit starting policy values below.',
    researchFromLeaders:
      'Uses each generated leader’s preferred opening research field. Disable it to use the chosen research focus below.',
    researchFocus:
      'Initial research field when Research from leaders is disabled. Autonomous governments may change it during play.',
    'policies.tax':
      'Opening tax percentage. Used when Policy from leaders is disabled; future government decisions can change it.',
    'policies.welfare':
      'Relative opening budget weight for welfare, not a percentage of the treasury. Used when Policy from leaders is disabled.',
    'policies.education':
      'Relative opening budget weight for education, not a percentage of the treasury. Used when Policy from leaders is disabled.',
    'policies.military':
      'Relative opening budget weight for military spending. Used when Policy from leaders is disabled.',
    'policies.research':
      'Relative opening budget weight for research. Used when Policy from leaders is disabled.',
    'policies.tariff': 'Opening import-tariff percentage. Used when Policy from leaders is disabled.',
    'policies.conscription':
      'Opening conscription policy, expressed as a percentage. Used when Policy from leaders is disabled.',
    'policies.migration':
      'Opening policy on migration across the state’s borders. Used when Policy from leaders is disabled.',
    'policies.priority': 'Opening economic production priority. Used when Policy from leaders is disabled.',
    marketPopulation:
      'Base residents in independent market settlements in frontier worlds, before variation and the population multiplier.',
    marketVariation:
      'Maximum extra residents added to a frontier market settlement by the seed, before the population multiplier.',
    hamletPopulation:
      'Base residents in inhabited independent hamlets in frontier worlds, before variation and the population multiplier.',
    hamletVariation:
      'Maximum extra residents added to a frontier hamlet by the seed, before the population multiplier.',
    hamletOneIn:
      'Approximately one in this many eligible frontier provinces gets an independent hamlet. Larger values make hamlets rarer.',
    marketOneIn:
      'Sets frontier market frequency relative to province count. Larger values produce fewer independent markets.',
    childrenShare:
      'Fraction of starting civilians assigned to children. Children and adults together must not exceed 1; the remainder are elders.',
    adultShare:
      'Fraction of starting civilians assigned to adults. Children and adults together must not exceed 1; the remainder are elders.',
    stability: 'Opening domestic stability for every state, on a 0–100 scale.',
    legitimacy: 'Opening acceptance of every state’s authority, on a 0–100 scale.',
    urbanScale:
      'Multiplier for each region’s opening urban share. Values are limited to the supported 0–1 range after scaling.',
    literacyScale: 'Multiplier for opening literacy in each region, limited to 0–1 after scaling.',
    healthScale: 'Multiplier for opening health in each region, limited to 0–1 after scaling.',
    happinessScale: 'Multiplier for opening happiness in each region, limited to 0–1 after scaling.',
    infrastructureScale:
      'Multiplier for each region’s opening infrastructure level, limited to the model’s supported range.',
    industryScale:
      'Multiplier for opening productive capital in each region. It changes initial capacity, not treasury cash.',
    stockpileScale:
      'Multiplier for all opening physical goods, including the capital stock amounts below. It does not add money.',
    armyScale:
      'Multiplier for initial land forces in Established states mode. Zero starts without them; frontier worlds already start without armies.',
    fleets: 'Allows the generator to create opening fleets where the starting scenario supports them.',
  },
  geography: {
    seaLevelOffset:
      'Raises or lowers generated sea level relative to the land. Positive values leave less dry land; existing worlds are unaffected.',
    relief:
      'Multiplier for generated elevation differences. Larger values produce stronger relief; 1 preserves the default landscape.',
    moistureOffset:
      'Offset to generated moisture on its normalized 0–1 scale. Positive values make the landscape wetter.',
    temperatureOffset:
      'Offset to the normalized temperature index used to generate terrain. This is not degrees Celsius or the live climate temperature.',
    provinceCount:
      'Target number of generated provinces. Zero uses the world-size default; disconnected islands can add provinces.',
    erosionPasses:
      'Number of erosion iterations during generation. More iterations reshape drainage valleys and increase generation work.',
    channelRunoff:
      'Accumulated modeled runoff needed for a drainage channel to be marked as a river. Higher values produce fewer rivers.',
  },
  founding: {
    people: 'Residents transferred from the home settlement on a manual founding expedition.',
    reserve: 'Minimum residents that must remain at home after a manual founding expedition.',
    cash: 'Funding required for a manual settlement expedition, paid from the existing treasury. This is a cost, not the cash each state starts with.',
    food: 'Tonnes of food the home settlement supplies to a manual expedition.',
    timber: 'Tonnes of timber required to construct a manually founded settlement.',
    stone: 'Tonnes of stone required to construct a manually founded settlement.',
    tools: 'Tonnes of tools required to construct a manually founded settlement.',
    range: 'Maximum overland distance for manual expeditions, counted in terrain-cell steps.',
    reserveMonths: 'Months of food the home settlement must retain after supplying a manual expedition.',
  },
  frontierPolitics: {
    influence:
      'Minimum neighboring-state influence needed before an independent community can move toward accession.',
    cityPopulation: 'Minimum settlement population considered for an independent city charter.',
    contribution:
      'Share of household cash contributed to the new treasury when an independent city becomes a state.',
    solventStability:
      'Minimum stability a neighboring state needs to qualify as a viable accession partner, on a 0–100 scale.',
    solventLegitimacy:
      'Minimum legitimacy a neighboring state needs to qualify as a viable accession partner, on a 0–100 scale.',
    solventFood:
      'Minimum food coverage for a viable accession partner; 1 means all modeled food needs are met.',
    enclaveAreaKm2:
      'Unclaimed pockets smaller than this area may join the single state surrounding them. Zero disables this absorption.',
  },
  conditions: {
    instability:
      'Strength and frequency of endogenous disturbances. Zero removes these disturbances; ordinary economic and political dynamics continue.',
    abundance:
      'Multiplier for harvests and raw-material extraction. Existing stockpiles remain unchanged; capacity, needs and transport still constrain supply.',
    extremity:
      'Amplifies political convictions and shapes future leaders. Existing ambitions and material constraints still apply.',
  },
  climate: {
    equatorTemperature: 'Mean temperature at the equator in degrees Celsius, before elevation cooling.',
    latitudeTemperatureDrop:
      'Temperature decrease in degrees Celsius from the equator to either pole, before elevation cooling.',
    elevationThreshold:
      'Normalized elevation above which the climate model begins applying altitude cooling.',
    elevationLapseRate:
      'Degrees Celsius of cooling per unit of normalized elevation above the elevation threshold.',
    seasonPhaseMonth:
      'Seasonal phase offset, numbered 0 for January through 11 for December. The southern hemisphere remains half a year out of phase.',
    growthMinimum:
      'Seasonal-output baseline mapped to zero in the growth index. Growth is clipped to 0–1 after normalization.',
    growthRange:
      'Seasonal-output span mapped to the full growth index. A smaller span makes growth reach its 0 and 1 limits sooner.',
    'temperatureThresholds.freezing':
      'Temperatures below this Celsius value enter the freezing row; exactly this value enters the cold row.',
    'temperatureThresholds.cold':
      'Temperatures below this Celsius value remain cold; exactly this value enters the mild row.',
    'temperatureThresholds.mild':
      'Upper Celsius limit of the mild row, including this exact value. Higher temperatures enter the warm row.',
    'temperatureThresholds.warm':
      'Upper Celsius limit of the warm row, including this exact value. Higher temperatures enter the hot row.',
    'moistureThresholds.dry':
      'Moisture below this normalized value enters the dry column; exactly this value enters the seasonal column.',
    'moistureThresholds.seasonal':
      'Moisture below this normalized value remains seasonal; exactly this value enters the moderate column.',
    'moistureThresholds.moderate':
      'Upper normalized moisture limit of the moderate column, including this exact value. Higher values enter the wet column.',
  },
  model: {
    bankCount:
      'Number of banks created with a new world. Existing account assignments prevent changing this during play.',
    bankCapitalRatio:
      'Bank equity required relative to outstanding loans. A higher ratio reduces lending capacity for a given amount of bank capital.',
    policyRateMonthly:
      'Monthly central-bank interest rate as a fraction: 0.0015 means 0.15% per month. Editing it sets the current rate; monetary policy may later adjust it.',
    bankLoanSpread:
      'Monthly interest margin added to the policy rate for new loans. Existing loan spreads remain contractual.',
    adultAgeMonths: 'Age at which people enter the adult population class, measured in months from birth.',
    retirementAgeMonths:
      'Age at which people enter the elder population class, measured in months from birth.',
    maximumAgeMonths:
      'Maximum supported lifespan in months. Cohorts reaching this age are removed by mortality in subsequent simulation steps.',
    openingMaximumAgeMonths:
      'Oldest age generated in a new world. It must exceed retirement age and remain within the maximum lifespan.',
    elderOpeningDecayYears:
      'Controls how quickly the opening elder population thins at older ages. Larger values give more weight to very old cohorts.',
    femaleBirthShare: 'Fraction of births assigned female; the remaining fraction is assigned male.',
    childFoodEquivalent:
      'Food needs of a child relative to an adult. For example, 0.65 means 65% of adult food needs.',
    elderFoodEquivalent:
      'Food needs of an elder relative to an adult. For example, 0.85 means 85% of adult food needs.',
    desiredChildrenBase:
      'Baseline desired lifetime family size, before rural motives, urban costs and expected child survival.',
    ruralFamilyMotive:
      'Additional family-size motive associated with rural livelihoods and old-age security.',
    urbanFamilyCost:
      'Strength of the urban cost adjustment to desired family size. Higher values discourage larger urban families.',
    jobSeparationMonthly: 'Monthly fraction of employment contracts subject to ordinary job separation.',
    matchingEfficiency:
      'Efficiency with which unemployed workers and open vacancies form new matches. Higher values reduce matching friction.',
    matchingElasticity:
      'Relative influence of job seekers versus vacancies in matching. 0.5 balances the two pools.',
    wageRenegotiationMonthly:
      'Monthly speed of contract wage adjustment toward the current bargaining outcome.',
    workerBargainingPower:
      'Workers’ weight in wage bargaining, from 0 to 1. Higher values shift more of the available surplus toward wages.',
    consumptionRiskAversion:
      'Strength of household consumption-risk aversion in reservation compensation. It affects the wages workers require.',
    loanResetMonths:
      'Interest-rate reset interval for new floating-rate loans. Existing loans keep their own recorded reset terms.',
    referenceUnemployment:
      'Reference unemployment fraction used by the labor model when judging labor-market pressure.',
    infrastructureServiceProductivity:
      'Infrastructure improvement produced by funded infrastructure services. Higher values make paid services more effective.',
    infrastructureWearMonthly:
      'Monthly infrastructure wear before funded maintenance or improvement offsets it.',
    infantHazardAnnual:
      'Baseline annual mortality hazard for infants. This is a hazard rate, adjusted for conditions before calculating deaths.',
    childHazardAnnual:
      'Baseline annual mortality hazard for children beyond infancy, before health and living-condition adjustments.',
    adultHazardAnnual:
      'Baseline annual adult mortality hazard, before age-related and living-condition adjustments.',
    ageingHazardScale: 'Scale of the additional mortality hazard associated with ageing.',
    ageingHazardSlope:
      'Rate at which age-related mortality hazard rises with age. Higher values make old-age mortality increase more steeply.',
    forecastAdjustment:
      'How quickly sales forecasts incorporate new observations. Higher values react faster but retain less history.',
    inventoryMonths:
      'Target stock coverage in months of expected sales. Active strategic-reserve policies can raise some material targets.',
    depreciationMonthly: 'Monthly fraction of productive capital lost to ordinary depreciation.',
    constructionMonths:
      'Completion time for new enterprise capital projects, in months. Already-funded projects retain their remaining schedule.',
    dividendShare:
      'Share of eligible enterprise profits distributed as dividends rather than retained for the business.',
    creditRepaymentMonthly:
      'Monthly share of loan principal scheduled for repayment, subject to available borrower funds.',
    defaultAfterMonths: 'Length of unpaid arrears after which a loan can enter default.',
    defaultRecovery: 'Fraction of a defaulted loan the banking model expects to recover.',
    mobilityMonthly:
      'Baseline monthly population-mobility rate, before local opportunity and constraint adjustments.',
    fullBuiltPopulationPerCell:
      'Population represented by fully built coverage of a terrain cell. Changing this would reinterpret existing settlement geometry.',
  },
  decisions: {
    development:
      'Enables native government development programs, including funded services, research and productive investment.',
    agriculture:
      'Enables autonomous decisions to fund agricultural improvements when resources and labor are available.',
    renewal:
      'Enables enterprise renewal and entry mechanisms. New activity still requires actual finance, workers and goods.',
    realCosts:
      'Prices selected government, military and settlement obligations against domestic wages instead of legacy fixed nominal costs.',
    merchantRelease:
      'Share of merchant cash above its operating reserve paid to owner households as additional dividends.',
    workDisutility:
      'Weight of the burden of working in household reservation compensation. Higher values can raise the wage needed to accept work.',
    investmentShare: 'Share of available enterprise resources considered for productive investment.',
    investmentAdjustment:
      'Speed at which enterprises adjust planned investment toward their desired capital.',
    readiness:
      'Baseline share of the national population used when setting military replacement targets, alongside conscription and military policy.',
    warThreshold:
      'Decision threshold for native governments to consider war. Raising it makes the criterion harder to meet.',
    foodSatiation:
      'Maximum desired food consumption relative to subsistence. Purchasing power beyond this food target shifts toward other goods or savings.',
  },
  expansion: {
    economicWeight: 'Weight of economic opportunity when comparing frontier settlement locations.',
    peerWeight:
      'Strength of competitive pressure from neighboring states in native development and expansion decisions.',
    pioneerPeople:
      'Residents moved by an autonomous pioneer expedition. Manual expeditions use their separate people setting.',
    homeReserve: 'Minimum population an autonomous pioneer expedition must leave at its home settlement.',
    homeFoodMonths: 'Minimum months of food retained at home after an autonomous pioneer expedition.',
    range: 'Maximum overland reach of autonomous pioneer expeditions, in terrain-cell steps.',
    reviewMonths: 'Interval between native expansion reviews, in months.',
    sitesPerProvince:
      'Maximum candidate settlement sites evaluated within a province during an expansion review.',
    minimumFood:
      'Minimum national food coverage for competitive expansion. A value of 1 means all modeled food needs are met.',
    minimumStability: 'Minimum stability for competitive expansion, on a 0–100 scale.',
    savingShare:
      'Strength of the budget reserve retained for frontier opportunities under competitive pressure.',
    developmentShare:
      'Strength of extra education, research and infrastructure priorities under competitive pressure.',
    accessionMonths:
      'Sustained accession progress required before an independent community can join a state, in months.',
    mandateMonths:
      'Time an independent community must sustain civic support before it can receive a state charter.',
    influenceRate:
      'Speed at which neighboring-state influence approaches its current target. Higher values react faster.',
    prosperityMonths: 'Sustained prosperity required before an independent city can receive a state charter.',
    militaryDrive: 'Strength of competitive pressure on military ambitions in native government decisions.',
    enterprisePopulation: 'Population scale used to judge opportunities for new frontier enterprises.',
    enterpriseEquity: 'Opening equity requirement for enterprise entry, in thousands of crowns.',
    charterWealthPerPerson:
      'Household wealth required per resident for an independent city charter, in thousands of crowns.',
    charterCapitalPerPerson: 'Productive capital requirement per resident for an independent city charter.',
    charterMinimumCapital:
      'Minimum total productive capital required for a charter, even in a small independent city.',
    urbanOpportunityPopulation:
      'Settlement population at which urban opportunity costs reach their full weight in family-size decisions. Larger values reduce that pressure in smaller towns.',
  },
  monetary: {
    target: 'Annual inflation target as a fraction. For example, 0.02 means 2% per year.',
    neutralRealRate:
      'Annual real interest-rate anchor used by the monetary policy rule, before inflation and employment adjustments.',
    referenceUnemployment: 'Unemployment fraction treated as the reference level by the central bank.',
    inflationResponse: 'Strength of the policy-rate response to inflation above or below target.',
    unemploymentResponse:
      'Strength of the policy-rate response to unemployment relative to its reference level.',
    inertia: 'Weight retained on the previous policy rate. Higher values make rate changes more gradual.',
    expectationAdjustment: 'Speed at which expected inflation follows new observed inflation.',
  },
  settlements: {
    villagePopulation: 'Minimum population for a settlement to be classified as a village.',
    townPopulation:
      'Minimum population for a settlement to be classified as a town. Must exceed the village threshold.',
    cityPopulation:
      'Minimum population for a settlement to be classified as a city. Must exceed the town threshold.',
    urbanDensity:
      'Developed residents per square kilometre at which residents live half under urban conditions. Urbanity rises smoothly with density on either side.',
    agglomerationWeight:
      'How strongly households prefer homes within reach of large developed centres. Larger values concentrate growth in established towns.',
    agglomerationReach:
      'Developed residents within about two kilometres at which the agglomeration preference has its reference strength. The preference rises logarithmically.',
    openingCoreDensity:
      'Residents per square kilometre at the centre of a generated 10,000-resident settlement. Density falls exponentially from the centre, so lower values spread towns over more land.',
    openingDensityElasticity:
      'How much denser the centres of larger generated settlements are. At zero every settlement has the same core density; higher values make cities more compact relative to towns.',
    entryBuiltCover: 'Built-area fraction needed for a cell to enter the urban footprint.',
    retainedBuiltCover:
      'Built-area fraction needed to keep a cell in an existing urban footprint. It cannot exceed the entry threshold.',
    movingFriction: 'Penalty for moving when comparing housing and work opportunities.',
    annualMovingHazard:
      'Annual rate of household opportunities to reconsider housing, converted to the current simulation interval.',
    accessMinutes: 'Travel-time budget used to evaluate access to work and services, in minutes.',
    searchMeters: 'Radius for discovering housing and employment options, in metres.',
  },
  placeTopology: {
    placeReach:
      'Developed residents within about two kilometres that make land part of a place. Homes beyond the reach of every place are open country.',
    incorporation:
      'Prominence below which an independent centre sharing an urban area becomes a quarter. Prominence is the density drop from a centre to the fabric joining it to a larger one, as a share of its peak.',
    release: 'Prominence at which a quarter becomes an independent place again. Must exceed incorporation.',
    quarterBirth: 'Prominence a new density peak needs before it can be named as a place or quarter.',
    quarterRetirement:
      'Prominence below which an existing quarter loses its own peak and merges into the place it adjoins. Must not exceed quarter birth.',
    transitionMonths:
      'Months an incorporation or release condition must persist before the administrative status changes.',
  },
  facilities: {
    jobsPerTier:
      'Industrial workplaces supplied by each completed workshop tier, shared across active local firms so entry cannot duplicate premises.',
    duration:
      'Months before a fully funded mine, workshop, farm estate or market becomes usable. Existing projects keep their completion date.',
    costGrowth:
      'Extra fraction of first-tier materials and labor required for each completed tier at this facility.',
    productivity:
      'Diminishing output gain for agricultural and extractive facilities: coefficient times log(1 + average installed tiers).',
    equipment:
      'Manufacturing equipment added per average installed tier of the matching workshop type. It does not produce without workers and raw inputs.',
    laborBias:
      'Strength with which installed sector premises influence labor plans before firms adjust for demand and available inputs.',
    marketHandling:
      'Reduction of the basic retail handling margin with installed markets. Inventory financing costs remain payable.',
    marketPreservation:
      'Reduction in physical retail spoilage and storage losses from paid market and warehouse facilities.',
    budgetShare:
      'Share of productive funding remaining after general land works offered to district facilities. Unspent money remains available to enterprise equity.',
    minimumDeposit:
      'Minimum remaining local resource potential needed to construct a matching mine, quarry or timber yard. Construction never creates ore.',
    minimumHabitat: 'Minimum local agricultural suitability for a new agricultural estate.',
    neighborDemand:
      'Share of adjacent domestic market demand considered when estimating potential customers for a specialized district.',
  },
  productiveLand: {
    timber: 'Tonnes of timber for the first complete refinement of one productive terrain tile.',
    stone: 'Tonnes of stone for the first complete refinement of one productive terrain tile.',
    tools: 'Tonnes of tools for the first complete refinement of one productive terrain tile.',
    laborMonths:
      'Worker-months needed for the first complete refinement of one tile. Later levels require more inputs.',
    duration:
      'Months before paid site works begin increasing productive capacity. Existing projects retain their completion dates.',
    productivity:
      'Output gain coefficient: the multiplier is one plus this value times log(1 + completed level). Technology unlocks at most six paid levels.',
    costGrowth:
      'Additional fraction of first-level materials and labor required for each previously completed level.',
    budgetShare:
      'Share of the public productive investment budget offered to site refinements first. Unspent funds remain available for enterprise equipment.',
  },
  farming: {
    timber: 'Tonnes of timber required for an agricultural improvement project.',
    stone: 'Tonnes of stone required for an agricultural improvement project.',
    laborMonths: 'Total worker-months needed to construct an agricultural improvement.',
    fertility: 'Fertility gain supplied by a completed agricultural improvement, subject to local limits.',
    duration: 'Construction duration of new agricultural improvements, in months.',
  },
  tradeMemory: {
    improvement: 'Cost improvement required before replacing an established trading relationship.',
    adjustment:
      'Fraction of remembered shipment volume removed each month without a new shipment on that trading link.',
    idleMonths: 'Months without use before an established trading relationship is forgotten.',
  },
  corridors: {
    gain: 'Rate at which used freight links gain familiarity.',
    evaporation: 'Rate at which unused corridor familiarity fades.',
    discount:
      'Strength of the route-cost benefit from familiarity. It affects route selection, not physical distance.',
    trafficAdjustment: 'Speed at which smoothed corridor traffic follows observed freight.',
    replanMonths: 'Minimum interval between ordinary route replanning opportunities.',
    minimumPathMonths: 'Minimum time an established route is normally retained before replacement.',
    improvement: 'Required cost advantage of a replacement route over an established route.',
  },
  corridorBundling: {
    radius: 'Terrain-cell search radius for opportunities to combine nearby freight paths.',
    minimumSharedEdges: 'Minimum consecutive shared links needed for a common corridor to be useful.',
    travelWeight: 'Weight of physical travel effort when evaluating shared corridors.',
    maximumExtraEffort:
      'Maximum extra physical travel effort accepted for a shared corridor, as a fraction of the original route.',
    maximumExtraCost:
      'Maximum extra route cost accepted for a shared corridor, as a fraction of the original route.',
    passes:
      'Maximum corridor-bundling refinement passes. More passes allow additional shared-route adjustments.',
  },
  roads: {
    maximumDetour:
      'Largest road-network detour accepted relative to a direct route. Higher values allow more indirect connections.',
    infrastructure:
      'Infrastructure level required for an established connection to qualify for the road network.',
    logistics: 'Logistics technology level required for qualifying road-network development.',
    familiarity: 'Trade familiarity required for an established connection to qualify for a road.',
    shortcutRatio: 'Detour ratio above which the road planner considers adding a shortcut.',
  },
  shipping: {
    maximumDetour: 'Largest shipping-network detour accepted relative to a direct sailing route.',
    shortcutRatio: 'Shipping detour ratio above which the planner considers a shortcut.',
  },
  harbors: {
    idleMonths: 'Months without qualifying traffic before a harbor becomes inactive.',
    halfLifeMonths: 'Months over which unused remembered harbor traffic halves.',
    adjustment: 'Speed at which a harbor’s smoothed activity follows observed throughput.',
  },
  riverRoads: {
    buildingSetback: 'Minimum separation of newly placed buildings from the rendered river bank, in metres.',
    setback: 'Minimum separation of ordinary road approaches from river banks, in metres.',
    approach: 'Length reserved for approaching a river crossing, in metres.',
    maxSpan: 'Maximum permitted bridge span for future crossings, in metres.',
    spacing: 'Preferred separation between nearby river crossings, in metres.',
    search: 'Distance searched for a suitable crossing position, in metres.',
  },
}

const TRANSPORT_PROJECT_NAMES: Readonly<Record<string, string>> = {
  'paved-road': 'paved-road',
  railway: 'railway',
  port: 'harbor-dock',
}

/**
 * Parameterized help generators for groups whose fields repeat a uniform domain
 * relationship across goods, strata, age cohorts, or climate bands (such as the
 * 20 `climate.matrix.*` cells, 10 `climate.terrainOverrides.*` cells, and the
 * per-good `consumptionBudget`, `materialCoverage`, `basePrices`, `householdNeeds`,
 * and `recipes` tables). Keeping these templated avoids duplicating ~80 near-identical
 * strings while still giving every cell/good a specific, contextual explanation.
 */
const GROUP_HELP_TEMPLATES: Partial<
  Record<keyof ConfigurationValues, (parts: readonly string[]) => string | undefined>
> = {
  facilityRecipes: ([kind, field]) => {
    const name = FACILITY_DEFINITIONS[kind as FacilityKind]?.name ?? kind
    if (field === 'laborMonths')
      return `Worker-months required to build the first tier of ${name}. Later tiers scale with the configured rising cost.`
    if (field === 'technology')
      return `Minimum relevant research level for ${name}; further research unlocks additional paid tiers.`
    return `Tonnes of ${field} consumed to build the first tier of ${name}, purchased at actual local prices.`
  },
  consumptionBudget: ([good]) =>
    `Relative weight of ${good} in household spending above subsistence. Weights are normalized together; increasing one redirects spending toward that good.`,
  materialCoverage: ([good]) =>
    `Relative contribution of ${good} to the material-needs coverage score. Weights are normalized together; this changes the measure, not stocks or cash.`,
  basePrices: ([good]) =>
    `Opening price of ${good}, in crowns per tonne. Later market prices respond to the simulation.`,
  householdNeeds: ([good]) =>
    `Baseline tonnes of ${good} needed per person per month, before living-standard and age adjustments.`,
  wageSkills: ([stratum]) =>
    `Relative wage multiplier for the ${stratum} stratum. A value of 1 uses the reference wage.`,
  recipes: ([output, input]) =>
    `Tonnes of ${input} required to produce one tonne of ${output}. More input per unit makes production more resource-intensive.`,
  starting: ([section, item]) => {
    if (section === 'policies' && Object.hasOwn(IDENTITY_POLICY_FIELDS, item))
      return (
        IDENTITY_POLICY_FIELDS[item as IdentityPolicyKey][1] +
        ' Opening intensity from 0 to 1, used when policy is not derived from leaders.'
      )
    if (section === 'capitalStocks')
      return `Tonnes of ${item} placed in each frontier capital at creation, before the stockpile multiplier. Established states use generated stockpiles.`
    if (section === 'technology')
      return `Opening ${item} technology level for every state. Later research can raise it.`
    return undefined
  },
  model: ([section, index]) =>
    section === 'fertilityAnnual'
      ? `Annual fertility-pattern weight for women aged ${15 + Number(index) * 5}–${19 + Number(index) * 5}. The pattern is normalized to desired lifetime family size; this is not a direct birth count.`
      : undefined,
  climate: ([section, item, band]) => {
    if (section === 'amplitudes')
      return `Seasonal output variation in the ${item} biome around a mean multiplier of 1. Zero removes seasonal variation; 0.23 gives a range of 0.77–1.23.`
    if (section === 'crops')
      return `Crop associated with the ${item} biome in the agricultural landscape and activity display.`
    if (section === 'matrix')
      return `Biome assigned to the ${item} temperature band and ${band} moisture band. Band thresholds define the ranges; desert and tundra use their explicit terrain overrides.`
    if (section === 'terrainOverrides')
      return `Biome assigned to ${item} terrain in the ${band} temperature band, regardless of moisture. This overrides the general biome matrix.`
    return undefined
  },
  transportProjects: ([key, item]) => {
    const project = TRANSPORT_PROJECT_NAMES[key]
    if (item === 'cost')
      return `Funding required for a new ${project} project, in thousands of crowns. The project also requires the listed materials and technology.`
    if (item === 'technology')
      return `Minimum logistics technology level needed to begin a ${project} project.`
    return `Tonnes of ${item} required for a new ${project} project, in addition to its funding and other materials.`
  },
}

export function configurationHelp(path: string): string {
  const [group, ...rest] = path.split('.') as [keyof ConfigurationValues, ...string[]]
  const subpath = rest.join('.')
  const description = GROUP_HELP[group]?.[subpath] ?? GROUP_HELP_TEMPLATES[group]?.(rest)
  if (description) return description
  throw new Error(`Missing parameter explanation: ${path}`)
}
