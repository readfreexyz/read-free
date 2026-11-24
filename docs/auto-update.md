# Updating itself

Sites change, so the extension needs updates. The Chrome Web Store doesn't allow extensions that take off paywalls, and Chrome on a Mac only installs a self-hosted `.crx` under an enterprise policy. So Read Free is loaded unpacked, and the folder Chrome loads is kept up to date from outside Chrome. Two ways:

- **Readers:** signed releases, installed and updated by `website/install.sh` (macOS and Linux). Those who load a folder by hand instead are told when a new version is out: in the toolbar menu, by an arrow on its icon, and now and then in the status bar ([The update notice](#the-update-notice)).
- **The maintainer's Mac:** a git clone that a LaunchAgent pulls every hour (below, from [The release clone](#the-release-clone)).

Either way, the extension notices the newer version on disk and reloads itself (`extension/src/update.js`, [below](#the-extension-reloads-itself)).

## Signed releases

A release is these files, uploaded to the site and to each mirror (`RELEASE_URLS`):

- `read-free-<version>.zip`: the committed `extension/` folder (`git archive`), nothing else.
- `latest.txt`: the newest release, in a few lines: `read-free-release 1`, then `version=`, `zip=` (the zip's name), `sha256=`, `size=` and `date=`.
- `latest.txt.sig`: its signature, by the release key (`ssh-keygen -Y sign`, namespace `read-free-release`).
- `install.sh`: the install script, with the key's public half (`SIGNER`) and the addresses written in.
- `install.ps1`: the same for Windows (Windows PowerShell 5.1), with the same key and addresses written in from `install.sh`. `publish.sh` refuses a release whose two installers disagree.
- `index.html`: the front page (`website/index.html`), with the release's version, date, zip, size and SHA-256 and the site's address written in. It shows the install command and the zip, the steps in Chrome with a picture of each control, the outlets, and a link to the source on GitHub; a hidden line that Read Free itself fills in once it's installed (`extension/src/site-mark.js`); and tells visitors on a phone or tablet that Read Free needs a computer (by CSS, from the kind of pointer). It loads nothing from elsewhere (its `og:` tags name `og.png` for apps that preview a shared link, but the page never loads it); its one script makes the command use the address the page is served from, if that's a plain https one (so a mirror installs from itself), and adds a Copy button. Without the script the page is complete.
- The rest of `website/`: `donate.json`, `og.png` (the link preview's picture), and `_headers`, which tells Cloudflare to send `Access-Control-Allow-Origin: *` with every file (GitHub Pages sends it anyway, and serves `_headers` as a plain file).

### Installing

```bash
curl -fsSLO https://readfree.xyz/install.sh && sh install.sh
```

It downloads the newest release, checks it, unpacks it into `~/Library/Application Support/Read Free/extension` (Linux: `~/.local/share/read-free/extension`), keeps a copy of itself next to it (`Read Free updater` on macOS, `update.sh` on Linux), and schedules that copy's `update` every hour: a LaunchAgent (`local.readfree.update`) on macOS, which runs the copy itself (it's executable), and a crontab line on Linux. Then, once, in Chrome: Developer mode on, and that folder dropped onto `chrome://extensions` (or **Load unpacked**). On a Mac, run at a terminal, the script opens the folder in Finder, selected, to drag, and copies its path for **Load unpacked**. Developer mode must stay on (see [The extension reloads itself](#the-extension-reloads-itself)).

`sh install.sh status` shows the folder, the version and the log; `sh install.sh uninstall` stops the updates. `install --no-schedule` installs without them. At the end, on a Mac with a person at the terminal, it opens the site's step 2 in a browser Read Free works in (one that's open, or else one that's installed; `open_steps`), then Finder in front of it with the folder selected. It can't open `chrome://extensions` itself: Chrome opens its own pages only when they're typed or pasted (tested in Chrome 157: started with that address, it shows a new tab). Then it prints those two commands with the installed copy, and says the `install.sh` that was run can be deleted. On macOS it also says that macOS may announce a new background item: System Settings lists a LaunchAgent under Login Items by the file name of the program it runs, so it shows as **Read Free updater** (with no developer: that would take an Apple-signed program). A copy installed by an earlier script, `update.sh` run through `/bin/sh`, showed as `sh`; installing again replaces it.

**On Windows**, in PowerShell:

```powershell
irm https://readfree.xyz/install.ps1 -OutFile install.ps1; powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

`install.ps1` does what `install.sh` does, the same way: the same addresses in turn, the same signed `latest.txt` checked by Windows' own OpenSSH (`ssh-keygen -Y verify`, with the file fed to it byte for byte), the same checks on every field, the zip's size and SHA-256, and a version that must be newer. It unpacks into `%LOCALAPPDATA%\Read Free\extension`, keeps a copy of itself next to it as `Read Free updater.ps1`, and sets up a Task Scheduler task for this user, "Read Free updater", at logon and every hour, which runs that copy with `update log` (under `conhost --headless` on Windows 10 1809 and later, so no window flashes up). Updates and failures go to `update.log` in that folder. It opens the site's step 2 too, before Explorer (`Open-Steps`), but not from an administrator's window, where the browser would get administrator rights; if it fails for any reason, the install goes on. At the end it opens Explorer with the folder selected, to drag onto `chrome://extensions`, and copies its path for Load unpacked. `status` and `uninstall` as on macOS; `install no-schedule` installs without the task. It needs OpenSSH 8.1 or later, which Windows 10 (kept up to date) and 11 have; without it, it says so and points to the zip. It's plain ASCII, since Windows PowerShell 5.1 reads a file without a byte-order mark in the system's code page.

### What an update checks

Each hour, the installed copy asks the addresses in turn, moving on when one doesn't answer or answers with something that doesn't check out. The first signed release decides. What went wrong with an address is logged only if the run ends in an update or a failure, so a mirror that's down isn't news every hour. It installs a release only if:

1. `latest.txt` came over https (redirects included), and is at most 4 KB;
2. its signature checks out, by exit status, against the key in the script, for the `read-free-release` namespace. Nothing in it is read before that;
3. every field is what it should be: the version is 1 to 4 numbers, the zip's name is `read-free-<that version>.zip` (no path), the SHA-256 is 64 hex digits, the size is at most 50 MB;
4. the version is newer than the one installed, numerically (0.14.10 is newer than 0.14.9). An older or equal one, even signed, is left alone;
5. the zip, from the same address, has the signed size and SHA-256;
6. it unpacks, and its `manifest.json` has that version.

Then it moves the installed folder aside and the new one in (renames within the same folder; the old one is put back if the second rename fails), under a lock so two runs can't overlap. A refused release leaves the installed folder as it was, and nothing behind.

The hourly job runs the installed copy of the script, never a fresh download: a site or mirror in the wrong hands can't put code in anyone's browser without the key. It can only withhold updates, or serve an older signed release, which isn't installed. It could give a new install a different `install.sh`: install from the site you trust. Running a newer `install.sh` by hand replaces the installed copy, which is how the script itself is updated.

### The update notice

For those who load a folder by hand (`extension/src/release.js`). Once a day the service worker reads `latest.txt` from the first address that answers (an hourly alarm wakes it; it asks again an hour after a failed try, otherwise a day after the last answer). The toolbar menu does the same when it opens, if a day has passed. If the version is newer than the one running, the release is a day old, and this copy has known of it for two hours (a computer waking from sleep learns of a release at the same time as its hourly updater, which then installs it first):

- the menu says "Read Free <version> is out", with **Get it**;
- the toolbar icon carries a red ↑ on every tab without a ✓ of its own, and its tooltip says so;
- once a wall comes off, the status bar says "Read Free <version> is out. Updating keeps it working as the outlets change their walls.", with **How to update**, at most every three days, never with an outlet's reason, and in place of the donation link (`extension/src/notify.js`). Article pages ask the service worker what it knows: nothing is fetched from them.

The links go to the first address's update steps (`#update`, the front page's manual-update card). A day, so those who installed with the script, updated within the hour, never see any of it. Only the version and date are taken from the file, and the link is built in. The request carries no cookies, referrer or query. The host must send `Access-Control-Allow-Origin: *`: GitHub Pages does, and Cloudflare does because of `website/_headers`.

### Setting it up, once

1. `tools/release.sh keygen` makes the release key, `~/.config/read-free/release-key`, and asks for a passphrase. Keep the key and its passphrase safe, with a backup: installed copies only take updates signed by it, and a new key means everyone reinstalling. Its public half is written into `website/install.sh` as `SIGNER`, with the comment `read-free`, not your user and host name.
2. Put the addresses, the site first, each ending in `/`, in both `RELEASE_URLS` lists: `extension/src/settings.js` and `website/install.sh`. A test checks they match. Choose them to last: an update replaces the extension, never the script, so every installed copy keeps asking the addresses it was installed with until its owner runs a newer `install.sh` by hand. A domain you control outlasts an address tied to an account or a host, and a mirror listed from the first release is one every reader already has. The menu's link goes to the first address itself: the front page. `build` refuses without an address, or with a first one that isn't plain (letters, digits, `.`, `-`, `_`, `~`, `/`), since the page puts it in a command people paste into a shell.
3. Commit both.
4. Where they're served from, for `tools/publish.sh`:
   - **The site:** a Cloudflare Worker serving static files (`READFREE_WORKER`, by default `readfree`), with the site's domain attached to it. `website/_headers` makes it send `Access-Control-Allow-Origin: *`. `publish.sh` deploys with Cloudflare's credentials from `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`, or else from the `cf` CLI's sign-in (`cf auth login`).
   - **The mirror:** a GitHub Pages repository (`<account>.github.io`), cloned to `READFREE_MIRROR_REPO` (by default `~/projects/read-free-site`), with a git identity of its own in that clone (`git config user.name` and `user.email` there): `publish.sh` refuses a clone without one, since the global identity is usually the maintainer's own.

### Releasing

1. Bump `"version"` in `extension/manifest.json`, run `npm test`, commit, push.
2. `tools/release.sh build`: `dist/` gets the zip, `latest.txt` and its signature (it asks for the key's passphrase), `install.sh`, the front page with the release written in, and the rest of `website/`. It checks the signature as an installed copy would.
3. `tools/publish.sh`: it checks `dist/` as an installed copy would (the signature, the zip's size and SHA-256, every field of the front page filled, `_headers` there) and won't publish a version older than the site's. Then it replaces the mirror's files with the release's, commits them in UTC and pushes, and deploys the release to the site's Worker with Wrangler, run from a temporary folder: Wrangler with no configuration of its own "sets up" the folder it's run in, rewriting `package.json` and `.gitignore`. Last, it waits until every address serves this `latest.txt` with the header. `tools/publish.sh mirror` or `site` does one of the two.

Readers who installed with the script have it within the hour; the menu tells the rest a day later.

## The release clone

The maintainer's own copy follows the repository instead:

1. **The release copy.** A clone of the repository's `main`, by default in `~/Library/Application Support/NYT Fixer`. Chrome loads its `extension/` folder unpacked. Nobody works in it: it only ever holds pushed commits.
2. **The LaunchAgent** (`local.nytfixer.update`). At login, and every hour, it runs `git pull --ff-only` in that clone, with git's own GitHub login (the keychain).
   - Its command is written into the plist, so nothing from the repository runs outside Chrome. A clone has no hooks.
   - It logs failed pulls, and each update, to `~/Library/Logs/NYT Fixer/update.log`.
3. **The extension** reloads itself, as below.

The folder, the LaunchAgent's label and the log folder keep the project's first name, NYT Fixer. Chrome knows an unpacked extension by its folder: moving it would make it a new extension, with default settings and an empty tally.

So a fix reaches the browser within about an hour of the push. Pages already open keep the version they started with until they're reloaded.

## The extension reloads itself

`extension/src/update.js`, loaded by `background.js`. Every minute it reads `manifest.json` from disk. If its version is newer than the one running, it reloads itself with `chrome.runtime.reload()`, which reads the folder again. It won't reload:
   - the first time it sees a new version. The version must still be there a minute later, so a pull that is still writing isn't loaded halfway.
   - if a file the new version names is missing. That covers the service worker, its `importScripts`, content scripts, styles, pages and icons. An unpacked extension that fails to load stays off until someone reloads it by hand, and this check goes down with it.
   - while an archive.today download is in flight, or while the toolbar menu or one of its pages is open. It waits up to 30 minutes, then reloads anyway.

Developer mode must stay on: Chrome turns unpacked extensions off without it, and a reload is when it notices (`DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION` in `chrome://extensions-internals`). Pages already open keep the version they started with until they're reloaded.

## Releasing to the release clone

- Bump `"version"` in `extension/manifest.json`, commit, push to `main`.
- A pushed change without a new version stays on disk unloaded until the next version comes along.
- The version must go up. A lower one is never loaded.
- Run `npm test` first. A service worker that doesn't run anymore (a syntax error, a bad `importScripts`) also stops the update check. The fix would then need a reload by hand.

## Setting up the release clone

```bash
tools/auto-update.sh install
```

This clones the repository (if it isn't there yet), writes the LaunchAgent to `~/Library/LaunchAgents/local.nytfixer.update.plist`, loads it and pulls once. Then, in Chrome:

1. `chrome://extensions`, Developer mode on.
2. **Load unpacked**, then the release copy's `extension` folder. `~/Library` is hidden in the file dialog: press Cmd+Shift+G and paste `~/Library/Application Support/NYT Fixer/extension`.
3. Turn **Allow in Incognito** on, under **Details**, if you want it in private windows.
4. Turn off the copy that loads from the project folder (see below).
5. Keep Developer mode on. Chrome turns unpacked extensions off without it, and a reload is when it notices: the update's reload would switch the extension off (`DISABLE_UNSUPPORTED_DEVELOPER_EXTENSION` in `chrome://extensions-internals`).

The new copy has a new extension ID. Chrome derives an unpacked extension's ID from its folder. So it starts with default options and an empty cache of archived pages.

`tools/auto-update.sh status` shows where everything is, the versions and the log. `tools/auto-update.sh uninstall` unloads and deletes the LaunchAgent. The clone stays; delete it once Chrome no longer loads it.

## Trying out work that isn't pushed

The project folder can stay installed as a second, separate copy, normally off. To try a change before it's committed:

1. In `chrome://extensions`, turn the release copy off and the project-folder copy on.
2. Reload the project-folder copy.
3. Afterwards, switch back.

Never leave both on: both would act on every page. The two copies keep separate options. The project-folder copy also reloads itself when its version goes up.

## Checking it

- **Windows:** `.github/workflows/windows-installer.yml` runs `test/windows/install-test.ps1` on a GitHub Windows machine, in Windows PowerShell 5.1, whenever the installer or its test changes: releases built and signed with a throwaway key, served from localhost over https; install, update (numerically), and each kind of bad release refused (edited, another key, another namespace, a different zip, a zip holding another version, a copy without a key), leaving the folder as it was; then the hourly task set up (window-less, under `conhost --headless`), run once, and removed by uninstall. `test/install-ps1.test.js` checks here what it can: plain ASCII, the same key, addresses and limits as `install.sh`, the site's command, and each variable spelled one way (PowerShell ignores case, so a `$task` would overwrite `$TASK`).
- `npm test`: `test/update.test.js` (the reload), `test/release.test.js` (the menu's notice) and `test/install.test.js`. That one builds and signs releases with a throwaway key, serves them over https from localhost, and installs and updates into a temporary home with `--no-schedule`: a newer release, an older and the same one, then each kind of bad one (an edited `latest.txt`, another key, another namespace, a different zip, a truncated one, a zip holding another version, a zip name with a path, plain http, no key), each leaving the installed folder as it was. It never schedules anything. `test/publish.test.js` publishes a release built with a throwaway key to a bare repository standing in for the mirror, with a stand-in for Wrangler, and checks the refusals: an edited `latest.txt`, no `_headers`, a mirror clone without its own identity, with uncommitted changes, or that isn't a GitHub Pages repository. It also checks the front page `build` wrote, and that `build` refuses without a plain address. `test/website.test.js` checks the page itself: its outlets are the extension's live sites, it loads nothing from elsewhere, its script has the hash its CSP allows (the test says the new one after a change), `build` fills each of its fields, and the command follows the page's address only when that's plain.
- `node tools/auto-update-check.mjs`: about 12 minutes, offline. It runs the whole loop in a headless Google Chrome with a profile of its own, deleted afterwards (`--chromium` to pick another browser):
  - A bare repository stands in for GitHub. A clone of it is loaded as **Load unpacked** loads it, with Developer mode on.
  - It pushes four releases and pulls each with the LaunchAgent's command:
    - two ordinary ones, with the service worker left to stop before each: each must load, new code included;
    - one whose manifest names a missing file: it must not load;
    - the one that adds the file: it must.
  - It tests the repository's committed HEAD; `--source` points it at another.
