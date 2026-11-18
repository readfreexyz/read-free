# Scaling Read Free to other sites (2026-11-14)

Can the extension's approach work beyond nytimes.com, and what would it take? The approach is to
take the wall off at once, then swap in the article from archive.today.

Data was gathered from the user's Chrome. Sample articles came from Bing News RSS
(`site:<domain>`), because archive.today serves a decoy "Welcome to nginx" page to scripted
requests for its per-domain listings. Each article was then looked up on archive.today: the
timemap, then the newest snapshot. Only structure and counts were recorded, never article text.

**Samples are small: one to four articles per site.** Treat every row below as a first look.
Single samples were misleading twice (see WSJ and Bloomberg).

## Summary

| Site | Wall (expected; verify per site) | archive.today has it? | Snapshot text | Article-body marker that survives archiving |
| --- | --- | --- | --- | --- |
| **Financial Times** | hard paywall | **4 of 4**, newest minutes old | complete | `article#article-body` |
| **The Atlantic** | metered | 1 of 1 (4 captures, newest 1 h) | complete, ~15k chars | `main#main-content > article > section` |
| **The New Yorker** | metered (Condé Nast) | **4 of 4**, newest minutes old | complete, ~9k chars | `main#main-content > article` |
| **Washington Post** | metered | 2 of 4 | complete | `main#main-content > article[id=<from URL>]`; see note |
| **CNN** | metered + sign-in | 3 of 4 | complete (short article) | `div[itemprop="articleBody"]` |
| **WSJ** | hard paywall | 2 of 4 | **mixed:** one capture an empty 39 KB shell, one complete (8k chars) | not yet identified |
| **Bloomberg** | hard paywall | 3 of 4 | **mixed:** 0.5k, 5.6k, 2.2k chars | `main > article` |
| **The Economist** | hard paywall | 1 of 4 | empty 39 KB shell (one sample) | inconclusive |
| The Guardian | none (donation asks) | 0 of 3 | n/a | not needed |
| NBC News, CBS News | none | 1 of 3 each | complete | not needed |
| ABC News | none | not sampled | n/a | not needed |

### What stood out

- **archive.today keeps ids, `name`, `itemprop` and `role`** on every site sampled. Classes and
  `data-*` attributes are stripped, same as on NYT. Every site that worked had a body marker built
  from those attributes, so snapshot extraction can stay selector-based.
- **FT is the best next candidate.** It's archived reliably and quickly, its paywall is hard (so the
  extension is actually useful there), and its marker (`#article-body`) is unambiguous.
- **Washington Post snapshots hold several articles.** WaPo's continuous scroll loads the next
  stories into the same page, each in an `article` whose id comes from its URL
  (`politics-2026-11-13-…`). The extractor must pick the one matching the requested URL.
- **WSJ captures sometimes fail.** One was an empty shell, another complete. The extension's
  existing fallback to older snapshots and its completeness check already handle this. Expect more
  "incomplete" outcomes than on NYT.
- **Bloomberg breaking news starts as a stub.** A 2-paragraph first version gets expanded later, so
  an early snapshot can be honestly short. The 1.5× completeness rule would reject it, which is the
  right outcome.
- **New Yorker is on Condé Nast's shared platform.** Wired, Vanity Fair and others may share its
  markup, so one adapter could cover several sites. Unverified.
- **ABC News keeps its article id in the query string** (`/story?id=123`). URL normalization can't
  just drop the query everywhere; it has to be per site.

## FT, built (version 0.8.0)

- **Live page** (the user's diagnostic in their own Chrome; FT shows automated browsers a
  Cloudflare check):
  - Non-subscribers get a **barrier page**, not the article: `main#site-content > div#barrier-page`
    with the headline (an `h1`) and subscription offers.
  - There's no `#article-body`, no `inert`, no overlay and no scroll lock. The title is
    "Subscribe to read".
- **So the adapter inserts the article instead of swapping it:**
  - **Detection:** `#barrier-page` has content. `wall.inert` is now optional.
  - **CSS:** `sites/ft.css` hides everything in the barrier page except the `h1` and its ancestors,
    using `:has(h1)`.
  - **Placement:** the core puts the loading box, the banner and the article right after
    `site.live.insertAfter` (`#barrier-page`).
  - **Failure:** the barrier page comes back (`.nytfix-off`).
- **Not shown on FT:** the standfirst and byline. The barrier page has only the headline, and only
  `#article-body` is taken from the snapshot.

## The Atlantic and The New Yorker, built (version 0.9.0)

Probed from the user's Chrome. That profile has ad blockers and is past The Atlantic's meter but
not The New Yorker's, so neither wall was seen in action. Treat both live sides as provisional
until tested.

- **The Atlantic.**
  - **Snapshot** (3 of 4 archived): `main#main-content > article` holds a `header` (skipped), the
    body in `div > section` (17–31 paragraphs), the author bio in `address#article-writer-0`,
    and "related story" links in `div#injected-recirculation-…` (both skipped).
  - **Live body:** `section[data-event-module="article body"]`, paragraphs `p.ArticleParagraph_root__…`.
  - **Past the meter:** the body is cut to 4 paragraphs (341 words). Two empty
    `[data-zephr-outcome-label]` slots sit at its end, where Zephr renders its gate. No modal,
    `inert` or scroll lock was visible, probably because the ad blockers stop Zephr.
  - **JSON-LD:** `isAccessibleForFree: false` with `hasPart` `.article-content-body`. That's the
    same for every reader, so it only says the text *may* be cut. No `wordCount`.
  - **Adapter:** the wall counts as up when the article is marked paywalled **and** the body has
    under 600 words (new `wall.detect` hook). `atlantic.css` hides the Zephr slots.
- **The New Yorker** (Condé Nast).
  - **Snapshot** (2 of 2 archived): `main#main-content > article` holds the header and the body,
    with share buttons (`role="button"`, now skipped on every site) and a video player
    (`[aria-label="Video Player"]`, skipped).
  - **Live body:** several `div[data-testid="BodyWrapper"] .body__inner-container` chunks with ads
    between them (new multi-chunk support in the core).
  - **The full text is on the page,** about 15k characters, also in JSON-LD `articleBody`.
    Paragraphs past the free part carry class `paywall`, and `aside.paywall-modal` exists empty
    on every page.
  - **Adapter:** the wall is the modal having content (`wall.detect`). While `.paywall` paragraphs
    are on the page it only lifts the wall (`wall.type` → `'login'`, with its own message);
    otherwise it uses archive.today. `newyorker.css` hides the modal and forces `.paywall`
    paragraphs visible.

### After first use (version 0.9.1)

- **The Atlantic: "pixelated" photos mid-article** were 80×80 thumbnails from a "related stories"
  list inside the body (`section > ul > li > div > figure > a > picture > img`, next to the
  linked headline), stretched to the column width. The extractor now skips any photo whose image
  is a link, and any list item holding one, on every site. Photos are also no longer stretched
  past their real size.
- **Sharper photos.** Snapshots drop `srcset`, so only the size the page loaded at capture time
  is left (`currentsourceurl`). Each adapter can derive a bigger one (`snapshot.hiresImage`),
  used as the 2x source and dropped if it fails to load. All three were checked to load:
  - NYT: the `-articleLarge` crop (1,024 px) → `-superJumbo` (2,048 px).
  - The New Yorker: `w_1280,c_limit` → `w_2560,c_limit` (2,048 px returned).
  - FT: `width=490` → `width=980`.
  - The Atlantic: none. Its thumbor resize URLs are signed (`/thumbor/<signature>/…/976x549/media/…`;
    an `unsafe` URL fails), and the CDN ignores `?width=`. The unresized upload under `/media/`
    loads, but it's the full original (2,000–5,500 px wide), too heavy for every photo.
- **The loading box was full-width on The Atlantic.** Its article body spans the page
  (1,728 px on the user's screen) and each paragraph sets its own width (665 px) through its
  class. The box now sits in a row carrying the site's most common paragraph class, measured on
  the live page at 665 px.
- **"Couldn't reach archive.ph: timed out after 20 s"** (seen on The Atlantic, version 0.9.2).
  That was the timemap request. Timed from the user's Chrome, 29 timemap requests:
  - Most answered in 0.3–3.5 s. All the waiting was on archive.today's side (no connection time).
  - Some took about 7.5 s. Two hung: one ran 90 s and ended in a 504, the other was stopped
    at 45 s. Both were Atlantic articles that had answered in under half a second minutes
    earlier.
  - A second, identical request sent 5 s into a stall hung just as long. Sending duplicate
    requests doesn't help.
  - **`/newest/<url>`** looks the article up and redirects to its newest snapshot
    (`/20261112214313/<url>`, so the date is in the address), or answers 404 if there's none.
    The lookup took 0.4–12 s over 12 tries, including 12 s for the article whose timemap had
    just hung.
  - Slow lookups were mostly Atlantic ones (4 of 10, against 0 of 7 for NYT and FT), but the
    sample is small, so this can't be pinned on The Atlantic.
  - **Change:** the extension fetches `/newest/` first: the lookup and the snapshot in one
    request. It falls back to the timemap only when that snapshot is incomplete (to try older
    ones) or doesn't come through (a timeout, a 5xx, a 404 from the snapshot itself). A CAPTCHA
    or rate limit stops right there. If the timemap then fails while an incomplete snapshot is
    in hand, that snapshot is offered instead of an error.
- **Try again.** Failure notes (in the article and in the banner) offer **Try again**. A retry
  remembers that the page was paywalled, since once NYT's wall is lifted the page no longer looks
  paywalled but its text is still cut off.
- **"The 2 newest archive.today snapshots look incomplete too"** on a short Atlantic article
  (version 0.9.2): the longest had 2,934 characters, the page showed 1,957 (1.5× would be
  2,936). Checked from the user's Chrome:
  - The newest snapshot's body held 6 paragraphs (2,884 characters by this probe's count) and
    ended at the page's own `div#article-end`. The other snapshot had no article in it at all.
  - The live page's HTML, fetched as the user, held the same 6 paragraphs and 2,884 characters.
    The Atlantic sends the whole article and cuts it in the browser (its JSON-LD declares the
    paywalled part with `hasPart`), and the cut page here kept 4 paragraphs. So the snapshot was
    complete. The article was just short enough that the wall had already shown two thirds of it.
  - The cut page keeps `div#article-end`, so that marker can't tell a complete snapshot from a
    cut one.
  - **Change:** when no snapshot reaches 1.5×, the extension shows the longest one anyway if it
    has more text than the page, says in the status bar that the end may be missing, and keeps
    it for 30 minutes instead of the usual 24 hours (30 days since 0.9.4). A snapshot with no
    more text than the page is still reported as incomplete, without the "Use the longest
    anyway" button, which would only show less.

## What the extension would need

Today everything NYT-specific is spread across the code:
- `paywall.js`: `#gateway-content`, `main[inert]`
- `content.css`: the wall-hiding rules
- `render.js`: `vi-gateway-container`, `section[name="articleBody"]`, the subscription line
- `extract.js`: `section[name="articleBody"]` in the snapshot
- `archive.js`: URL normalization and the article-path test
- the manifest: `www.nytimes.com`

**Split it into a site-independent core and one adapter per site.**

Core (unchanged in spirit):
- The archive.today client: timemap, mirrors, fallback to older snapshots.
- The background fetch proxy.
- The cache, keyed by normalized URL.
- The status bar and the loading placeholder.
- Keeping the reader's place.
- Settings.
- The orchestration in `content.js`: detect, lift, fetch, extract, swap, undo, and in-page navigation.

Adapter, one per site, mostly data:

```js
{
  id: 'ft',
  hosts: ['www.ft.com'],
  isArticle: url => /^\/content\/[0-9a-f-]{36}$/.test(url.pathname),
  normalizeUrl: url => `https://www.ft.com${url.pathname}`,        // ABC would keep ?id=
  live: {
    body: '…',                         // the live article body, for the swap and paragraph styling
    wall: {
      css: '…',                        // pre-hides the wall before first paint (per-site CSS file)
      inPage: doc => …,                // cheap DOM test, run from a MutationObserver
      type: doc => 'paywall' | 'login' | null,
      lift: { inert: '…', scrims: '…', pinned: '…', scrollLock: '…' },
    },
    upsell: '…',                       // the "subscribe to keep reading" line, for the placeholder
  },
  snapshot: {
    body: (doc, url) => …,             // e.g. '#article-body'; WaPo picks article[id] from the URL
    junk: /…/,                         // site-specific labels to drop
  },
}
```

- **A generic fallback extractor** for snapshots: score text density, like Readability. Use it when
  a site has no snapshot selector yet, or when its selector stops matching.
- **Opt-in per site with optional host permissions.** Rather than listing every news domain in
  `content_scripts` (and asking for access to all of them at install), declare them as
  `optional_host_permissions`. The options page then gets a checkbox per site. Turning one on
  requests that host and registers its content script and CSS with
  `chrome.scripting.registerContentScripts`. Registered CSS is still injected before first paint,
  so the no-flash approach keeps working.
- **Tests stay the same shape.** Each site gets synthetic live and snapshot fixtures built from its
  probes, and the existing jsdom integration harness runs once per adapter.

## Per-site onboarding (Phase 0 again, roughly half a day each)

1. **Snapshot probe** (first pass done above): coverage, completeness, body marker, links, photos,
   junk.
2. **Live-page probe, in incognito.** The user runs a diagnostic snippet, as with NYT. It needs to
   answer:
   - Which element is the wall, and what signals it in the DOM?
   - Is it a login wall or a paywall?
   - How does it block the page: `inert`, a fixed container, a scrim, a scroll lock?
   - Is the text cut on the server or only hidden?
   - Where is the "subscribe to keep reading" line?
   - How does the site navigate between articles in-page?
3. **Adapter, fixtures and tests,** then a real-page check by the user.

## Recommended order

1. **Refactor NYT into the first adapter,** with no change in behavior. The 116 existing tests must
   stay green. The core/adapter split is designed against a real second site, so do it alongside
   step 2.
2. **FT:** best coverage, hard paywall, clean marker.
3. **The Atlantic and The New Yorker:** clean markers. The New Yorker may unlock other Condé Nast
   sites.
4. **Washington Post:** needs per-URL article selection in snapshots.
5. **CNN:** marker is easy; mostly a sign-in wall, which may be liftable without archive.today,
   like NYT's login wall.
6. **WSJ and Bloomberg:** archive captures are inconsistent. Worth doing, but expect more "no
   complete snapshot" results.
7. **The Economist:** sample real articles first.

Skip the Guardian, NBC, CBS and ABC. They don't paywall articles, so there's nothing to fix.

## Risks

- **Load on archive.today grows with sites.** Every paywalled article that isn't cached costs a
  cold render (8–73 s observed). Keep fetches to one per article view, keep the local cache, and
  keep the fallback capped at three snapshots.
- **Publishers fight archive captures.** WSJ's empty capture is likely bot protection. Coverage
  can change without notice.
- **Maintenance multiplies.** Each adapter depends on one site's markup, on both the live page and
  its snapshot. The console decision logs and a "selector stopped matching" warning per adapter
  would make breakage visible.
- **Terms of service.** Same as NYT: personal use, loaded unpacked, not publishable on the Chrome
  Web Store.
