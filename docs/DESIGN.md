# Vertical-slice design

## Core loop

```text
build services → guests arrive → guests spend → food makes waste
       ↑                                           ↓
reinvest revenue ← attendance/reputation ← cleanliness
```

The player is physically present in the park. This gives litter and layout a
human scale: management is not only a spreadsheet, and cleaning a bad patch of
the park has an immediate spatial cost.

## Reference principles

OpenRCT2 and FreeRCT were reviewed as GPL research references. Parkworks does
not include their code, proprietary game data, graphics, sounds, names, or
layouts. The slice reimplements broad genre principles:

- Guest needs create demand for attractions, food, restrooms, and benches.
- Finite capacity produces queues and throughput limits.
- Food purchases have a delayed environmental consequence.
- Cleanliness feeds into satisfaction, reputation, and future attendance.
- Construction and upkeep make expansion a cash-flow decision.

## Real-world scale

- Adult character: about 1.7 m.
- Service counters: about 0.95–1.0 m.
- Doors: about 0.9 × 2.1 m.
- Rails: about 1.0–1.1 m.
- The build grid is one metre.
- UV density is based on metres rather than arbitrary per-object stretching.

## Mobile budgets

The baseline targets a phone-class 30 FPS experience:

- Pixel ratio capped at 1.35 on touch or low-memory devices.
- One 1024² directional shadow, no post-processing.
- 42 guests maximum; starter parks remain lower.
- Repeated structural details are instanced where they dominate mesh count.
- Runtime CC0 maps use 1024 px color and 512 px normal/roughness/AO derivatives.
- Source archives and displacement maps are excluded from the shipped build.

Future production optimization should pack roughness/AO/metalness into shared
ORM textures and convert to KTX2/Basis after visual values are locked.

## Next milestones

- Path construction and explicit connectivity validation.
- Facility inspector, configurable prices, operating status, and demolition.
- Finite bin fill level plus manual emptying.
- Staff hiring: janitor and mechanic.
- Save schema, local persistence, and resumable objectives.
- Audio, haptics, richer guest feedback, and accessibility settings.
- Exact Heartbeat Observatory integration and public-device performance pass.
