---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/styles.css","src/components/WorldMap.tsx","src/components/Inspector.tsx"]
---

# Uchrony atlas workspace

Mode: Operate. A desktop-first simulation workspace with mobile inspection support. Users observe an autonomous history and intervene through country and province dossiers. The optional preference questions remain pending; this session proceeds with the recommended code-first implementation, without recording a permanent workflow preference.

## Direction contract

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
