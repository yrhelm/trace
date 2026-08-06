chrome.storage.local.get({ visits: [], edges: {} }, (store) => {
  const visits = store.visits;
  const edges = Object.values(store.edges);
  const sites = new Set(visits.map((v) => v.domain));

  const byOrg = new Map();
  const taggedOrgs = new Set();
  for (const e of edges) {
    let o = byOrg.get(e.org);
    if (!o) { o = { org: e.org, sites: new Set() }; byOrg.set(e.org, o); }
    o.sites.add(e.pageDomain);
    if (e.signals && e.signals.id) taggedOrgs.add(e.org);
  }
  const followers = [...byOrg.values()].sort((a, b) => b.sites.size - a.sites.size);

  document.getElementById("sites").textContent = sites.size;
  document.getElementById("orgs").textContent = byOrg.size;

  const topline = document.getElementById("topline");
  if (followers.length === 0) {
    topline.textContent = "Nothing recorded yet. Browse a little, then check back.";
  } else {
    const t = followers[0];
    topline.innerHTML = "<b>" + esc(t.org) + "</b> followed you across " + t.sites.size + " of your " + sites.size + " sites.";
  }

  const tagline = document.getElementById("tagline");
  if (taggedOrgs.size) {
    tagline.innerHTML = "\u26a0 <b>" + taggedOrgs.size + "</b> " + (taggedOrgs.size === 1 ? "company" : "companies") + " tagged you with a durable ID.";
  }

  document.getElementById("mini").innerHTML = followers.slice(0, 3).map((f) =>
    '<li><span class="o">' + esc(f.org) + '</span><span class="c">' + f.sites.size + " sites</span></li>").join("");
});


(function(){
  const sw=document.getElementById("pgpc"), st=document.getElementById("pgpc-status");
  function setUi(on){ if(!sw)return; sw.classList.toggle("on",!!on); sw.setAttribute("aria-checked",on?"true":"false"); if(st){st.textContent=on?"on — opt-out sent on every request":"off"; st.classList.toggle("on",!!on);} }
  try{ chrome.runtime.sendMessage({type:"getGpc"},(r)=>setUi(r&&r.enabled)); }catch(e){}
  sw && sw.addEventListener("click",()=>{ const on=!sw.classList.contains("on"); setUi(on); try{chrome.runtime.sendMessage({type:"setGpc",on},(r)=>setUi(r?r.enabled:on));}catch(e){} });
})();

document.getElementById("open").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});
document.getElementById("clear").addEventListener("click", () => {
  chrome.storage.local.set({ visits: [], edges: {} }, () => window.close());
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
