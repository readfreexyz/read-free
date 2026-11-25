# Phase 0 findings (2026-11-14)

Test article: `https://www.nytimes.com/2026/11/14/world/europe/student-protests-pensions-generations.html`
Checked in the user's own Chrome (page context), not from an extension yet, then re-checked in an
incognito window with extensions off.

## archive.today

- **Reachable, no bot wall.** `archive.ph` answered directly: `server: nginx`, no Cloudflare
  headers (`cf-ray`, `cf-mitigated`), no CAPTCHA on the homepage, timemap or snapshot.
  (archive.today can still show its own CAPTCHA to some IPs/VPNs; handle it, but it is not the norm.)
- **Same result in incognito with extensions off:** 200, nginx, 1 memento, 3.8 MB in ~11.8 s,
  no CAPTCHA, body found with 32 text blocks (~7.4k chars). Ad blockers weren't affecting archive.today.
- **Timemap is fast:** `GET /timemap/<url>` → 200, `application/link-format`, 682 B, ~1.4 s.
  *Later (2026-11-14, version 0.9.2): usually 0.3–3.5 s, but it sometimes hangs; see
  [multi-site-investigation.md](multi-site-investigation.md#after-first-use-version-091). The
  extension now asks `/newest/<url>` first.*
  - One entry: `rel="first last memento"`, `datetime="Sat, 14 Nov 2026 05:05:35 GMT"`.
  - Memento URLs point at `http://archive.md/<YYYYMMDDhhmmss>/<url>`. Rewrite the
    host to the chosen mirror and use https.
- **Snapshot is slow and heavy:** `GET /newest/<url>` → redirect to
  `https://archive.ph/20261114050535/<url>`, 200, **3.8 MB, ~11.4 s**.
  - Show a loading state, and cache only the extracted article, never the raw page.
  - Get the date from the timemap and fetch the memento URL directly.
  - **The wait is all server time.** Fetching the memento URL directly sent nothing for 8.4 s,
    then the whole body in 0.4 s (gzip: 161 KB on the wire, 3.8 MB decoded, no `Content-Length`).
    → Downloaded bytes can't drive a progress bar.
  - One attempt took over 45 s, so allow a generous timeout (60 s).
- **archive.today caches rendered snapshots, separately for each URL and each mirror.**
  Measured one request after another:

  | Request | First byte |
  | --- | --- |
  | Long URL on archive.ph, cold | 8.5 s |
  | Same URL again | 0.3 s |
  | Short-ID URL (`/Z279f`), right after | 1.5 s |
  | `/newest/` (lookup, then the warm page) | 1.7 s |
  | Timemap | 0.3 s warm, 1.4 s cold |
  | Same snapshot on archive.is / archive.md (cold) | 9.9 s / 14.6 s |
  | `/download/<id>.zip` | 404 |

  - The 8–15 s is a one-time server render per mirror, and nothing client-side can speed up a cold render.
  - Racing several mirrors would multiply cold renders on their servers for no reliable gain.
  - → The only levers are starting the fetch earlier (as soon as the paywall appears) and caching
    the extracted text locally.
- **Freshness:** the snapshot was taken ~4 minutes after publication (published 05:01 UTC).
  Updates made to the article later won't be in it, so the banner must show the snapshot time.

## Snapshot DOM (`archive.ph/<timestamp>/<url>`)

- Page is wrapped in `#HEADER` (archive toolbar) and `#CONTENT` (the captured page).
- **Kept:** `id` attributes (`#app`, `main#site-content`, `article#story`) and
  **`section[name="articleBody"]`**. **Stripped:** classes (only 12 remain, archive's own),
  all `data-testid`, `itemprop` on the body.
  → Primary selector `#CONTENT section[name="articleBody"]`, fallback `#CONTENT article#story`.
- **No `<p>` tags at all.** Paragraphs are `<div>`s with inline styles (3,552 `style` attrs on the page).
  - Body text blocks: 31 divs at `section > div > div > div`, `nyt-imperial 20px`, ~7.4k chars.
  - That matches the live page (34 `<p>`, ~7.5k chars), so **the snapshot is complete, not paywalled.**
- **Inside the body, drop:**
  - 3 recommended-article cards: text divs inside `<a>`, `nyt-cheltenham-small 14px bold`, with webp thumbnails.
  - Ad labels ("Advertisement", "SKIP ADVERTISEMENT") and "Supported by".
- **Inside the body, keep:** 3 `figure`/`figcaption` photos and 1 `h2`.
- **Images:** `src="/Z279f/<sha1>.webp|.avif"` is a relative path on the archive host, *and* the original
  is kept in a `currentsourceurl="https://static01.nyt.com/..."` attribute. Prefer the original NYT URL.
- **Links:** rewritten to `https://archive.ph/o/Z279f/<original-url>`. Strip the `/o/<id>/` prefix
  to restore the original link.
- **Snapshot time:** `#HEADER time[itemprop="pubdate"][datetime]` (also `meta[property="article:published_time"]`),
  and the 14-digit timestamp in the URL.
- Gotcha: when parsing with `DOMParser`, resolve relative `src`/`href` against the **snapshot URL**
  (`getAttribute` + `new URL(v, snapshotUrl)`), not via `.src`, which resolves against nytimes.com.

## Live NYT page

- `section[name="articleBody"]` with 34 `<p>`. Paragraph classes are hashed (`css-12m5bll evys1bk0`),
  so copy `className` from the live paragraphs at runtime rather than hardcoding.
- **Logged-in profile, no paywall:** the full text was in the DOM (34 `<p>`, ~7.5k chars), in the
  server HTML (33 `<p>`) and in `__preloadedData` (36 `ParagraphBlock`s).
  - The server sent full text for those cookies, so ad blockers weren't what kept the paywall away.
- **Incognito (anonymous, extensions off), paywalled:**
  - **The text is cut on the server.** The server HTML had 12 `<p>` (~1.9k chars) and the live DOM
    7 `<p>` (~1.6k chars). The rest of the article isn't on the page at all.
    → archive.today is required; replace the whole body rather than un-hiding anything.
  - `#gateway-content[data-testid="gateway-content"]` measures **1165×370** (0×0 when inactive).
  - `div[data-testid="vi-gateway-container"]` wraps the whole article and becomes a
    **fixed-position overlay** when active. That's what stops scrolling.
  - Body overflow is `hidden auto` in both states, so it is **not** a signal.
  - The same paywall elements exist in both states: `vi-gateway-container`,
    `onsite-messaging-unit-gateway`, `gateway-content`, plus `p#gateway-exit-advisory`.
- **Phase 1 test with the paywall up:** the text swap worked, but two problems remained.
  - **A gradient scrim**, `div.css-hgm7bf`. It's an absolutely positioned child of `vi-gateway-container`
    with `linear-gradient(rgba(18,18,18,0), rgba(18,18,18,.65) 342px)` and `pointer-events: none`.
    Once the container is back in normal flow, the scrim covers the top ~800px of the page.
  - **Nothing behind the paywall was clickable**, even though `pointer-events` is `auto` all the way up.
    Hit tests skip every descendant of the container, which is how `inert` behaves. It's most likely
    on `main#site-content` (unconfirmed).
  - The container's children are a masthead `div` (static), `main#site-content`, two
    `display: contents` wrappers, and the scrim. Hiding every non-main child also hides the masthead.
- → **Detection:** `#gateway-content` has non-zero size.
- → **Removal:**
  - `content.css` hides `#gateway-content` and puts `vi-gateway-container` back in normal flow.
  - `render.js` hides positioned children of the container (the scrim) and removes `inert`/`aria-hidden`
    from the article's ancestors and from `#site-content [inert]`.
  - MutationObservers keep the paywall lifted until undo.
- **The login wall** ("This story is free to read. Log in to continue."), seen on a `/live/` blog in incognito:
  - **The whole story is in the page.** 158 `<p>` (~26.4k characters) both in the live DOM and in the
    server HTML, plus 165 `ParagraphBlock`s in `__preloadedData`. → Lifting the wall is enough;
    no archive.today request is needed.
  - **Same mechanics as the paywall:** `#gateway-content` (973×624 here), `vi-gateway-container` turned
    `fixed`, the same `div.css-hgm7bf` scrim, and `inert` + `aria-hidden="true"` on `main#site-content`.
  - **How to tell it apart:** `#gateway-content`'s own text says "To leave without signing in, use your
    browser's Back button." The email form isn't in the page's DOM (likely an iframe or shadow root).
    The paywall's wording hasn't been checked yet.
  - **No flash:** the extension's CSS (in place before the page renders) hides `#gateway-content`
    and keeps `vi-gateway-container` from being pinned, so the wall never draws. Detection therefore
    reads the DOM (the popup has content and `main` is `inert`) instead of the popup's size, inside
    a MutationObserver so `inert` and the scrim are gone before the next paint.
  - Live blogs have no `section[name="articleBody"]`. They're a feed of `live-blog-post` / `FeedItem`
    elements, so they'd need their own extractor for the archive path.
- **The wall changed (2026-11-25, the user's Chrome, signed out, a cut article):** `main#site-content` isn't
  `inert` any more. `section[name="articleBody"]` is (`inert` + `aria-hidden="true"`), and so are eight `div`s,
  one by one. `#gateway-content` still fills: a note for screen readers (`p#gateway-exit-advisory`, 83
  characters) and one more element; its wording no longer says "without signing in" (below). There's a
  `[data-testid="gateway-backdrop"]` next to it. The body still ends in the subscription line, with 5
  paragraphs of the article before it. Read Free saw no wall, since it looked for `inert` on main only
  (fixed: the article body counts too). Live blogs under this version haven't been looked at.
- **The login wall on an interactive page (`/interactive/2026/11/24/climate/…`, the same day):** no `article#story` or
  `section[name="articleBody"]`, nothing `inert`, and `main#site-content` isn't inside `vi-gateway-container`. `main` is
  pinned by inline styles instead (`position: fixed; width: 100%; margin-top: 0px`), so the document is only as tall as
  the window and can't scroll. The note reads "To leave without logging in or creating an account, use your browser's
  Back button" (it used to say "signing in"). All the text was there (221 `<p>`). Read Free ignored `/interactive/`
  while its CSS hid the wall, which left the page frozen at the top.
- **The page's own data didn't hold the rest, once (2026-11-25, the user's Chrome, a cut article):** `window.__preloadedData`
  had 9 `ParagraphBlock`s, 1,630 characters of text: about what a cut page shows. (Counting the word "ParagraphBlock" there
  finds more: type lists hold it too.) The next 5 articles looked at had it all (below); why that one didn't isn't known.
  Where the data falls short of NYT's word count, Read Free still asks archive.today.
- **The whole article is in the page (2026-11-25, 5 articles of 5, one signed-out browser; so Read Free checks it
  against NYT's own word count each time):** in `window.__preloadedData`, an
  inline script (a JavaScript object with some `undefined` values, not JSON): `loaderData.data.article.sprinkledBody.content`.
  `config.isOptimisticallyTruncated` is true, also on an article with no wall. Against `article.wordCount`, on 5 articles:
  1,164 words of 1,160; 1,360 of 1,347; 1,776 of 1,738; 995 of 976; 3,079 of 3,059. Seen at the top level:
  `ParagraphBlock`, `Heading2Block`, `DetailBlock`, `ImageBlock`, `InteractiveBlock`, and `Dropzone`, `RuleBlock`,
  `RelatedLinksBlock`, `Header…Block` (not the article's). Text is `TextInline` with `LinkFormat`, `ItalicFormat`,
  `BoldFormat`. Other kinds (lists, quotes, diptychs, grids) are handled from their names, not from a page seen.
- **Something else in the browser can hide the popup:** a `<style>` in the head of a cut article, in the user's Chrome
  (`#gateway-content { display: none }`), so only the backdrop showed. It isn't in NYT's HTML, uBlock's default lists or
  Read Free, and it was gone once the user had turned off another ad blocker. Measuring the popup finds no wall there;
  the marks and the cut line do. Without it, the popup let out for the measurement was 394x64 in the window, seen,
  with no scrolling (a reader at 600 stayed there), and "Show NYT's version" showed the whole wall.
- **A page with no wall** (an article from 2022, 48 paragraphs): no `#gateway-content` at all, nothing inert, no
  subscription line. Read Free did nothing in 14 s.
- **archive.today asked a script for a CAPTCHA, and not a page visit (seen once, the same day):** the snapshot of a cut
  article opened in a tab: the article (95 KB sent, 2.2 MB), twice, not from the cache. `fetch()` of the same address from that very page,
  with its cookies: 59 KB, a CAPTCHA. So there may be no check for the reader to complete. Read Free doesn't disguise
  its requests to get past that. On WSJ the same day the user got a CAPTCHA in the tab, and completing it worked, though
  not in incognito: there Read Free's requests went with the regular window's cookies ("spanning", Chrome's default).
  The manifest's `"incognito": "split"` made it count on stand-in pages (Chrome 158), but the user still couldn't get past
  it in incognito with that, so it isn't used; there, Read Free links to the article on archive.today.
- **archive.today can't be shown inside another page:** `X-Frame-Options: Deny` (2026-11-25). So the check is completed in
  a small window of its own.
- **CSP is permissive:** `img-src data: https: blob:`, `style-src 'unsafe-inline' https:`,
  no Trusted Types. Injected markup and either image source (archive or static01) will load.
- **NYT uses DataDome:** a cookieless fetch of the article gets a 403 bot challenge. The extension
  must never fetch NYT pages itself and should work only from the live DOM.

## Still open

1. **Fetching from the extension's service worker.** Page-context fetches worked; the extension's
   origin and `Sec-Fetch-*` headers differ. Phase 1's background fetch tests this directly.
2. **Older article templates** (pre-2018 URLs) may not have `section[name="articleBody"]`.
3. **Whether removing `inert` makes the page clickable again.** Re-test in incognito.

## Changes to the plan

- Extraction is selector-based, with Readability only as a fallback for odd templates.
- Flow: timemap (fast, gives the date) → fetch memento URL (slow) → extract → cache the result.
- Unit-test fixtures should be **synthetic HTML that copies the structure above**, not saved
  copies of real articles.
