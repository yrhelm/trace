# Privacy Policy — Trace

_Last updated: August 2026_

## Summary

Trace is a local-only browser extension. It does not collect, store off your
device, transmit, sell, or share any personal data. There is no account, no
server, no analytics, and no telemetry. Everything Trace records stays in your
browser's local storage on your own machine. The extension's engine contains no
network-sending code.

## What Trace does

As you browse, Trace observes the third-party requests that web pages make (ad
networks, analytics, data brokers) and builds a local picture of which trackers
appeared on which of your visits, which organization is behind each, and what
*type* of information each tracker was in a position to learn. It can also, at
your option, attach a Global Privacy Control opt-out signal to your outgoing
requests. Observation is read-only — Trace does not block the tracking and does
not modify page content beyond the optional GPC signal.

## What Trace stores — and what it deliberately does not

Trace's core design rule is **data minimization**: it records the *type* of
exposure and discards the underlying value.

- **Stored (locally only):** the sites you visited, the third-party tracker
  domains seen on each, the organization/category label for each tracker, hit
  counts, and a set of **signal flags** describing the *kind* of data a tracker
  could observe (for example: "a durable ID was present," "approximate location
  was present," "device/browser was present").
- **Never stored:** the actual values behind those flags. Trace does not store
  your cookie values, tracking IDs, the full URLs of pages you visit, request
  bodies, or any raw header contents.
- **Read then discarded:** to decide which flags apply, Trace inspects request
  URLs, request bodies, and certain request headers (Cookie, User-Agent,
  Referer, Accept-Language). For the Cookie header specifically, Trace checks
  only whether a value *looks like a durable identifier* (by known cookie name
  or by entropy/format heuristics) in order to set the "durable ID" flag. The
  header values are used for that classification and are immediately discarded —
  they are never written to storage or transmitted anywhere.

## Data handling

- **No transmission.** Trace's engine makes no outbound network requests and
  sends no data to the developer or any third party. The only network effect
  Trace produces is the optional GPC opt-out signal it adds to requests you were
  already making.
- **Local, capped, self-pruning.** Records live in `chrome.storage.local`, are
  limited to roughly one week of history and a fixed number of recent visits,
  and older data is pruned automatically.
- **No sale or sharing.** Trace does not sell or share any data, because it
  never collects any off your device in the first place.

## Global Privacy Control (optional)

When you enable GPC, Trace adds the `Sec-GPC: 1` request header to your outgoing
requests (via a declarativeNetRequest rule) and sets the
`navigator.globalPrivacyControl` property to `true` on pages (via a script that
runs only while GPC is enabled). This communicates a "do not sell or share my
data" preference that some jurisdictions recognize and some websites honor. It
sends no information about you beyond the opt-out signal itself.

## Permissions

- **Host access to all sites (`<all_urls>`)**, **webRequest**, and
  **webNavigation** — to observe, read-only, which third-party trackers fire on
  the sites you visit and to associate them with the page you were on.
- **declarativeNetRequest** and **scripting** — used only when you enable GPC, to
  add the opt-out header and set the corresponding page property.
- **storage / unlimitedStorage** — to keep the local records described above.

## Children's privacy

Trace is not directed at children and collects no data from anyone.

## Changes to this policy

Any changes will be published at this document's URL. Continued use after a
change constitutes acceptance of the updated policy.

## Contact

Questions about this policy: yrhelm@outlook.com
