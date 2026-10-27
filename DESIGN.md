---
name: Uchrony
description: A living atlas with inspectable state dossiers and historical consequences.
colors:
  bg: '#19252b'
  ink: '#e6e7dd'
  muted: '#a8b6b7'
  line: '#354449'
  accent: '#d7b77a'
  green: '#a9c5a1'
  red: '#d6a098'
  ocean: '#304e54'
  inspector: '#202e34'
  button-ink: '#253034'
  button-hover: '#e7c994'
  selected-state: '#31403f'
  field: '#1c2e34'
typography:
  display:
    fontFamily: 'Alegreya, Georgia, serif'
    fontSize: '29px'
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: '0.005em'
  headline:
    fontFamily: 'Alegreya, Georgia, serif'
    fontSize: '23px'
    fontWeight: 500
    lineHeight: 1.1
  narrative:
    fontFamily: 'Alegreya, Georgia, serif'
    fontSize: '19px'
    fontWeight: 500
    lineHeight: 1.2
  metric:
    fontFamily: 'Alegreya, Georgia, serif'
    fontSize: '27px'
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '13px'
    lineHeight: 1.5
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '11px'
    fontWeight: 500
  button:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif'
    fontSize: '12px'
    fontWeight: 500
rounded:
  control: '4px'
  floating: '5px'
  dialog: '12px'
spacing:
  compact: '8px'
  related: '12px'
  panel: '20px'
  section: '24px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.button-ink}'
    rounded: '{rounded.control}'
    padding: '7px 12px'
  button-primary-hover:
    backgroundColor: '{colors.button-hover}'
  button-secondary:
    backgroundColor: 'transparent'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '7px 12px'
  button-text:
    textColor: '{colors.accent}'
    padding: '7px 0'
  field:
    backgroundColor: '{colors.field}'
    textColor: '{colors.ink}'
    rounded: '{rounded.control}'
    padding: '7px 9px'
  state-row-selected:
    backgroundColor: '{colors.selected-state}'
    rounded: '{rounded.control}'
    padding: '9px 8px'
  inspector:
    backgroundColor: '{colors.inspector}'
    padding: '20px'
---

# Design System: Uchrony

## Overview

**Creative North Star: "The cabinet map table"**

Uchrony frames a living atlas with compact, inspectable state dossiers. Blue-green slate, warm pale lettering, restrained brass controls, and muted territorial colors create the character of a working map cabinet. Alegreya gives places and historical records a distinct voice while a quiet sans-serif carries operations and comparable data.

This records the implemented, provisional code-led direction, seed ec4fabee; it is not a claim of user approval. The source is authoritative for the current build. Product mechanisms belong in PRODUCT.md, and the first-surface composition remains in .impeccable/surfaces/src-app-tsx.md.

The illuminated-atlas map treatment is a first trial accepted for exploration on 25 October 2026, inspired by Matrakçı Nasuh’s city miniatures. It changes the landscape and town materials locally; it does not replace the cabinet-map interface or establish permanent approval of this art direction.

**Key Characteristics:**

- Geography remains the dominant visual field.
- Ruled, dense dossiers make quantities and costs comparable.
- Brass identifies actions, focus, and selection.
- Alegreya distinguishes places, narrative, and prominent figures from operational labels.

## Colors

The palette combines slate blue-green framing, warm pale text, brass actions, and subdued cartographic hues. Frontmatter values are normative; the canvas additionally uses data-driven territorial and thematic colors.

### Primary

- **Brass** (`accent`): primary buttons, selected research, active navigation underline, and focus outlines.

### Secondary

- **Sage** (`green`): positive changes and favorable relationships.
- **Clay** (`red`): negative changes and conflict-related feedback. Labels and symbols provide meaning alongside color.

### Neutral

- **Deep slate** (`bg`): application background.
- **Warm pale ink** (`ink`) and **mist ink** (`muted`): primary and supporting text.
- **Slate rule** (`line`): persistent structural separators.
- **Dossier slate** (`inspector`) and **recessed field** (`field`): bounded work areas and editable controls.
- **Ocean** (`ocean`): continuous cartographic background, distinct from application chrome.
- **Selected state** (`selected-state`): a local selection surface in the country list.

**The Brass Action Rule.** Use brass for primary actions, active controls, and keyboard focus; territorial colors communicate the map’s data.

### Provisional map-local pigments — 25 October 2026

The trial uses jade and ochre ground, lapis-blue water, pale masonry, vermilion/turquoise/slate roofs, and restrained gold civic finials. The implementation source is `src/map/illuminated-palette.ts`; these are local scenery colors, not additions to the global frontmatter token set. Terrain pigment enhancement is enabled for Terrain and disabled for thematic land fills; thematic river color remains restrained. Data-layer meaning continues to take precedence.

**The Map-local Trial Rule.** Keep the illuminated pigments and miniature materials local to the map trial; preserve slate controls, brass actions, Alegreya lettering, and the meaning of thematic data colors.

## Typography

**Display Font:** self-hosted Alegreya, with Georgia and serif fallbacks.
**Body Font:** the platform sans-serif stack recorded in frontmatter.

The serif gives geography and history a literary character; the sans-serif makes operational information compact and comparable. The typography is role-specific, rather than a geometric modular scale.

### Hierarchy

- **Display:** map title; grows to (34px) at the wide breakpoint and contracts to (25px) on mobile.
- **Headline:** state dossier title; (26px) wide, (22px) compact desktop, and (25px) mobile.
- **Narrative:** chronicle entry titles; (22px) mobile.
- **Metric:** prominent dossier values; (30px) mobile. Leading domain totals use Alegreya (36px) with line height (1.2).
- **Body:** inherited application baseline. Data rows use (11px), increasing to (12px) on mobile; explanatory notes have a maximum measure of (65ch).
- **Title:** compact section titles and row names.
- **Button:** operational action labels. Primary button labels use weight (600).

Numeric tables, data rows, metrics, and simulation statistics use tabular figures. Canvas country labels adapt to territorial size and map zoom; they are not a fixed interface type role. Existing very small auxiliary labels are not a reusable typography standard.

**The Two Voices Rule.** Use Alegreya for place names, prominent values, and historical narrative; use the operational sans-serif for controls and comparable rows.

## Layout

The atlas fills the dynamic viewport beneath a single (54px) header, reduced to (50px) on mobile. Global statistics, view navigation, background generation, map overlays and saving no longer occupy stacked full-width bars. The palette, heraldry, serif/sans roles and dossier data styling remain the incumbent visual system.

Temporary controls sit over the geography: States and Explore at the upper left, map layers at the upper right, a floating clock at bottom center, zoom controls at lower right, and scale/map key at lower left. States opens a (286px) searchable drawer and collapses after selection. A province click opens a compact contextual action panel; full dossiers appear only when requested. State selection frames its territory in the map area left visible by the dossier.

Dossiers occupy an independently scrolling right panel (366px), expanding to (400px) on wide screens. The expand control permits up to (740px) for detailed work. A local section selector replaces global view tabs, and stability is part of the country subtitle instead of another section bar. World comparisons use a separate nonmodal panel up to (1040px). Import, export, generation, conditions and help live in the world menu; generation and saving status live in Activity. A saving failure retains a visible warning and a notification.

At (760px) and below, the map remains full-height while dossiers become sheets below the map controls and above the clock. States remains a collapsible drawer. Header actions use icons with accessible labels, and long layer names truncate within the available width. The underlying camera size stays stable when panels open or close. Menus dismiss outside or with Escape; the map supports keyboard pan/zoom and two-pointer pinch zoom. Reduced motion retains the existing project behavior.

## Elevation & Depth

Depth comes mainly from adjacent slate tones, fine borders, and selected surfaces. Persistent panels are flat. Floating elements use soft, transparent shadows; map label shadows preserve legibility over geography.

### Shadow Vocabulary

- **Layer menu / contextual popover:** `0 10px 34px #081a2270`.
- **Map tooltip:** `0 7px 20px #14282f55`.
- **Toast:** `0 8px 30px #08181f66`.
- **Dialog:** `0 18px 70px #06151f80`, paired with a dark translucent backdrop.
- **State drawer:** `0 10px 34px #0b1b2266`.
- **Dossier / comparison panel:** `0 12px 38px #081a2270`.
- **Floating clock:** `0 8px 28px #081a2266`.

**The Cabinet Plane Rule.** Keep persistent workspace panels flat and ruled. Reserve diffuse shadows for floating menus, tooltips, dialogs, and temporary messages.

## Shapes

Controls have small, practical corners; menus and tooltips are only slightly softer. Dialogs use the larger corner token to distinguish temporary tasks. Persistent panels retain straight edges. Context panels use (8px) corners, while fine borders delineate controls and rows; meters use nearly square ends. Dots are reserved for compact status and event markers. Heraldic SVG silhouettes identify states and echo the map’s territorial color.

## Components

### Buttons

Compact, labelled actions sit naturally inside dossiers. Primary buttons use brass with dark ink; secondary buttons are transparent with a muted border. Secondary hover lightens the surface and border; primary hover uses the brighter brass token. Text actions use brass without a surrounding box. Destructive actions use clay text and a matching border. Disabled buttons reduce opacity to (0.4) and use the unavailable cursor.

All interactive controls share a brass focus outline (2px), offset by (3px). Color, background, and border transitions last (0.15s); the reduced-motion media query removes transitions and animations.

### Inputs / Fields

Fields use a recessed slate background, a fine green-gray border, and control corners. Standard fields have minimum height (34px); dialog fields grow to (40px). Labels sit above fields. Policy sliders retain visible values, explanatory text, and brass thumbs. Their track is (4px) high; the mobile slider interaction box grows to (8px).

### Navigation

Explore offers domain views in a lightweight menu; the active dossier section is selected locally in its header. World comparisons keep their own horizontal tabs. The compact clock exposes play/pause, direct 1×, 2×, 4× and Max buttons, and monthly stepping, with annual stepping in its menu. Selected pace uses brass text and an inset underline. Max is labelled as approximate six-month simulation; histories that have used it retain an approximation label after pausing or returning to monthly play. On mobile the date and status sit above one row of controls. The existing chronicle scope controls retain their tonal selected state.

### State Rows and Dossiers

State selectors pair a heraldic mark with a name, supporting data, and status. Selection changes the row surface and name color, and reveals a chevron. The inspector is a contextual panel with a serif state heading, numeric summary and ruled sections. Its duplicate section heading and persistent status footer are removed; the section selector and country subtitle carry orientation and stability. It can expand or dismiss without resizing the map.

### Cartographic Controls and Legends

The layer picker, stacked zoom controls, and tooltip use compact dark floating surfaces. Switching themes preserves geography and selection. Quantitative themes include a color ramp, descriptive label, and numeric ticks; terrain uses labeled swatches; trade and military use their rendered line and marker vocabulary. The map key opens its legend above the scale instead of keeping all symbols visible. Icons are SVG components, including the selected layer check.

The default map is now a flat quadtree view, with Terrain as its initial layer. Actual adaptive leaf boundaries remain visible over land and water; occupied building footprints carry stable roof-pigment variation, vacant housing remains visible, and funded construction has dashed brass outlines. Cells refine across developed parcels and coarsen after a dwell period. Hover and inspection identify the physical cell and its residents, while close zoom suppresses country labels. New frontier development uses persistent, freely positioned buildings with varied footprints and parcel sizes along local lanes and established trade-road frontages. Lanes favor gentler terrain and contour directions; compact settlements use smaller setbacks and greater housing capacity near their center. Buildings do not snap to the quadtree: occupied development can refine to 8 m cells, while settlement outlines emerge from connected occupied lots. The economy stays at district level, and existing saves retain recorded building geometry. Building picking and metre-scale zoom reveal this detail without filling a city-sized rectangle.

The 3D landscape remains an optional presentation and initializes only when selected. Returning to Quadtree releases its scene. Existing slate controls, brass actions, Alegreya labels, thematic layers and dossiers retain their roles. WebGL failure returns to Quadtree. The map key explains occupied homes, vacancy and construction without adding a permanent panel. Geography still uses the existing terrain samples; more varied terrain generation is a separate next step. See [map rendering](docs/MAP_RENDERING.md) for implementation and validation limits.

Local lanes and land trade routes appear by default as unpaved ground pigment, with soft shoulders and broken wheel wear. The same procedural canvas treatment paints the flat map and the relief terrain overlay; roads do not use extruded scenery pieces. Shared land edges are painted once, and physical paths remain visible with the freight overlay off. The Trade layer adds a tonnage-based quantity highlight and dims unrelated shipments while emphasizing the selected state's or province's imports and exports. Shipping retains warm dashed lines and hollow harbor markers. Cargo dots follow actual travel direction at a constant screen speed and stop when paused or reduced motion is requested. The dossier explains cargo, distance, and harbor transfers without requiring map hover.

### Illuminated-atlas map trial

The existing 3D geography and deterministic towns receive a matte mineral-pigment treatment. Procedural wall grain, arched windows, fine architectural edge lines, and tiled roofs reveal detail at close range; distance filtering softens the smaller marks. Rounded and slender foliage, sparse animated brush-wave marks, and a small gold civic accent support the miniature character. Lighting still describes relief and architecture. Atlas coastline strokes stay fine in screen space; the 3D terrain-texture coastline retains its existing footprint.

This trial adds no panel or sourced/generated shipping raster artwork. Existing code-native geography, selection, camera controls, shared scenery motion, pause/reduced-motion behavior, and town cache limits remain the context. It is an invitation to judge the result, not a permanent global visual replacement. Trial evidence and its performance limits are recorded in [map rendering](docs/MAP_RENDERING.md#illuminated-atlas-trial--25-october-2026).

### Meters and Chronicle

Meters pair a left label and right value with a narrow tonal track. Research emphasis reuses brass. Chronicle entries pair a timestamp and event marker with an Alegreya title and explanatory text, separated by rules. Use actual event categories and available state values rather than decorative indicators.

### Dialogs and Feedback

Native dialogs use a bounded, scrollable slate surface with diffuse shadow and a dimmed backdrop. Ordinary dialogs are (460px) wide and help dialogs (780px), both constrained to the viewport. Toasts use a pale contrasting surface; error feedback shifts toward clay. Motion consists of brief state transitions, a loading spinner, running-state pulse, and a short toast entrance; reduced motion disables these CSS animations.

## Do's and Don'ts

### Do:

- **Do** keep active state visible through an underline, selected surface, or border in addition to color.
- **Do** pair quantitative map ramps with labels and ticks, and categorical layers with their actual symbols.
- **Do** align numeric columns to the right and use tabular figures for changing quantities.
- **Do** retain visible brass keyboard focus and reduced-motion behavior.
- **Do** use actual SVG icons and the existing heraldic marks.

### Don't:

- **Don't** apply the primary-action fill to every row or panel.
- **Don't** replace ruled dossiers with a repeated grid of floating cards.
- **Don't** use territorial colors as arbitrary interface decoration.
- **Don't** generalize the smallest incidental status labels into a text-size standard.
