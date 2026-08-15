# Handoff prompt

Paste the block below into a fresh Claude Code session to resume work.

Last updated 2026-08-15. Keep it current — this file is what makes a relaunch
cost a minute instead of an hour.

---

We're continuing work on Parkworks Tycoon, a mobile-first 3D park management
game in Three.js + TypeScript. Live at
https://jaronkbragg7337.github.io/parkworks-tycoon/ , source at
https://github.com/JaronKBragg7337/parkworks-tycoon , and also playable inside
Heartbeat Observatory at https://www.heartbeatobservatory.com/games/parkworks/

**Read `docs/NEXT.md` in that repo first — the handoff section at the top has
the working state, the next three items, two decisions waiting on me, and the
traps that have already cost time.**

Where we are: Codex originally built it. Since then we've added park saves with
a pluggable backend, an away report, sell/move/rotate, a placement facing arrow
and nudge pad, and then over the last two days: fixed the ride bug and unified
its constants, added prices gated by reputation, guest wallets, a cash machine,
a start-over button behind two confirmations, six new placeables, a scenery
appeal radius, a full 24-hour day with the park closing overnight, an overnight
settlement, and a buyable cleaning crew with a janitor who walks the paths.
**209 tests pass, `npm run check` is the gate**, pushing to main auto-deploys to
Pages, and `node tools/vendor-to-heartbeat.mjs --build` refreshes the Heartbeat
copy.

On the Heartbeat side we also built a shared `hb-supabase.js` at the root of
https://github.com/JaronKBragg7337/heartbeat-observatory (the project key had
been pasted into 27 files), an identity helper, and a `parkworks_saves` table.
Anonymous sign-ins are enabled, with public content — the Signal Feed, the
library, DMs — guarded behind `public.is_real_account()` so an anonymous session
cannot post.

The direction: an endless solo tycoon. A park that outgrows its land should
promote me to running several parks, with a holding-company layer over the top —
decisions, lawsuits, moving staff between parks. My kids would love other people
being able to walk into my park, so keep that cheap to add later, but it isn't
the priority.

Next up, in order: the end-of-day report, then the rest of the staff (mechanic
and entertainer — the janitor established the shape), then the multi-park chain
layer. Two things are waiting on a decision from me rather than on code:
after-dark activities, and whether the mini-railway needing 120 m² as the
cheapest ride is a problem or a deliberate nudge to buy land.

How I work: this machine is for AI use, shared with Codex — use it as your own,
just don't delete things. Do the work rather than handing me steps, and name
blockers as blockers. **Before calling anything a blocker, check whether it's
reachable in my signed-in Chrome — dashboards usually are.** All my credentials
are in `C:\Users\lilli\.secrets\keys.env`; read it and use them rather than
asking me, and please don't lecture me about API keys.

Measure before concluding — give me real numbers, not screenshot theories, and
an honest verified / couldn't-verify / skipped split. A passing test is not the
same as having looked at it. Everything you build gets pushed and published to a
live URL I can open on my phone; local files aren't a deliverable. Anything that
makes a project more official is a standing yes and priority one — don't ask,
just do it carefully and tell me. I sometimes reply to only part of a message
and drop something important; bring it back rather than treating my silence as a
decision. You can use subagents when work genuinely splits apart — it's worked
well; just don't run two of them through the same files.

Three.js themselves watch my X posts, so visual quality matters here.
