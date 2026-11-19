# Outlet coverage tracker (2026-11-14)

All 53 outlets from the user's list. For each: is there a wall, does the page send the article
text to a signed-out reader anyway, and does archive.today have usable snapshots? That decides
the work, and it settles the order of the batches below.

## How this was checked

- **Samples:** 3 recent articles per outlet from Bing News RSS (`site:<domain>`).
- **The site's own pages** (`tools/probe-outlets.mjs`): each article was fetched as a first-time,
  signed-out reader, with no cookies. The probe recorded:
  - the JSON-LD paywall flag (`isAccessibleForFree`, `hasPart`)
  - how much article text the page sends
  - which paywall services load (Piano, Zephr, Sophi, Laterpay…)

  When the script couldn't get a page (a bot check, or a site that didn't load), the page was
  checked in a browser instead.
- **archive.today:** `/newest/<url>` for 2 articles per outlet with a wall or an open question
  (55 lookups, 2.5 s apart, no CAPTCHA or rate limit). It recorded the paragraph count and
  characters in the newest snapshot, and the id / itemprop / role / name that holds them.
- **Only structure and counts were recorded, never article text.**
- **Limits:**
  - A first-time reader is under every meter, so on metered sites the page sends the whole
    article here too. The JSON-LD flag and the paywall service are what mark those sites.
  - The user's ad blockers may stop some paywall services (as with Zephr on The Atlantic). So a
    "lift only" site below may never actually show the user a wall.
  - Two samples per site is a first look, not a verdict.

## Summary

| Group | Outlets | Work |
| --- | --- | --- |
| Covered | NYT, FT, The Atlantic (and The New Yorker, not on the list) | done |
| **Batch 1: text already on the page** (built, 0.10.0) | CNN, Los Angeles Times, Newsweek, The Globe and Mail, Toronto Star | Take the wall off, no archive.today wait (like The New Yorker) |
| **Batch 2: cut page, good snapshots** (built, 0.11.0, except The Telegraph) | The Wall Street Journal, The Age + The Sydney Morning Herald, The Daily Telegraph (UK), Der Spiegel, Le Monde | The archive.today swap, as on NYT |
| **Batch 3** (built, 0.12.0, except De Telegraaf and The Free Press) | Corriere della Sera, The Spectator (whole text on the page: lift); National Post (cut on the server: archive.today swap); De Telegraaf (waiting on a page the user saves); The Free Press (parked) | See "Batch 3, built" |
| **Batch 4: parked sites rechecked** (built, 0.13.3) | Reuters, La Libre Belgique (whole text on the page: lift) | See "Batch 4, built" |
| **Parked** | The Washington Post, The Times (cut on the server, archive.today's copies cut or the wall); The Australian, The Daily Telegraph (Australia), News.com.au's premium stories (server redirect to a subscribe page); The Free Press (previews only); The Economist (not seen: Cloudflare) | Recheck later |
| **Batch 5: the open questions** (built, 0.14.2) | Daily Mail (Mail+ text on the page, hidden by CSS: lift); USA Today (free; Admiral's ad-blocker popup hidden); BBC and Politico (no wall: free) | See "Batch 5, built" |
| Free, checked | AP, ABC News (Australia), BBC, CBC, CBS News, Channel 4 News, Daily Express, Fox News, Metro, MSNBC, NBC News, NPR, PBS, Politico, The Guardian, The Sun, Time | nothing |
| Free, not checked | 9News, ABC News (US), GB News, ITV News, Sky News, TalkTV, The Hill | nothing (confirm while reading) |

## Every outlet

"Sent" is how much of the article a signed-out reader's page carries. "Snapshots" counts the
newest snapshots found for the 2 samples. "Marker" is what holds the text in a snapshot.

| Outlet | Wall | Sent | Snapshots | Marker | Next |
| --- | --- | --- | --- | --- | --- |
| 9News | none expected | not checked (the site didn't load; Bing's samples were years old) | — | — | free, confirm |
| ABC News (Australia) | none (marked free) | all | — | — | free |
| ABC News (US) | none expected | not checked (samples were widgets) | — | — | free, confirm |
| Associated Press | none (no flag, 20 paragraphs on the page) | all | — | — | free. Shows automated browsers a Cloudflare check. |
| BBC | none seen from the US (3 articles, Culture included; Piano loads, no flag) | all | 1 of 2, complete | `main#bbc-main` | **batch 5**: free |
| CBC | none | all | — | — | free |
| CBS News | none | all | — | — | free |
| Channel 4 News | none | all (mostly video pages) | — | — | free |
| CNN | metered + sign-in (flag false, Piano, reg wall) | **all** (JSON-LD `articleBody` matches) | 2 of 2 | `[itemprop=articleBody]` | **batch 1**, lift only |
| Corriere della Sera | metered (flag "False", Piano); wall not seen | **all**, premium articles too (JSON-LD `articleBody` matches) | 1 of 2, text split across blocks | `#content-to-read > .content` blocks | **batch 3**, lift only |
| Daily Express | none (Piano loads, no flag) | all | — | — | free |
| Daily Mail | Mail+ articles (flag false, `body.is-paywalled-article`, Zephr) | **all**, Mail+ too, hidden by CSS | 0 of 1 (the Mail+ sample) | not needed | **batch 5**, lift |
| De Telegraaf | premium articles expected | not checked: Cloudflare's bot check, in the built-in browser and in Chrome through the tools | 2 of 2, but older captures | `div#__next` (the whole app) | batch 3: needs a page the user saves |
| Der Spiegel | Spiegel+ articles (flag false on 1 of 3) | **cut** (515 characters) | 2 of 2, about 4k | `main#Inhalt` | **batch 2** |
| Fox News | none (marked free) | all | — | — | free |
| GB News | none expected | not checked (the site didn't load) | — | — | free, confirm |
| ITV News | none expected | not checked (connection error) | — | — | free, confirm |
| La Libre Belgique | premium articles (flag False on 1 of 3, Piano) | cut | **0 of 2** | — | parked |
| Le Monde | subscriber articles (flag false, `.article__reserved-content`) | **cut** (~1.5k) | 1 of 2, ~8.3k | `section#habillagepub` (an ad wrapper; check) | **batch 2** |
| Los Angeles Times | metered (flag false, `.paywall`) | **all** | 2 of 2, complete, including the metering popup | not needed | **batch 1**, lift only |
| Metro | none (marked free) | all | — | — | free |
| MSNBC | none (Piano loads, no flag) | all | — | — | free |
| National Post | paywall (flag false) | **cut** on the server: one paragraph, then `.pmd-paywall-trimmed-marker` | 1 snapshot for the sample checked: 37 paragraphs, photos, a video player to skip | `div[role=region]` (found automatically) | **batch 3**, archive.today swap |
| NBC News | none (marked free) | all | — | — | free |
| News.com.au | some premium expected | not checked (403) | **0 of 2** | — | parked |
| Newsweek | metered (flag false, `.meteredContent`, Piano) | **all** | 1 of 2, ~10k | not needed | **batch 1**, lift only |
| NPR | none | all | — | — | free |
| PBS | none | all | — | — | free |
| Politico | none (flag false on every article, but the page data says `free_paid_content: free`) | all (the samples are short news items) | 1 of 2, short | `main#main` | **batch 5**: free |
| Reuters | paywall / sign-in (flag false, `hasPart .paywall-…`; 4 paragraphs on the page) | cut | **0 of 2** | — | parked |
| Sky News | none expected | not checked (bot check) | — | — | free, confirm |
| TalkTV | — | Bing has no recent articles; the site may be gone | — | — | free, confirm |
| The Age | paywall (flag false, `.paywall`, Piano) | **cut** (~5 paragraphs) | 1 of 2 (the other timed out), ~7.4k | `main#content` | **batch 2** (Nine, with SMH) |
| The Australian | hard paywall expected | not checked (403) | **0 of 2** | — | parked |
| The Daily Telegraph (Australia) | paywall expected | not checked (403) | 1 of 2, **cut** (~0.9k) | — | parked |
| The Daily Telegraph (UK) | metered / premium expected | not checked (the site didn't load) | 1 of 2, complete (~11k) | `main#main-content` | **batch 2** |
| The Economist | hard paywall (flag false, Zephr) | cut (4 paragraphs on the page) | **0 of 2** (newsletters; an earlier sample was an empty page) | — | parked: retry with regular articles |
| The Free Press | paid posts (Substack, `audience: only_paid`) | **cut** on the server: 146 of 1,554 and 333 of 2,170 words | the preview only (445 of 2,170 words, the paid-subscriber box captured) | `div[role=main]` | **parked**: archive.today has previews |
| The Globe and Mail | paywall (flag False, Zephr + Sophi) | **all** (~6.6k) | 2 of 2 | `article#content-gate` | **batch 1**, lift only |
| The Guardian | none (marked free) | all | — | — | free |
| The Hill | none expected | not checked (connection timeout) | — | — | free, confirm |
| The Spectator | metered (flag false, `hasPart .paywalled-content`, Piano); wall not seen in 5 articles | **all**: `.non-paywalled-content` + `.paywalled-content` match `wordCount` | not checked | `.entry-content` | **batch 3**, lift only (now spectator.com) |
| The Sun | none (Zephr loads, no flag) | all | — | — | free |
| The Sydney Morning Herald | as The Age | **cut** | 2 of 2: ~5.4k, ~1.1k | `main#content` | **batch 2** (Nine) |
| The Times | hard paywall (flag false, Zephr) | **cut**: only a 50-character summary | 1 of 2, and **it's the paywall page** (`div#paywall-takeover`) | — | parked: archive.today captures the wall |
| The Wall Street Journal | hard paywall (flag false, `.paywall`) | cut (~5 paragraphs on the page) | 2 of 2, 6–8k | `div#__next` (narrow down; comments sit in `#comments_sector`) | **batch 2** |
| The Washington Post | metered (flag false, `.meteredContent`) | **cut**: ~1.2k per article, and each page carries 7 articles | both lookups returned the same snapshot, ~1.8k per article | — | parked: needs a closer look (earlier samples were complete) |
| Time | probably none (Piano loads, no flag) | all | timed out | — | free, confirm |
| Toronto Star | paywall (flag false, Laterpay) | **all** (`itemprop=articleBody` 6.7–14k) | **0 of 2** | — | **batch 1**, lift only |
| USA Today | none (flag true); Admiral's ad-blocker popup | all | 0 of 2 | — | **batch 5**: supported for the popup |

## What this changes in the plan

- **Batch 1 is new, and cheapest:** five sites send the whole article and hide it in the browser.
  The New Yorker approach (take the cover off, no archive.today) should work without a snapshot.
  Before building, the user should say which of them actually show a wall, since ad blockers may
  already stop Piano and Zephr.
- **The Washington Post and The Economist move to parked.** WaPo's signed-out page and its newest
  snapshot both carry only ~1.2–1.8k per article. The Economist's newsletter samples weren't
  archived at all.
- **Nine** (The Age, SMH) is the one family that showed up clearly, with the same markup and
  marker on both. The News Corp Australia family is parked, since archive.today barely has it.
- **Parked sites need another source** or a later recheck. archive.today doesn't have them
  (Reuters, The Australian, News.com.au, La Libre), or captures the wall itself (The Times).

## Step 2: shared pieces (version 0.9.5)

Built so that most outlets above need only an adapter's settings (`extension/src/adapter.js`;
see "Adding a site" in the README):

- **Wall checks from the JSON-LD.**
  - `cutBody`: the article is flagged paywalled and its body is cut short. This was The
    Atlantic's check, now shared, and The Atlantic uses it.
  - `textOnPage`: is the whole article on the page? It compares the body's words with the
    JSON-LD `wordCount` or `articleBody`. If so, the wall is only lifted (`'lift'`); if not,
    archive.today fills in.
  - `anyShown`: a wall element with content is on the page.
- **Paywall services.**
  - Piano: `.tp-modal`, `.tp-backdrop`.
  - Zephr: `[data-zephr-outcome-label]`.
  - An adapter lists its site's (`wall.services`). Lifting the wall hides them, and hides them
    again if the service draws them again. Piano's modal also serves as the wall check.
- **Taking the cover off** (any adapter):
  - `wall.hide` hides the wall's elements.
  - `wall.reveal` shows text the site hid (display: none, a max-height, fades, blur).
  - `wall.unlockScroll` (on by default for new sites) undoes `overflow: hidden` on `<html>` or
    `<body>`, or a pinned `<body>`.
  - All of it is undone when the reader asks for the site's version.
- **Snapshot body by default:** `[itemprop="articleBody"]`, `[name="articleBody"]`, then `auto`.
  `auto` takes the id / itemprop / role / name block holding the most paragraphs, which is how
  the survey's markers were found, then narrows into it. Navigation, headers, footers, asides,
  forms and links don't count.
- **Not yet checked against real pages.** The tests use synthetic pages shaped like the survey's
  findings. Batch 1 is where these meet the real sites.

## Batch 1, built (version 0.10.0)

Measured in the user's Chrome (ad blockers on), and from the pages each site sends. Structure
and counts only. All five are built from shared pieces (`defineSite`), so each adapter is
mostly settings.

| Site | Wall seen? | What it is | Adapter |
| --- | --- | --- | --- |
| Los Angeles Times | **yes**, past the meter | Metering popup `modality-custom-element[name=metering-modal][role=dialog]`, drawn in a shadow root. Scrolling is locked by `body.met-panel-open` (overflow hidden). The whole article (19 paragraphs, 1,124 words, matching the JSON-LD `articleBody`) is underneath, none of it hidden. | Wall = that class or the popup showing. Hide the popup, unlock scrolling, lift only. |
| Toronto Star | not measured (Chrome blocked the extension tools on the page; another extension seems to be in the way) | From the HTML: `#article-body[itemprop=articleBody]` holds 2 `.subscriber-preview` blocks and the rest in `.subscriber-only` blocks with `style="display:none"`, for every reader. BLOX's offers popup is `#access-offers-modal`. | Wall = hidden `.subscriber-only` blocks. Show them, hide the popup and Bootstrap's backdrop, lift only. |
| CNN | no (not past the meter) | The whole article in `[itemprop=articleBody].article__content`; JSON-LD `wordCount` 782 and `articleBody` 785 words. Every article is flagged paywalled. Piano's `.tp-modal` sits on the page, hidden. `<html>` has overflow-x hidden (not a lock). | Wall = Piano's modal showing, or the general signs. Lift only when the text matches the JSON-LD's length, else archive.today. |
| Newsweek | no | The whole article in `article.<hash>_articleBody`. Piano slots (`#piano_inline`, `#piano-EOA-unit`). The large fixed "drawer" on the page was the empty comments panel (Viafoura), not a wall. No length in the JSON-LD. | Wall = Piano's modal showing, or the general signs. Lift only with 150+ words on the page. |
| The Globe and Mail | no | The whole article in `article#content-gate` (34 paragraphs visible). Zephr loads. Free articles are flagged "True", paid ones "False". | Wall = the general signs on a paid article. Lift only with 150+ words. |

The general signs (`adapter.walledArticle`): the article is flagged paywalled and either its
body is cut short (of the JSON-LD's length, or under 150 words), scrolling is locked, or its
last paragraphs are hidden. `anyShown` now counts only elements that are drawn, since Piano keeps
its modal on the page, hidden.

Still to check: the walls on CNN, Newsweek and The Globe and Mail, once the user's profile is past
their meters, and the Toronto Star in a browser.

### After first use (version 0.10.1)

- **LA Times subscribe popup still up on newsletter pages** (`/california/newsletter/…`). The
  adapter only took `/…/story/…` addresses as articles. It now takes newsletters too.
- **LA Times "For subscribers" long-form page: text and photos missing.**
  - The article text is sent, but inside `div.subscriber-content.hidden`. The classes
    `.subscriber-content` and `.hidden` both set `display: none`, and the 15 photos in that
    block never load while it's hidden. Shown, they load as they scroll into view.
  - The same block holds 35 of 39 paragraphs on a newsletter page, behind 4 preview paragraphs.
  - It isn't tied to `body.met-panel-open`: removing that class changed nothing.
  - The adapter's body selector (`article.story > .ct-rich-text-children`) had matched the
    bulleted summary first. The body is now every `.ct-rich-text-children` holding paragraphs
    directly (`:has(> p)`).
  - The hidden block is revealed, and a hidden one also counts as a wall when no popup shows.
- **Lift-only threshold lowered from 90% to 75%** of the JSON-LD's length. The long-form page's
  paragraphs held 971 of the 1,052 words in its `articleBody` (92%, close to the old line). A cut
  page keeps only its preview.
- **Not explained:** in the user's incognito window the long-form page showed its text but not
  its photos (a blank lead photo, an author photo showing its alt text). That couldn't be
  reproduced in their main profile.

### After first use (version 0.10.2)

- **LA Times subscriber-only review: the popup came off, the text stayed hidden.** The page had
  sent the whole review: 2 preview paragraphs, then 14 in `.subscriber-content`, 581 words
  against 578 in the JSON-LD. The extension had marked the block to be shown, but one of LA
  Times' hiding rules is `display: none !important`. At equal specificity a page's own rule beats
  an extension's, so the block stayed hidden. A more specific rule showed it.
- **Change:**
  - Revealing hidden text and unlocking scrolling now set `display` / `overflow` (and
    `position` for a pinned `<body>`) as inline `!important` styles, which outrank any
    stylesheet. Undo puts the old inline values back.
  - The matching rules in `content.css` are also more specific (doubled attribute, under
    `html body`), as a backup if a site rewrites the inline style.

### Ad-blocker popups (version 0.10.3)

- **LA Times "turn off your ad blocker" popup** over the article, with the page dimmed. It showed
  in the user's screenshot, but never appeared in their main Chrome profile. There, after 10 s
  and a scroll through the page:
  - no element mentioned an ad blocker, shadow roots included;
  - nothing covered the screen;
  - Google's messaging script (Funding Choices) wasn't loaded, and no other ad-block-recovery
    service was.

  So its markup is unknown. It most likely depends on the window (incognito) and what the
  ad blocker lets through there.
- **Change:** `src/notices.js`, on every supported article page, wall or no wall. It finds a
  notice by what it says:
  - It looks at elements drawn on top: position fixed (children and grandchildren of `<body>`),
    or dialogs anywhere (`role="dialog"`, `aria-modal`, `<dialog>`), shadow roots included.
  - The text must be under 2,000 characters and mention an ad blocker. Google's
    `.fc-ab-root` counts by name.
  - It hides the notice's outermost fixed container and any dimming layer next to it (fixed,
    almost no text, covering at least 80% of the screen), and unlocks scrolling. All of this is
    done with inline `!important` styles.
  - It keeps watching, at most every 250 ms, for 10 minutes. It ignores the extension's own
    elements and isn't undone with the wall.
- **Not yet seen working against the real popup.**

### Keeping the reader's place (version 0.10.4)

- **The ad-blocker popup lost the reader's place** (user report). The wall lift already noted
  where the reader last scrolled to themselves (`scroll.js`) and put them back after
  (`keepPlace`). Hiding a notice did neither.
- **Change:**
  - `notices.watch` now calls `beforeHide()` before hiding (the content script notes the place)
    and `onHide(hidden, place)` after (it puts the reader back, holding the place for 1.5 s
    against the site scrolling on its own).
  - Wherever the extension unpins a `<body>` pinned at `top: -Npx` (both in notices and when
    unlocking scrolling under a wall), it scrolls back to N. A pinned body keeps the page looking
    still while the scroll position drops to 0.

### Still jumping (version 0.10.5)

The popup couldn't be made to show in the user's main Chrome profile or the built-in browser.
There, with real wheel scrolling recorded, the page never scrolled on its own and nothing locked
scrolling. Two bugs were found in the code instead, each enough to lose the reader's place:

- **The reader's scrolling never counted after an LA Times lift.**
  - `scroll.js` ignores scrolling while a wall shows, and asks the adapter whether one does.
  - LA Times leaves `body.met-panel-open` in place after the popup is hidden, and the adapter
    reads that class as a wall. So every scroll was thrown out, and the reader's place was
    never known.
  - When a notice then moved the page, the extension "kept" wherever the page was at that
    moment.
  - Scrolling now counts once the extension has lifted the wall.
- **The notice watcher went blind after any lift.** It skipped the extension's own elements by
  looking for an `nytfix-` class on any ancestor, and `<html>` carries `nytfix-active` while a
  wall is lifted. It now looks below `<body>` only.
- **Also:**
  - The watcher reacts within 100 ms (was 250).
  - Each hide logs a console line ("hid an ad-blocker notice") with the scroll position and the
    scroll locks before and after. Next to "keeping your place", that shows what happened if
    the page still jumps.

### What moves the page on LA Times (version 0.10.6)

Found by reading LA Times' own scripts. The popup itself never showed for us, and its wording
isn't in any script on the page, so it's most likely a template fetched when it opens.

- **`meteringjs/latspot.js`** shows LA Times' popups as "reactions":
  - Many wait until the reader scrolls past a set point (`window.scrollY >= …`).
  - The modal kind then calls `window.scroll({ top: 0, behavior: 'smooth' })` before opening.
  - Other kinds call `window.scrollTo(0, 0)` as they show.
  - Closing removes `met-panel-open`.
- **`modalityjs/latest.js`**, the popup framework:
  - Opening a popup with scroll lock notes `scrollY` and sets `body.style.overflow = 'hidden'`.
  - On touch screens it also pins `<body>` (`position: fixed; top: -<scrollY>px`) and scrolls
    back on close.
- **Why the reader's place was lost:**
  - The glide to the top usually starts while the reader is scrolling down past the trigger.
    `scroll.js` took any scroll within a second of input as the reader's, and a smooth scroll's
    small steps never looked like a one-frame jump. So it recorded the glide as the reader.
  - A popup opening after the wall was lifted (the metering one again, or the ad-blocker one)
    sent the page up with nothing to bring the reader back.
- **Change:**
  - `scroll.js` notes which way the reader's input goes: the wheel's `deltaY`, scrolling
    keys, Shift+Space for up. A move of more than 50 px the other way is `against input`, not
    the reader. A jump to the top right after the reader asked to go up (Home, Page Up, wheel
    up) now counts as theirs. It used to be rejected.
  - New `onJumpUp(position, top, verdict)`: the page went more than 300 px above the reader's
    place without them.
  - The content script then puts the reader back, once it has lifted a wall or hidden a notice
    on that page. It pauses for 1.5 s after moving the page itself (`keepPlace`, the archived
    text going in). It logs "the page scrolled up by itself".

## Batch 2, built (version 0.11.0)

The live pages were seen in the built-in browser, a fresh profile, so the walls were actually
up, and WSJ in the user's Chrome. The newest snapshots were run through the real extractor
inside archive.ph in the user's Chrome. Only counts and structure were recorded.

| Site | Live page (cut) | Wall | Snapshot, as extracted |
| --- | --- | --- | --- |
| WSJ | 4 paragraphs in `article .crawler > section`, 2 of them hidden. Flagged paywalled (`hasPart .paywall`). | Piano's snippet overlay, `[id^=cx-snippet]`, in a wrapper div after the text. | 33 paragraphs, 2 subheads, 2 photos (one sample; the other's `/newest/` took 92 s and returned 504). The byline's "By" / "and" and the dateline are junk; comments (`#comments_sector`) skipped. |
| The Age | 2 paragraphs (77 words) in a div directly under `main#content .article.paywall`; hashed class names. | Piano slots by id (`#paywall-prompt-wrapper-piano-id.paywall-prompt-piano-active`, `#hard-reg-wall-piano-id`, `#soft-reg-wall-piano-id`, `#meter-prompt-piano-id`…); `<body>` overflow hidden inline. | 41 paragraphs, 6 photos, from `main#content`. "Most viewed" / partner tiles after the text are `<section>`s (skipped); share labels are junk. |
| The Sydney Morning Herald | Same as The Age (2 paragraphs, 75 words), same Piano slots and lock. | Same. | 31 and 8 paragraphs (two samples). A video player's labels were in one; video players (`[aria-label="Video Player"]`) and their labels are now skipped on every site. |
| Der Spiegel | Spiegel+: none of the text. `div[data-area=body]` holds only the offer block `[data-area=paywall]`. Free articles: paragraphs without a class in `div[data-area=text] > div.RichText`. | The offer block. (A fresh profile also gets a consent prompt that locks `<body>`.) | 10 paragraphs (Spiegel+ sample), 9 (free sample). |
| Le Monde | 4 paragraphs (`p.article__paragraph`) in `article.article__content`. The JSON-LD's `hasPart` names `.article__reserved-content`, which isn't on the page. | `section.paywall.js-paywall`. The cookie-consent wall (`.gdpr-lmd-wall`, pay-or-accept) is a separate choice and is left alone. | 16 paragraphs, 2 subheads, after dropping 4 "Read more" labels and the link-only titles after them. |
| The Daily Telegraph | **Not built.** telegraph.co.uk didn't load when it was checked, so its pages couldn't be looked at. | — | 1 of 2 archived in the survey, complete (`main#main-content`). |

New in the core along the way:

- **Paragraphs inside a wall don't count** (the adapter's `wall.hide`, or `live.exclude`), for the
  page's text length and for the styling the archived text copies. Spiegel's offer block sits
  inside the article body.
- **`live.textTemplate`**: the wrappers to put archived paragraphs in when the page kept none of
  its own (Spiegel+).
- **Snapshots, on every site:**
  - A line or heading that is only a link (and under 160 characters) is dropped. These are
    "Read more" titles and headline tiles.
  - Video players and video.js control labels are dropped.

### After first use (version 0.11.1)

- **WSJ: the panel stayed up and the text didn't load.**
  - On that article the wall was Piano's offer panel fixed at the bottom of the screen
    (`#cx-candybar`, its offer in an iframe, 515 px tall), with `#cx-scrim` and
    `#cx-sign-in-reminder`. The adapter only hid the snippet overlay. Every `cx-` element but the
    menu's subscribe button is now hidden, and the panel counts as the wall.
  - archive.today had a single capture of that article, an empty 38 KB shell with no article in
    it. The failed-capture pattern from the survey. The error now says the snapshot has no article
    text (captures fail) and that archiving the page again usually fixes it.
- **The Age / SMH: the archived text landed below "Most viewed", with the site's own two
  paragraphs still showing.**
  - Nine sends the whole article in its HTML (22 paragraphs in 5 blocks, fetched without
    cookies). It cuts it in the browser to 2 paragraphs in one block, and React may redraw.
  - The extension can act while that happens. If the body isn't there when the archived text
    arrives, the text goes at the end of the page. If the body is redrawn, the site's own
    paragraphs come back.
  - **Change:** for 30 s after a swap, every 500 ms, the extension checks that the archived text
    is still inside the article body and none of the site's paragraphs are showing again
    (`render.swapIntact`). If not, it swaps again, up to 5 times.
  - Replayed on The Age's real page (its HTML, cut the way the browser cuts it, in jsdom):
    swapped into the body; after a simulated redraw, put back within about a second.
  - Archived paragraphs no longer get the fallback styling when the site's own are unclassed
    and straight in the body. A plain div lets them take the body's styling.
- **Le Monde: not automatic, text repeated, grey box.** That was a long read (M le mag):
  `article#Longform`, the text in `section.article__content`. The adapter looked for
  `article.article__content`, so it found no body.
  - Nothing was detected.
  - A manual run put the text at the end of the page, in the fallback styling and over the
    paywall section's grey background, with the site's paragraphs still showing.
  - The body is now `.article__content:has(> p)`, which covers both layouts.
- **Der Spiegel: lots of ads.** Those are the page's own ads. The extension doesn't block ads; an
  ad blocker does that better.
- **Testing without the user:**
  - Le Monde and WSJ answer scripts with bot checks (402, 401).
  - Le Monde's pages can't load scripts from a local test server.
  - So the real-page replays were The Age and Der Spiegel (their HTML in jsdom, the real content
    scripts, a made-up snapshot), plus an end-to-end run on The Age in the built-in browser
    (scripts served from a local server, API stand-ins).

### After second use (version 0.11.2)

- **WSJ: the text arrived but only two paragraphs showed.** The user saved the page. The swap
  had worked: 62 archived paragraphs inside the article body. WSJ's stylesheet hides every
  paragraph in the body after the second (`p:nth-of-type(n + 3) { display: none }` on the body
  section), and draws a 136 px white fade over the body's end in its `::after`. Both applied to
  the archived text too.
  - **Change (all sites):** while the body holds the archived text it's marked
    `data-nytfix-swapped`, and `content.css` shows every archived paragraph and drops the body's
    `::after`. Checked on the saved page with WSJ's own CSS: 2 of 62 paragraphs drawn before, 62
    after.
- **The Herald: the text still landed below "Most viewed", and the "subscribe to comment" box
  showed. The Age: the text was broken up.** The 0.11.1 guard wasn't the problem; the body
  selector was. Seen in the user's Chrome (a wide window):
  - In a wide window, Nine puts the body a level down, in a column next to an ad rail, with the
    article footer (Save / Gift / Share, tags, the author's bio, the comments prompt, "Most
    viewed") after it in the same column. `.article > div:has(> p)` matched nothing, so the text
    went to the end of the page in the fallback styling, and the site's two paragraphs stayed.
    (The built-in browser's pane is narrow, where the body is a child of `.article`; that's the
    layout 0.11.1 was checked in.)
  - Opinion pieces put the standfirst (a classed `<p>`) and the share buttons in a div of their
    own under the headline. That div was the one match, so the archived text went into the
    headline area, styled as the standfirst, and the site's own paragraphs showed below it.
  - **Change:** the body is the div of unclassed `<p>`s inside `.article`, leaving out the
    header, anything under a `data-testid` (share buttons, author, footer) and Piano's slots.
    The same single div in both widths and on the saved full page (5 blocks there).
  - The comments prompt (`#comments-cta-piano-id`, a Piano iframe) is hidden with the rest of
    Piano's slots.
  - Checked at 1600 px in the built-in browser on the user's Herald article and an Age opinion
    piece (scripts from a local server, a made-up snapshot): the text in the body column, the
    site's paragraphs hidden, the footer after the text, the standfirst kept, the comments box
    gone.

### Stopping the cut instead of fetching (version 0.11.3)

- **The Age / the Herald showed the article, then cut it a second or two later.** The user asked
  whether the wall could be stopped instead of fetching from archive.today, and that this become
  the first option for every new site: it's the fastest.
- **How Nine cuts:** the page carries the whole article (the Herald sample: 27 paragraphs in its
  HTML and in `window.APOLLO_STATE`). Piano decides the reader gets the wall and fires a
  `pianoContentWall` event at window, `detail.type` `payWall` (or `regWall`, and `scrollLock`).
  Nine's React code listens for it, cuts the body (`blocks.slice(0, 2)` in the article
  template) and locks scrolling. `NO_PAYWALL` undoes a `payWall`. Piano draws its subscribe box
  itself (the `-piano-active` classes).
- **Change:** `page/nine.js` runs in the page's own world (`"world": "MAIN"`, `document_start`)
  and holds those events back, marking `<html data-nytfix-held>`. The adapter reads that as a
  wall (`adapter.wallHeld`) and, with the body whole, lifts it: Piano's box hidden, nothing
  fetched. The reader asking for the site's version lets the held events through
  (`nytfix:release`); running the extension again holds them and sends `NO_PAYWALL`
  (`nytfix:hold`). If the article is cut anyway, archive.today fills in as before.
- **Checked on the live pages** (built-in browser): the article's own HTML written into a frame
  with the guard loaded first, then the content scripts.
  - Without the guard: Piano fired `payWall`, the body went to 2 paragraphs and scrolling locked.
  - With it, on the Herald: `payWall` held, all 27 paragraphs kept, no archive.today request,
    the box hidden, status "Removed The Herald's wall".
  - On an Age opinion piece: `payWall` fired twice, both held, 22 paragraphs kept, nothing
    fetched.

## Batch 3, built (version 0.12.0)

The first batch built with the rule the user set after The Age and the Herald: first find out
whether the page already carries the article, and stop or undo the cut there; archive.today is
for sites that never send the text.

| Site | What the page sends | Wall | Adapter |
| --- | --- | --- | --- |
| Corriere della Sera | The whole article, premium ones too, in `div.content` blocks (`#content-to-read`). JSON-LD `articleBody` and `wordCount` match (650 of 650, 498 of 496, 812 of 793 words; no cookies). | Piano (tinypass). Not seen: a fresh profile isn't past the meter. A cookie-consent wall pins `<body>`; `.modal-access` is a "reading on another device" notice. | Lift only: Piano's modal, or text cut or hidden. Locked scrolling doesn't count (the consent wall). |
| The Spectator | The whole article: `span.non-paywalled-content` and `span.paywalled-content` in `.entry-content`, matching `wordCount` (1,051 of 1,051; 811 of 838). spectator.co.uk now redirects to spectator.com. | Piano (Zephr's markers are left over). Not seen in five articles in a fresh profile. | Lift only: show `.paywalled-content`, hide Piano's boxes, the white fade (`.reggradient`) and the offer slot under the article. |
| National Post | One paragraph (about 30 words), then `.pmd-paywall-trimmed-marker`; JSON-LD `wordCount` 891 and 1,587. Nothing else on the page holds the rest. | The server's trim. Its ad-blocker notice (Admiral, random class names) covers the page and locks scrolling; notices.js hides it. CSS keeps the body invisible until Naviga Engage decides. | archive.today swap (the body made visible); the snapshot's video player (`pm-jw-player`) skipped. |
| The Free Press | Substack: the preview only (146 of 1,554 and 333 of 2,170 words in its page data). | Server-side. | **Parked:** archive.today's copy is the preview too (445 of 2,170 words, with the paid-subscriber box). |
| De Telegraaf | Not seen: Cloudflare's bot check ("Just a moment…") stops the built-in browser and Chrome driven by the tools, and plain requests get 403. Not to be clicked through. | — | **Waiting** on an article page the user saves from their own Chrome. |

- **Checked on the live pages** (built-in browser, content scripts injected): The Spectator and
  Corriere were left alone with no wall up (Corriere with its consent wall showing); with a wall
  added the way it would come (The Spectator: the paid part hidden and scrolling locked;
  Corriere: Piano's modal), it came off with nothing fetched. National Post sends automated
  browsers to TollBit (402), so it was checked in the user's Chrome (structure) and on its
  archive.today copy (extraction).
- **Shared changes:** the extractor skips any video player labelled "Video Player…" (JW Player
  adds the title); a body holding archived text is made visible (`data-nytfix-swapped`);
  `walledArticle` can leave locked scrolling out (`locked: false`); `visible()` without
  `checkVisibility` (tests) also looks at ancestors.

### After first use (version 0.12.1)

- **Corriere: an ad-blocker popup on the homepage, and the paywall on an article shortly after
  load** (milano.corriere.it).
  - The extension only matched www.corriere.it; the local editions (milano., roma., …) are the
    same platform. Corriere now matches `*.corriere.it` (adapters' `hosts` take `*.domain`), and
    keeps the edition's host for archive.today.
  - Corriere's script loader (rcs_orchestrator) starts modules on events. `adblockActivated`
    (document) loads rcs_anti-adblocker, the "non usare il blocco della pubblicità" popup.
    `pno_abc_test:init` (window, once Piano decides) starts AbcTestPaywall, which by an A/B-test
    cookie either deletes every block after the first from `#content-to-read` (inline wall,
    `#pno_wall_inline`) or locks scrolling under Piano's modal (`tp-scroll-prevented`).
  - **Change:** `page/corriere.js` holds both events back, so the popup never loads and the
    article isn't cut. Only the wall's event marks `data-nytfix-held`. The content script lifts
    whatever Piano still draws (its modal, the inline wall) with nothing fetched.
  - As a fallback, ad-blocker notices are now looked for on every page of a supported site, not
    just articles, and in Italian, German, French, Dutch and Spanish too.
- **The Spectator: the wall stayed, and the extension said the page already had the full text.**
  Magazine articles get the wall at once: `.entry-content` clipped to `max-height: 650px` with
  overflow hidden, the rest of the text still inside, under a white fade and above Piano's offer
  box. Nothing was hidden or missing, so it wasn't seen as a wall; a click went to archive.today,
  whose copy was shorter than the page.
  - **Change:** a clipped body is now a sign of a wall (`adapter.clipped`, in `walledArticle`);
    lifting takes the clip off `.entry-content` and hides the fade and the offer box. Checked
    on the live article: 650px to the whole text, nothing fetched.
  - Locked scrolling no longer counts on The Spectator: its wall doesn't lock it, and
    Sourcepoint's consent dialog can.
- **The Free Press:** paid posts never reach a signed-out reader. Every public copy checked has
  only the preview: the page (146 of 1,554 words), its RSS feed (150–270 words for paid posts),
  archive.today (445 of 2,170) and the Wayback Machine (333 of 2,170). Stays parked.
- **De Telegraaf:** the user has it open in an incognito window, which the tools can't reach;
  waiting on a saved copy of an article page.

### After second use (version 0.12.2)

- **Corriere (corrieredibologna.corriere.it): the article loaded, then the page went white a
  couple of seconds later, and archive.today had nothing.**
  - Corriere checks for private windows (`trvImode.iMode()`, kept in sessionStorage as
    `FP_PRVT_USER`) and tells Piano (`privateBrowser`). In a private window, once the cookie wall
    is answered, Piano puts up `.tp-modal.wall-modal` over a near-opaque backdrop and, about 4 s
    in, removes `#content-to-read`, then `section.body-article`, then the `div.container` around
    them, leaving `main .wrapper.has-wall` empty: headline and article gone. Lifting the modal
    left a white page; the "cut" page went to archive.today, which had no copy of a same-day
    local story.
  - Reproduced in the built-in browser by setting that flag and accepting the cookie wall (with
    the user's OK).
  - **Change (all sites):** `live.keep` names parts of the article a wall deletes;
    `render.keepOnPage` puts back anything removed that is or holds one, in the same
    MutationObserver round (before paint), nested removals included. Other changes (ad slots,
    players replacing placeholders, moves) are left alone. Corriere keeps `#content-to-read` and
    the headline. Checked live: the wall came at about 4 s; the article stayed whole and drawn,
    the modal and backdrop came off, scrolling worked, nothing fetched.

### After third use (version 0.12.3)

- **Corriere: the article stayed, but the nav bar and more were gone.** From the page the user
  saved, and a recording of every removal on the live page: the private-window wall removes, in
  one moment, the header's top bar and section menu (`#l-header > div > .container`, twice), the
  main `div.container` with `section.body-article` and `#content-to-read`, the right-hand column
  (`.aside-right`) and the footer's content (`#l-footer > div > .container`). 0.12.2 kept only
  the article.
  - **Change:** Corriere's `live.keep` names all six. Checked live in the private-window state:
    the wall removed all six; all six stayed on the page and drawn, the wall box came off,
    nothing fetched. Corriere's own widgets that redraw themselves (comments, tags) are left
    alone.

## Batch 4, built (version 0.13.3)

The parked sites rechecked with the prevent-first rule: does the page carry the whole article
(HTML, page data, JSON-LD), even when archive.today has nothing? Scripted requests are blocked
on most of them (DataDome on Reuters, Cloudflare on The Economist, Akamai on News Corp, a
challenge on The Times, no connection to The Washington Post), and the built-in browser refuses
thetimes.com and needs approval for lalibre.be, so the checks ran in the user's Chrome.

| Site | What the page sends | Verdict |
| --- | --- | --- |
| Reuters | **Everything**: a 1,053-word story had 1,048 words in 26 blocks of its Arc page data (`fusion-metadata`, `result.word_count`) and all 25 paragraphs drawn (`div[data-testid^=paragraph-]` in `[data-testid=ArticleBody]`). Two other samples were short bulletins (38 and 47 words), not cuts. The wall: a metered modal, `[data-testid=Modal]` holding a `paywall-modal-module` dialog, scrolling locked on `<html>` and `<body>`. | **Lift** (`sites/reuters.js`): hide the modal, unlock scrolling. Matched on the stable part of the hashed class names. Nothing clips the body (no max-height, overflow visible, the hashed paywall class and `over-6-para` included). Its stylesheet also has an inline wall (`article-wall-module__paywall`), not seen on screen; it's treated the same. The modal is metered, so a test may show no wall at all. |
| La Libre Belgique | **Everything**: `#story-preview-MEMBER` (2 paragraphs) and the rest in `#story-content-MEMBER.is-hidden` (9 paragraphs, 331 words) inside Piano's slot `#piano-paywall-MEMBER`; the page data (`Fusion.globalContent.story_elements`, 16 blocks, `articleLength.full` 2,751 characters) holds the same. La Libre's component unhides the rest for subscribers only. Then Piano fills its slot with an offer (`div.tp-container-inner > iframe#offer-…`), wiping the text: about 9.4 s in, against a page load at 4.8 s. | **Keep + lift** (`sites/lalibre.js`): the rest is kept on the page (`live.keep`), shown, and the offer hidden. `.is-hidden` collapses the rest (height 0, opacity 0, overflow hidden) instead of `display: none`, which the browser still counts as visible, so the class is the wall sign; the reveal styles uncollapse it, and the preview's white fade (`.is-preview::before`) is dropped. Piano's slot only sets `min-height: 500px` and grows with the text. Replayed on the real page (jsdom, the real content scripts, La Libre's hiding rule, the wipe simulated): shown at start, put back after the wipe, nothing fetched. If the wipe ever beats the extension, the page data could rebuild it (not built). |
| The Washington Post | Cut on the server: the page data (`__NEXT_DATA__ … globalContent.content_elements`) ends after one paragraph with a `subscribe-cta` element (two samples). A 945-word string in `contentState` is head markup (17 scripts, 51 links). archive.today's copy of one sample had the same 200 words; the other had none. | Parked. |
| The Times | No article text: the summary (`.entry-summary`, the JSON-LD's free part), then Zephr's paywall box, scrolling locked. No page data. archive.today captures the wall (survey). | Parked. |
| The Australian, The Daily Telegraph (Australia) | Premium stories: the server answers with a redirect to `/subscribe/…?mode=premium` (`fetch(…, {redirect: 'manual'})` from the site's own page: `opaqueredirect`). No article reaches the browser. | Parked. |
| News.com.au | The sample was a free story (200, 33 paragraphs, 915 words). Its premium stories are assumed to go through the same platform redirect (not observed). | Free stories need nothing; premium parked. |
| The Economist | Not seen: Cloudflare's check ("Just a moment…") in the user's Chrome driven by the tools (twice); not clicked through. | Waiting on a saved page. |

- **Shared changes:** `render.keepOnPage` puts a node back at most 5 times (`maxPutBacks`), so a
  site that keeps re-deleting it can't loop with the extension. Revealed elements drop gradient
  backgrounds in their `::before` / `::after` (fades drawn over the hidden text).

### Live checks (2026-11-15, the user's Chrome, before the user's own test)

The extension in Chrome was still the previous version. On La Libre the lift was replayed by
hand on the live pages: render.js's `keepOnPage` and content.css's hide, reveal and unlock
rules were pasted in, with the adapter's selectors. Reuters was only probed: the wall's
selector, the paragraphs and the scroll lock. Its lift is covered by the jsdom test alone.
Counts only.

- **La Libre, two subscriber articles** (one `MEMBER`, one `PAYING`): Piano's offer wiped the
  rest once, within 4 s of the lift. It was put back at once and was still there 16 s later
  (372 and 1,838 words, opacity 1, 2,115 and 6,556 px tall). The fade was gone, the offer
  hidden, and the page scrolled with the wheel. Didomi's consent popup class leaves `<body>` at
  `overflow: hidden`; `<html>` is the scroller. The replay skipped the extension's default
  scroll unlock, which will set `<body>` to visible. No visible change is expected.
- **La Libre, 30 front-page links:** all 21 paid ones (19 `PAYING`, 2 `MEMBER`) had Piano's slot
  and the rest sent but hidden (155–1,838 words). The 9 `FREE` ones had no slot, so no wall.
  A `PAYING` case was added to the tests.
- **Reuters:** the one article that loaded showed the metered modal, matched by `MODAL`, over
  all 22 paragraphs (676 of `word_count` 682 words, none hidden, no max-height). Scrolling was
  locked on both `<html>` and `<body>`, so the fixture now locks both and the test checks
  both. The next two article loads got Reuters' bot-protection page, "Access is temporarily
  restricted" (it names developer tools as one cause). Left alone; it should lift by itself.
- **The Economist, De Telegraaf:** still Cloudflare's "Just a moment…" on the home page. Not
  clicked through. Both still wait on pages the user saves.

### The user's test of 0.13.0

- **La Libre: an ad-blocker popup** in the user's incognito window, over a free article: "Vous
  utilisez un bloqueur de publicités !", with "subscribe" and "turn off your ad blocker"
  buttons, the page dimmed. It's a Piano modal with its text in Piano's iframe
  (buy-eu.piano.io), so notices.js, which reads the page's text, never saw it. The check is
  Piano's standard snippet, which La Libre's bundle inserts as `script#piano-adblocker`. It
  clears an `__adblocker` cookie, then loads a bait script, `www.npttech.com/advertising.js`.
  Its `onerror` calls `setNptTechAdblockerCookie(true)`, which sets the cookie to true for
  5 minutes, and Piano's Composer shows the popup to those readers. In the user's main
  window the bait loads, the cookie says false, and no popup shows. In incognito their ad
  blocker stops it. **Fix (0.13.1):** `page/piano-adblock.js`, a page-world guard at
  `document_start`, defines `setNptTechAdblockerCookie` first, as a property the snippet's
  `var` can't replace, and it always records false. A true cookie from an earlier page is
  cleared at once. Tested in jsdom with the real snippet and its `onerror` fired: the cookie
  says false. Without the guard, it says true. Nothing else in La Libre's bundle mentions ad
  blockers.
- **Reuters: after the modal came off, about half the article was cut off and the page
  wouldn't scroll further down** (user's main window). I couldn't reproduce it myself: the
  article metered earlier loaded with no modal, and the next load got the bot-protection
  page again.

### The user's test of 0.13.1

- **Reuters, the cut-off (the user's saved page):** all 17 paragraphs were there (455 words,
  the page data's `word_count`). The modal was gone from the page and `<html>` unlocked. But
  `[data-testid=RegularArticleLayout]` and `[data-testid=MainContent]` carried
  `regular-article-layout-module__restricted`. Reuters' stylesheet caps those at
  `max-height: 150vh; overflow: hidden` and hides the footer container with it. The live-page
  and single-column layouts have the same rules. **Fix (0.13.2):** the class
  (`[class*="layout-module__restricted"]`, not the video players' `…-module__restricted`)
  counts as the wall, and those elements are revealed. Replayed on the saved page with
  Reuters' rules and the real content scripts: both containers went from `max-height` 1,152px
  (150vh in jsdom) with overflow hidden to none and visible. The footer is shown, and nothing
  is fetched. Tests: the modal plus the crop, and the crop alone.
- **La Libre, the ad-blocker popup still showed** on free articles; paid ones get the paywall
  offer instead. Reproduced in the user's main window: the 0.13.1 guard was in place, yet
  `__adblocker` said true. The bait script, `www.npttech.com/advertising.js`, had loaded
  rather than being blocked. It's BlockAdBlock: it plants a 1px off-screen div with ad-like
  classes (`ad`, `adsbygoogle`, `pub_300x250`, …), and if the ad blocker's cosmetic filters
  hide it, it writes the cookie itself. That path skips `setNptTechAdblockerCookie`. It uses an
  existing `window.blockAdBlock` if there is one. Piano's client (`tinypass.min.js`) takes the
  status from `__pac`, then `__adblocker`. `__pac` isn't set here. **Fix (0.13.2):** the guard
  also defines `blockAdBlock` first, as an accessor the site can't replace, whose check plants
  no bait and reports "not detected". Live, on the page in the user's Chrome, the real bait
  script set true without the stub and false with it, even with the cookie set to true just
  before. Tests cover both paths: the bait script blocked, and loaded with the ad blocker
  hiding the bait.

### The user's test of 0.13.2

- La Libre works. Reuters seemed to work, but there was no telling which articles had been
  walled: Reuters meters articles rather than marking some as paid, and the status bar fades
  after 6 s. **Added (0.13.3):** a green ✓ on the toolbar button while a page's wall is off,
  lifted or swapped. Hovering it says which. It's cleared on undo, on in-site navigation, and
  when the reader leaves the page (`pagehide`; Chrome is expected to clear a tab's badge on a
  new page anyway, not confirmed). It's sent again when a page comes back from the
  back/forward cache.

## Batch 5, built (version 0.14.2)

The four outlets left to ask about, checked in the user's Chrome (from the US). The checks
recorded structure and counts only.

| Site | What the page sends | Verdict |
| --- | --- | --- |
| Daily Mail | **Everything**, Mail+ articles included. `div[itemprop=articleBody]` holds every paragraph, subheading and photo: 50 paragraphs and 1,830 words, 53 and 1,811, and 19 and 837 in three Mail+ samples. The JSON-LD marks them paywalled but gives no length. The wall is CSS, four rules, all for `body.is-paywalled-article:not(.is-paywall-processed):not(.is-deepdive-paywall):not(.is-shorthand-paywall)`. On desktop they hide `[itemprop=articleBody] :nth-child(n+3):not(iframe)`, which means every third-or-later child, links and spans inside paragraphs included, and draw a fade in its `::after`. On mobile they do the same past the 27th child. A script also caps the body at `max-height: 20px; overflow: hidden` (inline), and the Mail+ box (`.related-replace-paywall`) follows it. Scrolling isn't locked. American readers are redirected to www.dailymail.com. | **Lift** (`sites/dailymail.js`). A new adapter option, `wall.classes`, gives `<body>` the class the site's rules wait for, `is-paywall-processed`, which no other rule uses. So the text shows as the site lays it out, links staying inline. The lift also takes the cap off (`wall.reveal`) and hides the Mail+ box. Forcing `display: block` on what was hidden would have broken the links. Live, on a Mail+ article, with the same changes made by hand: all 53 paragraphs showed, no link stayed hidden, and the body grew from 20px to 8,208px. The site left the class alone for the 10 seconds watched, and the layout looked normal. |
| USA Today | **Everything**: the JSON-LD marks stories free, and `div.gnt_ar_b` holds them whole (34 paragraphs and 1,309 words; 48 and 1,216). No paywall seen. What shows is **Admiral's ad-blocker popup**, "It looks like you're using an adblocker": a fixed box straight under `<body>`, random class names, 246 characters, scrolling locked on `<html>`. It doesn't show on every visit; a third load didn't get it. | **Supported for the popup** (`sites/usatoday.js`). notices.js hides it and unlocks scrolling, as on every supported site. The general wall checks apply if a story is ever marked paywalled. |
| BBC | Three articles from the US: two news stories and a Culture feature, the only links on the Culture page with a subscriber or lock marker. 28 paragraphs and 846 words, 32 and 1,276, 20 and 496, all drawn. No paywall flag, no wall, only the header's Subscribe button. Piano loads. | Free; nothing built. |
| Politico | Two articles, both short news items: 189 and 99 words drawn. The JSON-LD says `isAccessibleForFree: false`, with `.public-article-content` as the part, but the page data (Nuxt) says `free_paid_content: "free"`, and its longest strings are an embed and an ad script, not more of the article. No wall. | Free; nothing built. |

- **Shared change:** `wall.classes` (`{ selector: class or [classes] }`), in `render.liftPaywall`.
  The classes are added on lift, added again if the site takes them off, and removed on undo.

### The user's test of 0.14.0

- USA Today works.
- The Daily Mail works, but in the user's (incognito) window a blue Mail+ banner stayed after
  the text, "Subscribe to continue reading" with a free-trial offer. A white fade above it
  covered the last lines. That's Zephr's outcome, not the Mail+ box: the site's
  `articleDefer.js` puts a `<template>` holding `div#mol-fe-zephr-outcome-wrapper` right after
  the article body (`…-puzzles-…` and `…-game-render-…` on those pages), and Zephr draws its
  outcome there. The site's stylesheets have no rules for it, so its look comes with Zephr's
  outcome. This profile never got it (it got the Mail+ box), so its inner markup wasn't seen.
  **Fix (0.14.1):** `[id$="zephr-outcome-wrapper"]` is hidden with the rest of the wall, and
  counts as a sign of it. The fade goes with it if it's part of the outcome. A fade on the
  article body itself is already dropped (revealed elements lose gradient backgrounds in
  `::before`/`::after`). Not yet seen on the live page.

### The user's test of 0.14.1

- The banner was still there (the user's examples: a Bryony Gordon column under /debate/ and a
  /tvshowbiz/ story). In this profile it showed too, on the first one. The 0.14.1 guess was
  the wrong element. It's Zephr's **inline** paywall, made by the site's `articleDefer.js`
  (read in the page). It caps the body at the free paragraphs' height (inline
  `max-height`, `overflow: hidden`) and marks it `data-is-inline-paywall-mounted`. Then it
  inserts a new `div.noskim` right after the body (`d.after(p)`) and renders the Mail+
  banner into it, fade included (a `shortGradient` setting). It may add a trending block
  after it (`#mol-fe-paywall-inline-trending`).
- **Fix (0.14.2):** `[itemprop="articleBody"][data-is-inline-paywall-mounted] + .noskim` and
  `#mol-fe-paywall-inline-trending` are hidden with the rest of the wall, and count as signs of
  it. The outcome slot (`#mol-fe-zephr-outcome-wrapper`) stays on the list for Zephr's other
  outcomes. Live, with the banner hidden by hand, the last paragraphs read clearly with no
  fade, and the selector matches that one element. The test page now carries the inline
  paywall's structure.


## Candidates beyond the list, first probe (2026-11-16)

Outlets added to the research CSV on 2026-11-16 (rows 54–77) that were expected to have a wall.
Checked with `tools/probe-outlets.mjs` (3 Bing samples each, signed out), then premium-marked
articles from each home page, fetched by script or from inside the built-in browser.
archive.today wasn't reachable from scripts this time, so its lookups ran in the browser, one
article per site. Structure and counts only. Nothing is built.

| Outlet | Wall | Sent | Snapshot | Next |
| --- | --- | --- | --- | --- |
| ABC (Spain) | flag false on all 3, `hasPart .paywall`, Evolok | **all**: `div.paywall` holds the text (2.2–9.8k), JSON-LD `articleBody` matches (2.9–11k) | not checked | lift candidate |
| El Mundo | flag false, Piano | **all**, premium-marked articles too (2 from the home page: 19 paragraphs and 7.0k, 9 and 2.5k; JSON-LD `articleBody` matches); body in `div.ue-c-article__body` | not checked | lift candidate |
| NRC | flag false, `hasPart .googlebot-article-content` | **all** in the 3 samples (4.0–6.0k, 8–11 paragraphs, `div.vorm__article-content`); JSON-LD gives no length to compare | not checked | lift candidate; confirm against a long article |
| The Independent | Bing samples marked free; 2 Independent Premium articles carry no cut | **all** in the premium samples (35 paragraphs and 15.4k; 31 and 8.9k); a registration wall is mentioned in the markup | not checked | lift candidate; the wall itself wasn't seen |
| Ottawa Citizen (Postmedia) | flag false | **all** in 2 of 3 fresh samples (46 and 49 paragraphs, 5.5–6.1k); no `.pmd-paywall-trimmed-marker`, unlike the National Post | not checked | metered; lift candidate, try `sites/nationalpost.js` markup first |
| Toronto Sun (Postmedia) | flag false | 3.5–5.1k of paragraph text per page, largest cluster about 1k | not checked | unclear; needs a closer look |
| Vancouver Sun (Postmedia) | flag true on all 3 | 2.6–5.6k of paragraph text per page | not checked | probably free or metered; confirm |
| Die Welt | WELTplus: flag false, `hasPart .c-article-page__text.is-paywalled-content` | **cut** on the server (3 samples: about 240 characters in JSON-LD, 4 paragraphs); free articles whole | 1 of 1, same day, 42 blocks and 13.4k | archive.today swap candidate |
| Le Parisien | subscriber articles: flag false, `hasPart .paywall-abo`; the script gets 403 | **cut** on the server (2 samples: 3 paragraphs, under 1k) | 1 of 1, same day, 32 blocks and 8.2k | archive.today swap candidate |
| Bild | BILDplus | Bing samples free and whole (2.0–2.7k). One BILDplus-marked page: flag false, 1 paragraph, 767 characters, but it was a competition page, not an article | not checked | probably cut; needs real BILDplus samples |
| The Jerusalem Post | none seen (flag true) | all (JSON-LD `articleBody` 2.2–3.6k matches the page) | — | free in these samples; premium section not sampled |
| Die Zeit | Z+ expected | not checked: the site didn't load for the script, and the built-in browser got a 403 | — | needs the user's Chrome |
| de Volkskrant | expected | not checked: 403 to the script, and the built-in browser wasn't allowed to open it | — | needs the user's Chrome |
| AD | expected | not checked: 403 to the script; not tried in the browser (same publisher as de Volkskrant) | — | needs the user's Chrome |

Limits: as before, a first-time reader is under every meter, so "all" on a metered site doesn't
show what the wall does once it comes up. One archive.today sample per site is a first look.

## Batch 6, built (2026-11-16; 0.17.0)

The four "lift candidates" from the first probe, looked at in the built-in browser before
building. Structure and counts only. Released in 0.17.0, with the follow-up fixes below (ABC's
message, NRC's cut stopped on the page).

| Site | What was seen | Built |
| --- | --- | --- |
| ABC (Spain) | **Not a plain lift.** The server sends the whole article: the first paragraph, then `div.paywall[hidden]` (19 paragraphs, 13,186 characters in a premium article; the JSON-LD's `articleBody` is 13,332). An inline script marks everything for subscribers with one random attribute and everything for the rest with another, waits for Evolok (`rtim:ev-auth-ready`), and unless the answer is `ALLOW_ACCESS` removes the first kind. Watched in a same-site frame: the page was parsed at 331 ms, `div.paywall` was removed at 1,001 ms, by `exc()` in that script. The ellipsis (`span.c-text`) and an empty `<div>` with `<ev-engagement>` are then unhidden. | `sites/abces.js`: `live.keep` puts `div.paywall` and `span.paywall` back when they're deleted, the lift shows them and hides the ellipsis and the offer. A page already cut when the extension starts goes to archive.today. Nothing is said until the page has decided (`live.wall.decision`, see below). |
| El Mundo | The whole article, premium-marked ones too (4,362 characters on the page against 4,450 in the JSON-LD; all nine paragraphs showing). The consent popup (Didomi, accept or subscribe) was up with `<body>` locked, and Piano's slot was empty: **the wall wasn't seen.** | `sites/elmundo.js`: general signs only (Piano's modal; the text clipped, hidden at its end, or cut short of the JSON-LD). Locked scrolling isn't a sign. |
| NRC | The first article was whole (30 paragraphs, 1,501 words, all showing), with a dormant `div.paywall.hidden.paywall--inline` under `<body>`. **The wall came up on the second** (the meter is in localStorage, `demeter`): the page as fetched still held 29 paragraphs and 11,358 characters, with cookies or without, but the page as drawn kept 1 paragraph of 391. `<body class="has-paywall">`, `<html class="disable-overflow-fixed">` (scrolling locked), and `div.paywall.paywall--hard` (a mask and a container, fixed) under `<body>`. archive.today had a same-day copy of the walled article (47 blocks, 17.4k with the page's other text). No length in the JSON-LD. **The cut, found later the same day** in NRC's `main.js` (`paywall/Paywall.js`): once Zephr and Sophi have decided (five requests in a row, the first starting after the page is parsed: parsed at 1.8 s, last answer at 4.8 s, on a walled article), `show()` locks scrolling, marks `<body>`, shows the block as the hard wall, and `clipArticleContent()` removes every child of the article after the first paragraph, from the last one back. | `sites/nrc.js`: **the cut is stopped on the page.** `live.keep` holds every child of the article, so each goes straight back as it's removed (in order: see below), and the wall then comes off a whole article; the hard wall is hidden and scrolling unlocked. A page cut before the extension starts still goes to archive.today. The sign of the wall is the hard wall, or the end of the text hidden or clipped, never the length alone: some articles are short (a 117-word one, two paragraphs) and the JSON-LD gives no length. Under the hard wall, text the extension put back counts as whole however short (`adapter.cutKept`, `<html data-nytfix-kept>`); otherwise under 150 words goes to archive.today. Health method `lift`, with no word minimum (no length to compare, and short pieces among the samples). |
| The Independent | American readers are redirected to www.the-independent.com; the canonical link stays on independent.co.uk. A Premium article was whole and showing (29 paragraphs, 14,000 characters), scrolling free: **no wall came up.** | `sites/independent.js`, both hosts: general signs only, on articles marked paywalled. |

- **Tests:** `test/batch6.test.js`, eight in `test/content.test.js` (ABC: refused, allowed,
  no answer, already allowed; NRC: a long and a short article cut after the start, a short one
  with no wall, one cut before the start) and two in `test/render.test.js`, with
  `test/fixtures-batch6.js`. They cover the pages' scripts acting
  through the content script, the signs, and what must not read as a wall (the consent lock,
  NRC's dormant block, the Independent's premium wrapper).
- **Checked on real pages with no wall** (the last three long paragraphs drawn, the body not
  clipped): The Independent, El Mundo and ABC read as no wall. `tools/site-health.mjs` passes
  for ABC, El Mundo and The Independent, and for NRC as a swap (its short items run to 77
  words). archive.today had a same-day copy of the ABC premium article too.
- **Reasons** (`src/reasons.js`): NRC, the Erasmus study (one of seven, no figure of its own);
  The Independent, one front page in CfMM's report; ABC and El Mundo, one opinion column.
- **Replayed live, in the built-in browser** (the extension itself can't be loaded there): on
  a page each site had already cut, the article as sent was put back in place, the put-back
  installed as `render.keepOnPage` has it, and the site's own cutting code run on it. ABC's
  refusal branch of `exc()` (Evolok said no for this browser by then): `span.paywall` and
  `div.paywall` back in their places, 19 paid paragraphs. NRC's `clipArticleContent(1)`: the
  article cut from 36 children to 1, all 35 back in order (27 paragraphs). Some ABC pages (an
  interview page, a newsletter sign-up) have no paid part or `.v-d--1` body and aren't
  checked.
- **ABC's false "wall removed", fixed:** an article the reader may read has its paid part
  hidden until Evolok answers too. The lift still happens at once, but the content script now
  waits for the page's decision before saying anything (`live.wall.decision`, content.js
  `awaitDecision`): the paid part deleted and put back is a wall; the ellipsis removed (what
  `exc()` does on `ALLOW_ACCESS`, read in the page's inline script) means there was none, and
  the lift is taken back, silently; no answer in 6 s means the text would have stayed hidden,
  so it's reported (the script only asks Evolok when `enableFrontalAuth` is on). The random
  attributes aren't used.
- **NRC's scroll lock, fixed in 0.17.1** (found in the user's Chrome: the wall came off, the page
  wouldn't scroll): NRC pins `<html>` itself (`html.disable-overflow-fixed { position: fixed;
  overflow: hidden }`, in `paywall.css`, loaded only with the wall). The lift set overflow free
  but only ever unpinned `<body>`, so `<html>` stayed fixed: 768 px tall and still on the real
  page, 2,294 px and scrolling once unpinned. The lift now unpins either, and `sites/nrc.css`
  keeps the class from locking anything while the wall is lifted, in case NRC's stylesheet
  arrives after the lift.
- **The put-back, fixed for runs removed backwards:** `keepOnPage` put each node back before
  the sibling that followed it when removed, which for NRC's last-to-first cut would have
  reversed the article. It now goes through the removals last first and puts each after the
  sibling before it. A container removed after the article it held, in the same go
  (Corriere), still counts as holding it; once the helper has given up on a part (5 tries),
  its old container removed later stays removed.
- **For the user's test:** all four, as with batch 3. For El Mundo, NRC and The Independent the
  first real wall is the thing to capture (a saved page, as for the other "site bugs").
