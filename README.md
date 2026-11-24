# Read Free

Read the news outlets boycotted over their coverage of Israel's genocide in Gaza, without paying
them a cent. Read Free is a Chrome extension for your computer that gets you past their paywalls.
The first time you read each one, it tells you why it's boycotted and links to the source.

Where a wall only covers text the page already has, it takes the wall off, with nothing fetched.
Otherwise it puts in the text of the newest [archive.today](https://archive.ph) snapshot of the
article. The table under [How it works](#how-it-works) says which each site gets.

It works on 25 outlets: ABC (Spain), The Age, The Atlantic, CNN, Corriere della Sera, Daily Mail,
Der Spiegel, El Mundo, Financial Times, The Globe and Mail, The Independent, La Libre Belgique,
Le Monde, Los Angeles Times, National Post, The New York Times, The New Yorker, Newsweek, NRC,
Reuters, The Spectator, The Sydney Morning Herald, Toronto Star, USA Today and The Wall Street
Journal.

For personal use only. It goes against the publishers' terms, and the Chrome Web Store doesn't
allow paywall-bypass extensions, so it's loaded unpacked.

## Install

**With the install script** (macOS and Linux): it installs the newest signed release and keeps
it up to date, checking every hour ([docs/auto-update.md](docs/auto-update.md)).

```bash
curl -fsSLO https://readfree.xyz/install.sh && sh install.sh
```

**On Windows**, the same in PowerShell (`website/install.ps1`): it keeps Read Free up to date
with an hourly Task Scheduler task, "Read Free updater".

```powershell
irm https://readfree.xyz/install.ps1 -OutFile install.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

Then, once, in Chrome (or Edge, Brave, Vivaldi, Dia: in Dia the page is `dia://extensions`):

1. Go to `chrome://extensions` and turn on **Developer mode** (top right). Leave it on: with it
   off, Chrome turns Read Free off when it updates itself.
2. Drag the folder onto that page: the script opens it selected, in Finder on a Mac or File
   Explorer on Windows (it's called `extension`); Chrome loads a folder dropped there once
   Developer mode is on. Or click **Load unpacked** and pick the folder the script printed. The
   script copies its path: on a Mac, press Cmd+Shift+G in that window and paste it; on Windows,
   paste it into the Folder box and click Select Folder.
3. Read Free's watermelon shows in the toolbar, next to the address bar. If it doesn't, click the
   puzzle piece there and pin **Read Free**.
4. Reload any tabs that were already open.

Read Free then opens a welcome page (once, never on an update), and the site's front page says
it's installed and which version (`extension/src/site-mark.js`, which only writes that line into
the page). The site shows each Chrome step with a picture.

**By hand** (any system): unzip a release and pick the unzipped folder, or clone this repository
and pick its **`extension/`** folder (not the project root: Chrome rejects it because
`node_modules` contains files starting with `_`). Then do the same. It won't update itself: it
says when a new version is out (in the toolbar menu, by a ↑ on its icon, and now and then in the
status bar).

To test the paywalled case, open the extension's **Details** and turn on **Allow in Incognito**.
Then use an incognito window, which isn't signed in to NYT.

## Use

Open an NYT article (`https://www.nytimes.com/2026/...`). NYT's walls never show: the
extension's CSS hides them before the page is drawn, and its script takes care of the rest the
moment a wall goes up. On a paywalled article it then swaps in the text of the newest complete
archive.today snapshot on its own. A status bar in the bottom-left corner shows each step and how
long it's been waiting. Subscribers never get a wall, so nothing is fetched for them.

Once the status bar has faded, the toolbar icon keeps a green **✓** for as long as the page's
wall is off: there was one, and it's gone (the text was on the page all along, or archived text
is showing). Pages that never had a wall get no mark, so on a metered site such as Reuters it
tells you which articles were walled. The mark goes when you undo, or when you leave the page.
The icon turns grey on sites where you've turned the extension off. While a newer version is out
(for a copy loaded by hand), it carries a red **↑** instead, on every page without a ✓.

### Notifications

The status bar in the bottom-left corner shows progress while archive.today loads, and any
problem. Once a wall is off it says so, and adds:

- **Why the outlet is boycotted**, the first time you read it with the extension (and again after
  a month): one documented criticism of its Gaza coverage, worded no more strongly than its source,
  with a link to the source. When archive.today has to load the article, it shows during the wait.
  After that it's one click away (**Why?**), and always in the toolbar menu. The reasons and their
  sources are in `extension/src/reasons.js`, from the project's outlet research, each checked
  against its source, except the Toronto Star's: rabble.ca's review couldn't be read. The New Yorker isn't in the research, so it has none.
- **Now and then, the donation link:** not before your 10th article and 3rd day of use, never in
  the same notification as a reason, at most every two weeks. It opens with your tally ("This
  month: 23 articles from 6 outlets, about $95 in subscriptions you didn't pay them.", see
  [Your boycott](#your-boycott)). **Not now** puts it off for 45 days, clicking through to donate
  for half a year, and **I've donated** in the settings for good (taken on trust). **Donate**
  opens the extension's own donation page (see [Donating](#donating)).
- **A newer version, if you loaded Read Free by hand:** "Read Free [version] is out", with **How
  to update** (the site's steps), at most every three days until you update. Never in the same
  notification as a reason (it waits for the next article), and in place of the donation link.
  Copies installed with the install script update themselves first, so they never see it
  ([docs/auto-update.md](docs/auto-update.md#the-update-notice)).
- **Nothing, once there's nothing new:** after your first 5 articles, a wall coming off shows no
  notification at all (the toolbar icon's ✓ still marks the page), and a reload of an article
  you've read never does. **Confirm every time a wall comes off** in the settings brings them
  back. A notification with a reason, a donation link or a newer version closes with its ×, or on its own; the line
  along its bottom shows how long it has left, and stops while you hover it.

`extension/src/notify.js` makes these decisions from a small record in `chrome.storage.local`
(articles read, days of use, when each outlet was explained, when you were last asked, when it
last mentioned a newer version, and the
tally).
**Start notifications over** in the settings goes back to the first day (keeping your answer to the donation link, and the tally).

### Your boycott

The extension counts, for each month, how many articles from each outlet you read with it, and
how many of them were behind a paywall. The toolbar menu shows this month's count and what
subscribing would have cost; the settings page breaks it down by outlet, since the count began.

- **The cost** is approximate. An outlet you read behind its paywall in a month counts its cheapest
  digital subscription for that month, once, however many of its articles you read. It uses the
  regular price, not the introductory offer, converted to your currency (from the browser's
  language: dollars, euros, pounds, Canadian or Australian dollars) at fixed rates.
- **Not counted:** NYT's login wall (a free account gets past it), reloads, and outlets with no
  price found: for now USA Today, the National Post, Newsweek, El Mundo and Le Monde.
- **The prices** are in `extension/src/tally.js`, each with the page that states it and the date
  it was read there (November 2026). Most outlets' own price pages won't load for a script, so
  most come from trade press, price trackers and app stores rather than the outlet itself.
- **Private:** counts only, never which articles, kept in `chrome.storage.local`. Nothing is sent
  anywhere.
- **Where it can go:** the toolbar menu and the settings page offer to donate the amount to UNRWA
  (`AID_URL` in `extension/src/settings.js`: UNRWA's own donation page, which sends each reader on
  to their region's). The amount isn't put in the link, so the count stays in the browser; the
  reader enters it on UNRWA's page. Below that, the project's own button asks for some of it
  (see [Donating](#donating)).

### The toolbar menu

Click the icon for the menu:

- **What happened on this page:** the wall came off with the article already on the page, the
  article is showing from archive.today, it's still loading, or there was no wall. On a site the
  extension doesn't cover, it says so.
- **One button:** **Show the site's version** (undo), **Remove the wall** (redo), or **Load from
  archive.today** on a page with no wall. On a tab that was open before the extension was
  installed or reloaded, **Reload page**.
- **On [this site]** and **On all sites:** switches. Turned off, a site's pages are left exactly
  as it sends them, wall and all: nothing is hidden, lifted or fetched. Flipping a switch reloads
  the tab so the page starts over. Other open tabs follow when they're next loaded. Turning
  everything off keeps each site's own switch for when it comes back on.
- **Why we don't pay [this site]:** the documented reason, with its source.
- **Withheld this month:** what subscribing to what you read would have cost, and how many
  articles from how many outlets (see [Your boycott](#your-boycott)). Below it, **Donate [that
  amount] to UNRWA**, and **Or give some to keep Read Free alive** (see [Donating](#donating)).
- **Settings**, and **Support the project** when there's no tally yet to show it under.
- **Report a problem**, at the bottom, with the address (hello@readfree.xyz): the same email as
  the error banner's, with what the menu says about the page.
- **Read Free [version] is out**, at the top, for a copy loaded by hand, once a release is a
  day old, with **Get it** (the site's update steps). Once a day, in the background, Read Free
  reads the release's version from its own site (`RELEASE_URLS`), and the menu does too when it
  opens if a day has passed: no cookies, no referrer, nothing about you, and never from article
  pages ([docs/auto-update.md](docs/auto-update.md#the-update-notice)).

archive.today takes 8–15 seconds to send a snapshot nobody has asked for recently, and sometimes
much longer, so the extension waits up to 90 seconds. It asks for the newest snapshot directly,
in one request; archive.today's list of snapshots, which now and then hangs for a minute or
more, is only needed if that fails or comes back incomplete. Once an article has loaded, its text is kept
for 30 days, so reloads and revisits are instant. That's about 50 KB for a long article, up to
50 MB in all, oldest dropped first (the extension asks for `unlimitedStorage`, since Chrome
otherwise stops extension storage at 10 MB).

- **Login wall** ("This story is free to read. Log in to continue."): the whole story is already
  on the page under the wall, so hiding the wall is all there is to do, with no archive.today
  request. This works on articles and live blogs.
- **Paywall:** the wall is gone right away, so you can read the first paragraphs while
  archive.today loads. Where NYT's text stops, a "Loading the rest of this article…"
  placeholder stands in for NYT's subscription line, lined up with the text column. If
  archive.today can't help, it turns into a short note saying why, with a **Try again** button
  (or **Check again** when there's no snapshot yet), and NYT's line comes back. Then the full
  text swaps in, with its links (pointing at the original pages, not archive.today's copies) and
  photos with captions (loaded from NYT's own image server). The banner above the article shows the snapshot's date
  with a link to it. The paragraph you were reading stays exactly where it was
  on screen, and if you'd reached the end of NYT's cut-off text, the rest continues right below
  it. The console logs a `[Read Free] keeping your reading place:` line each time.
- **Your place on the page is kept.** NYT pins the page while a wall is up, which used to throw
  you back to the top; the CSS now stops that. As a backup, the extension remembers where you
  last scrolled to yourself (only scrolling that follows your own wheel, touch, key or mouse
  input counts) and returns you there. The console logs a `[Read Free] keeping your place:` line
  with the details each time.
- **To undo:** **Show the site's version** in the toolbar menu, or **Show NYT's version** in the banner. NYT's page comes
  back as it was, wall included, and the extension won't change that page again on its own.
- **Live blogs behind the paywall** can't be fixed yet, so NYT's paywall is left showing there.
- **To swap by hand:** **Load from archive.today** in the toolbar menu, for example on a page with no paywall. If the page
  already has the full text, nothing is replaced and the banner offers **Use the snapshot anyway**.
- **Incomplete snapshots:** a snapshot captured behind the paywall has barely more text than
  the paywalled page. The extension looks for at least 1.5× the page's text and tries up to the
  three newest snapshots. If none gets there, it shows the longest one anyway, as long as it has
  more text than the page: usually the article is just short and the wall had already shown most
  of it. The status bar says the end may be missing, and that copy is kept for only 30 minutes,
  in case a fuller snapshot turns up. If no snapshot even beats the page, a banner says so and
  offers **Try again**.
- **No snapshot yet:** a gray banner links to archive.today, where you can archive the article,
  and offers **Check again**. The answer is remembered for 30 minutes, but loading by hand from
  the toolbar menu always checks again.
- **Moving between articles:** if NYT shows another article without a full page load, the
  extension starts over for that article.
- **Problems:** a CAPTCHA, a timeout or a network error shows a red banner with a link to the
  article on archive.today and a **Try again** button (also on the note in the article). If
  there's a CAPTCHA, complete it there first. **Report a problem** in the banner opens an email
  to hello@readfree.xyz in your mail app, filled in with what happened, the outlet and the
  versions; never the article's address (paste it if you want that page looked at). Nothing is
  sent unless you send it.
- **Photos:** snapshots keep only the one size the page loaded when it was captured. Where the
  site's image server can be asked for a bigger one (NYT's `-superJumbo` crops, FT's `width`
  parameter, The New Yorker's `w_2560`), 2x screens get that instead, falling back to the
  snapshot's size if it doesn't load. Photos are never stretched past their real size.
  Thumbnails that link to other stories (The Atlantic's "related" lists) are left out.

## Settings

**Settings** in the toolbar menu opens them in a tab (or right-click the icon and choose
**Options**).

- **Your boycott:** what you withheld this month, the counts, the total since the count began,
  the same two donation buttons as the menu, and this month's outlets ranked by what each
  subscription costs, with a bar each and a link to where the price comes from (see
  [Your boycott](#your-boycott)).
- **Sites:** a switch for each supported site, and one for all of them, the same as the menu's.
- **Notifications:** **Confirm every time a wall comes off**, and **Start notifications over**
  (see [Notifications](#notifications)).
- **archive.today address:** archive.today answers under several names (archive.ph, archive.is,
  archive.today, archive.md, …). If the one in use stops loading, pick another. Some networks and
  DNS services, Cloudflare's 1.1.1.1 among them, are known to block it.
- **Clear saved articles:** forgets the articles kept for instant reloads.
- **Support the project**, at the bottom: the donation page (see [Donating](#donating)), and
  **I've donated. Don't ask again.**, which stops the status bar offering it.

### Donating

Every "give to the project" button (the toolbar menu, the settings page, the status bar) opens
the extension's own page, `extension/give/`: what you withheld this month with **Donate [it] to
UNRWA** first, and next to it the ways to give to Read Free: Ko-fi's donation panel (one-off or
monthly) inside the page, and any other ways as links.

- **Where it goes:** a list Read Free publishes on its own site, so the service can change, or
  donations pause, without a new version (`extension/src/donations.js`). `DONATIONS_URLS` in
  `extension/src/settings.js` lists the addresses to try, the site's first, then mirrors; until
  it's set, the page uses `TIP_URL` (`https://ko-fi.com/readfree`). Empty `TIP_URL`, and no
  donation link shows anywhere.
- **The list** is `website/donate.json`, published as is:
  `{ "v": 1, "ways": [ { "name": "Ko-fi", "href": "https://ko-fi.com/readfree", "note": "…" } ] }`.
  Up to 5 ways, in the order shown. When the first is a Ko-fi page it gets Ko-fi's panel; the
  rest are links. `"ways": []` pauses donations: the page says so and offers only UNRWA (the menu, the settings page
  and the status bar still lead to it). Its host
  must send `Access-Control-Allow-Origin: *` (GitHub Pages does; Cloudflare does because of `website/_headers`).
- **Checked as if hostile** (a lost or seized domain is what it's for): names and notes are plain
  text; links must be `https` to a known donation service (`HOSTS` in `donations.js`: Ko-fi,
  Liberapay, Open Collective, Buy Me a Coffee, Patreon, PayPal's donate links, GitHub Sponsors,
  Stripe payment links); nothing from it is framed, since Ko-fi's panel address is built in the
  extension; a list with nothing usable is ignored. The UNRWA link isn't in it. It can't stop
  someone who takes the domain from listing their own Ko-fi page: only a signed list would.
- **When it's fetched:** only when the donation page opens, never from article pages or on a
  timer, with no cookies, referrer or query. The last good list is kept in `chrome.storage.local`
  and shown at once; if the site doesn't answer within 5 seconds, it stays.
- **The panel** is Ko-fi's embed form of the page (`?widget=true&embed=true`), the one form Ko-fi
  lets another page frame. Ko-fi's own widget scripts can't be used: an extension may only run
  code it ships with. **Open Read Free on Ko-fi** under it is the way out if it doesn't load.
- **Private:** the services are loaded only on that page, and given nothing: no tally, no
  reading. The UNRWA link carries no amount either.
- Opening the page counts as clicking through to donate: the status bar stops asking for half a
  year.

### Themes

The look (colors, icon, decoration) is a theme in `extension/themes/<name>/`. Two are kept:

- **solidarity** (in use): the Palestinian flag's black, white, green and red on undyed cotton,
  a watermelon slice for the icon, the keffiyeh's edge (bars and olive leaves) along the top of
  the menu, the settings page and the status bar, and its fishnet behind headings and the
  donation card.
- **classic:** the first redesign, ink blue with a news page for the icon and no decoration.

Switch with `node tools/theme.mjs classic` (or `solidarity`; no name prints the one in use), then
reload the extension. It copies the theme's `theme.css` to `ui/theme.css` (the menu and settings
page), its `page.css` into the marked block at the top of `content.css` (the banner, loading box
and status bar on news pages, with its SVGs inlined: news pages can't load the extension's
files), and its icons into `icons/`, drawing the PNGs with `rsvg-convert` (`brew install
librsvg`). `test/theme.test.js` checks the themes define the same colors and that the active one
is copied in whole.

## How it works

The core in `extension/src/` is site-independent. Everything about a particular site (its URLs,
how its walls work, where its article body is on the page and in a snapshot) lives in an adapter
in `extension/sites/`, plus a CSS file for anything that has to apply before the page is drawn.
The content script picks the adapter for the current host. See
[docs/multi-site-investigation.md](docs/multi-site-investigation.md) for other sites, and
[docs/outlet-coverage.md](docs/outlet-coverage.md) for where each outlet on the list stands.
[docs/monitoring.md](docs/monitoring.md) says how a change on an outlet's side gets noticed: a
daily check on GitHub (`.github/workflows/site-health.yml`), and readers' reports.

| Site | Status |
| --- | --- |
| The New York Times | `sites/nyt.js`, `sites/nyt.css`: everything in this README |
| The Atlantic | `sites/atlantic.js`, `sites/atlantic.css`. Past the meter, the paywall service (Zephr) cuts the body to a few paragraphs, so the wall is detected from the cut: the article is marked paywalled in its structured data and the body holds under 600 words. CSS hides Zephr's gate slots; the archived text replaces the cut body. The gate itself hasn't been seen yet (ad blockers stop it), so this is provisional. |
| The New Yorker | `sites/newyorker.js`, `sites/newyorker.css`. The full text is on the page: paragraphs past the free part have class `paywall`, and a paywall modal appears when the meter runs out. CSS hides the modal and shows those paragraphs, so no archive.today request is needed unless they're missing. Seen only inactive so far, so this is provisional. |
| Financial Times | `sites/ft.js`, `sites/ft.css`. FT shows non-subscribers a "barrier page" instead of the article: the headline plus offers, with no article text at all. `ft.css` trims it to the headline before first paint, and the archived article is inserted below the headline with a loading box while it loads. If archive.today can't help, FT's barrier page comes back. |
| Los Angeles Times | `sites/latimes.js`. Seen past the meter: the page sends the whole article. On gated articles all but a few preview paragraphs sit in a hidden `div.subscriber-content.hidden` block, photos included, under a metering popup (`modality-custom-element[name=metering-modal]`) with scrolling locked (`body.met-panel-open`). The popup is hidden, the block shown and scrolling unlocked; nothing is fetched. Stories and newsletters. |
| Toronto Star | `sites/thestar.js`. Sends every paragraph, hiding all but the first two in `.subscriber-only` blocks (`display: none`). They're shown, and the offers popup hidden. Built from the pages it sends; not yet checked in a browser. |
| CNN, Newsweek, The Globe and Mail | `sites/cnn.js`, `sites/newsweek.js`, `sites/globeandmail.js`. They send the whole article too, but their walls (Piano on CNN and Newsweek, Zephr on the Globe) haven't been seen in action. So the check is general: a paid article with text cut short, locked scrolling or its end hidden, or (CNN, Newsweek) Piano's modal showing. With the text there, the wall comes off; if it was cut, archive.today fills in. Provisional. |
| The Wall Street Journal | `sites/wsj.js`. The page sends a few paragraphs, then Piano's wall: a snippet overlay (`[id^=cx-snippet]`) and an offer panel fixed at the bottom (`#cx-candybar`). Every Piano `cx-` element but the menu's subscribe button is hidden and the article swapped in from archive.today, without the byline's "By" / "and", the dateline and reader comments. WSJ's CSS hides the body's paragraphs after the second; it doesn't apply to the archived text (`data-nytfix-swapped` in `content.css`). archive.today's WSJ captures are sometimes empty shells; the error then says so. |
| The Age, The Sydney Morning Herald | `sites/nine.js`, `page/nine.js` (one adapter, two sites, Nine's platform). The page sends the whole article; a second or two in, Piano fires a `pianoContentWall` event and Nine's own code cuts the body to two paragraphs and locks scrolling. `page/nine.js` runs in the page's own world before its scripts and holds that event back, so the article is never cut; Piano's subscribe box (`[id$=-piano-id]` slots, the "subscribe to comment" box too) is hidden and nothing is fetched. If the article gets cut anyway, it's swapped in from archive.today (the body: the div of unclassed `<p>`s, a level deeper in a wide window). |
| Der Spiegel | `sites/spiegel.js`. A Spiegel+ article sends none of its text, only an offer block in its body (`[data-area=paywall]`). It's hidden and the archived article goes in, dressed in Spiegel's text wrapper (`live.textTemplate`). |
| Le Monde | `sites/lemonde.js`, French and English, regular articles and long reads (`article#Longform`). The page sends the first paragraphs, in `.article__content`, and leaves out the part its JSON-LD calls `.article__reserved-content`; the offer block (`section.js-paywall`) is hidden and the article swapped in from archive.today, without its "Read more" lines. The cookie-consent wall is left alone. |
| Corriere della Sera | `sites/corriere.js`, `page/corriere.js`, on www.corriere.it and the local editions (`*.corriere.it`). Sends the whole article, subscriber-only ones too. When Piano decides on the wall, Corriere's own script deletes the text after the first block or locks scrolling; `page/corriere.js` holds back the event that starts it (`pno_abc_test:init`), and the one that loads its ad-blocker popup (`adblockActivated`). In a private window Piano's wall also deletes the page's main parts (header bar and menu, article, side column, footer); they're put back as they go (`live.keep`). Whatever Piano still draws is lifted, with nothing fetched. The cookie-consent wall is left alone. |
| The Spectator | `sites/spectator.js` (spectator.com; spectator.co.uk redirects there). Sends the whole article: the free part, then `span.paywalled-content`. Magazine articles are clipped to 650px under a white fade with Piano's offer below; the clip comes off and the fade and offer go, with nothing fetched. If the paid part is ever missing, archive.today fills in. |
| National Post | `sites/nationalpost.js`. The server trims the article to one paragraph (`.pmd-paywall-trimmed-marker`), so the rest comes from archive.today, without the snapshot's video player. Its ad-blocker notice is hidden like any other. |
| Reuters | `sites/reuters.js`. Sends the whole article (its page data carries the same text and word count). Its metered wall is a modal (`[data-testid=Modal]` with a `paywall-modal-module` dialog) with scrolling locked, and the layout cropped to 150vh with the footer hidden (a `…layout-module__restricted` class); the modal comes off, scrolling unlocks and the crop comes off, with nothing fetched. |
| La Libre Belgique | `sites/lalibre.js`. Sends the whole article: the rest of a subscriber-only story is hidden in `#story-content-PAYING` (or `-MEMBER`), inside Piano's slot. When Piano fills that slot with its offer, which wipes the text, the text is put back (`live.keep`); it's shown and the offer hidden, with nothing fetched. Free articles are left alone. Its ad-blocker popup is a Piano modal drawn in Piano's iframe; `page/piano-adblock.js` keeps Piano's ad-blocker check (a bait script that, blocked or loaded, sets an `__adblocker` cookie) from finding the blocker, so it never shows. |
| Daily Mail | `sites/dailymail.js`, on www.dailymail.co.uk and the US edition www.dailymail.com. Mail+ articles send the whole text; the site's own CSS hides all but the first two paragraphs while `<body>` isn't `is-paywall-processed`, and a script caps the article body at 20px. The lift adds that class (`wall.classes`), takes the cap off and hides the Mail+ box, with nothing fetched. Free articles are left alone. |
| ABC (Spain) | `sites/abces.js`. Sends the whole article, the part after the first paragraph in a hidden `div.paywall`. An inline script on the page deletes it once Evolok refuses access; it's put straight back (`live.keep`), shown, and the ellipsis and Evolok's offer hidden. The part is hidden until Evolok answers even for readers who may read, so nothing is said until the page has decided, and if it lets the reader in the lift is taken back. If the deletion came first, archive.today fills in. |
| El Mundo | `sites/elmundo.js`. Sends the whole article, premium ones included. **The wall hasn't been seen** (the consent popup was in the way), so it goes on the general signs: Piano's modal, or the text clipped, hidden or cut short. |
| NRC | `sites/nrc.js`. The server sends the whole article, but once the meter runs out the site's script (after Zephr and Sophi decide, seconds after the page loads) cuts the drawn page to one paragraph, locks scrolling and puts `div.paywall.paywall--hard` over it. Every child of the article is kept (`live.keep`), so each goes straight back as it's removed, and the hard wall comes off. If the cut came first, archive.today fills in. The dormant `div.paywall.hidden` on other articles isn't taken for a wall. |
| The Independent | `sites/independent.js` (independent.co.uk and the-independent.com, where American readers are sent). Sends the whole article, Independent Premium included; **no wall came up** from the US. General signs only, on articles marked paywalled. |
| USA Today | `sites/usatoday.js`. Its stories are free and whole; what shows is Admiral's ad-blocker popup, with scrolling locked. Being a supported site is what lets the ad-blocker notice handling (`src/notices.js`) hide it and unlock scrolling. |

| File | Role |
| --- | --- |
| `extension/sites/*.js` | One adapter per site: URL rules, live-page selectors and wall signals, snapshot body and junk labels. |
| `extension/sites/*.css` | Per-site CSS that keeps the site's walls from being drawn. |
| `extension/page/*.js` | Page-world guards: scripts that run in a site's own JavaScript world (`"world": "MAIN"`, at `document_start`, before its scripts) and keep the site's code from cutting an article it already sent. They mark `<html data-nytfix-held>` with what they held back, and answer `nytfix:release` (the reader asked for the site's version) and `nytfix:hold` events from the content script. |
| `extension/src/adapter.js` | Shared pieces for adapters: `defineSite` (defaults and registration), the page's JSON-LD (paywall flag, article length), wall checks built on it (`cutBody`, `textOnPage`, `anyShown`), and what common paywall services (Piano, Zephr) put on the page. |
| `extension/background.js` | Draws the toolbar icon: grey while the extension is off everywhere or on that tab's site, and a ✓ mark while a page's wall is off (the content script says when). Fetches pages for the content script, which can't make cross-site requests itself. Only `https` archive.today URLs are allowed. |
| `extension/src/archive.js` | archive.today addresses: the newest snapshot (`/newest/`, which redirects to it), the snapshot list (`/timemap/`), mirrors, and spotting CAPTCHA pages. |
| `extension/src/extract.js` | Finds the article body in the snapshot (where the adapter says, or `auto`: the marked block holding the most paragraphs) and pulls out paragraphs (with their links, unwrapped to the original address, and emphasis), subheadings, and photos with captions, plus a sharper copy of each photo where the adapter knows one. Skips cards for other stories. |
| `extension/src/render.js` | Lifts the wall (removes `inert`, hides the scrim and the adapter's or paywall service's elements, shows text the site hid, unlocks scrolling), and separately swaps the text in using NYT's own paragraph classes and wrappers. Shows the banner, handles undo, and scrolls the reader back into place. |
| `extension/src/notices.js` | Hides "turn off your ad blocker" popups on any supported article, wall or no wall. They're found by what they say: something drawn on top (fixed, or a dialog, shadow roots included) whose short text mentions an ad blocker, plus Google's `.fc-ab-root` by name. Hides its dimming layer too and unlocks scrolling. |
| `extension/src/status.js` | The floating status bar: one stage per step, an elapsed-time counter, and the final result. |
| `extension/src/paywall.js` | Detects a wall from the DOM (the popup has content and the page is `inert`), reacting in a MutationObserver before the next paint, and tells the login wall from the paywall. |
| `extension/src/scroll.js` | Remembers where the reader last scrolled to themselves, ignoring scrolls NYT makes on its own. |
| `extension/src/cache.js` | Keeps extracted text in `chrome.storage.local` for 30 days (up to 50 MB, oldest dropped first), and "no snapshot yet" answers and copies that may be missing their end for 30 minutes. A small info entry beside each article (when saved, how big) lets it trim without reading every article. |
| `extension/src/content.js` | Reads the settings first (and leaves the page alone where the extension is off), then runs the whole sequence when the paywall appears or the menu's button is pressed: cache first, then the newest snapshot in one request (`/newest/`). Only if that one is incomplete or doesn't come through does it ask for the snapshot list (`/timemap/`, which sometimes hangs) and try older ones, up to three snapshots in all. Starts over when the site navigates in-page. |
| `extension/src/settings.js` | The settings in `chrome.storage.sync`: on or off everywhere, the sites turned off (by adapter id), the archive.today address; and the donation link. |
| `extension/src/notify.js` | Decides what the status bar adds once a wall is off: the outlet's reason (once, then on request), the donation link (rarely), or no notification at all. |
| `extension/src/reasons.js` | Why each outlet is boycotted: one documented criticism of its Gaza coverage and its source. |
| `extension/src/release.js` | "Read Free [version] is out", for copies loaded by hand (the menu, the toolbar icon's ↑, the status bar): `latest.txt` from the release addresses (`RELEASE_URLS`), at most once a day. |
| `extension/src/donations.js` | The ways to give to Read Free: the list from Read Free's site (`DONATIONS_URLS`), checked and kept, or the built-in Ko-fi link. |
| `extension/src/tally.js` | The reader's tally in figures and words, and what subscribing would have cost: each outlet's regular price with its source, and the exchange rates. |
| `extension/popup/` | The toolbar menu. `view.js` turns the tab's state (asked of its content script with `nytfix:state`) and the settings into words and a button. |
| `extension/options/` | The settings page. |
| `extension/welcome/` | The page Read Free opens once, when it's first loaded: what to do next, and the outlets. |
| `extension/src/site-mark.js` | On Read Free's own site (the release addresses): writes "Read Free [version] is installed in this browser" into the front page's placeholder. Reads nothing, sends nothing. |
| `extension/give/` | The donation page: what you withheld, UNRWA's link, and the ways to give to Read Free (Ko-fi's donation panel, other links). |
| `website/_headers` | Makes Cloudflare send `Access-Control-Allow-Origin: *` with every file of the site, so the extension can read `latest.txt` and `donate.json`. |
| `website/donate.json` | The list of ways to give, to publish on Read Free's site (see [Donating](#donating)). |
| `website/index.html` | The site's front page: the install command, the zip, the steps in Chrome and the outlets, and a note for visitors on a phone. `tools/release.sh build` writes the release in (see [docs/auto-update.md](docs/auto-update.md)). |
| `website/og.png` | The picture apps show when the site's link is shared (the page's `og:image`). Drawn from `brand/og.svg`: `rsvg-convert -w 1200 -h 630 brand/og.svg -o website/og.png`. |
| `website/install.sh` | Installs the newest signed release on macOS or Linux and updates it every hour (see [docs/auto-update.md](docs/auto-update.md)). |
| `website/install.ps1` | The same for Windows, in Windows PowerShell 5.1: installs the newest signed release (checked by Windows' own OpenSSH) and updates it every hour from Task Scheduler. `tools/release.sh` writes install.sh's key and addresses into it; `.github/workflows/windows-installer.yml` runs it for real on a GitHub Windows machine (`test/windows/`). |
| `tools/release.sh` | Makes the release signing key (`keygen`), and builds and signs a release into `dist/` (`build`). |
| `tools/publish.sh` | Publishes `dist/` to the site (a Cloudflare Worker) and its mirror (GitHub Pages), then waits until both serve it (see [docs/auto-update.md](docs/auto-update.md)). |
| `extension/ui/` | Shared by the menu and the settings page: `ui.css` (buttons, switches, the band), `theme.css` (the active theme's colors), `sites.js` (loads the adapters the manifest lists, and finds the one for a host). |
| `extension/themes/` | The themes; see [Themes](#themes). `tools/theme.mjs` switches between them. |
| `extension/content.css` | Styles the banner, the loading placeholder and photos, in the active theme's colors (the marked block at the top). (Wall-hiding CSS is per site, in `sites/`.) |
| `tools/probe-outlets.mjs` | Research, not part of the extension: fetches sample articles for a list of outlets as a signed-out reader and records wall signals and text counts (never text). Results feed `docs/outlet-coverage.md`. |

The archived article is rebuilt with DOM calls (text nodes and `<a>`, `<em>`, `<strong>`,
`<figure>` elements), never parsed as HTML, and only `http(s)` links and `https` images get
through. The page structure this relies on is written up in
[docs/phase0-findings.md](docs/phase0-findings.md).

## Develop

```bash
npm install
npm test        # unit + integration tests (node:test + jsdom, synthetic fixtures, fake chrome APIs)
npm run check   # manifest JSON + syntax check of every extension script
```

After changing code, click the reload icon on the extension's card in `chrome://extensions`,
then reload the NYT tab.

### Adding a site

First find out whether the page already carries the article: in its HTML, in its page data
(`window.APOLLO_STATE`, `__NEXT_DATA__` and the like) or in its JSON-LD (`articleBody`). If it
does and the site hides or cuts it in the browser, undo that on the page: reveal the hidden text
(`wall.reveal`), give the page the class its CSS waits for before it shows the text
(`wall.classes`, as for the Daily Mail), or stop the cut with a page-world guard
(`extension/page/`, as for The Age and the Herald). That's the fastest way: nothing to fetch, and nothing for the reader to wait for.
archive.today is for sites that never send the text.

Most sites need only settings, through `NYTFix.adapter.defineSite` (`extension/src/adapter.js`):

```js
NYTFix.adapter.defineSite({
  id: 'example', name: 'Example News', shortName: 'Example', hosts: ['www.example.com'],
  isArticle: path => /^\/\d{4}\/\d{2}\/\d{2}\//.test(path),
  live: {
    body: '.story-body',                  // the article body on the page
    wall: {
      services: ['piano'],                // its paywall service: the wall check, and what to hide
      hide: '.subscribe-gate',            // more of the wall to hide
      reveal: '.locked-text',             // text the site sent but hid
      type: NYTFix.adapter.textOnPage('.story-body'), // whole text on the page? lift; else archive.today
    },
  },
  snapshot: { junk: /^related coverage$/i }, // body found automatically unless given
});
```

Then add a `content_scripts` entry for its host in `manifest.json` (the core scripts,
`src/adapter.js`, the new `sites/<id>.js`, then `src/content.js`), and add the site to its
description. A page-world guard gets an entry of its own, before that one, with
`"world": "MAIN"` and `"run_at": "document_start"`. Check it with `tools/probe-outlets.mjs` and a couple of real articles before
relying on the defaults. Give it a reason in `src/reasons.js` (or list it as having none), and a
price in `src/tally.js` with its source (or list it in `UNPRICED`, saying why): the tests check
both.

## Current limits

- **Off on a site** is read when the page's script starts, after the page has loaded. Until then
  the site CSS that hides walls (NYT, FT, The Atlantic, The New Yorker) still applies, so their
  wall shows a moment later than it would without the extension. La Libre's ad-blocker guard
  (`page/piano-adblock.js`) runs before any setting can be read, so its ad-blocker popup stays
  away even there.
- Only paragraphs, subheadings and photos are carried over. Videos, interactive graphics and
  embedded posts in an article aren't.
- The 1.5× rule for a complete snapshot comes from one NYT article. Short articles fall below it
  (see the incomplete snapshots bullet above).
- In-page navigation handling has only been tested on a simulated page, not on nytimes.com itself.
- Lifting the paywall (popup, gradient scrim and `inert`) is based on one paywalled article.
  Other article templates may differ.
- Telling NYT's login wall from its paywall: the popup's wording ("without signing in", "free to
  read") only counts when the article isn't cut. Since Nov 2026 the paywall's popup carries the
  "To leave without signing in" note too, so an article body ending in "Subscribe to The Times to
  read as many articles as you like" is always the paywall. The console logs each decision with
  the popup's wording.
- Live blogs behind the paywall aren't supported. Live blogs behind the login wall are.
