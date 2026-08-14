# Still needed

Working state as of 2026-08-14. Read this first if you are picking the project
up cold.

## Where things stand

Live and green: <https://jaronkbragg7337.github.io/parkworks-tycoon/>
Push to `main` runs `npm run check` and deploys to Pages automatically.

Shipped in the last two commits:

- Saves that resume, with a **pluggable backend**. The game never imports
  Supabase; it calls `resolveSaveBackend`, which looks for
  `window.HeartbeatObservatory.createSaveBackend(gameId)` and falls back to
  `localStorage`. This is the seam that lets the same source run standalone and
  inside Heartbeat Observatory.
- An **away report** on return, projected from the park's own service rates and
  capped at eight hours of credit.
- **Sell, move, and rotate** already-placed buildings, plus a ground **facing
  arrow** during placement and selection.
- **One-metre nudge buttons** beside Rotate, camera-relative.
- **Both growth ceilings removed** — see "No ceiling" in [DESIGN.md](DESIGN.md).

110 tests pass.

## The direction

An endless solo tycoon. A park that outgrows its land should promote the player
to running several, with a holding-company layer over the top: decisions,
lawsuits, insurance, moving staff between parks, selling a park that is not
working. Different verbs, same world.

Two things already point at this and should not be broken:

- `computeAwayProgress` in `src/core/awayReport.ts` projects a park running
  while nobody watches it. That is the same problem as "park A while you stand
  in park B" — the chain layer is mostly a different trigger for existing code.
- A save is a **self-contained portable document**. A chain is a list of them.
  No save-format change is needed to get there.

## Heartbeat Observatory / Supabase — do this first

HBO's Supabase project is live and already handles auth sessions and realtime
presence. No game has ever written *state* to it.

Measured: the Supabase URL and anon key are copy-pasted into **15+ files** with
no shared client module. An anonymous device-id fallback already exists in
`games/syl/src/multiplayer/multiplayer.js` around line 466.

1. Shared `hb-supabase.js` at the HBO root — one client, imported everywhere.
2. Identity helper: anonymous device id plus session, reusing the SYL pattern.
3. `parkworks_saves` table and the `createSaveBackend` hook this game already
   looks for. **The game needs no change** — the host page supplies it.
4. Enable RLS, including the policies still commented out in
   `supabase/world3-shared-town-v0.sql`.
5. Audit what the public anon key currently exposes.

**Items 4 and 5 touch the live database and existing world3 data. Show Jaron
exactly what a migration or policy change does and get an explicit yes before
applying it.** Nothing has been approved against the running project yet.

## Then, on the game

1. **Day/night** from the existing 9am–9pm clock, which currently changes
   nothing visually, plus lamps on at dusk.
2. **End-of-day report** — gives the day counter meaning, natural autosave beat.
3. **Guest wallets and per-facility pricing** (needs an ATM). This is the whole
   tycoon genre in one variable.
4. **Staff**: janitor, mechanic, entertainer. Litter is currently only
   removable by the player walking over it. Wages create cash-flow pressure.
   Pathfinding already exists for them to use.
5. **Ride breakdowns and reliability**, giving the mechanic a job.
6. **More content** — each item is one `catalog.ts` entry plus one
   `AssetFactory` builder. Also give scenery an appeal *radius* instead of the
   current flat global bonus, so decoration matters where you put it.
7. **Multi-park chain layer.**

## Known and unfixed

- A park day is about 3.4 real minutes, so a short absence advances the calendar
  by dozens of days. Worth addressing when the end-of-day report lands.
- Bins never fill up.
- Guests only look for a bin within 12 metres; otherwise they litter instantly.
- Cash can go negative without limit — there is no bankruptcy or loan.
