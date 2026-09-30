import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";

const ROOT = process.cwd();
const SITE = "https://gool-zone.netlify.app";
const MAX_NEWS = 18;

// These feeds publish headlines/summaries and links back to the original publisher.
// You can replace or add feeds later with the NEWS_FEEDS environment variable.
const DEFAULT_FEEDS = [
  { name: "اليوم", url: "https://www.alyaum.com/rssFeed/1009/114", category: "كرة عالمية" },
  { name: "اليوم", url: "https://www.alyaum.com/rssFeed/1009/112", category: "السعودية" },
  { name: "بطولات", url: "https://www.btolat.com/rss", category: "كرة عربية" },
  { name: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/football/rss.xml", category: "كرة عالمية" }
];

const feeds = process.env.NEWS_FEEDS
  ? process.env.NEWS_FEEDS.split("||").map((part) => {
      const [name, url, category = "كرة القدم"] = part.split("|");
      return { name, url, category };
    })
  : DEFAULT_FEEDS;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => ["item", "entry", "media:content", "enclosure"].includes(name)
});

function arr(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function text(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return value["#text"] ?? value.text ?? "";
  return String(value);
}

function cleanHtml(value) {
  return text(value)
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "football-news";
}

function getImage(item) {
  const media = arr(item["media:content"])[0];
  const enclosure = arr(item.enclosure)[0];
  return media?.["@_url"] || enclosure?.["@_url"] || item.image || "";
}

function getLink(item) {
  if (typeof item.link === "string") return item.link;
  if (item.link?.["@_href"]) return item.link["@_href"];
  if (Array.isArray(item.link)) {
    const candidate = item.link.find((x) => x?.["@_href"]);
    return candidate?.["@_href"] || "";
  }
  return "";
}

function normalizeItem(item, feed) {
  const title = cleanHtml(item.title);
  const link = getLink(item);
  const description = cleanHtml(item.description || item.summary || item["content:encoded"]);
  const dateRaw = item.pubDate || item.published || item.updated || new Date().toISOString();
  const date = new Date(dateRaw);
  return {
    title,
    link,
    description: description.slice(0, 320),
    date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    image: getImage(item),
    source: feed.name,
    category: feed.category
  };
}

async function fetchFeed(feed) {
  try {
    const response = await fetch(feed.url, {
      headers: { "user-agent": "Gooal-Zone-NewsBot/1.0 (+https://gool-zone.netlify.app/)" },
      signal: AbortSignal.timeout(12000)
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const xml = await response.text();
    const parsed = parser.parse(xml);
    const channel = parsed.rss?.channel || parsed.feed || {};
    const items = arr(channel.item).concat(arr(channel.entry));
    return items.map((item) => normalizeItem(item, feed)).filter((item) => item.title && item.link);
  } catch (error) {
    console.warn(`Feed failed: ${feed.url} — ${error.message}`);
    return [];
  }
}

function uniqueNews(items) {
  const seen = new Set();
  return items
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .filter((item) => {
      const key = item.link || item.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_NEWS);
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("ar-MA", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

function card(item, index = 0) {
  const slug = `${slugify(item.title)}-${Math.abs(hash(item.link)).toString(36)}`;
  const image = item.image || "/news/transfers.svg";
  return `<article class="news-card${index === 0 ? " featured" : ""}">
<a href="/news/${slug}.html"><img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)}" loading="${index < 2 ? "eager" : "lazy"}" onerror="this.onerror=null;this.src='/news/transfers.svg'"><div class="card-body"><span class="category">${escapeHtml(item.category)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.description || "أحدث أخبار كرة القدم من المصدر الأصلي.")}</p><time datetime="${escapeHtml(item.date)}">${escapeHtml(formatDate(item.date))}</time></div></a></article>`;
}

function hash(value) {
  let h = 2166136261;
  for (const ch of value) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
  return h >>> 0;
}

function articlePage(item) {
  const slug = `${slugify(item.title)}-${Math.abs(hash(item.link)).toString(36)}`;
  const image = item.image || `${SITE}/news/transfers.svg`;
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(item.title)} | Gooal Zone</title>
<meta name="description" content="${escapeHtml(item.description || item.title)}"><meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${SITE}/news/${slug}.html"><meta property="og:type" content="article"><meta property="og:title" content="${escapeHtml(item.title)}"><meta property="og:description" content="${escapeHtml(item.description || item.title)}"><meta property="og:url" content="${SITE}/news/${slug}.html"><meta property="og:image" content="${escapeHtml(image)}"><meta property="og:site_name" content="Gooal Zone">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/style.css">
<script type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@type":"NewsArticle","headline":item.title,"datePublished":item.date,"dateModified":item.date,"mainEntityOfPage":`${SITE}/news/${slug}.html`,"image":[image],"publisher":{"@type":"Organization","name":"Gooal Zone","url":SITE}})}</script>
</head><body><header class="topbar"><div class="container nav"><a class="logo" href="/"><span>G</span> Gooal <b>Zone</b></a><button class="menu-btn" aria-label="فتح القائمة">☰</button><nav id="mainNav"><a href="/">الرئيسية</a><a href="/news.html">آخر الأخبار</a><a href="/#matches">المباريات</a><a href="/#transfers">الانتقالات</a><a href="/about.html">من نحن</a></nav></div></header>
<main class="container page article-page"><span class="eyebrow dark">${escapeHtml(item.category)}</span><h1>${escapeHtml(item.title)}</h1><time datetime="${escapeHtml(item.date)}">${escapeHtml(formatDate(item.date))}</time><img class="article-image" src="${escapeHtml(image)}" alt="${escapeHtml(item.title)}" onerror="this.onerror=null;this.src='/news/transfers.svg'"><div class="article-body"><p>${escapeHtml(item.description || "هذا الخبر منشور عبر خلاصات الأخبار، ويمكن متابعة التفاصيل الكاملة من المصدر الأصلي.")}</p><p class="source-note">المصدر: ${escapeHtml(item.source)} — <a href="${escapeHtml(item.link)}" rel="noopener noreferrer nofollow" target="_blank">قراءة الخبر الأصلي</a></p></div></main>
<footer><div class="container footer"><div><strong>Gooal Zone</strong><p>أخبار كرة القدم المغربية والعالمية.</p></div><div class="footer-links"><a href="/about.html">من نحن</a><a href="/privacy.html">الخصوصية</a><a href="/contact.html">اتصل بنا</a></div><p>© <span id="year"></span> Gooal Zone</p></div></footer><script src="/script.js" defer></script></body></html>`;
}

async function main() {
  const all = (await Promise.all(feeds.map(fetchFeed))).flat();
  const news = uniqueNews(all);
  if (!news.length) {
    console.warn("No RSS items were available; keeping the existing static content.");
    return;
  }

  const newsDir = path.join(ROOT, "news");
  await fs.mkdir(newsDir, { recursive: true });
  const generatedDir = path.join(newsDir, "generated");
  await fs.rm(generatedDir, { recursive: true, force: true });
  await fs.mkdir(generatedDir, { recursive: true });

  for (const item of news) {
    const slug = `${slugify(item.title)}-${Math.abs(hash(item.link)).toString(36)}`;
    await fs.writeFile(path.join(generatedDir, `${slug}.html`), articlePage(item), "utf8");
  }

  const data = { generatedAt: new Date().toISOString(), count: news.length, items: news };
  await fs.writeFile(path.join(ROOT, "news-data.json"), JSON.stringify(data, null, 2), "utf8");

  for (const file of ["index.html", "news.html"]) {
    const filePath = path.join(ROOT, file);
    let html = await fs.readFile(filePath, "utf8");
    const cards = news.map(card).join("\n");
    const start = "<!-- AUTO_NEWS_START -->";
    const end = "<!-- AUTO_NEWS_END -->";
    if (html.includes(start) && html.includes(end)) {
      html = html.replace(new RegExp(`${start}[\\s\\S]*?${end}`), `${start}\n${cards}\n${end}`);
    }
    await fs.writeFile(filePath, html, "utf8");
  }

  const sitemapPath = path.join(ROOT, "sitemap.xml");
  let sitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${SITE}/</loc></url><url><loc>${SITE}/news.html</loc></url>`;
  for (const item of news) {
    const slug = `${slugify(item.title)}-${Math.abs(hash(item.link)).toString(36)}`;
    sitemap += `\n<url><loc>${SITE}/news/${slug}.html</loc><lastmod>${item.date.slice(0,10)}</lastmod></url>`;
  }
  sitemap += "\n</urlset>\n";
  await fs.writeFile(sitemapPath, sitemap, "utf8");
  console.log(`Generated ${news.length} automatic football news articles.`);
}

main().catch((error) => { console.error(error); process.exit(1); });
