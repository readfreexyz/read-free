# Knowing when an outlet breaks

Outlets change their pages and their walls without warning, and an adapter that no longer fits
fails quietly. Two things watch for that: a daily check that runs by itself, and readers, who can
report a problem in one click.

## The daily check

`.github/workflows/site-health.yml` runs `tools/site-health.mjs` every day at 05:23 UTC on
GitHub's machines. For each outlet (`extension/health/specs.js`) it fetches the homepage and two
sample articles, signed out, saying it's a script (Node's own user agent), and checks what the
adapter relies on (`extension/health/checks.js`):

- **article links:** the homepage still links articles at the addresses the adapter expects;
- **article body:** the adapter's `live.body` still finds the article;
- **whole text sent:** an outlet whose text the extension only uncovers still sends all of it;
- **parts to keep, markers:** what the adapter keeps, and the events a page-world guard holds
  back, are still there;
- **archive snapshot** (outlets swapped in from archive.today: NYT, FT, The Atlantic, WSJ,
  Der Spiegel, Le Monde, National Post): archive.today's newest snapshot of a sample article,
  run through the extension's own extractor. Samples come from the homepage, or from the
  outlet's feed when the homepage refuses a script. A few requests, seconds apart.

Each check passes, fails, or is skipped: a bot check, a refusal, a CAPTCHA, no snapshot yet, or a
capture made behind the wall. Nothing is done to get past any of them, and a skip is never an
alarm. Only counts and selectors are logged, never article text: the run's log and summary are
public, like the repository.

**When it alerts:** the run fails, and GitHub emails about it, when

- an outlet fails, on most of its samples, twice a minute apart; or
- an outlet that used to answer this checker hasn't for a week (`BLIND_DAYS`).

An outlet that has never answered (from GitHub's machines, NYT, FT, The Atlantic, WSJ and Reuters
are likely to refuse) is listed on the run's page and never alerts. What each run learned (which
outlets answered, since when not) is kept for the next in the Actions cache, as
`.health-state.json`.

**Running it:**

- By hand: the repository's **Actions** tab, **Site health**, **Run workflow**. **Fail on
  purpose** makes it fail, to check that the email arrives.
- Here: `node tools/site-health.mjs [--only nyt,lemonde] [--samples 2] [--state state.json]`.
  Some networks can't reach archive.today from a script; its check is then skipped.
- GitHub pauses scheduled runs in a public repository after 60 days without a commit. Any push,
  or **Enable workflow** on the Actions tab, starts them again.

**Who gets the email:** GitHub sends the email about a failed scheduled run to whoever last
changed the schedule, or last turned the workflow back on. Turning it off and on again from the
Read Free account (Actions tab, or `GH_CONFIG_DIR=~/.config/gh-readfree gh workflow disable
site-health.yml` then `enable`) makes that account the one, so the email goes to its address.

**What it can't see:** what a reader past the free-article limit sees in a browser, where the
wall is drawn by the outlet's scripts. For that, readers' reports.

## Reports from readers

The error banner on an article (archive.today couldn't help) and the toolbar menu have **Report a
problem**: an email to hello@readfree.xyz that the reader's mail app opens, already filled in with
what happened, the outlet, and the versions of Read Free and the browser
(`settings.reportLink`). Never the article's address: the email asks the reader to paste it if
they want that page looked at. Nothing is sent unless the reader sends it. The menu shows the
address as text too, for a browser with no mail app set up.

## Fixing one

Fix the adapter, add a test from what the page now looks like, bump the version and release
(`docs/auto-update.md`). Copies installed with the install script have it within the hour; copies
loaded by hand see the ↑ the next day.

## Walls it can't see

The daily check reads pages without running them, and NYT, the FT, The Atlantic, WSJ and Reuters refuse it,
so it never sees a wall go up. On 2026-11-25 NYT's wall had changed (`docs/phase0-findings.md`), and
nothing said so. Readers' own pages are where that shows, and there's no telemetry, so:

- **A hidden popup is measured** (`paywall.hiddenPopupShows`): site CSS hides NYT's popup, so it's let out
  (`.nytfix-probe`) just for the measurement. On screen, with the wall's wording or a cut article, it's a
  wall, whatever marks NYT uses (`wall.probe`). It can't help where something else hides the popup too (seen on
  one cut article, `docs/phase0-findings.md`); the note below can.
- **It fails open** (`wall.failOpen`, `paywall.watchMissed`, `render.frozen`): a popup that isn't
  recognized, or a page still frozen after a lift, gets the site's wall back, with a note and an email link.
- **A cut article with no wall** gets a note, and is fetched only on request (`wall.cut`).
- **Copy page details** (`src/details.js`) gives a report what's needed to fix it, without developer tools.

They're the adapter's to turn on; only NYT's does so far. Others need a popup that measures 0x0 without
a wall, or a line that only a cut article has.
