# Parkworks Tycoon

[Play Parkworks Tycoon](https://jaronkbragg7337.github.io/parkworks-tycoon/) —
public, no login, and no installation required.

Parkworks Tycoon is a mobile-friendly 3D amusement-park management game for the
web. Walk the park yourself, construct attractions and services, earn money
from guests, and keep litter under control before cleanliness damages the
park's reputation.

This repository is the standalone game build. It is deliberately separate from
Heartbeat Observatory until the gameplay slice and mobile performance are
validated. Its production bundle uses relative paths so it can later be copied
under `heartbeat-observatory/games/parkworks-tycoon/` without changing source.

## Playable systems

- Third-person walking with WASD/arrow keys and mouse/pointer look.
- Dynamic touch stick: the left half of the screen is invisible at rest; touch
  it to reveal the stick under the thumb. The right side remains available for
  camera look, and pointer release/cancel immediately clears movement.
- Build catalog with three food stations, five rides, three staffed facilities,
  waste services, benches, shielded lamps, and mature shade trees.
- Buy seven adjacent land parcels, then draw sidewalks and park roads in
  one-metre touch-friendly strokes. Construction is quoted before confirmation,
  and parcels unlock only from land you already own.
- Grid-snapped object construction with owned-land checks, path conflicts,
  footprint collision, rotation, confirmation, cancellation, and refunds.
- Deterministic guests with hunger, fun, bladder, rest, happiness, queuing,
  facility capacity, service time, spending, and departure states.
- Guests travel the connected road/sidewalk graph from the front gate. They do
  not target, queue at, or generate revenue from a disconnected attraction;
  drawing a route to a prebuilt facility activates it immediately.
- Food packaging becomes carried waste. Guests find a nearby bin or drop litter;
  the player cleans litter by walking close to it. Cleanliness changes live.
- Park cash, construction expense, upkeep, revenue, reputation, attendance,
  day clock, and opening objectives. Attendance is limited by what the park can
  attract rather than by a fixed ceiling, and reputation tracks how guests
  actually leave, so neither stat stops moving as the park grows.
- One-metre nudge buttons beside Rotate, because a fingertip covers several
  metres of ground and the last metre of alignment has to be precise.
- Parks save themselves and resume where you left off. The store is chosen by
  the page: a host site can supply its own (a Heartbeat account, say), and the
  standalone build falls back to this browser. Saves are self-contained
  documents, so a park is portable rather than tied to one device.
- An away report on return, projected from the park's own service rates: guests,
  revenue, upkeep, litter dropped with nobody there to clean it, and the
  reputation swing. Offline time is credited up to eight hours.
- Already-placed buildings can be selected, turned, moved, or sold back at 70%.
  A ground arrow marks the side guests approach from, both while placing and
  while editing, so a thumb over the model never hides which way it faces.

## Art and fidelity

Assets are built procedurally in metres from visibly assembled components.
Hero assets include primary silhouettes, secondary frames/bracing/panels, and
tertiary fasteners, vents, seams, hinges, conduits, trim, and decals. Carousel
and sky-wheel pivots are animated; repeated ride parts use instancing. Shadows
are selective and phone pixel density is capped.

Materials use physically calibrated roughness and metalness, consistent
metre-scaled UVs, procedural micro/macro variation as an immediate fallback,
and compressed ambientCG CC0 texture maps for grass, paving, concrete, timber,
and bark. Full sources and transformations are in
[ASSET_PROVENANCE.md](ASSET_PROVENANCE.md).

## What is next

[docs/NEXT.md](docs/NEXT.md) carries the working state: what has shipped, the
direction, the Heartbeat Observatory and Supabase steps to take first, and the
known gaps. Read it before picking the project up cold.

## Local development

Requirements: Node.js 24+ (or Bun) and npm.

```powershell
npm install
npm run dev
```

Production verification:

```powershell
npm run check
```

`npm run check` runs deterministic simulation/input/asset tests, strict
TypeScript, and the Vite production build. `npm run preview` serves the output.

## Hosting later in Heartbeat Observatory

Do not copy source or `node_modules`. After `npm run build`, copy the contents
of `dist/` into `games/parkworks-tycoon/` in the Heartbeat Observatory repo and
add the game to its existing game index. Verify the exact production URL from a
390 × 844 phone viewport before publishing the integration.

## License

Original project code and procedural art are dedicated to the public domain
under [CC0 1.0](LICENSE). Three.js is consumed as an MIT-licensed npm dependency.
Third-party texture assets remain CC0 and are individually documented. The
compiled distribution includes [third-party notices](public/THIRD_PARTY_NOTICES.md).
