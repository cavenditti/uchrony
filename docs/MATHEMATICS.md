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

Planned lifetime fertility $T$ is desired surviving children divided by expected childhood survival. Desired children are $2.3+1.2(1-\ell)(1-v)-0.6v\ell$, with literacy $\ell$ and urban opportunity exposure $v$. In adaptive worlds, each home contributes $\min(1,R_i/50{,}000)$, where $R_i$ is developed residents within market reach (below), weighted by its occupants into their economic district; homes in open country contribute zero. A compact farming village does not become metropolitan. The baseline comparison profile and non-adaptive worlds retain their previous urban-share input. Food shortage is $s$; $\xi_B$ is the active fertility-effect multiplier.

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

In model 6, food quantity saturates at $1.5\gamma_{\mathrm{food}}$. Spending released by this cap is redistributed among nonfood goods in proportion to their discretionary shares; unavailable purchases remain savings. Wholesalers retain at most half their nonfood inventory against forecast workshop-input orders, so households cannot permanently empty production chains. Food is excluded from this business reserve.

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
b&=0.40758kc^2,\qquad \beta=0.5(1-u_{t-1})\\
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

In model 7, paid productive equipment also multiplies farm output by $1+0.5\log(1+K_{\mathrm{eff}})$, using the same population-normalized productive capital as manufacturing. Its marginal effect diminishes; zero farm employment still produces zero food. Public soil works purchase actual timber, stone and available labor, enter fixed investment at cost, and add at most 0.12 fertility after six months, with a total fertility ceiling of 1.2.

Local farm seasonality multiplies food capacity by

$$
s_{c,t}=1+a_c\sin\left(\frac{2\pi}{12}((t\bmod 12)-4+6\mathbf{1}_{\ell_c<0})\right).
$$

Here $\ell_c=1-2(r_c+0.5)/H$ is synthetic latitude, with row $r_c$ and map height $H$. Temperature is $29-47|\ell_c|-25\max(0,e_c-0.2)$ for elevation $e_c$. Terrain, moisture and temperature classify climate; amplitude $a_c$ is 0.08 for tropical, 0.12 for arid and 0.23 otherwise. The annual mean of this multiplier is one. These rules give opposite growing seasons to the two hemispheres; they do not simulate weather or individual crops.

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
\frac{\text{sales}+\widehat R-\text{payroll}-\text{inputs}}{\max(c_K,Kc_K)}&>r^{\mathrm{real}}+\delta
\end{aligned}
$$

$c_K$ is unit construction cost. Because investment precedes retail, $\widehat R$ includes expected remaining retail receipts, bounded by actual inventory and the unsatisfied part of the sales forecast. Expected receipts affect the return estimate only; funding must already exist. Desired additions replace depreciation and respond to utilization; actual construction requires materials, unused artisan labor and at most 23.396% of firm deposits. The utilization adjustment is 0.03502 monthly. Funded productive investment is considered before public hiring and household consumption. Projects take six months. Materials and labor are paid, capitalized and counted once in GDP. Persistent financial distress can liquidate a firm; new entry transfers existing owner funds.

## Government, welfare and research

Taxes transfer income to the treasury. With monthly tax receipts $T$, treasury deposits $D_G$ and civilian population $N$, the desired spending envelope is:

$$
G^*=\max(0.95T,\,0.00002N)+0.02(D_G-12T)^+
$$

Actual spending is limited by treasury deposits and approved credit. Budget shares buy available workers or make funded transfers. Half the military allocation remains available for recruitment and supplies rather than civilian service hiring; its budget therefore includes a funded operations envelope. Recruitment and automatic settlement labor obligations each cost six current domestic monthly wages per person. Welfare creates household income only when paid and contributes no GDP by itself. Nonmarket services are valued at paid cost; their real output uses reference wages.

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

Funded provincial paving multiplies local road friction by 0.85 and capacity by 1.2; funded railways use 0.65 and 1.5. A paid harbor level $h\in\{0,1,2,3\}$ multiplies port capacity by $1+0.4h$. Construction requires technology, treasury and depot materials, and improves existing transport access. These are synthetic investment effects, not calibrated engineering capacities.

The atlas projects employment and population onto dominant tile activities. Detailed farms, woods, mines, workshops, docks and representative motion are generated only for observed tiles and do not alter these accounts. Mixed activities and individual routines remain aggregated in the authoritative monthly model.

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
+2\frac{\sigma(p)}{\bar p}+R_n+T_n+\frac{Q_n}{64}.
$$

$Q_n$ is the live physical-site count; $N_n$ and $J_n$ are residents and paid jobs, $s_n$ is width in meters, and $R_n=1$ when a node wider than 4 km contains a river (zero otherwise). Refinement is reviewed every six months with 1/0.55 entry/exit thresholds and a twelve-month dwell period. The minimum-width setting is 128 m. The moving-activity signal $M_n$ adds corridor traffic / 20,000 at endpoints and fleet crew / 300 plus hull count / 8 at their recorded location; this is not additional population. $T_n$ is the larger of area-weighted elevation SD / 0.12, moisture SD / 0.18, or 1.1 for a mixed land/water node, multiplied by $\min(1,(s_n/2000)^2)$. Only existing geographic data contribute. These are declared numerical choices; camera position is absent. [AMReX conservation and coarse–fine interfaces](https://amrex-codes.github.io/amrex/docs_html/AmrCore.html#using-fluxregisters).

Municipalities and provinces annually compare local mergers, splits and boundary transfers. For population $N$, $o$ local service offices and monthly wage $w$, office workload costs $w[b+(o-1)+N/10^4+(N/80000)^{1.3}]$, with $b=4$ for municipalities and $20$ for provinces. Travel adds four annual return visits to the nearest retained office, valued at a quarter of the hourly wage. Mergers retain offices; independent profitable reforms can proceed together, each rechecking available workers and funds. A reform requires 36 months of expected savings to exceed its paid reorganization labor. Geometry must remain complete, connected and within one sovereign state. Permanent legal references and past national accounts survive the change. Initial boundary proposals use legacy terrain polygons; computational leaves can be much smaller.

## Settlement formation and residential choice

Home $j$ houses $D_j$ developed residents on a square support $B_j$: all occupants of a building or funded parcel, or $\min(N_j,\,c_j\cdot48{,}000)$ for a coarse record with built cover $c_j$. With the biweight $k(u)=\tfrac{15}{16}(1-u^2)^2$ on $[-1,1]$ and the separable kernel $K_b(x,y)=k(x/b)k(y/b)/b^2$, a field is

$$
\rho_b(\mathbf x)=\sum_j D_j\,(\mathbf 1_{B_j}/|B_j| * K_b)(\mathbf x),
$$

sampled on aligned quadtree nodes with each axis' weights renormalized after world clipping, so $\sum\rho_b\,\Delta A=\sum_jD_j$ exactly. The fabric field uses $b=160$ m on 32 m nodes; urbanity is $v=\rho^2/(\rho^2+1500^2)$ for developed residents and uses the terrain sample's mean $\rho$ for dispersed ones. The agglomeration field uses $b=2{,}048$ m on 256 m nodes and is read as reach $R=\rho/K_b(0)$, so a point mass reads its own size.

Urban areas are connected components of $\{R\ge100\}$ on habitable land within one state. Processing nodes in descending $R$ with a union–find gives each mode $m$ a peak $R_m$, the saddle $s_m$ where it first joins a higher mode, and prominence $p_m=(R_m-s_m)/R_m$. A mode is significant if it is an area summit or $p_m\ge0.2$ ($\ge0.1$ while it already holds a place). A significant mode is named once at least 500 developed residents ascend to it; smaller basins join the place they adjoin. A non-summit place becomes a quarter after $p_m<0.4$ for 12 months and is released after $p_m\ge0.6$ for 12 months. Village, town and city denote 500, 5,000 and 50,000 administered residents. These are classification conventions, not growth targets or a fitted definition of cities. [Degree of Urbanisation](https://human-settlement.emergency.copernicus.eu/degurbaDefinitions.php); [persistence-based clustering](https://doi.org/10.1145/2535927).

For home $i$, accessible nonfarm work $A_i$, funded administrative service access $S_i$ and locational utility are

$$
A_i=\sum_{j:\tau_{ji}\le60}(E_j+V_j)(1-f_j)e^{-\tau_{ji}/30},\qquad
S_i=\sum_{k:\tau_{ki}\le60}P_ke^{-\tau_{ki}/30},\qquad
u_i=0.18\log(1+A_i/100)+0.12\log(1+S_i/100)+0.12h_i+0.1\log(1+R_i/2000)-0.25(N_i/H_i)^2.
$$

$E,V$ are filled and unfilled jobs; $f$ is the food-employment share, $h$ habitat quality, $R$ developed residents within market reach (the agglomeration pull), $H$ housing capacity and $N$ occupants. $P_k$ is funded administration, education and policing output / 0.0015, allocated over a municipality's retained offices. No service is supplied by an unfunded office. Sources must be within 6 km. Reverse shortest-path searches supply source-to-home network times with domestic passage, water/corner barriers, terrain, roads and congestion. Door offsets walk at 4 km/h. Within a source square, direct walking uses its terrain penalty; between accessible adjacent squares it uses the larger endpoint terrain penalty. Direct walking competes with the network route, so road congestion cannot block a neighboring footpath. Actual relocation retains the exact physical route check.

A source-tree branch of radius $r$ is approximated at its bounding-box center only if $\exp(rL/30)-1\le0.02$, where $L$ bounds travel-time change per meter (0.015 for network source access, or 0.015 times the larger terrain penalty for direct walking). Branches intersecting the 6 km or 60-minute cutoff are opened. Thus each positive work/service sum has at most 2% relative kernel error; coincident sources and leaves are exact. Source trees do not change when the numerical mesh is refined. Independent batches retain fixed source order on every worker count. These are synthetic coefficients and a numerical error bound, not calibrated urban-growth predictions.

Each month at most $\lfloor N(1-e^{-0.08/12})\rfloor$ residents per household pool consider relocation. Integer apportionment distributes this budget across homes. A move requires funded vacancy and $\Delta u>0.08+\tau_{ik}/600$; its batch shrinks until this remains true after crowding changes. Proposals compete for vacancies in descending gain order. These are bounded local improvements, not a global equilibrium solver. Inter-pool migrants use the existing demographic and financial transfers; within-pool moves change only recorded physical occupancy.

Construction anticipates one year of willingness to move toward the best accessible existing site, net of nearby vacant and pending housing. It also responds to a 15% aggregate capacity buffer shortfall. That shortfall represents new households, who split between the home's local centre (weight 1) and reachable centres with higher net utility (weight $e^{(u_k-\tau_{ik}/600-u_\text{local})/0.15}$), so new housing gravitates toward established centres. Capacity cannot appear from preference alone: materials, wages and completion time still bind. The coefficients remain synthetic; this implements job access and congestion mechanisms, not a calibrated prediction of city counts. [Duranton–Puga: agglomeration mechanisms](https://www.nber.org/papers/w9931).

## Housing, commuting and daily inspection

For a project adding $q$ places to existing capacity $H$ on land area $A$, define $B=\max(1,A/40)$ and

$$
D(q,H,A)=q\left[1+0.18\frac{H^2+Hq+q^2/3}{B^2}\right].
$$

Timber, stone and labor requirements are $0.08D$, $0.05D$ and $0.1D$. This integrates a convex marginal density cost. A new plot additionally requires $(4+0.005d,\;8+0.04d,\;2+0.02d)$ in those respective inputs, where $d$ is the access connection in meters. Investors compare feasible cost per place at current input prices and wages among nearby accessible infill and a new serviced plot. Funding and input constraints scale the project; a new plot's first project fits its ground capacity. Dispersed opening rural housing uses its full source land area for rehabilitation, and is not reclassified as compact urban development merely because money is spent. These are synthetic construction coefficients, not estimated elasticities.

A project settles its inputs and wages once, then completes after three months. Opening legacy capacity is an explicit initialization assumption, not GDP. Capacity is a physical limit; this version does not add landlord, rent or mortgage transactions.

The city view uses recorded capacity to derive the parcel floor-area ratio $F/A$, with $F=40H$. It illustrates density through a bounded two-to-six-storey profile, larger house footprints, varied roof forms and seeded market, planned or riverside street traditions. A finite decorative lot sample does **not** receive the entire capacity as literal floors: capacity is conserved separately as $H_b=H a_b w_b/\sum_j a_j w_j$ in display metadata. Workshops carry no residential capacity. House heights use bounded cartographic proportions (never taller than their shorter footprint side), and foundations use small physical offsets; the old twofold vertical multiplier is removed. Streets and buildings remain stable when population changes within an unchanged physical parcel. Geometry is illustrative, with no causal building census or structural-engineering model, and it never changes population or construction accounts.

After local contracts, an unemployed worker pool searches accessible workplaces. Candidate weight is proportional to vacancies and wage and declines with travel time:

$$
\omega_{ij}=V_j w_j e^{-\tau_{ij}/30},\qquad
A_{ij}=0.35 U_i\frac{\omega_{ij}}{\sum_k\omega_{ik}}.
$$

Time is in minutes. Cross-market search covers a six-kilometer neighborhood and requires a network journey of at most 90 minutes; within-market travel is currently approximated as ten minutes. Workplace vacancies and cash scale simultaneous offers before payroll settles. Domestic residence receives wages and pays income tax; production belongs to the workplace. No cross-border work permit is inferred. Paths respect terrain, damage, corridors and congestion. Rail and motor modes require both technology and infrastructure. Freight taking longer than a monthly interval remains owned inventory in transit until its arrival date. [UrbanSim buildings, jobs and households](https://www.urbansim.com/parcel-level), [MATSim activity and travel models](https://matsim.org/the-book/).

A viewed day is a deterministic conditional sample of a saved month. Routine weights summarize paid jobs and other residents; a displayed person is not a persistent individual. Inspection never advances wages, births, consumption or the economic random stream. Persistent causal individuals remain phase 8.


## Public productive investment and supplier compensation

A public project buys a fraction $a$ of a real construction recipe. Its value and financing constraint are

$$
V(a)=a\left(\frac{\sum_g q_gp_g}{1000}+\ell\bar w\right),\qquad V(a)-D(a)\le B.
$$

Here $p_g$ is crowns per tonne, $\bar w$ is the monthly occupational wage in thousands of crowns, $\ell$ is worker-months, $D(a)$ is eligible supplier credit and $B$ is allocated cash. Feasible scale is also limited by materials, available labor and project capacity. Wages always require cash. The state may defer payment only for materials above the local consumption/input buffer. A bounded search finds the largest feasible $a$. The credit limit is twelve months of the current domestic revenue estimate, less outstanding supplier claims.

For a deferred material purchase of value `d`: the supplier loses the actual quantity, gains a receivable of `d`, and the state gains the capital contribution and a liability of `d`. Aggregate crowns do not change. A later repayment `p` reduces treasury cash and that liability by `p`, raises supplier cash by `p`, and reduces its receivable by `p`. It is not a new sale or a second capital expense in the national accounts. Cash-basis tax/dividend capacity rises only on actual compensation. Supplier claims move with district financial ownership and survive legal succession.

Public enterprise equity uses `new_shares = contribution_value / opening_book_value * old_total_shares`. This dilutes old ownership proportionally while preserving its book claim; the government gains no cash or production merely by subscribing. Dividends are transfers from realized operating cash under the ordinary firm buffer rule. Strategic reserve profit-tax relief is at most 25%, weighted by the value share of new, sufficiently productive strategic output retained within an unfilled target. Eligible quantity is bounded by `max(0, production - sold)`; sold output cannot also earn a reserve incentive. It neither taxes inventory as revenue nor pays a subsidy for holding old stocks. Food insecurity suspends the reserve incentive.


## Technology-limited productive sites

Each original terrain tile retains a commissioned level $L_c$. Its current research ceiling and productivity multiplier are

$$
L_{\max}=\min\left(6,1+\left\lfloor\min(t_{\mathrm{agriculture}},t_{\mathrm{industry}},t_{\mathrm{logistics}})\right\rfloor\right),
\qquad m_c=1+0.45\ln(1+L_c),\qquad \bar m_r=\frac{1}{|C_r|}\sum_{c\in C_r}m_c.
$$

Agriculture, extraction and manufacturing capacity use $\bar m_r$, the area mean over equal-sized terrain samples in district $r$. Completed capital persists after conquest or district remapping; a lower successor technology ceiling prevents new tiers rather than erasing commissioned works. Research alone creates no completed levels. Zero workers, exhausted resources or missing production inputs still constrain actual output.

A complete next level at a tile with level $L$ requires materials and worker-months scaled by $1+0.6L$. The first recipe is 16 tonnes timber, 24 tonnes stone, 4 tonnes tools and 160 worker-months. Only one tier per tile may be under construction, and full financing is required before commissioning it six months later. This replaces neither the separate soil-fertility ceiling nor enterprise equipment. The coefficients and construction duration are live synthetic parameters.

After food coverage reaches 97%, native governments offer half their productive investment budget to a ranked batch of site works, at most one per economic district per quarterly review. With observed output value $Y_r$ and next-tier construction cost $C_{c,L+1}$, the score is

$$
S_c=\frac{Y_r\left[m(L_c+1)-m(L_c)\right]}{\bar m_r\,|C_r|\,C_{c,L_c+1}}.
$$

Dividing by current $\bar m_r$ removes the improvement already included in observed output. This is an estimate of marginal productive capacity per construction crown, not a promised sale or financial return. Budget, wages and local material availability bind every project; food emergencies redirect facility and enterprise funding to agriculture. Unspent land funding remains available for enterprise investment. Surplus value and treasury receipts still depend on realized production, input costs and sales.


## District facilities and specialization

For facility kind $k$, completed tiers $L_{c,k}$ belong to original terrain cell $c$. Its relevant technology is $t_k$, the configured entry threshold is $t_{0,k}$, and the shared land and research constraints are

$$
\sum_k L_{c,k}\le 6,\qquad L_{k,\max}=\min\left(6,\max\left(0,1+\lfloor t_k-t_{0,k}\rfloor\right)\right),\qquad
\bar L_{r,k}=\frac{1}{|C_r|}\sum_{c\in C_r}L_{c,k}.
$$

Agricultural estates, timber yards, quarries, iron mines and coal mines require the corresponding geographic endowment. Ore-grade potential is reduced by the share of its original reserve remaining. Workshop and market sites require habitable land. Every tier consumes its actual construction recipe and worker-months, scaled by $1+0.5L_{c,k}$, and commissions after six months by default. There can be only one project per cell at a time. Neither technology nor site selection awards construction output.

Primary-sector capacity multiplies by $1+0.35\ln(1+\bar L_{r,k})$ for the matching kind only. Workshop sector equipment is $K^{\mathrm{eff}}_{r,f,k}+0.25\bar L_{r,k}$, retaining its ordinary worker and input constraints. Total public indoor capacity is

$$
H^{\mathrm{public}}_r=120\sum_{c\in C_r}\sum_{k\in\{\mathrm{tools,textiles,arms}\}}L_{c,k},\qquad
H^{\mathrm{available}}_{r,f}=H^{\mathrm{private}}_{r,f}+\frac{H^{\mathrm{public}}_r}{\max(1,F^{\mathrm{active}}_r)}.
$$

The same commissioned capital can therefore establish industrial equipment and finite premises where private workshops are absent. Firms cannot multiply the shared workplace allowance by entering. Installed capacity biases sector labor plans; solvent demand, manufacturing inputs and paid hiring still determine employment and output. A district receives a specialization label only when one broad category holds a strict majority of its commissioned tiers; the label itself has no economic effect.

With mean market tiers $M_r$, the handling margin and integrated physical storage-loss rate are

$$
\mu^{\mathrm{handling}}_r=\frac{0.04}{1+0.2M_r},\qquad
\delta_{r,g}(\Delta)=1-\left(1-\frac{\delta_g}{1+0.3M_r}\right)^\Delta.
$$

Merchants retain weighted inventory acquisition costs and actual interest obligations. The ordinary loss-recovery and financing terms are added to the handling margin. Lower storage losses leave physical goods available; constructing a market never grants new goods or revenue.

Native facilities receive 65% of productive capital funding remaining after general land works. A complete project's total commitment, including supplier claims, must fit the remaining appropriation. Alternatives are ranked by $S_{r,k}=\widehat{\Delta V}_{r,k}/C_{r,k}$. The numerator estimates marginal output capacity or avoided distribution losses from observed local prices and margins, remaining resources, inputs, storage and customer demand. Nearby domestic demand is weighted by infrastructure and a configured 25% neighbor share. It is neither a contract nor proof of a traversable freight route. Food emergencies prioritize estates; otherwise at most one ranked facility is funded per district per review. Coefficients, recipes and thresholds are synthetic, configurable assumptions rather than promised profits or historical estimates.
