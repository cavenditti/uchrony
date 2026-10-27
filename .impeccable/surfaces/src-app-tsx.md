---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css","src/components/WorldMap.tsx","src/components/Inspector.tsx"]
---

# Uchrony atlas workspace

Mode: Operate. A desktop-first simulation workspace with mobile inspection support. Users observe an autonomous history and intervene through country and province dossiers. The optional preference questions remain pending; this session proceeds with the recommended code-first implementation, without recording a permanent workflow preference.

## Direction contract

Playback extension, 27 October 2026: retain the floating slate clock and brass play/pause action. Replace its speed selector with direct 1×, 2×, 4× and Max buttons, with a persistent selected state. Max explicitly identifies approximate six-month simulation; preserve the approximation disclosure after returning to normal play. Keep monthly stepping and the annual-step menu. Below 760px put the date/status above a compact control row; preserve map access and keyboard shortcuts. No palette, typography or global layout changes.

Urban detail extension, 27 October 2026: preserve the cabinet-map composition. Selecting developed land exposes a 128 m block summary and an Inspect block action inside the existing place context; building and numerical-cell inspection remain available. Close city captions explain metropolitan membership or incorporation. Keep slate, brass, existing type roles and mobile wrapping; no new permanent panel, map layer or palette. Code-led extension of the existing direction. Finish with desktop/mobile captures and an independent finish review.

THESIS: The cabinet map table puts geographic consequences at the center, with state dossiers and decisions at arm's reach.

OWN-WORLD: Slate blue-green framing, warm pale type, restrained brass active controls, and desaturated colored sovereign territory. Precise tables, visible separators, compact toolbars, and self-hosted Alegreya map lettering.

STORY: Start time; see people, goods, and nations evolve; select a place; inspect the mechanisms; change a policy and observe the consequences.

FIRST VIEWPORT: A single 54px header above a full-height canvas. Factions open in a searchable, collapsible States drawer; Explore and province selection open contextual, expandable dossiers. A province click offers people, trade, forces and diplomacy beside the selected place. Layers and overlays share a compact map picker. A floating clock carries playback; world comparisons are a nonmodal workspace; background/saving details stay in Activity. Mobile preserves the map and uses dossier sheets. The signature interaction moves from geography to the relevant mechanism without permanently framing the map in controls.

FORM: Cabinet map table, seventh of seven grounded candidates (survey atlas; naval plotting table; air-traffic scope; census atlas; railway control; geological survey; cabinet map table). Seed ec4fabee. The night-atlas challenger is competitive for route observation but weakens border readability. Other challengers contribute consistent layer transformations, persistent selection, dense comparable rows, historical scale discipline, and one dominant map. Direction page was opened; no user choice received at implementation time, so this is a provisional direction rather than claimed approval.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Landscape and river extension — 25 October 2026

The landscape continues the cabinet map table: continuous terrain and biome transitions come from actual geographic sample positions, while administrative district refinement remains independent. Rivers follow the generated drainage network as smooth reaches that preserve confluences and remain within their geographic corridor. Atlas strokes and retained 3D ribbons share those curves; the ribbons follow the terrain surface. Irregular, bounded forest clusters and restrained, nonperiodic water detail support the geography without changing the slate interface, brass actions, Alegreya lettering, or dossier hierarchy.

New worlds establish drainage through iterative least-resistance routing and erosion during generation; saved worlds retain their existing geography. This is a synthetic landscape, with no claim of physical hydrology or AAA art certification. Implementation details, bounds, and validation evidence remain in [map rendering](../../docs/MAP_RENDERING.md#natural-landscape-and-drainage--25-october-2026); these local materials do not add global design tokens.

## City-detail extension — 25 October 2026

Closer inspection extends the same cabinet map table into procedural townscapes. Settlement identity and geography establish stable plans independently of administrative district refinement: irregular market lanes, planned blocks, or a longitudinal street network. Dense frontages frame an open civic square with a belfry, dome, or keep; varied roofs, walls, windows, market canopies, and local shadows make the internal layout readable. Streets and buildings respect the rendered river curves, with short bridges where major streets cross. These are code-native scene materials, not shipping raster artwork or new global interface tokens.

The province context offers **Explore city**; deeper zoom reveals the layout and a quiet slate caption with an Alegreya place name and operational population/type text. The established brass controls, map layers, dossier hierarchy, and aggregate simulation remain intact. Detail is bounded to six visible townscapes, twelve cached townscapes, and at most 350 buildings per layout. This is cartographic presentation, not per-building simulation or AAA art certification; existing saves require no migration. Architecture and validation evidence belong in [map rendering](../../docs/MAP_RENDERING.md).

## Water material refinement — 25 October 2026

Lit 3D channels use deeper centers, shallow edges, restrained earth-colored banks and static ripple normals. Tributary joins soften bank accents; river mouths meet the retained land silhouette. Width changes follow discharge and share the same setback calculation with town plans. This extends the landscape's materials while preserving Atlas, cabinet-map controls, simulation boundaries and the existing resource limits; no additional water texture or animation loop is introduced.

## Town materials and motion — 25 October 2026

The next pass makes close town inspection richer through procedural masonry, roof tiles, timber accents, cobbles, civic details and planted plots. A gentle shared wind moves flags and foliage, while water ripples follow the running/paused state. This replaces the preceding static-ripple treatment without adding a new art direction or global interface tokens. Motion stops when paused, hidden or reduced motion is enabled; the same retained city limits and 30 fps ceiling govern the scene. Material and geometry costs, visual checks and their limits are recorded in [map rendering](../../docs/MAP_RENDERING.md#animated-scenery-and-town-materials--25-october-2026).

## Illuminated-atlas trial — 25 October 2026

Status: first implementation of a map-local art-direction trial. The user accepted “let’s try it out and see how it ends up looking” after the recommendation inspired by [Matrakçı Nasuh’s city miniatures](https://www.ee.bilkent.edu.tr/~history/Ext/matruk). This is permission to explore the result, not permanent approval of a replacement global design system. The earlier direction contract still governs the operational interface.

THESIS: A living illuminated atlas with real 3D geography and towns.

OWN-WORLD: Jade/ochre terrain, lapis-blue water, pale masonry, vermilion/turquoise/slate roofs, fine architectural edges, arched windows, sparse brush-wave marks, rounded/slender foliage, and tiny gold civic details. These pigments are local to the landscape; slate controls, brass actions, Alegreya lettering, dossier hierarchy, and thematic data meaning remain intact.

STORY: Zoom from regions into distinctive seeded town plans and observe the existing shared animated scenery.

FIRST VIEWPORT: Geography dominates. Close zoom reveals architecture; the trial introduces no new panels.

FORM: The retained code-native 3D scene receives procedural pigments and materials. Geographic data, town plans, interactions, and simulation semantics remain intact. No generated or sourced shipping raster assets are introduced. Fine Atlas coastline strokes use screen-space widths; relief keeps its existing texture footprint.

FINISH: The first independent review requested finer Atlas coastline weight and documentation. The final Atlas recapture and documentation update resolved both specified fixes; the independent verdict is `ship` at that scope. Validation covers the isolated animated graphics fixture, not a fresh simulation/autosave endurance run. See [map rendering](../../docs/MAP_RENDERING.md#illuminated-atlas-trial--25-october-2026) for measured costs and evidence.

The subsequent 3D estuary refinement retains rich inland blue while matching the existing sea pigment, ripples and roughness near actual outlets. Banks fade before open water. The transition follows drainage through tributary joins; it is an illustrated mixing zone, with no sediment simulation, new global token or additional texture. Atlas keeps its cartographic strokes.


## Quadtree and dynamic urban land — 26 October 2026

Carlo requested less bloat and a stronger focus on the quadtree and fully dynamic urban areas, with more diverse terrain generation eventually. The default flat map now exposes the authoritative adaptive partition and physical developed parcels. Density, vacancy, and funded construction remain visible independently of city names. Dense occupied footprints receive finer cells; camera movement only changes visibility. Existing land-use, relocation, and city-continuity mechanisms supply changes. 3D is optional and allocated on demand. The terrain generator remains unchanged in this pass.

- Frontier urban land now consists of persistent building footprints on small lots. City names follow occupied connections; no enclosing city rectangle is painted. Quadtree detail reaches 8 m, while economics retain larger districts. Map picks distinguish the building footprint from its numerical cell, and close zoom uses metres. Political wilderness is unclaimed rather than tinted as a neutral state; founding shows its people, supply cost and province claim before the action.

## Organic growth and ground roads — 27 October 2026

New frontier development extends the cabinet map table with persistent buildings of varied sizes, freely positioned along local lanes and established trade-road frontages. Street growth favors gentle grades and contour directions using the existing terrain samples. Compact settlements use smaller setbacks and greater housing capacity toward their center; footprints and parcel sizes vary independently of the quadtree partition. Occupied buildings use stable roof-pigment variation, with vacancy and funded construction retaining their distinct marks. The quadtree indexes this geometry and can refine to 8 m; economic accounts remain in their larger pools, and existing saves retain their recorded footprints.

Local lanes and land trade routes default to procedural dirt paths painted into the flat map and the relief terrain overlay, with soft shoulders and broken wheel wear. These ground marks remain visible with the freight overlay off and replace extruded road scenery. The Trade layer can add a tonnage-based highlight; shipping remains dashed. This is a scoped, code-led refinement: slate controls, brass actions, Alegreya lettering, thematic meanings, and global design tokens remain unchanged. No shipping raster assets or replacement visual identity are introduced.

Implementation evidence is in `src/sim/urban-growth.ts`, `src/sim/building-lots.ts`, `src/map/quadtree-renderer.ts`, `src/map/ground-roads.ts`, `src/map/relief.ts`, and `src/map/trade.ts`. The local review captures are in `.impeccable/review/organic-growth/`; they document the rendered fixtures, not historical calibration or long-run simulation qualification.

## Smooth land routes — 27 October 2026

Land trade roads soften ordinary bends within the traversed cells while keeping junctions, ports, province centers, and surveyed building and lane connections fixed. Dirt paint and quantity highlights share the same curves, and cargo follows their sampled length. The existing soft shoulders and broken wheel wear remain the material language in both flat and relief views; this presentation refinement introduces no global tokens, road meshes, or shipping raster assets. Routing, freight costs, and recorded settlement geometry retain their existing simulation meaning. Source and validation details are recorded in [map rendering](../../docs/MAP_RENDERING.md); the local visual review captures are in `.impeccable/review/smooth-roads/`.

## Urban-centre inspection extension — 27 October 2026

The selected-place popup now includes a 128 m block summary: residents, jobs, vacant housing capacity, construction when present, and associated centre names. Explicit building records add building count and coverage; broader housing records instead show their coarser basis. **Inspect block** opens the block bounds through the existing area-inspection action. Numerical-cell and building inspection remain distinct actions above it. The popup reuses the existing ruled rows, slate surface, Alegreya heading and brass text actions; its height is bounded to the remaining map viewport and excess content scrolls internally.

Close-city captions optionally show **Linked with** a metropolitan centre or **District of** that centre after incorporation. This source-reviewed caption describes the recorded relationship; it introduces no permanent panel, map layer, art direction or global token. Simulation rules for persistent centres, incorporation and housing demand belong in the simulation documentation.

FINISH: The independent fallback finish review returned `ship` with no material fixes for the captured block extension. The desktop capture ([1440 × 1000](../review/urban-centres/desktop.png)) and mobile capture ([390 × 844](../review/urban-centres/mobile.png)) show block statistics and the block action within the existing popup, alongside numerical-cell inspection. These are isolated review fixtures, not shipping raster artwork. The metropolitan caption was source-reviewed but is not shown in these captures; conditional construction/coarse-housing states and building-action preservation are also source evidence, not claims of captured coverage. The detector returned `[]`; no QUALITY BAR card was supplied, so the verdict makes no separate quality-bar certification.

Documentation check: `PRODUCT.md`, `DESIGN.md`, `src/styles.css` and the affected `src/components/WorldMap.tsx` markup remain consistent with an ordinary extension of the incumbent visual system. `DESIGN.md` and `.impeccable/design.json` are unchanged by this pass; the new surface behavior is recorded here without promoting local details or pre-existing drift into global rules.
