---
target: Review all graphics and identify improvements
total_score: 20
max_score: 32
na_heuristics: 5,9
p0_count: 0
p1_count: 1
target_identity: "file:/Users/carlo/Devel/personal/uchrony/src/components/WorldMap.tsx"
target_fingerprint: "sha256:d2ee7c0ad82dd319f4e6002c80d8df4e075985e6383927aecfb9f56677e9bfc6"
target_path: /Users/carlo/Devel/personal/uchrony/src/components/WorldMap.tsx
timestamp: 2026-10-25T17-46-11Z
slug: src-components-worldmap-tsx
---
Method: dual-agent (A: graphics_design_review · B: graphics_evidence_review)

The biggest improvement now is coherence across scales. The palette and city families have character, but crisp miniature towns, pale rounded forests, soft mountain surfaces and the blurred Atlas base still feel like different treatments. Stronger geography, consistent scale and connected urban fabric should come before additional tiny decoration.

Both independent assessments inspected the current 129,024-cell renderer. This is a graphics review, not a whole-app usability or endurance qualification. No application code was changed.

**What works**

- Meridia's red, Ord's dark blue and Serrana's turquoise architecture distinguish places immediately.
- Pale masonry, civic squares and directional shadows give close town views useful focal points.
- The estuary color/ripple blend connects rivers and sea without losing the inland blue. Preserve it.

**Priority issues**

1. **P1 — Fix annotation scale and collisions.** Atlas army badges grow to roughly 200 × 100 px at city zoom and obscure places; their 3D counterpart remains about 78 × 21 px. Regional place names are tiny and strongly outlined, while all ordinary location labels disappear beyond a deep 3D zoom threshold. Use shared screen-space markers in both presentations, a collision budget for labels and badges, and persistent selected-place anchors. This is a concrete defect with high benefit and limited art cost. Suggested commands: `$impeccable polish`, `$impeccable typeset`. Sources: `src/components/WorldMap.tsx:415`, `:465`, `:556`; `src/map/renderer.ts:293`, `:311`; `src/map/warfare.ts:24`. Evidence: `.impeccable/review/graphics-b-atlas-badge.jpg`, `graphics-b-city-3d.jpg`, `graphics-a-region.jpg`.

2. **P2 — Improve shore and river shapes.** The color seam is better, but straight-sided channels, pointed tributary joins, hard inlet corners and the broad soft shore lip remain visible beside precise buildings. Preserve drainage and improve the displayed junctions, width transitions and coast edge, with bounded local detail. This should be coordinated with the quadtree work rather than increasing the whole-world mesh. Suggested command: `$impeccable polish`. Sources: `src/map/river-surface.ts:46`, `:149`; `src/map/relief.ts:67`; `src/map/renderer.ts:274`. Evidence: `.impeccable/review/graphics-a-meridia-close.jpg`, `graphics-a-serrana.jpg`. These are existing limitations, not demonstrated regressions from estuary blending.

3. **P2 — Give forests and mountains the same drawn character as towns.** Regional trees read as repeated pale capsules; dark interiors, composed groves and varied crown proportions would read more convincingly. Mountains need selective ridge/rock marks and a clearer hierarchy between peaks and slopes. Ground contact and restrained edge accents would unify lighting and materials. Reorganize the existing instance budget and use cached detail rather than adding dense scatter. Suggested command: `$impeccable shape`. Sources: `src/map/relief.ts:164`; `src/map/forest-sites.ts:9`, `:22`; `src/map/landscape-raster.ts:48`. Evidence: `.impeccable/review/graphics-a-relief.jpg`.

4. **P2 — Make towns feel grown, connected and locally specific.** The building kit is attractive, but repeated open plazas, broad pale streets, evenly spaced houses and detached slatted garden rectangles expose the kit. Use one dominant civic center, a denser old core, secondary districts and a gradual rural edge. Attach gardens to yards and lanes; introduce shared frontages and terrain-shaped neighborhoods. Distinctive waterfront, fortress or market silhouettes should express settlement context. Keep this illustrative and within the existing house/cache limits. Suggested command: `$impeccable shape`. Sources: `src/map/city-layout.ts:228`, `:322`, `:421`; `src/map/city-scenery.ts:578`. Evidence: `.impeccable/review/graphics-a-ord.jpg`, `graphics-a-meridia.jpg`, `graphics-a-serrana.jpg`.

5. **P2 — Give each map mode a deliberate visual hierarchy.** Atlas currently loses the forests and exposes a blurred base; it needs a designed translation, such as sparse woodland symbols, ridge strokes and clear river hierarchy. In population view, 3D scenery and relief compete with data and thin district boundaries become less legible than in Atlas. Use clearer quantitative color, quieter scenery and selected boundaries drawn at readable screen weight. Suggested commands: `$impeccable shape`, `$impeccable quieter`. Sources: `src/map/renderer.ts:45`, `:238`; `src/map/relief.ts:67`; `src/map/landscape-raster.ts:15`. Evidence: `.impeccable/review/graphics-a-atlas-region.jpg`, `graphics-b-population-3d.jpg`, `graphics-b-population-atlas.jpg`.

**Secondary improvements and limits**

- Match the outer canvas to the ocean so the world does not sit on an obvious rectangular plate. Portrait world-fit also leaves extensive empty space.
- Keep wave marks quiet at regional distances. Additional close-up smoke, sails or route-bound activity should follow the coherence pass and retain paused/reduced-motion behavior.
- Profile zoom uploads before adding higher-resolution terrain: source inspection shows full terrain paint/upload on zoom increments. This is a profiling target, not a measured performance failure.
- The three-month fixture did not finish preparing within the bounded inspection window. The fallback had zero shipments, so live freight remains unverified. Subtle ocean motion was observed; no FPS or memory measurements were made.

**Graphics-scoped usability check**

| Heuristic | Score | Key observation |
|---|---:|---|
| System status | 3/4 | Layer, presentation and city identity visible |
| Real-world match | 3/4 | Recognizable places; symbolic scale can confuse |
| Control and freedom | 3/4 | Pan, zoom, fit and view controls available |
| Consistency | 2/4 | Art and marker scale diverge between views |
| Error prevention | n/a | No editing/destructive workflow assessed |
| Recognition | 2/4 | Tiny labels and intrusive badges |
| Flexibility | 3/4 | Several useful viewing modes |
| Aesthetic hierarchy | 2/4 | Uneven detail and annotation emphasis |
| Error recovery | n/a | Error workflows outside this review |
| Help | 2/4 | Legend useful; symbolic scale remains implicit |
| Total | 20/32 | Acceptable in this limited scope; not an art-quality score |

Cognitive load is moderate: regional labels lack hierarchy and ten layer choices are peers, although the main map remains dominant. For a first-time explorer, the literal-looking gardens and buildings obscure the intended symbolic scale. For a low-vision reader, tiny outlined place names are difficult to distinguish. On mobile, badges compete with central city details and the world-fit composition underuses portrait space.

The strongest sequence is annotation fixes, then a landscape coherence pass, then city structure and identity. The current estuary treatment and architectural palette should be kept.

**Questions for the next pass**

1. Prioritize landscape coherence, city character, or both in that order?
2. Should Atlas become an illustrated companion or remain a spare analytical map?
