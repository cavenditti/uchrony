---
name: Uchrony
description: A living atlas with inspectable state dossiers and historical consequences.
colors:
  bg: "#19252b"
  ink: "#e6e7dd"
  muted: "#a8b6b7"
  line: "#354449"
  accent: "#d7b77a"
  green: "#a9c5a1"
  red: "#d6a098"
  ocean: "#304e54"
  inspector: "#202e34"
  button-ink: "#253034"
  button-hover: "#e7c994"
  selected-state: "#31403f"
  field: "#1c2e34"
typography:
  display:
    fontFamily: "Alegreya, Georgia, serif"
    fontSize: "29px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.005em"
  headline:
    fontFamily: "Alegreya, Georgia, serif"
    fontSize: "23px"
    fontWeight: 500
    lineHeight: 1.1
  narrative:
    fontFamily: "Alegreya, Georgia, serif"
    fontSize: "19px"
    fontWeight: 500
    lineHeight: 1.2
  metric:
    fontFamily: "Alegreya, Georgia, serif"
    fontSize: "27px"
    fontWeight: 400
    lineHeight: 1.3
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    lineHeight: 1.5
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 500
  button:
    fontFamily: "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 500
rounded:
  control: "4px"
  floating: "5px"
  dialog: "12px"
spacing:
  compact: "8px"
  related: "12px"
  panel: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.button-ink}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-primary-hover:
    backgroundColor: "{colors.button-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-text:
    textColor: "{colors.accent}"
    padding: "7px 0"
  field:
    backgroundColor: "{colors.field}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 9px"
  state-row-selected:
    backgroundColor: "{colors.selected-state}"
    rounded: "{rounded.control}"
    padding: "9px 8px"
  inspector:
    backgroundColor: "{colors.inspector}"
    padding: "20px"
---

# Design System: Uchrony

## Overview

**Creative North Star: "The cabinet map table"**

Uchrony frames a living atlas with compact, inspectable state dossiers. Blue-green slate, warm pale lettering, restrained brass controls, and muted territorial colors create the character of a working map cabinet. Alegreya gives places and historical records a distinct voice while a quiet sans-serif carries operations and comparable data.

This records the implemented, provisional code-led direction, seed ec4fabee; it is not a claim of user approval. The source is authoritative for the current build. Product mechanisms belong in PRODUCT.md, and the first-surface composition remains in .impeccable/surfaces/src-app-tsx.md.

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

The desktop application fills the dynamic viewport, with independently scrolling side panels and a flexible map. Persistent toolbars and separators establish a continuous workspace. The default columns are (208px / minmax(0, 1fr) / 328px); the topbar is (66px), the facts strip (40px), and primary navigation (47px). These describe the implemented atlas surface, not mandatory dimensions for every future screen.

The recurring rhythm uses compact gaps, related-item spacing, panel padding, and section separation from the frontmatter. Inspector metrics form two columns; data and goods rows align their values to the right. Most dossier sections remain open against their parent surface and are separated by horizontal rules.

- At (1600px) and above, columns expand to (230px / flexible / 360px), with larger panel padding and lettering.
- At (1250px) and below, columns contract to (182px / flexible / 302px).
- At (1050px) and below, the state list becomes a temporary drawer and the main layout becomes a flexible map plus (310px) dossier. Navigation scrolls horizontally.
- At (760px) and below, the map and dossier stack in document flow. The map workspace uses (57dvh), bounded by (380px) and (630px). The state drawer remains accessible; action labels in the header become icon controls with accessible names. Dossier text and targets increase in size.

## Elevation & Depth

Depth comes mainly from adjacent slate tones, fine borders, and selected surfaces. Persistent panels are flat. Floating elements use soft, transparent shadows; map label shadows preserve legibility over geography.

### Shadow Vocabulary

- **Layer menu:** `0 7px 25px #10202355`.
- **Map tooltip:** `0 7px 20px #14282f55`.
- **Toast:** `0 8px 30px #08181f66`.
- **Dialog:** `0 18px 70px #06151f80`, paired with a dark translucent backdrop.
- **State drawer:** `8px 0 30px #0b1c2666`.

**The Cabinet Plane Rule.** Keep persistent workspace panels flat and ruled. Reserve diffuse shadows for floating menus, tooltips, dialogs, and temporary messages.

## Shapes

Controls have small, practical corners; menus and tooltips are only slightly softer. Dialogs use the larger corner token to distinguish temporary tasks. Persistent panels retain straight edges. Fine borders delineate controls and rows; meters use nearly square ends. Dots are reserved for compact status and event markers. Heraldic SVG silhouettes identify states and echo the map’s territorial color.

## Components

### Buttons

Compact, labelled actions sit naturally inside dossiers. Primary buttons use brass with dark ink; secondary buttons are transparent with a muted border. Secondary hover lightens the surface and border; primary hover uses the brighter brass token. Text actions use brass without a surrounding box. Destructive actions use clay text and a matching border. Disabled buttons reduce opacity to (0.4) and use the unavailable cursor.

All interactive controls share a brass focus outline (2px), offset by (3px). Color, background, and border transitions last (0.15s); the reduced-motion media query removes transitions and animations.

### Inputs / Fields

Fields use a recessed slate background, a fine green-gray border, and control corners. Standard fields have minimum height (34px); dialog fields grow to (40px). Labels sit above fields. Policy sliders retain visible values, explanatory text, and brass thumbs. Their track is (4px) high; the mobile slider interaction box grows to (8px).

### Navigation

Primary navigation is a ruled horizontal strip. The active item combines warmer text, a faint brass wash, and a bottom underline (2px). It remains a horizontal scroller at narrow widths. Compact segmented controls for speed and chronicle scope use a selected tonal surface.

### State Rows and Dossiers

State selectors pair a heraldic mark with a name, supporting data, and status. Selection changes the row surface and name color, and reveals a chevron. The inspector is a continuous panel with a serif state heading, numeric summary, ruled sections, and persistent status footer. It is not a standalone card repeated around the canvas.

### Cartographic Controls and Legends

The layer picker, stacked zoom controls, and tooltip use compact dark floating surfaces. Switching themes preserves geography and selection. Quantitative themes include a color ramp, descriptive label, and numeric ticks; terrain uses labeled swatches; trade and military use their rendered line and marker vocabulary. The scale shifts clear of the thematic legend. Icons are SVG components, including the selected layer check.

### Meters and Chronicle

Meters pair a left label and right value with a narrow tonal track. Research emphasis reuses brass. Chronicle entries pair a timestamp and event marker with an Alegreya title and explanatory text, separated by rules. Use actual event categories and available state values rather than decorative indicators.

### Dialogs and Feedback

Native dialogs use a bounded, scrollable slate surface with diffuse shadow and a dimmed backdrop. Ordinary dialogs are (460px) wide and help dialogs (620px), both constrained to the viewport. Toasts use a pale contrasting surface; error feedback shifts toward clay. Motion consists of brief state transitions, a loading spinner, running-state pulse, and a short toast entrance; reduced motion disables these CSS animations.

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
