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
- **A day/night cycle** driven by the park clock: keyframed sun, sky, and fog,
  with every lit fixture coming up together at dusk and lamps casting pools of
  light on the ground. Evening is deliberately brighter than physical accuracy,
  because the park has to stay readable to walk around in.

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

## Heartbeat Observatory / Supabase

Audited against the live database on 2026-08-14, with Jaron's go-ahead.

**Correction to what this file said before:** RLS was *not* unapplied. That
claim came from reading commented-out lines in `supabase/world3-shared-town-v0.sql`
rather than from the database. All 40 public tables have RLS enabled, world3
included. Enabling RLS was never the outstanding task.

**Fixed:** `public.assign_apartment()` was SECURITY DEFINER, took no arguments,
checked nothing, and was callable at `/rest/v1/rpc/assign_apartment` with the
public anon key. When every apartment is full it inserts a new row and returns
it, so anyone could grow `public.apartments` without bound. EXECUTE revoked from
`PUBLIC` (revoking from `anon` alone does nothing — Postgres grants function
EXECUTE to PUBLIC by default), granted back to `service_role`. The
`create_world_character()` trigger function was closed off the same way. Both
advisor lints cleared.

**Still open, none urgent:** six tables have RLS on with zero policies so only
`service_role` can read them — safe, but check whether any page expects data
from them; ~22 other SECURITY DEFINER functions stay callable but were each
verified to check `auth.uid()` internally; `touch_updated_at` has a mutable
search_path; `pg_net` sits in the public schema; leaked-password protection is a
dashboard toggle only Jaron can flip.

**Still to build:**

1. Shared `hb-supabase.js` at the HBO root — the URL and anon key are pasted
   into 15+ files with no shared client. Parkworks must not become the 16th.
2. Identity helper: anonymous device id plus session, reusing the pattern at
   `games/syl/src/multiplayer/multiplayer.js:466`.
3. `parkworks_saves` table and the `createSaveBackend` hook this game already
   looks for. **The game needs no change** — the host page supplies it.

## Reported from play on 2026-08-14

### 1. Guests only ever ride one ride — confirmed bug, already diagnosed

Jaron noticed guests did not move on to a second ride. It is real, and it is
arithmetic rather than pathfinding or rendering:

- `completeService` relieves `fun` by **0.82**, dropping a guest from ~0.85 to
  the 0.03 floor. One ride almost completely satisfies them.
- `fun` regrows at **0.0036/sec** (`updateGuest`).
- `chooseGuestAction` needs `fun > 0.34` to even consider another ride (and then
  only on a 38% roll), or `fun > 0.51` for it to become the top need.
- That is **86 seconds** to reconsider and **134 seconds** to prioritise.
- Guests leave at `lifetime > 155` seconds.

A guest who rides at t=30s cannot reconsider until t=116s, leaving 39 seconds to
decide, walk, queue, and ride — when ride service alone is 12–20 seconds.

**Suggested fix:** drop the fun relief from 0.82 to about **0.30**, leaving a
guest around 0.20 after a ride and wanting another in roughly 40 seconds, which
fits several rides into one visit. Prefer this over lengthening the visit.

**Do not change it in one place.** `src/core/awayReport.ts` mirrors these
constants in `NEED_RELIEF_PER_SERVICE` so offline earnings match live rates; the
two must move together, and `tests/awayReport.test.ts` covers the relationship.

### 2. A "start over" button

Players need a way to abandon a park and begin again. It must **double-confirm**
— a mispress that silently destroys a park people have invested hours in is the
worst possible outcome. The splash already has "Start a new park" for the resume
path (`discardSavedPark`); this is the equivalent for a park already in play.

### 3. Show what each facility charges per guest

Every spec already carries `revenue`. Surface it on the build catalog card and
in the building inspector, so the player can see what a place earns per visit
before and after building it.

### 4. Let players set prices, with demand gated by reputation

Jaron's favourite of the four, and the one that carries the late game: raise a
price and guests weigh it against the park's reputation, so a well-run park can
charge more and a bad one cannot. This is the "bigger boss" lever that makes a
large park feel different from a small one, and it pairs directly with the guest
wallets below — a guest needs money before a price can matter.

## Then, on the game

1. **End-of-day report** — gives the day counter meaning, natural autosave beat.
2. **Guest wallets and per-facility pricing** (needs an ATM). This is the whole
   tycoon genre in one variable, and it is what items 3 and 4 above are built
   on — do these together.
3. **Staff**: janitor, mechanic, entertainer. Litter is currently only
   removable by the player walking over it. Wages create cash-flow pressure.
   Pathfinding already exists for them to use.
4. **Ride breakdowns and reliability**, giving the mechanic a job.
5. **More content** — each item is one `catalog.ts` entry plus one
   `AssetFactory` builder. Also give scenery an appeal *radius* instead of the
   current flat global bonus, so decoration matters where you put it.
6. **Multi-park chain layer.**

## Known and unfixed

- A park day is about 3.4 real minutes, so a short absence advances the calendar
  by dozens of days. Worth addressing when the end-of-day report lands.
- Bins never fill up.
- Guests only look for a bin within 12 metres; otherwise they litter instantly.
- Cash can go negative without limit — there is no bankruptcy or loan.
