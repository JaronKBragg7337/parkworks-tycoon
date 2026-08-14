# Handoff prompt

Paste the block below into a fresh Claude Code session to resume work.

---

We're continuing work on Parkworks Tycoon, a mobile-first 3D park management
game in Three.js + TypeScript. Live at
https://jaronkbragg7337.github.io/parkworks-tycoon/ , source at
https://github.com/JaronKBragg7337/parkworks-tycoon

**Read `docs/NEXT.md` in that repo first — it has the full working state, the
numbers behind the open bug, and the Supabase audit results.**

Where we are: Codex originally built it; over the last two days we added park
saves with a pluggable backend, an away report, sell/move/rotate for placed
buildings, a placement facing-arrow and one-metre nudge pad, removed both growth
ceilings, and added a day/night cycle. 121 tests pass, `npm run check` is the
gate, and pushing to main auto-deploys to Pages.

The direction: an endless solo tycoon. A park that outgrows its land should
promote me to running several parks, with a holding-company layer over the top —
decisions, lawsuits, moving staff between parks. My kids would love other people
being able to walk into my park, so keep that cheap to add later, but it isn't
the priority.

Next up, in order:

1. A shared `hb-supabase.js` at the root of
   https://github.com/JaronKBragg7337/heartbeat-observatory — the Supabase URL
   and anon key are currently pasted into 15+ separate files with no shared
   client. Parkworks must not become the 16th.
2. An identity helper (anonymous device id + session), reusing the pattern
   already in `games/syl/src/multiplayer/multiplayer.js` around line 466.
3. A `parkworks_saves` table and the `createSaveBackend` hook the game already
   looks for. The game needs no change — the host page supplies it.
4. Then: end-of-day report, guest wallets and per-facility pricing, staff,
   ride breakdowns, more content, multi-park layer.

Open bug, already diagnosed: guests only ever ride one ride. A ride relieves
`fun` by 0.82 down to the 0.03 floor, fun regrows at 0.0036/sec, so it takes 86
seconds to reconsider and 134 to prioritise — but guests leave at 155 seconds.
Suggested fix is dropping the relief to about 0.30. `src/core/awayReport.ts`
mirrors that constant and must move with it.

Also wanted: a start-over button with double confirmation, showing what each
facility charges per guest, and letting me set prices where demand is gated by
reputation (that last one is my favourite — it's the "bigger boss" lever).

How I work: this machine is for AI use, shared with Codex — use it as your own,
just don't delete things. Do the work rather than handing me steps, and name
blockers as blockers. Measure before concluding — give me real numbers, not
screenshot theories, and an honest verified / couldn't-verify / skipped split.
Everything you build gets pushed and published to a live URL I can open on my
phone; local files aren't a deliverable. Anything that makes a project more
official is a standing yes and priority one — don't ask, just do it carefully
and tell me. I sometimes reply to only part of a message and drop something
important; bring it back rather than treating my silence as a decision.

Three.js themselves watch my X posts, so visual quality matters here.
