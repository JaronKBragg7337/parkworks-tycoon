# Parkworks Tycoon

**[Play it now](https://jaronkbragg7337.github.io/parkworks-tycoon/)** — in a
browser, on a phone, no login and nothing to install.

Parkworks Tycoon is a mobile-first 3D amusement-park management game for the
web. You do not hover above the park issuing orders: you **walk around inside
it**. Build rides and food stalls, draw the paths that connect them, set what
everything charges, and pick up the litter your guests drop — then watch the
gates close at dusk and the day's takings settle overnight.

Built with Three.js and TypeScript. Every asset is generated procedurally in
code; there are no downloaded models.

Also playable inside Heartbeat Observatory at
[/games/parkworks/](https://www.heartbeatobservatory.com/games/parkworks/),
where a signed-in player's park is saved to their account instead of their
browser.

---

## What you actually do

**Walk your park.** Third-person on desktop with WASD and pointer look; on a
phone the left half of the screen is an invisible stick that appears under your
thumb and vanishes when you let go, with the right half for looking around.
There is an overview camera when you want to see the whole site.

**Build it.** Buy adjacent land parcels, draw sidewalks and roads in
touch-friendly one-metre strokes, then place buildings on grid-snapped
footprints with rotation, one-metre nudge buttons, and a ground arrow showing
which side guests walk in from. Everything is quoted before you confirm, and
anything already built can be moved, turned, or sold back at 70%.

**Guests only visit what they can reach.** Attractions with no path to the front
gate are ignored entirely — no queue, no revenue — and connecting one brings it
to life immediately.

**Run it as a business.** Guests arrive carrying money and spend it down. You set
the price of everything that charges, and what you can get away with is governed
by your reputation: a park nobody rates can charge three quarters of the standard
rate, a perfect one can charge double. Push past that and guests walk past the
queue — which lowers reputation, which lowers what you can charge. Nothing
punishes greed directly; the loop closes on its own.

**Keep it clean.** Food comes with packaging. Guests look for a nearby bin and
drop litter when they cannot find one, and litter drags cleanliness down, which
drags reputation down. Walk over it to clear it — or build a **Cleaning Crew**
post and put a janitor on the payroll to walk the paths doing it for you. They
work through the night too, so a park left overnight tidies itself. Wages are
charged every upkeep cycle whether there is litter or not.

**Close up and get paid.** The park trades from 9:00 to 21:00, then the gates
shut, the crowd files out, and the books settle: a fixed subsidy, a share paid on
reputation, and a cut of the day's own takings.

**Leave and come back.** Your park keeps running while you are gone and reports
what happened — guests, revenue, upkeep, litter nobody was there to clear, and
the reputation swing. Offline hours are credited up to eight, are counted only
while the gates would have been open, and are deliberately tuned to earn
slightly *less* than playing, so closing the tab is never the better move.

## What is in it

**Rides** — Willow Line Railway ($1,150), Constellation Carousel ($1,850),
Voltage Bumper Hall ($2,450), Aurora Sky Wheel ($3,200), Copper Corsair pirate
ship ($3,350), Pulse Drop Tower ($3,950), and the Meteor Chase coaster ($5,600).

**Food** — Citrus Press drinks, Moon Scoop Creamery, Copper Bun Kitchen burgers,
and the Ember Stone Pizzeria, from $460 to $1,450 and charging $19 to $52 a head.

**Facilities** — comfort station, first aid, information booth, sorting bins, a
cash machine that lets guests top up (and takes a fee for it), and the Warden
Yard Crew Post that employs a janitor.

**Staff** — one janitor per crew post, walking the same paths guests do at
2.2 m/s and only picking up what is genuinely within arm's reach. Staff are
derived from the buildings that employ them rather than owned separately, so a
park reloads with its crew standing at their posts instead of frozen mid-walk.
Measured on a filthy 18-building park with no bins: **no crew 0% clean, one 61%,
two 76%**. Past two it plateaus, because a little litter ends up further from a
path than a janitor can reach — that is yours to collect, cutting across the
grass where they cannot.

**Park details** — benches, shielded lamps, copper beeches, blossom planters, and
a tiered bronze fountain. Decoration has an **appeal radius**: it flatters what
it stands beside rather than the park in general, so where you put it matters.

**A full day/night cycle** — a keyframed sun, sky, and fog across all
twenty-four hours, with every lamp in the park coming up together at dusk and
the small hours staying moonlit rather than black, because you still walk the
park while it is shut.

**Saves that follow you** — a park is a self-contained document, not a slot tied
to one device. The page decides where it lives: a host site can supply its own
store (a Heartbeat account, say) and the standalone build falls back to this
browser. There is a start-over button behind two confirmations.

## Art and fidelity

Assets are built procedurally in metres from visibly assembled components. Hero
assets carry primary silhouettes, secondary frames, bracing and panels, and
tertiary fasteners, vents, seams, hinges, conduits, trim and decals. Ride pivots
are animated and repeated parts use instancing. Shadows are selective and phone
pixel density is capped.

Materials use physically calibrated roughness and metalness, consistent
metre-scaled UVs, procedural micro and macro variation as an immediate fallback,
and compressed ambientCG CC0 texture maps for grass, paving, concrete, timber and
bark. Full sources and transformations are in
[ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).

## Running it

Requirements: Node.js 24+ and npm.

```bash
npm install
```

```bash
npm run dev
```

The gate before anything ships:

```bash
npm run check
```

That runs the test suite, strict TypeScript, and the production build. `npm run
preview` serves the built output.

## How the code is arranged

| Path | What lives there |
| --- | --- |
| `src/core/` | The simulation and its rules — guests, economy, clock, saves. No Three.js, no DOM, so it is all directly testable. |
| `src/world/` | Procedural geometry, materials, and the sky cycle. |
| `src/game/` | The bridge: scene, camera, placement, and the game loop. |
| `src/ui/` | HUD, build catalog, park office, and the icon set. |
| `src/controls/` | Input, joystick, and camera maths. |
| `tests/` | Vitest suites, mostly against `src/core` maths rather than the renderer. |
| `docs/` | `NEXT.md` is the live working state — read it first when picking this up cold. |

Two rules worth knowing before changing the economy:

- **Rates that govern a visit live once**, in `src/core/needRates.ts`, and both
  the live simulation and the offline projection import them. They used to be
  copied into both and drifted, which is what made guests stop riding.
- **Measure, do not guess.** The wallet range, the ride relief, the offline
  utilisation factor and the daily settlement were all set from measured runs,
  and the numbers behind each are written next to the constant.

## Deploying

Pushing to `main` runs `npm run check` and publishes to GitHub Pages
automatically.

The copy inside Heartbeat Observatory is a **build artifact**, not source. To
refresh it, run `npm run build` here and copy `dist/` into
`heartbeat-observatory/games/parkworks/`, keeping that directory's
`hb-save-backend.js` and re-applying the two script tags its README documents.

## Licence

Original project code and procedural art are dedicated to the public domain
under [CC0 1.0](LICENSE). Three.js is consumed as an MIT-licensed npm dependency,
third-party textures remain CC0 and are individually documented, and the compiled
distribution ships [third-party notices](public/THIRD_PARTY_NOTICES.md).
