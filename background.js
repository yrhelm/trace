// background.js  (MV3 module service worker)
//
// What this does:
//   - Watches every request as you browse (observation only, no blocking).
//   - Logs only third parties (the interesting half).
//   - For each (visit, tracker) it records a hit count AND a set of SIGNAL FLAGS:
//     what the tracker learned about you (an ID, your screen, the page, etc.).
//   - It stores the FLAGS, never the raw values. See lib/classify.js for why.
//
// Everything stays in chrome.storage.local. There is no network code in here.
//
// MV3 note: the service worker is ephemeral. Listeners are registered at top
// level so they re-attach on wake; we flush eagerly so a worker death costs at
// most ~1s of buffered events.

import { getDomain, hostnameFromUrl, classify, loadTrackerData } from "./lib/domains.js";
loadTrackerData();
import { signalsFromUrl, signalsFromHeaders, signalsFromBody, mergeSignals } from "./lib/classify.js";

const VISIT_CAP = 800;
const RETENTION_MS = 7 * 864e5;
const FLUSH_DEBOUNCE_MS = 1200;
const FLUSH_THRESHOLD = 40;

let pendingVisits = [];
const pendingEdges = new Map();   // key -> { visitId, ts, pageDomain, trackerDomain, org, category, count, signals }
const tabVisits = new Map();      // tabId -> { visitId, domain, ts }
let flushTimer = null;
let writeChain = Promise.resolve();

const edgeKey = (visitId, trackerDomain) => visitId + "\u241f" + trackerDomain;

function scheduleFlush() {
  if (pendingEdges.size + pendingVisits.length >= FLUSH_THRESHOLD) return flush();
  if (flushTimer) return;
  flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
}

function flush() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (pendingVisits.length === 0 && pendingEdges.size === 0) return;

  const visitsToWrite = pendingVisits;
  const edgesToWrite = Array.from(pendingEdges.values());
  pendingVisits = [];
  pendingEdges.clear();

  writeChain = writeChain.then(() => new Promise((resolve) => {
    chrome.storage.local.get({ visits: [], edges: {} }, (store) => {
      const visits = store.visits;
      const edges = store.edges;

      for (const v of visitsToWrite) visits.push(v);

      for (const e of edgesToWrite) {
        const k = edgeKey(e.visitId, e.trackerDomain);
        if (edges[k]) {
          edges[k].count += e.count;
          edges[k].signals = Object.assign(edges[k].signals || {}, e.signals || {});
        } else {
          edges[k] = e;
        }
      }

      const cutoff = Date.now() - RETENTION_MS;
      let kept = visits.filter((v) => v.ts >= cutoff);
      if (kept.length > VISIT_CAP) kept = kept.slice(kept.length - VISIT_CAP);
      const liveIds = new Set(kept.map((v) => v.id));
      const prunedEdges = {};
      for (const k in edges) if (liveIds.has(edges[k].visitId)) prunedEdges[k] = edges[k];

      chrome.storage.local.set({ visits: kept, edges: prunedEdges }, resolve);
    });
  }));
}

// resolve which page-visit a request belongs to (creating a synthetic one if the
// worker restarted and we lost the tab map). returns { visit, pageDomain } | null
function resolveVisit(details) {
  let visit = tabVisits.get(details.tabId);
  let pageDomain = visit && visit.domain;
  if (!pageDomain && details.initiator) pageDomain = getDomain(hostnameFromUrl(details.initiator));
  if (!pageDomain) return null;
  if (!visit) {
    visit = { visitId: details.tabId + "@synth@" + pageDomain, domain: pageDomain, ts: Date.now() };
    tabVisits.set(details.tabId, visit);
    pendingVisits.push({ id: visit.visitId, ts: visit.ts, domain: pageDomain, url: "https://" + pageDomain + "/" });
  }
  return { visit, pageDomain };
}

// OR a set of signal flags into the pending edge for (visit, tracker); optionally
// bump the hit count. Both request events funnel through here.
function upsertEdge(details, trackerDomain, pageDomain, visit, signalSet, incCount) {
  const k = edgeKey(visit.visitId, trackerDomain);
  let e = pendingEdges.get(k);
  if (!e) {
    const { org, category } = classify(trackerDomain);
    e = { visitId: visit.visitId, ts: details.timeStamp || Date.now(), pageDomain, trackerDomain, org, category, count: 0, signals: {} };
    pendingEdges.set(k, e);
  }
  if (incCount) e.count += 1;
  if (signalSet && signalSet.size) mergeSignals(e.signals, signalSet);
}

function classifyRequest(details, incCount, signalSet) {
  if (details.type === "main_frame") return;
  if (details.tabId < 0) return;
  const trackerDomain = getDomain(hostnameFromUrl(details.url));
  if (!trackerDomain) return;
  const rv = resolveVisit(details);
  if (!rv) return;
  if (trackerDomain === rv.pageDomain) return; // first-party
  upsertEdge(details, trackerDomain, rv.pageDomain, rv.visit, signalSet, incCount);
  scheduleFlush();
}

// ---- visits ----
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (/^chrome/.test(details.url)) return;
  const domain = getDomain(hostnameFromUrl(details.url));
  if (!domain) return;
  const visit = { id: details.tabId + "@" + details.timeStamp, ts: details.timeStamp, domain, url: details.url };
  tabVisits.set(details.tabId, { visitId: visit.id, domain, ts: visit.ts });
  pendingVisits.push(visit);
  flush();
});

chrome.tabs && chrome.tabs.onRemoved && chrome.tabs.onRemoved.addListener((tabId) => tabVisits.delete(tabId));

// ---- requests: URL + body signals (this event carries requestBody) ----
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    const set = signalsFromUrl(details.url);
    for (const s of signalsFromBody(details.requestBody)) set.add(s);
    classifyRequest(details, /*incCount=*/true, set);
  },
  { urls: ["<all_urls>"] },
  ["requestBody"]
);

// ---- requests: header signals (Cookie/UA/Referer/Language) ----
// extraHeaders is required to see Cookie/Referer/UA. We read them to classify and
// immediately discard the values — only the flags survive.
chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const set = signalsFromHeaders(details.requestHeaders);
    classifyRequest(details, /*incCount=*/false, set);
  },
  { urls: ["<all_urls>"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.runtime.onSuspend && chrome.runtime.onSuspend.addListener(flush);

// ---------------------------------------------------------------------------
// GPC enforcement — turn the user's opt-out into a real signal on every request.
//   header  : declarativeNetRequest adds `Sec-GPC: 1` (what servers + the law act on)
//   property: a MAIN-world content script sets navigator.globalPrivacyControl
// Both are toggled together by the stored `gpcEnabled` flag.
// ---------------------------------------------------------------------------
const GPC_RULE_ID = 1;
const GPC_SCRIPT_ID = "gpc-dom";
const GPC_RESOURCE_TYPES = ["main_frame","sub_frame","stylesheet","script","image","font","object","xmlhttprequest","ping","media","websocket","other"];

async function applyGpc(on) {
  // 1) request header
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [GPC_RULE_ID],
      addRules: on ? [{
        id: GPC_RULE_ID,
        priority: 1,
        action: { type: "modifyHeaders", requestHeaders: [{ header: "Sec-GPC", operation: "set", value: "1" }] },
        condition: { resourceTypes: GPC_RESOURCE_TYPES }
      }] : []
    });
  } catch (e) { /* header path unavailable; property path below still helps */ }

  // 2) DOM property (register only while on)
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [GPC_SCRIPT_ID] });
    if (on && existing.length === 0) {
      await chrome.scripting.registerContentScripts([{
        id: GPC_SCRIPT_ID, js: ["gpc-inject.js"], matches: ["<all_urls>"],
        runAt: "document_start", world: "MAIN", allFrames: true
      }]);
    } else if (!on && existing.length > 0) {
      await chrome.scripting.unregisterContentScripts({ ids: [GPC_SCRIPT_ID] });
    }
  } catch (e) { /* scripting registration unsupported on this Chrome build */ }
}

function getGpc(cb) { chrome.storage.local.get({ gpcEnabled: false }, (s) => cb(s.gpcEnabled)); }

// apply saved state on startup / install
getGpc(applyGpc);
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(() => getGpc(applyGpc));
chrome.runtime.onInstalled && chrome.runtime.onInstalled.addListener(() => getGpc(applyGpc));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "getGpc") { getGpc((on) => sendResponse({ enabled: on })); return true; }
  if (msg.type === "setGpc") {
    const on = !!msg.on;
    chrome.storage.local.set({ gpcEnabled: on }, () => applyGpc(on).finally(() => sendResponse({ enabled: on })));
    return true;
  }
});
