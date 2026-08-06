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
- **Follow one company's chain** — pick any company and get its trail in order:
  every stop it caught you at, with the gap between them. "Criteo saw you on
  siteA at 9:02, siteB at 9:15, and 4 more."
- **See who fingerprints** — trackers whose scripts probe your browser for a
  unique signature get a red badge. That's identification with no cookie to
  clear, so it's called out separately from ID-based tracking.
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

## Tracker data

Attribution is backed by [DuckDuckGo Tracker
Radar](https://github.com/duckduckgo/tracker-radar) (Apache-2.0), reduced to
`data/trackers.json` — 24,296 domains mapped to `[org, category,
fingerprintingScore]`. Upstream ships ~49k files across 9 regional crawls, which
has no business inside an extension, so `tools/build-trackers.mjs` flattens it
to the three fields Trace renders. To rebuild:

```sh
git clone --depth 1 https://github.com/duckduckgo/tracker-radar.git
node tools/build-trackers.mjs ./tracker-radar
```

The clone is ~100MB and is gitignored; only the generated file is committed.

The **fingerprinting score is Radar's raw 0–3** ("likelihood this domain is
fingerprinting users"), not a boolean. That distinction is load-bearing: ~47% of
domains score ≥1, so a flag set at ≥1 badges half the web and communicates
nothing. Trace badges ≥2 (25% of domains, and 5% score 3). Move `FP_THRESHOLD`
in `lib/domains.js` to retune it — no rebuild needed.

Worth knowing what the score does and doesn't mean: it measures *scripts probing
browser APIs*, which is a different mechanism from cookie/ID tracking. Criteo
scores 1 because it tags you with an ID instead — that surfaces as the "durable
ID" signal, not as a fingerprinting badge. A CDN serving a fingerprinting
library scores 3. Both readings are correct; they're just answering different
questions.

## Honest limits (flagged, not hidden)

- **Public suffix handling** uses a small hand-rolled set, not the full Public
  Suffix List — right for common cases, wrong for exotic TLDs. Upgrade path:
  bundle the real PSL.
- **Organization attribution** covers the 24,296 domains in Tracker Radar, with
  a curated seed list in `lib/domains.js` taking precedence on wording. Domains
  outside Radar fall back to showing the domain itself — honest, but unhelpful.
- **The tracker data is a snapshot**, frozen at build time. Trackers rotate
  domains; rerun `tools/build-trackers.mjs` to refresh it.
- **The re-identifiability number is an estimate**, using rough per-signal
  entropy (EFF Panopticlick-style). It's directional, not a guarantee, and is
  labeled as such wherever it appears.
- **The fingerprinting badge is a likelihood, not a verdict.** It says Radar's
  crawler saw scripts on that domain using APIs associated with fingerprinting —
  not that you were fingerprinted on that visit.

## Privacy

Everything is local. The extension's engine contains no network code. See
[PRIVACY.md](PRIVACY.md).

## License

[MIT](LICENSE). The bundled tracker data derives from DuckDuckGo Tracker Radar
(Apache-2.0) — see [NOTICE](NOTICE) for attribution.
