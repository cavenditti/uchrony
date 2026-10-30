# Physical supply chains

The catalogue contains 28 goods. Production, procurement, households and
construction use physical quantities, paid labor, inventories and the existing
cash and goods ledgers. Coefficients are synthetic game parameters, not historical
or nutritional calibration.

| Chain         | Inputs and outputs                                      | Economic use                                                  |
| ------------- | ------------------------------------------------------- | ------------------------------------------------------------- |
| Iron and fuel | Iron ore + charcoal → iron; timber → charcoal           | Tools, arms and construction                                  |
| Masonry       | Clay + coal → bricks                                    | Partial stone substitution in housing and public construction |
| Cereals       | Grain → flour; flour + charcoal → bread                 | Household food substitution                                   |
| Fishing       | Coastal fish → fresh fish; fish + salt → preserved food | Household food, with different spoilage rates                 |
| Steel         | Coal → coke; iron + coke → steel                        | Alternative tool and arms recipes after industry research     |
| Fibres        | Wool, flax or cotton → textiles; hemp → rope            | Clothing and paid shipbuilding materials                      |
| Luxury        | Precious ore + charcoal → precious metal → jewelry      | Discretionary household spending after food needs             |

Each new good has a productive facility, construction recipe, opening price and
explicit labor share. District specialization counts every commissioned facility: crops,
grazing and fisheries are agricultural, extraction is mining, processing is
industrial, and markets are urban. Ties remain mixed; pending projects supply no
workplaces or specialization. Raw minerals are geographically distributed. Clay, salt
and precious ore extraction draw down finite cell reservoirs. New worlds place
precious-metal ore in three to five compact, separated lodes with rich centres
and barren land between them, favouring accessible uplands. Their footprint
scales with map extent rather than adding more scattered deposits at larger
scales. Previously saved reservoirs retain their original geology and depletion.
Precious metals are aggregated rather than separated into gold and silver;
extraction does not mint money. Coastal fisheries share water-cell stocks and a monthly harvest cap.
Stocks recover over time without creating fish in owned warehouses. Offshore
fishing, fishing fleets and territorial fishing rights are not implemented.

Agricultural sectors share land and labor. Grain and flour are intermediates;
bread, fish and preserved food satisfy the existing household food ration through
actual purchases. Physical consumption remains attributed to the purchased good.
The current food-equivalence coefficients are deliberately simplified. Spoilage
is product-specific. Detailed livestock, preparation seasons, army diet
substitution and nutritional variety remain future work.

Textile and steel techniques compare available inputs and posted prices at the
local hiring round. Procurement and production use the same selected recipe.
These are compatible material substitutions, without separate plant conversion
projects or conversion delays. Coke, steel and some advanced goods require
research. A lack of inputs stops production but preserves upstream orders.

Bricks can replace part of the stone in housing and public construction when
available and useful; foundations retain stone. Existing committed projects
retain their original material quantities. Naval commissioning consumes rope
and textiles alongside its previous inputs.

New worlds receive explicit opening inventories scaled by scenario settings;
fish, bread and jewelry are not granted as free production. The repository's
current world schema rejects older saves and incomplete inventories; there is no
supply-chain save migration. Natural resource stocks and production choices are
validated on restoration.

Recipe indexes and static geographic fields are cached. Capacity quotes do not
initialize or mutate resource inventories. Production and trade still traverse a
larger catalogue; this extension does not claim unchanged monthly throughput.

Further candidates and acceptance criteria remain in the
[economic supply-chain roadmap](plans/ECONOMIC_SUPPLY_CHAINS_ROADMAP.md).
