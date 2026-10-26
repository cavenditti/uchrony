# Mathematical model

## Population and age cohorts

The census tracks sex and absolute birth month. For each resident group:

$$
N_{t+1}=N_t+B_t-D_t+M_t
$$

Here $M$ is net migration; transfers between civilians and armies preserve the world total. Births use women in each five-year fertility band, $F_a$, and annual rates $f_a$:

$$
\mathbb E[B_t]=\frac{T}{2.505}\,(1-0.8s)\,\xi_B\sum_a\frac{F_a f_a}{12}
$$

Planned lifetime fertility $T$ is desired surviving children divided by expected childhood survival. Desired children are $2.3+1.2(1-\ell)(1-v)-0.6v\ell$, with literacy $\ell$ and urbanization $v$. Food shortage is $s$; $\xi_B$ is the active fertility-effect multiplier.

$$
\Pr(\text{death in month})=1-e^{-\widetilde h/12}
$$

Annual hazard $\widetilde h$ combines age, health, squared food shortage and historical effects. Counts use seeded stochastic rounding; age 110 is terminal. These schedules are synthetic, not fitted population forecasts. [UN cohort-component methodology](https://population.un.org/wpp/assets/Files/WPP2024_Methodology-Report_Final.pdf).

## Household budgets and consumption

District households pool accounts within five economic strata. With subsistence quantities $\gamma_g$, prices $p_g$, deposits $D$ and disposable income $Y$:

$$
\begin{aligned}
S&=\sum_g p_g\gamma_g\\
B&=\min\!\left(D,\max\!\left(S,\,0.85Y^++0.05(D-3S)^+\right)\right)\\
q_g^*&=\gamma_g+\frac{\beta_g(B-S)}{p_g},\qquad B\ge S
\end{aligned}
$$

Here $z^+=\max(0,z)$ and discretionary shares satisfy $\sum_g\beta_g=1$. This is a Stone–Geary linear expenditure system above subsistence. Below it, purchases are rationed food first. Strata submit affordable orders together; scarce lots are allocated proportionally at each seller's quote. Spending cannot exceed deposits or available goods. [IMF: linear expenditure systems](https://www.imf.org/external/pubs/ft/wp/2003/wp03204.pdf).

## Labor participation and matching

Participating labor is $L=\sum_a N_a\,\rho_a(0.6+0.4h)$, with health $h$ and age-specific participation $\rho_a$. Participation is zero below 18 and from 70; between those ages it ranges from 15% to 78%.

$$
\begin{aligned}
R_f&=\min\!\left(J_f^{\mathrm{funded}},\,0.985E_{f,t-1}\right)\\
V_f&=(J_f^{\mathrm{funded}}-R_f)^+\\
M&=\min\!\left(U,V,\,0.65\sqrt{UV}\right),\quad V=\sum_f V_f\\
E_f&=R_f+M\frac{V_f}{V},\qquad u=1-\frac{E}{L}
\end{aligned}
$$

Retained jobs $R$ are scaled down if the local workforce shrinks. $U$ is remaining available labor after retention and public hiring reservations. Zero vacancies imply zero hires. Only funded, paid jobs enter employment; public and construction work share the same labor ceiling. This is aggregate search and matching, without individual employment histories or a solved free-entry condition. [Diamond–Mortensen–Pissarides framework](https://www.nobelprize.org/prizes/economic-sciences/2010/advanced-information/).

## Wage bargaining

Reservation compensation $b$ uses the consumption–leisure marginal rate of substitution with CRRA curvature 2. Let $k$ be subsistence-basket cost per skill-adjusted worker and $c$ the previous consumption-coverage proxy:

$$
\begin{aligned}
c&=0.7c_{\mathrm{food}}+0.3c_{\mathrm{materials}}\\
b&=0.65kc^2,\qquad \beta=0.5(1-u_{t-1})\\
w^*&=b+\beta(y-b)^+\\
w_t&=\frac{11}{12}w_{t-1}e^{\pi^e/12}+\frac{1}{12}w^*
\end{aligned}
$$

$y$ is benchmark value added per skill-adjusted worker, an average-product proxy. Firms open no jobs when $y<b$; new hires require an offer at least $b$. Stratum wage multipliers range from 0.8 to 1.7. Reservation compensation is not guaranteed outside income. Wages adjust gradually, without a fixed nominal floor.

## Firm demand, production and prices

Competing firms keep separate cash, workers, debt, capital and inventories. Forecast sales $\widehat d$, observed sales $d$ and own inventory $S$ determine planned output:

$$
\begin{aligned}
\widehat d_t&=0.82\widehat d_{t-1}+0.18d_{t-1}\\
q^{\mathrm{plan}}&=\left[d^*+0.25(2d^*-S)\right]^+
\end{aligned}
$$

$d^*$ is the largest of the firm's forecast and its share of wholesaler demand or local subsistence/input orders. Manufacturing has fixed input coefficients $a_{ig}$: output cannot exceed labor/capital capacity, available inputs divided by $a_{ig}$, or input-purchase funding. Farm labor has diminishing returns through $A(1-e^{-L_f/A})$, with effective land $A$; technology and local conditions scale output. Extraction also requires remaining natural reserves.

$$
\begin{aligned}
p^*&=\max\!\left(0.01,c_{\mathrm{replacement}}(1+\mu)\right)\\
\Delta\log p&=\operatorname{clip}\!\left(\log(p^*/p),-0.06,0.06\right)
\end{aligned}
$$

Quotes here are crowns per tonne. Markups $\mu$ respond to inventory pressure within 4–30%. These are posted-price adjustment rules; markets need not clear. The price floor and adjustment bounds are explicit modeling assumptions. [Agent-based stock-flow-consistent macroeconomics](https://business.columbia.edu/sites/default/files-efs/imce-uploads/Joseph_Stiglitz/Agent%20based-stock%20flow.pdf).

## Deposits, banks and credit

Every payment has a payer and a recipient. New lending creates a borrower deposit and a bank loan asset; principal repayment extinguishes both. For each bank:

$$
\begin{aligned}
R+L&=D+A+E\\
\Delta D_{\mathrm{origination}}&=\Delta L_{\mathrm{origination}}\\
\Delta D_{\mathrm{repayment}}&=\Delta L_{\mathrm{repayment}}<0
\end{aligned}
$$

$R$ denotes reserves, $L$ loans, $D$ customer deposits, $A$ central-bank advances and $E$ equity. Interest transfers deposits into bank equity; distributions reverse that transfer. Write-offs reduce loan assets and equity. Settlement moves reserves; collateralized central-bank advances provide liquidity. Lending also faces borrower debt-service limits and a 10% equity-to-loan requirement. Deposit insurance, deposit interest and bond markets are absent. [Bank of England: money creation](https://www.bankofengland.co.uk/quarterly-bulletin/2014/q1/money-creation-in-the-modern-economy).

## Monetary policy and expectations

The price signal is annual log change in the subsistence basket index $P$. Completed monthly observations set the next policy rate:

$$
\begin{aligned}
\pi_t&=\sum_{j=0}^{11}\Delta\log P_{t-j}\\
\pi^e_{t+1}&=\pi^e_t+\frac{\pi_t-\pi^e_t}{24}\\
i_t^*&=0.02+\pi_t+0.5(\pi_t-0.02)+(0.04-u_t)\\
i_{t+1}&=\max\!\left(0,0.85i_t+0.15i_t^*\right)
\end{aligned}
$$

$i$ is an annualized nominal rate, quoted as twelve times the monthly charge. New monthly loan rates are $i/12+0.0015$; floating loans reset every three months. Initial expected inflation is 2%; missing initial inflation months use prior expectations. The zero lower bound and coefficients define a synthetic inflation-targeting regime, not historical Federal Reserve behavior. [Federal Reserve: policy-rule examples](https://www.federalreserve.gov/monetarypolicy/2026-07-mpr-part2.htm).

## Capital and investment

Capital depreciates at $\delta=0.0015$ per month. Firms compare operating yield with expected real financing cost plus depreciation:

$$
\begin{aligned}
r^{\mathrm{real}}&=(1+r^{\mathrm{loan}})e^{-\pi^e/12}-1\\
\text{invest only if}\quad
\frac{\text{sales}-\text{payroll}-\text{inputs}}{\max(c_K,Kc_K)}&>r^{\mathrm{real}}+\delta
\end{aligned}
$$

$c_K$ is unit construction cost. Desired additions replace depreciation and respond to utilization; actual construction requires materials, unused artisan labor and at most 25% of firm deposits. Projects take six months. Materials and labor are paid, capitalized and counted once in GDP. Persistent financial distress can liquidate a firm; new entry transfers existing owner funds.

## Government, welfare and research

Taxes transfer income to the treasury. With monthly tax receipts $T$, treasury deposits $D_G$ and civilian population $N$, the desired spending envelope is:

$$
G^*=\max(0.95T,\,0.00002N)+0.02(D_G-12T)^+
$$

Actual spending is limited by treasury deposits and approved credit. Budget shares buy available workers or make funded transfers. Welfare creates household income only when paid and contributes no GDP by itself. Nonmarket services are valued at paid cost; their real output uses reference wages.

$$
\Delta H=\frac{Q_R^0}{7}(0.35+\ell)(1+0.07g)\xi_R
$$

Research knowledge $H$ depends on delivered research labor at reference wages $Q_R^0$, literacy $\ell$, governance level $g$ and research effects $\xi_R$. The next level requires $140(n+1)^{1.45}$ knowledge. Nominal wage inflation alone creates no knowledge.

## GDP and inventory reconciliation

Three independently accumulated accounts must agree:

$$
\begin{aligned}
Y_P&=\sum_f(\mathrm{output}_f-\mathrm{inputs}_f)+T_p\\
Y_E&=C+G+I_K+\Delta I_S+X-M\\
Y_I&=W+\Pi_{\mathrm{gross}}+Y_{\mathrm{mixed}}+T_p
\end{aligned}
$$

$T_p$ is product tax, $I_K$ fixed investment and $\Delta I_S$ inventory transaction changes. Gross operating surplus, mixed income and wages are accrued from business records. No balancing plug is added.

$$
\text{holding gain}=V_{\mathrm{close}}-V_{\mathrm{open}}-\Delta V_{\mathrm{transactions}}-\Delta V_{\mathrm{other}}
$$

Holding gains, asset destruction, transfers, loan flows and property income are excluded from GDP. Domestic trade cancels on consolidation; world exports equal world imports. Coverage is limited to represented sectors. [BEA national accounts handbook](https://www.bea.gov/resources/methodologies/nipa-handbook) · [Eurostat–OECD inventories guide](https://unstats.un.org/Unsd/nationalaccount/docs/3017071e.pdf).

## Prices, real output and inequality

The basket index uses current subsistence needs; the real-output indicator values net physical production at opening prices:

$$
\begin{aligned}
P_t&=\frac{\sum_g p_{g,t}\gamma_{g,t}}{\sum_g p_{g,0}\gamma_{g,t}}\\
Q_t^0&=\sum_g p_{g,0}(q_{g,t}-z_{g,t})+\text{public labor at reference wages}
\end{aligned}
$$

$z$ denotes industrial inputs. $Q^0$ omits some services and margins; it is not chain-linked real GDP. For district-stratum groups sorted by per-person disposable income:

$$
\mathrm{Gini}=1-\frac{\sum_j n_j(C_{j-1}+C_j)}{NY}
$$

$n_j$ is group population, $C_j$ cumulative income, $N$ total people and $Y$ total income. Zero aggregate income displays zero. Inequality within pooled strata is unobserved.

## Local markets, transport and resources

Households buy locally; firms retain local jobs and can recruit accessible commuters. Cross-market purchases require paid transport. A shipment's landed unit cost is:

$$
p_{\mathrm{landed}}=p_{\mathrm{seller}}+\text{tariff}+0.002\,p_{\mathrm{seller}}\,\text{route effort}
$$

Delivered quantity is bounded by seller stock, buyer cash and the remaining capacity of every corridor used. Freight receipts become carrier mixed income. Supplier selection considers price, effort, domestic preference and existing relationships; it is not a global cost-minimizing equilibrium.

Mineral extraction depletes cell-level reserves. Timber regrows by 0.2% of the gap to its land-use-adjusted capacity each month. Resource abundance, geography and transport costs therefore shape specialization rather than granting every district identical opportunities.

## Local markets and concentration

Persistent household pools and firms retain their own prices, inventories and contracts when the spatial tree or administrative borders change. Manufacturing's external-economy multiplier is $\min(1.4,1+0.04\log(1+N/(1000A)))$, with $A$ terrain cells. This bounded productivity assumption is distinct from the geometry of a municipality. Residential and productive capacity determine built activity; housing construction and commuting are described below. Land rents and mortgage markets remain unmodeled. [Krugman: increasing returns and economic geography](https://www.nber.org/papers/w3275).

## Historical benchmark and limits

The US 1960–1985 experiment is a separate quarterly aggregate model. Its backward-looking demand equation is:

$$
x_t=\rho x_{t-1}-\frac{\sigma}{4}(i_{t-1}-\pi^e_{t-1}-r^*)-\chi\Delta\log p_t^{\mathrm{oil}}
$$

$x$ is the output gap; $r^*$ the neutral real rate. A price equation links expected inflation, unemployment and oil costs. Parameters fit 1960–1969; 1970–1985 is a holdout, starting once from observed 1969Q4. Recorded policy rates and oil prices are conditional paths, not identified causal shocks. Other future outcomes are used only for scoring.

**The first holdout fails historical qualification:** recorded-policy/energy replay has RMSE of 9.26 pp for growth, 24.31 pp for inflation and 10.85 pp for unemployment. It fails to beat the persistence/drift baseline. The spatial version-5 qualification now includes three 200-year accounting runs, with final-source save/continuation checks. Populations fell 92–95%; food access and unemployment remain poor. These runs establish accounting consistency, not behavioral stability or historical accuracy. Full source boundaries and results are in the validation record. [FRED source data](https://fred.stlouisfed.org/) · [Federal Reserve history: the 1973–74 oil shock](https://www.federalreservehistory.org/essays/oil-shock-of-1973-74).

## Adaptive space and administration

The physical quadtree and legal jurisdictions are separate. Original land and water polygons are clipped into square leaves; neighboring leaf widths differ by at most 2:1. Legacy centers are explicitly assigned 1 km spacing. This synthetic scale is not a historical calibration.

For additive stocks, restriction is $X_p=\sum_cX_c$. Accounts, contracts, firm identities and census cohorts remain in persistent closure records; refinement changes their spatial grouping, never their owners or balances. Because $f(\sum_iX_i)\ne\sum_i f(X_i)$ in general, heterogeneous household and firm records are retained rather than replaced with a mean agent.

The refinement indicator is:

$$
\eta_n=\left(\frac{N_n}{12000}+\frac{J_n}{2500}+M_n\right)
\min\left(1,\frac{s_n^2}{1000^2}\right)
+2\frac{\sigma(p)}{\bar p}+R_n+T_n.
$$

$N_n$ and $J_n$ are residents and paid jobs, $s_n$ is width in meters, and $R_n=1$ when a node wider than 4 km contains a river (zero otherwise). Refinement is reviewed every six months with 1/0.55 entry/exit thresholds and a twelve-month dwell period. The minimum-width setting is 125 m (128 m on the current power-of-two tree). The moving-activity signal $M_n$ adds corridor traffic / 20,000 at endpoints and fleet crew / 300 plus hull count / 8 at their recorded location; this is not additional population. $T_n$ is the larger of area-weighted elevation SD / 0.12, moisture SD / 0.18, or 1.1 for a mixed land/water node, multiplied by $\min(1,(s_n/2000)^2)$. Only existing geographic data contribute. These are declared numerical choices; camera position is absent. [AMReX conservation and coarse–fine interfaces](https://amrex-codes.github.io/amrex/docs_html/AmrCore.html#using-fluxregisters).

Municipalities and provinces annually compare local mergers, splits and boundary transfers. For population $N$, $o$ local service offices and monthly wage $w$, office workload costs $w[b+(o-1)+N/10^4+(N/80000)^{1.3}]$, with $b=4$ for municipalities and $20$ for provinces. Travel adds four annual return visits to the nearest retained office, valued at a quarter of the hourly wage. Mergers retain offices; independent profitable reforms can proceed together, each rechecking available workers and funds. A reform requires 36 months of expected savings to exceed its paid reorganization labor. Geometry must remain complete, connected and within one sovereign state. Permanent legal references and past national accounts survive the change. Initial boundary proposals use legacy terrain polygons; computational leaves can be much smaller.

## Settlement formation and residential choice

Town scenery requires occupied, connected development: village $N\ge500$, town $N\ge5000$, city $N\ge50000$. Developed parcels need density at least 300/km²; gaps up to 150 m connect only with a journey of at most 20 minutes. Empty plots cannot join settlements. These are classification conventions, not growth targets or a fitted definition of cities. [Degree of Urbanisation](https://human-settlement.emergency.copernicus.eu/degurbaDefinitions.php).

For home $i$, accessible nonfarm work and locational utility are

$$
A_i=\sum_{j:\tau_{ji}\le60}(E_j+V_j)(1-f_j)e^{-\tau_{ji}/30},\qquad
u_i=0.18\log(1+A_i/100)+0.12h_i-\frac{s_i}{600}-0.25(N_i/H_i)^2.
$$

$E,V$ are filled and unfilled jobs; $f$ is the food-employment share, $h$ habitat quality, $s$ walking minutes to the local market, $H$ housing capacity and $N$ occupants. Recursive tree queries screen sites within 6 km; actual workplace journeys use the transport network. The return journey is used for access; local retained contracts still use the aggregate commuting approximation below.

Each month at most $\lfloor N(1-e^{-0.08/12})\rfloor$ residents per household pool consider relocation. Integer apportionment distributes this budget across homes. A move requires funded vacancy and $\Delta u>0.08+\tau_{ik}/600$; its batch shrinks until this remains true after crowding changes. Proposals compete for vacancies in descending gain order. These are bounded local improvements, not a global equilibrium solver. Inter-pool migrants use the existing demographic and financial transfers; within-pool moves change only recorded physical occupancy.

Construction anticipates one year of willingness to move toward the best accessible existing site, net of nearby vacant and pending housing. It also responds to a 15% aggregate capacity buffer shortfall. Capacity cannot appear from preference alone: materials, wages and completion time still bind. The coefficients remain synthetic; this implements job access and congestion mechanisms, not a calibrated prediction of city counts. [Duranton–Puga: agglomeration mechanisms](https://www.nber.org/papers/w9931).

## Housing, commuting and daily inspection

Residential capacity changes through construction using timber, stone and available paid labor. A project settles its inputs and wages once, then completes after three months. Opening legacy capacity is an explicit initialization assumption, not GDP. Capacity is a physical limit; this version does not add landlord, rent or mortgage transactions.

After local contracts, an unemployed worker pool searches accessible workplaces. Candidate weight is proportional to vacancies and wage and declines with travel time:

$$
\omega_{ij}=V_j w_j e^{-\tau_{ij}/30},\qquad
A_{ij}=0.35 U_i\frac{\omega_{ij}}{\sum_k\omega_{ik}}.
$$

Time is in minutes. Cross-market search covers a six-kilometer neighborhood and requires a network journey of at most 90 minutes; within-market travel is currently approximated as ten minutes. Workplace vacancies and cash scale simultaneous offers before payroll settles. Domestic residence receives wages and pays income tax; production belongs to the workplace. No cross-border work permit is inferred. Paths respect terrain, damage, corridors and congestion. Rail and motor modes require both technology and infrastructure. Freight taking longer than a monthly interval remains owned inventory in transit until its arrival date. [UrbanSim buildings, jobs and households](https://www.urbansim.com/parcel-level), [MATSim activity and travel models](https://matsim.org/the-book/).

A viewed day is a deterministic conditional sample of a saved month. Routine weights summarize paid jobs and other residents; a displayed person is not a persistent individual. Inspection never advances wages, births, consumption or the economic random stream. Persistent causal individuals remain phase 8.
