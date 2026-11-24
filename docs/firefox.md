# Read Free in Firefox

Firefox 140 or later, on a computer. Firefox for Android isn't covered: it doesn't reliably install
add-ons from a website.

## How it gets to people

Firefox only keeps add-ons that Mozilla has signed, so a folder can't be loaded the way Chrome does
it (a temporary add-on goes when Firefox quits). Mozilla signs each version as *unlisted*: signed,
but not on its store. The site serves the signed file, and its **Add to Firefox** button installs
it. Firefox then checks `https://readfree.xyz/updates.json` about once a day and updates by itself.

So two things from Chrome are off in Firefox (`settings.isFirefox()`: the manifest has a
`browser_specific_settings.gecko` block): reloading when a newer version is on disk
(`src/update.js`, which only runs in a service worker) and the "newer version is out" notice
(`src/release.js`).

## The package (`tools/firefox.mjs`)

`node tools/firefox.mjs` makes `build/firefox/` from `extension/`, with a manifest made from
Chrome's. `extension/manifest.json` stays Chrome's own, so Chrome sees no keys it doesn't know.

- `background.scripts` in place of `service_worker`: the files `background.js` imports, then
  `background.js`. Firefox has no extension service workers, and a background page has no
  `importScripts`, so that call is guarded.
- `browser_specific_settings.gecko`:
  - `id`: `read-free@readfree.xyz`. Permanent: installed copies, their synced settings and
    Mozilla's signing go by it.
  - `strict_min_version`: 140, the first with Firefox's own data consent. Page-world scripts
    (`page/*.js`) need 128.
  - `update_url`: the first release address's `updates.json`. Permanent too: installed copies keep
    asking there.
  - `data_collection_permissions`: `browsingActivity`, because an article's address goes to
    archive.today to find its snapshot. Firefox shows this when installing.

To try it: `about:debugging` > This Firefox > Load Temporary Add-on > `build/firefox/manifest.json`.
`npm run lint:firefox` runs Mozilla's linter. Two warnings are expected: the Android one (not
covered) and `innerHTML` in `src/render.js`, which is given the adapters' own markup only.

Firefox differs from Chrome in one more way the code has to know: `getManifest()` gives file names
as whole addresses (`moz-extension://<id>/sites/nyt.js`), see `ui.adapterFiles`.

## Addresses an update adds (`src/access.js`)

Firefox asks about the manifest's addresses when Read Free is installed, and never about those an
update adds: they stay off, silently. Tested in Firefox 160: an update that added
`cooking.nytimes.com` and `archive.fo` got neither. So:

- the toolbar icon carries a `!` until the reader has seen them listed in Settings;
- the toolbar menu says "New sites need your OK", and opens Settings;
- Settings has an **Allow** button, which brings up Firefox's own prompt.

The same shows for addresses the reader turned off in Firefox's add-on settings, but once seen the
`!` doesn't come back for them.

## Releasing

`tools/release.sh build` makes the Firefox file with the rest (`tools/firefox-release.mjs`):

1. The package is made from the committed `extension/`.
2. Mozilla signs it: `web-ext sign --channel unlisted`, in UTC. **This sends the extension's code to
   Mozilla.** The API key comes from the Keychain, and macOS asks before handing it over.
3. What comes back must hold exactly the files that were sent, byte for byte, plus `META-INF/`
   (Mozilla's signature). Only `manifest.json` is compared by what it says: Mozilla writes it anew
   (without the line break at its end). Otherwise the build stops, with `dist/` as it was, and the
   file is kept in the cache as `refused-<version>.xpi`.
4. `dist/read-free-<version>.xpi` and `dist/updates.json` (the version, the file's address and its
   SHA-256).

**Mozilla signs a version number once.** The signed file is kept in `~/.cache/read-free/firefox/`, by
version and contents. A release that changes only the site uses it again; a changed extension with a
version already signed is refused: bump the version.

- If Mozilla takes long to review a version, or the kept file is gone: download the signed file from
  Mozilla's developer pages, then `READFREE_FIREFOX_XPI=<file> tools/release.sh build`.
- `READFREE_FIREFOX=no tools/release.sh build` releases for Chrome alone. The site then shows its
  `<!-- chrome-only -->` parts in place of its `<!-- firefox -->` ones.

`tools/publish.sh` refuses a file, an `updates.json` and a page that don't agree, and waits until each
address serves the file as `application/x-xpinstall` (`website/_headers`): with another type, Firefox
downloads it instead of offering to install it.

`latest.txt` and the install scripts know nothing of Firefox.

### The API key, once

Make the account under Read Free's name and email. Then, at
[addons.mozilla.org](https://addons.mozilla.org/developers/addon/api/key/), generate credentials and
run `tools/release.sh amo-key`, which keeps them in the macOS Keychain. Like the release key, they are
the maintainer's alone. `tools/release.sh amo-check` sees that Mozilla takes the key, and uploads
nothing; `tools/release.sh amo-test` has Mozilla sign a tiny add-on that isn't Read Free
(`read-free-signing-test@readfree.xyz`) and checks it, leaving it in `build/signing-test.xpi`.
On 2026-11-24 Mozilla took the key and signed the test add-on, the check accepts the file it sent back,
and Firefox 160 kept it as a permanent add-on. Whoever has the key can sign a version of Read Free as
Mozilla sees it, though not publish one on the site.

## What could go wrong

Mozilla's [policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) cover
add-ons it signs without listing, and it "may reject or block affected versions or entire add-ons".
From December 1, 2026, its Acceptable Use Policy and "conform to the laws of the United States" cover
those too. None of it names paywalls. Mozilla dropped paywall add-ons from its store in 2018 and 2023.
A block would turn Read Free off in Firefox; Chrome wouldn't be affected.
