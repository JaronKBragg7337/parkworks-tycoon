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
- Build catalog with two food stations, two rides, a restroom, sorting bin,
  bench, shielded lamp, and mature shade tree.
- Grid-snapped construction preview with footprint collision, rotation,
  confirmation, cancellation, purchase, and refund behavior.
- Deterministic guests with hunger, fun, bladder, rest, happiness, queuing,
  facility capacity, service time, spending, and departure states.
- Food packaging becomes carried waste. Guests find a nearby bin or drop litter;
  the player cleans litter by walking close to it. Cleanliness changes live.
- Park cash, construction expense, upkeep, revenue, reputation, attendance,
  day clock, and opening objectives.

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
