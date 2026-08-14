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

## Persistence

A save is a self-contained document: owned parcels, run-length encoded path
surfaces, every placed building, the books, and any litter left behind. Guests
are not saved; they are transient, and a park between sessions has none.

The game never imports a database client. It asks the page for a store through
`resolveSaveBackend`, so Heartbeat Observatory's shell can hand it a
cloud-backed one tied to the player's Heartbeat identity while the standalone
build quietly falls back to this browser. One codebase, both homes.

Offline progress is a closed form derived from the live constants in
`ParkSimulation`, not invented rates: needs grow at the same speed, facilities
serve at their real throughput, and upkeep still lands. It is an upper bound for
a well-connected park, and credited time is capped at eight hours.

## No ceiling

The slice originally stopped growing about twenty minutes in. Two limits did
that, and both are gone:

- **Reputation used to saturate.** It accumulated a fixed amount per service and
  per happy departure, which moved any busy park from 38 to 100 in about nine
  minutes and then meant nothing. It is now an exponential average over the
  happiness guests leave with, so it keeps responding forever: a park that grows
  past what it can serve is felt straight away, and a park held at 90 is a park
  genuinely being run well.
- **Attendance used to cap at 42**, reached at 111 appeal — roughly three large
  rides. That number was a phone rendering budget, not a design decision, so it
  now governs drawing only. The simulation admits up to 600 guests and
  `ParkGame.visibleGuests` draws the nearest 42 on touch devices or 90 on
  desktop. Guests off screen still queue, spend, and litter.

Remaining: a park day is about 3.4 real minutes, so short absences advance the
calendar by dozens of days. That wants addressing when days carry an end-of-day
report.

## Beyond one park

The intended long arc is that a park which outgrows its land promotes the player
to running several. Saves are already self-contained portable documents for this
reason: a chain is a list of them plus a holding-company layer of decisions the
individual parks feed into. Nothing in the current save format has to change to
get there.

## Next milestones

- Facility pricing and guest wallets.
- Finite bin fill level plus manual emptying.
- Staff hiring: janitor and mechanic.
- Day/night lighting driven by the existing clock, and an end-of-day report.
- Multi-park ownership: a chain layer over several saved parks.
- Audio, haptics, richer guest feedback, and accessibility settings.
- Exact Heartbeat Observatory integration and public-device performance pass.
