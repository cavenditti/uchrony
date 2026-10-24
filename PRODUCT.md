# Uchrony

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Provisional choice while the optional stack question is pending: TypeScript, React, Vite, a Canvas map, and a dedicated simulation Web Worker. Local browser execution; no backend or account required.

## Users

Carlo wants to build and explore a detailed world-history simulation. Broader audiences remain undecided.

## Product Purpose

Simulate population dynamics, resources, goods routes, military action, diplomacy, policies, resource allocation, and technological research on a generated or real map.

## Operating Context

Reference: https://youtu.be/aobeydG8Sd4 — Aprento, “1,080 Years in Fantasy Map Simulator | Timelapse.” Title and description verified; video playback unavailable during initial inspection.

## Capabilities and Constraints

The user accepts a fictional generated map. The initial implementation uses reproducible generated geography and fictional states. Monthly ticks connect production, transport, consumption, fiscal policy, demography, research, diplomacy, and warfare. The model is a synthetic sandbox, not a calibrated historical forecast.

Assumed initial interaction: autonomous observer with optional direct intervention and country control. Assumed desktop-first browser use, with a usable mobile inspection layout. These preferences were asked and remain open until the user responds.

## Product Principles

- Consequences must come from shared simulation state rather than cosmetic counters.
- Every action should expose its cost, prerequisite, and measurable result.
- Worlds must be reproducible, inspectable, and portable through versioned saves.
- Clearly distinguish modeled mechanisms from historical realism and future extensions.
