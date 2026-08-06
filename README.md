# Trace — who followed you across the web

Trace watches the trackers that quietly load while you browse and shows you who
they are, what they learned about you, and how they follow you from site to
site. Everything stays on your machine — no account, no server, nothing leaves
your device.

## What it does

- **See who's really tracking you** — every ad network, analytics script, and
  data broker, traced back to the real company (so `adsrvr.org` shows up as
  "The Trade Desk," `demdex.net` as "Adobe Audience Manager").
- **Watch them follow you** — Trace builds a picture of which trackers appear
  across which of your visits, so the same company reappearing on site after
  site becomes visible. That's the trail a normal blocker never shows.
- **Know what leaked** — for each tracker on each visit, Trace records the
  *types* of data exposed: a durable ID, approximate location, device/browser,
  screen, timezone, language, the page you were on, where you came from, your
  consent string. It records *that* these leaked — never the actual values.
- **Get a fingerprint read** — an aggregate re-identifiability estimate in plain
  language (e.g. "1 in ~2.3 million"), labeled as an estimate everywhere.
- **Push back with one switch** — turn on GPC and Trace attaches a Global
  Privacy Control signal to your traffic: the `Sec-GPC` request header (a
  legally recognized opt-out under laws like California's) plus the
  `navigator.globalPrivacyControl` property that consent scripts read.
- **Stays private and tidy** — about a week of history, capped, all in local
  storage, pruned automatically.

## The design rule that matters

Trace classifies the *kind* of exposure and then throws the raw value away. It
never stores your cookie value, your ID, or the URL you were on. Header values
(Cookie, User-Agent, Referer, Accept-Language) are read only to decide which
signal flags apply, then discarded. A privacy tool that hoarded that data would
just become the richest tracking database on your own machine — the exact thing
it exists to expose. So: classify, then forget.

## Install (unpacked, for testing)

1. Unzip to a folder you'll keep.
2. **Chrome:** open `chrome://extensions` → turn on **Developer mode** (top
   right) → **Load unpacked** → select the folder → pin it.
3. **Edge:** open `edge://extensions` → **Developer mode** → **Load unpacked** →
   same folder.

Open a few sites, then click the Trace icon to see the trackers, the following,
and your re-id read. Flip the GPC switch to send the opt-out signal.

## How it works (short version)

- A Manifest V3 service worker observes third-party requests (observation only —
  it does not block the tracking itself), attributes each to an organization and
  category, and builds a **visits + edges** graph in `chrome.storage.local`.
- Signal detection lives in `lib/classify.js`; organization/category attribution
  and registrable-domain logic in `lib/domains.js`.
- GPC enforcement uses a `declarativeNetRequest` header rule plus a MAIN-world
  property injection, toggled together and applied on startup from the saved
  flag.

## Honest limits (flagged, not hidden)

- **Public suffix handling** uses a small hand-rolled set, not the full Public
  Suffix List — right for common cases, wrong for exotic TLDs. Upgrade path:
  bundle the real PSL.
- **Organization attribution** is only as good as the seed list in
  `lib/domains.js` (~90 of the players you'll actually see). Upgrade path: fold
  in a maintained tracker list such as DuckDuckGo Tracker Radar or EasyPrivacy.
- **The re-identifiability number is an estimate**, using rough per-signal
  entropy (EFF Panopticlick-style). It's directional, not a guarantee, and is
  labeled as such wherever it appears.

## Privacy

Everything is local. The extension's engine contains no network code. See
[PRIVACY.md](PRIVACY.md).
