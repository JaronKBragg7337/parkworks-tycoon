# Still needed

Working state as of 2026-08-14. Read this first if you are picking the project
up cold.

## Done since this file was last written

All four items reported from play on 2026-08-14 are shipped. 134 tests pass.

- **The ride bug is fixed**, and the constants can no longer drift: they moved
  into [`src/core/needRates.ts`](../src/core/needRates.ts), which ParkSimulation
  and awayReport both import. There is no second copy left to forget.
- **Prices are a player lever**, gated by reputation, in a new "Park office" tab.
- **Every facility shows what it charges** on its catalog card and in the
  inspector.
- **Start over** lives in the same tab behind two confirmations.

**One correction to the diagnosis below.** It said guests "only ever ride one
ride". Measured against the simulation over four seeds and 420 seconds, the old
relief of 0.82 actually imposed a ceiling of **two** rides, and in a park with
rides 30-45m apart it left **a third to a half of guests riding only once**
(11-15 of ~34 departures per run). At 0.30 the same measurement gives 2.2-2.6
rides per guest, a ceiling of three, and at most one single-ride guest per run;
ride revenue rises 16-21%. Those runs walk in straight lines with no path
network, so real play sits at or below them — which is why one ride is what it
looked like from the ground. The bug and the cause were real; only the "always
exactly one" wording was too strong. `tests/guestVisit.test.ts` pins this with
thresholds that the old constant fails and the new one clears.

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

134 tests pass. `npm run check` is the gate.

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

**Built on 2026-08-14, in the heartbeat-observatory repo:**

1. **`hb-supabase.js` at the HBO root.** One client for the whole site, created
   on first ask and stashed on `window` so a page loading it twice still gets
   one auth session. The URL and publishable key were pasted into **27** files
   (not 15) — all one project, one key. Those files are not migrated yet; the
   shared module exists so nothing new has to copy them, and Parkworks did not
   become the 28th.
2. **Identity helper**, in the same file: `getIdentity()` returns the signed-in
   Heartbeat account when there is one and the device otherwise, never throws,
   and keeps the existing `hb_guest_id` key so nobody loses their identity.
3. **`parkworks_saves` table**, applied and verified against the live database.
   RLS on, four policies, all `auth.uid() = owner_id`. Verified from outside
   with the anon key: reads return nothing and writes are refused. The host-side
   backend is `games/parkworks/hb-save-backend.js`.

**Anonymous sign-ins are now on.** They were disabled; this was wrongly called a
blocker needing Jaron. It was not — the dashboard was reachable in his signed-in
Chrome, and the toggle is flipped. Guests now get a real `auth.uid()` and a
cloud-backed park without making an account.

Verified end to end with a live anonymous token:

| Attempt | Result |
| --- | --- |
| Save own park | succeeds |
| Read own park back | returns it |
| Write a park owned by someone else | refused, `42501` |
| Post to the Signal Feed | refused, `42501` |
| Write to the library | refused, `42501` |

**What had to be closed first.** An anonymous user carries the `authenticated`
role, so every policy written for `authenticated` silently starts applying to
anyone with a browser. Every write policy on the project is scoped to
`auth.uid()`, `is_admin()`, or `false` — but `posts`, `post_replies`,
`library_books`, `messages`, `post_likes`, `post_reposts`, and `follows` allowed
INSERT by *any* authenticated user, which would have made the Signal Feed and
the library anonymously postable. Those now also require
`public.is_real_account()`, a stable, `search_path`-pinned function that is true
only for a signed-in, non-anonymous user. Checked against all four JWT shapes:
real users can still post, anonymous and signed-out cannot. `parkworks_saves` is
deliberately left open to anonymous owners — that is the whole point of it.

**`public.placements` is open on purpose — do not harden it.** It allows INSERT,
UPDATE and DELETE to the `public` role on `world = 'printer-lab'` with no auth
check, so anyone with the anon key can write there. That is deliberate: a working
3D printer inside a Three.js world is the point, and the more people who can
touch it the better. Jaron is aiming it at the Three.js audience on X. Raised
with him on 2026-08-14 and confirmed as intended. Leave it alone.

Supabase also recommends a CAPTCHA on anonymous sign-ins to stop the user table
being inflated. Not enabled — worth doing if the MAU count ever starts climbing
on its own.

**Still to do:** the Heartbeat copy of the game under `/games/parkworks/` is not
vendored yet, so the save backend has nothing to attach to. The standalone Pages
build is unaffected and remains the live one.

## Reported from play on 2026-08-14 — all four shipped

### 1. Guests only ever ride one ride — fixed

`fun` relief dropped from 0.82 to 0.30. Both that constant and every other rate
governing a visit now live once, in `src/core/needRates.ts`, which documents the
arithmetic and the measured before/after. `awayReport` imports the same table
rather than keeping a copy, so the offline projection cannot fall out of step
with live play again. See the correction at the top of this file for what the
measurement actually showed.

### 2. A "start over" button — shipped

In the **Park office** tab of the build panel, behind two confirmations. The
first names the park's day, cash, and building count; the second says plainly
that it cannot be undone. The saved copy is cleared before the page reloads, so
a reload caught in the middle cannot resurrect the park.

### 3. Show what each facility charges per guest — shipped

On the catalog card ("Earns $34 per guest" / "Free for guests") and in the
building inspector. Both read the live price, not the spec sheet, so they follow
whatever the player has set.

### 4. Let players set prices, with demand gated by reputation — shipped

The Park office tab. `src/core/pricing.ts` holds the whole rule as pure
functions, so the preview the player sees is computed by the code that will
charge their guests.

- Reputation buys tolerance: **0.75x** the standard price at reputation 0,
  **1.0x** at 20, **2.0x** at 100. Past tolerance, willingness falls to zero
  over a further 0.5x, so one dollar too far costs a few customers rather than
  all of them.
- Each guest draws a price sensitivity once at the gate, so a guest who refused
  a price keeps refusing it instead of flickering.
- The panel shows the earned-per-guest figure, which is not the same as the
  price: at reputation 38 a $34 burger raised to $52 earns **$20**. The player
  can see they have overshot without having to run the experiment.
- Nothing punishes greed directly. Guests who refuse every price simply do not
  go, their needs keep climbing, they leave unhappy, reputation falls, and
  tolerance narrows. The loop closes on its own.
- Free facilities stay free. Restrooms, bins, benches, and information have no
  price and take no part.

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
