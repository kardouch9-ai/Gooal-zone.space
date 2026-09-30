import fs from "node:fs/promises";

const SITE = process.env.SITE_URL || "https://gooal-zone.space";
const API_KEY = process.env.FOOTBALL_API_KEY;
const TZ = "Africa/Casablanca";
const INDEX = "index.html";
const DATA = "matches-data.json";

function localDate(offset = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(now);
  const base = `${parts.find(x=>x.type==="year").value}-${parts.find(x=>x.type==="month").value}-${parts.find(x=>x.type==="day").value}T12:00:00`;
  const d = new Date(base + "Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0,10);
}

function esc(s="") {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function formatTime(iso) {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date(iso));
  } catch { return "--:--"; }
}

function formatDate(date) {
  try {
    return new Intl.DateTimeFormat("ar-MA", {
      timeZone: TZ, weekday: "long", day: "numeric", month: "long"
    }).format(new Date(`${date}T12:00:00Z`));
  } catch { return date; }
}

async function fetchDate(date) {
  const url = `https://v3.football.api-sports.io/fixtures?date=${date}&timezone=${encodeURIComponent(TZ)}`;
  const res = await fetch(url, {
    headers: { "x-apisports-key": API_KEY },
    signal: AbortSignal.timeout(15000)
  });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors && Object.keys(body.errors).length) {
    throw new Error(`API error: ${JSON.stringify(body.errors)}`);
  }
  return (body.response || []).map(x => ({
    id: x.fixture?.id,
    date: x.fixture?.date,
    status: x.fixture?.status?.short || "",
    statusLong: x.fixture?.status?.long || "",
    home: x.teams?.home?.name || "",
    away: x.teams?.away?.name || "",
    homeLogo: x.teams?.home?.logo || "",
    awayLogo: x.teams?.away?.logo || "",
    league: x.league?.name || "",
    country: x.league?.country || "",
    round: x.league?.round || ""
  })).filter(x => x.home && x.away);
}

function card(m) {
  const status = m.status === "NS" ? "" : `<span class="match-status">${esc(m.statusLong || m.status)}</span>`;
  const logos = `
    <div class="team"><b>${esc(m.home)}</b>${m.homeLogo ? `<img src="${esc(m.homeLogo)}" alt="" loading="lazy">` : ""}</div>
    <span class="vs">VS</span>
    <div class="team"><b>${esc(m.away)}</b>${m.awayLogo ? `<img src="${esc(m.awayLogo)}" alt="" loading="lazy">` : ""}</div>`;
  return `<div class="match"><div class="match-teams">${logos}</div><strong>${esc(formatTime(m.date))}</strong><small>${esc(m.league)}${m.country ? ` · ${esc(m.country)}` : ""}</small>${status}</div>`;
}

async function main() {
  if (!API_KEY) {
    console.error("FOOTBALL_API_KEY is not configured.");
    process.exit(1);
  }

  const dates = [0, 1, 2].map(localDate);
  const all = [];
  const errors = [];

  for (const date of dates) {
    try {
      const items = await fetchDate(date);
      all.push(...items.map(x => ({...x, dateOnly: date})));
      console.log(`Fetched ${items.length} fixtures for ${date}`);
    } catch (e) {
      errors.push(`${date}: ${e.message}`);
      console.error(`Failed ${date}: ${e.message}`);
    }
  }

  if (!all.length) {
    console.error("No fixtures were fetched. Existing matches will not be replaced.");
    process.exit(1);
  }

  const seen = new Set();
  const matches = all.filter(x => {
    if (!x.id || seen.has(x.id)) return false;
    seen.add(x.id);
    return true;
  }).slice(0, 60);

  await fs.writeFile(DATA, JSON.stringify({
    generatedAt: new Date().toISOString(),
    timezone: TZ,
    dates,
    matches,
    errors
  }, null, 2), "utf8");

  const groups = dates.map(date => {
    const day = matches.filter(m => m.dateOnly === date);
    if (!day.length) return `<div class="match-day"><h3>${esc(formatDate(date))}</h3><p class="no-matches">لا توجد مباريات مسجلة لهذا اليوم.</p></div>`;
    return `<div class="match-day"><h3>${esc(formatDate(date))}</h3><div class="matches">${day.slice(0,20).map(card).join("")}</div></div>`;
  }).join("");

  const block = `
<section id="matches" class="container section">
 <div class="section-head"><div><span class="eyebrow dark">تحديث تلقائي</span><h2>المباريات اليوم والقادمة</h2></div></div>
 <div class="auto-matches">${groups}</div>
 <p class="source-note">آخر تحديث تلقائي: ${esc(new Intl.DateTimeFormat("ar-MA",{timeZone:TZ,dateStyle:"medium",timeStyle:"short"}).format(new Date()))}. البيانات من Football API.</p>
</section>`;

  let html = await fs.readFile(INDEX, "utf8");
  const start = html.indexOf('<section id="matches"');
  if (start === -1) throw new Error("Matches section not found in index.html");
  const end = html.indexOf('</section>', start);
  if (end === -1) throw new Error("Matches section closing tag not found");
  html = html.slice(0,start) + block + html.slice(end + '</section>'.length);
  await fs.writeFile(INDEX, html, "utf8");
  console.log(`Updated index.html with ${matches.length} fixtures.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
