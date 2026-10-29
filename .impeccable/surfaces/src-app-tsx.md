---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css","src/components/WorldMap.tsx","src/components/Inspector.tsx"]
---

# Uchrony atlas workspace

Mode: Operate. A desktop-first simulation workspace with mobile inspection support. Users observe an autonomous history and intervene through country and province dossiers. The optional preference questions remain pending; this session proceeds with the recommended code-first implementation, without recording a permanent workflow preference.

## Direction contract

Playback extension, 27 October 2026: retain the floating slate clock and brass play/pause action. Expose three icon controls: play for standard speed, double arrow for 2× and triple arrow for Max; omit 4×. The active running control becomes pause, retaining a persistent selected state and accessible names/tooltips. Max advances one approximate six-month economy/population interval and then reconciles local details; its status and help identify this approximation and pause occurs after the current step; preserve the approximation disclosure after returning to normal play. Keep monthly stepping and the annual-step menu. Below 760px put the date/status above a compact control row; preserve map access and keyboard shortcuts. No palette, typography or global layout changes.

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

## Configuration editor extension — 28 October 2026

Advanced world setup and the live Simulation parameters dialog extend the cabinet map table with searchable, collapsible ruled groups, section/default resets and JSON preset import/export. They retain slate surfaces, pale operational text, brass actions and focus, and Alegreya subheadings. The live editor shows pending changes and explicit **Apply changes together** / **Discard changes** actions; creation-only fields remain unavailable during live editing. Applied settings govern future steps and travel with the world's saves. Configuration and scenario boundaries are described in [the simulation model](../../docs/MODEL.md#configuration-and-scenario-boundaries).

The wider, viewport-bounded dialog uses two field columns on desktop. At 600px and below, setup and parameter fields become a single column, search occupies its own row, and live actions stack with the primary action first. The exhaustive five-by-four biome matrix remains a ruled table with editable cells and terrain overrides; it scrolls horizontally within its own region, retains sticky temperature labels, and displays a sideways-scroll instruction on phones. Temperature fields include their units. These are local extensions of the existing modal, with no new global tokens or shipping raster artwork.

FINISH: The supplied independent finish verdict is `ship` for the two reviewed corrections: clipped mobile setup values and missing temperature units. Local evidence comprises [desktop setup](../review/configuration/desktop-setup.png), [mobile setup](../review/configuration/mobile-setup.png), [desktop live editing](../review/configuration/desktop-live.png), [mobile live editing](../review/configuration/mobile-live.png), and intentionally scrolled [desktop](../review/configuration/desktop-matrix.png) / [mobile](../review/configuration/mobile-matrix.png) matrix views. These are synthetic preview fixtures; the static preview lacks the save API, so its background warning is not production save evidence. No comp or QUALITY BAR was supplied. This source-grounded documenter pass preserves `DESIGN.md` and `.impeccable/design.json`; their pre-existing sidecar drift and the unset build path remain outside this extension.


## Parameter explanations and opening treasury — 29 October 2026

Small SVG question-mark controls extend the existing setup and parameter fields with a short explanation on hover, keyboard focus or tap. All 338 configuration values require help text, including each biome-matrix cell; basic world setup and simulation conditions use the same pattern. The explanation remains associated with its field for assistive technology. The fixed-position bubble stays within the viewport, including beside horizontally scrolling matrix controls; Escape dismisses it before closing the enclosing dialog, and scrolling or resizing dismisses it. Its muted resting icon, brass active/focus state, slate surface and pale text continue the cabinet-map direction (seed ec4fabee). Local tooltip dimensions and shadow are implementation details, not new global design tokens.

**Starting conditions** is the first advanced group. **Initial treasury per frontier state** and **Initial treasury per established state** describe opening money in thousands of crowns; the basic setup summary shows the selected pattern's opening treasury in crowns. **Expedition cash cost** describes money spent from an existing treasury for a manual expedition. This distinction corrects the earlier ambiguity between an expense and starting funds. Live edits retain the existing pending-change review and explicit batch apply/discard actions.

FINISH: The supplied independent fallback review returned `ship` with no material fixes for the scoped parameter-help extension. Its six reviewed captures are [desktop help](../review/parameter-help/desktop.png), [mobile help](../review/parameter-help/mobile.png), [desktop treasury](../review/parameter-help/desktop-treasury.png), [mobile treasury](../review/parameter-help/mobile-treasury.png), and intentionally scrolled [desktop matrix](../review/parameter-help/desktop-matrix.png) / [mobile matrix](../review/parameter-help/mobile-matrix.png). These are synthetic static-preview fixtures; the preview has no save API, so its background Save warning is not production-save evidence. Basic/live behavior was source-reviewed rather than captured at that review time, and the review did not individually audit every help sentence against the simulation. The configuration suite passed all 12 tests, the build passed, and the design hooks reported zero findings. No comp or QUALITY BAR was supplied, so this is a scoped ship verdict without separate quality-bar certification. No shipping raster artwork was added.

Subsequent parent browser validation also captured [desktop live editing](../review/parameter-help/desktop-live.png) and [mobile live editing](../review/parameter-help/mobile-live.png), confirming expedition-cost help and the retained batch apply action. It observed a generated Treasury 1B after setting the opening treasury to 1,000,000 thousand crowns. This additional evidence does not expand the independent reviewer’s six-capture scope; reproduction details and limits are recorded in [the validation record](../../docs/validation/parameter-help-2026-10-29.json).

Documentation check: `PRODUCT.md`, `DESIGN.md`, the affected components, `src/styles.css`, and the configuration schema/help source support an ordinary extension of the incumbent system. `DESIGN.md` is preserved. The explicitly requested `.impeccable/design.json` refresh reconciles the incumbent narrative, current floating-surface shadows, drawer row and local comparison navigation samples; it removes the obsolete global navigation and unused world-type tag examples without introducing global tokens. Existing incidental small labels remain outside the normative typography standard.


## Historical atlas and institutional dossiers — 29 October 2026

THESIS: Inspect a dated world and the reasons its institutions changed, with one selected date governing both the map and dossier. This extends the existing cabinet map table.

OWN-WORLD: Retain slate surfaces, brass actions, pale operational text, Alegreya headings, Lucide controls and ruled data rows. Historical geography is a flat provincial SVG: no present-day buildings are projected into the past.

STORY: Open History (or an institution from the World overview), select a date, inspect a state or institution, follow a decision to its date, and return to the present. Current institutional proposals use explicit council consent; past records are read-only.

FIRST VIEWPORT: A dated toolbar and map accompany the searchable dossier. Coarse observations and missing earlier history are disclosed beside the date. A comparison anchor highlights changed sovereignty.

FORM: Ordinary code-led extension of the incumbent cabinet map (existing seed ec4fabee), not a new visual world. Desktop pairs the map with a 390px dossier; mobile stacks them in a scrollable view. No new global tokens or shipping raster assets.

INTERACTION: Selecting a date requests a bounded historical projection from the simulation worker. The live world pauses on opening. Numeric and slider navigation, keyboard-operable provinces, map zoom, dated timeline links and an explicit return action provide navigation without animation dependencies.

FINISH: The independent fallback review returned `ship` for the two requested corrections: quantitative map legends and a map key that obscured geography. Population and economic-output legends now share the map's square-root scale, show units and numerical values, and disclose constant or empty observations. The key occupies its own space below the SVG rather than covering territory; the mobile map retains a fixed-height region above the stacked dossier. This is a scoped disposition for those corrections, not certification of every historical-atlas state.

The final [desktop](../review/historical-atlas/desktop.png) and [mobile](../review/historical-atlas/mobile.png) captures show the quantitative layer; [desktop crisis](../review/historical-atlas/desktop-crisis.png) and [mobile dossier](../review/historical-atlas/mobile-dossier.png) retain the earlier institutional and past-crisis evidence. These are labeled synthetic fixtures with no model calls or autosaves, not evidence of long-run simulation calibration. No comp or QUALITY BAR was supplied, and no shipping raster artwork was added.

Validation: 28 focused domain, save, performance and worker-integration tests passed, along with the diplomatic-access regression, preserved physical-trajectory fingerprint and local disk-endpoint check. The final build passed. The final browser accessibility report has zero violations and zero incomplete checks after assigning the quantitative legend a grouping role. The full-suite attempt reported 658 passing and 15 failing cases, including two feature-related test fixtures that now pass on isolated reruns, one local-server restriction, and a long simulation file terminated after seventeen minutes. The remaining cases in that file are unverified. Eleven unrelated housing, frontier, industrial-investment, map, residential-display and formula-rendering failures reproduce on unchanged HEAD; a disk-endpoint failure under restricted local-server access passes when that access is available. The older access-test fixture was completed with the required relation list and now covers wartime loss of privileges. No all-suite-pass claim is made. Exact scope and limitations are recorded in [the validation report](../../docs/validation/history-institutions-2026-10-29.json).

Documentation check: `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, the historical atlas/map/institution components, `src/App.tsx` and the affected styles support an ordinary extension of the incumbent cabinet map. This fallback documenter pass preserves both global system files and the already accurate historical-atlas/shared-institution descriptions in `docs/MODEL.md`. Local type sizes and legend layout remain surface details; incidental small labels and unrelated global drift are not promoted into normative design rules.
