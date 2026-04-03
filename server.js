/* ═══════════════════════════════════════════════════════════════════════
   P.S Movizx — Backend Server  (Node.js + Express)
   Install:  npm install
   Run    :  node server.js
   Open   :  http://localhost:3000
   ═══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const fetch   = require('node-fetch');
const cheerio = require('cheerio');
const cors    = require('cors');
const path    = require('path');

const app  = express();
const PORT = process.env.PORT || 3000;
const BASE = 'https://moviesda18.com';
const HDR  = {
  'User-Agent'     : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept'         : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection'     : 'keep-alive',
  'Referer'        : 'https://moviesda18.com/',
};

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ════ CACHE (in-memory, 1-hour TTL) ════════════════════════════════ */
const CACHE = new Map();
const TTL   = 60 * 60 * 1000;
const cGet  = k => { const e = CACHE.get(k); return (e && Date.now()-e.t < TTL) ? e.v : null; };
const cSet  = (k,v) => { CACHE.set(k,{v,t:Date.now()}); return v; };

/* ════ HTTP SCRAPER (cache + retry) ══════════════════════════════════ */
async function scrape(url, retries = 2) {
  const cached = cGet('__html__'+url);
  if (cached) return cached;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: HDR, timeout: 18000 });
      const h = await r.text();
      if (h.length > 100) return cSet('__html__'+url, h);
    } catch (e) {
      if (i === retries) console.error('[scrape fail]', url, e.message);
      else await new Promise(r => setTimeout(r, 1200*(i+1)));
    }
  }
  return '';
}

/* ════ SHARED HELPERS ════════════════════════════════════════════════ */

/**
 * Parse a standard moviesda listing page.
 * allowAtoZ — when true, also allows /tamil-movies/X/ style links (for A-Z page)
 * Returns { movies: [{name,path}], total, folders: [{name,path}] }
 * "folders" = sub-category folders (actor collections, quality options, etc.)
 */
function parseListing(html, { allowAtoZ = false } = {}) {
  const $      = cheerio.load(html);
  const movies  = [];
  const folders = [];

  $('div.f a').each((_,el) => {
    const href = $(el).attr('href')||'';
    const name = $(el).text().trim();
    if (!href.startsWith('/') || !name) return;
    if (href.includes('isaidub')) return;
    if (href.includes('/page/movie-request')) return;

    // A-Z alphabet nav links — only keep when explicitly allowed
    if (href.match(/^\/tamil-movies\/[a-z0-9]\/$/) ) {
      if (allowAtoZ) folders.push({ name: name.toUpperCase(), path: href, isLetter: true });
      return; // never add as a movie
    }

    // Alpha-list links at page bottom — skip
    if (href.match(/^\/tamil-movies\/[a-z]\/$/)) return;

    movies.push({ name, path: href });
  });

  const total = parseInt($('#totalPages').text()) || 1;
  return { movies, folders, total };
}

/* ════ ROUTES ════════════════════════════════════════════════════════ */

/* ── /api/categories ─────────────────────────────────────────────── */
app.get('/api/categories', async (req, res) => {
  const k = 'cats', c = cGet(k); if (c) return res.json(c);
  const $ = cheerio.load(await scrape(BASE+'/'));
  const cats = [];
  $('div.f a').each((_,el) => {
    const href = $(el).attr('href')||'', name = $(el).text().trim();
    if (href.startsWith('/') && name && !href.includes('isaidub') && !href.includes('/page/'))
      cats.push({ name, path: href });
  });
  res.json(cSet(k, cats));
});

/* ── /api/movies?category=PATH[&page=N] ──────────────────────────
   Works for: year pages, actor collections, A-Z letter pages, HD pages.
   Omit page → fetches ALL pages concurrently and returns full flat list.
   For collections with sub-folders, fetches movies from all sub-folders. */
app.get('/api/movies', async (req, res) => {
  const { category, page } = req.query;
  if (!category) return res.status(400).json({ error: 'category required' });

  const k = `mov|${category}|${page||'all'}`, c = cGet(k);
  if (c) return res.json(c);

  if (page) {
    const html = await scrape(`${BASE}${category}?page=${page}`);
    const { movies, total } = parseListing(html);
    return res.json(cSet(k, { movies, total, page: +page }));
  }

  // All-pages mode - first check if this is a collection with sub-folders
  const html1 = await scrape(`${BASE}${category}`);
  const { movies: m1, folders, total } = parseListing(html1, { allowAtoZ: true });
  
  // If page has sub-folders (like actor collections or director collections)
  // fetch movies from each sub-folder
  let all = [];
  if (folders.length > 0 && folders.length > m1.length) {
    // This appears to be a collection page with movie sub-folders
    console.log(`[Collection detected] ${category} with ${folders.length} sub-folders`);
    
    // Fetch movies from all sub-folders in parallel (batches of 5)
    for (let i = 0; i < folders.length; i += 5) {
      const batch = [];
      for (let j = i; j < i+5 && j < folders.length; j++) {
        batch.push(scrape(`${BASE}${folders[j].path}`).then(html => parseListing(html).movies));
      }
      const results = await Promise.all(batch);
      results.forEach(movies => all.push(...movies));
    }
  } else {
    // Regular category - load all pages
    all = [...m1];
    for (let p = 2; p <= total; p += 5) {
      const batch = [];
      for (let b = p; b < p+5 && b <= total; b++)
        batch.push(scrape(`${BASE}${category}?page=${b}`));
      (await Promise.all(batch)).forEach(h => all.push(...parseListing(h).movies));
    }
  }
  
  res.json(cSet(k, { movies: all, total: all.length, page: 0 }));
});

/* ── /api/folders?path=PATH ──────────────────────────────────────
   Returns sub-folder list for collection pages (actor/director collections,
   A-Z landing page, Tamil Movies Collection, etc.).
   Also returns direct movie list if the page has movies directly. */
app.get('/api/folders', async (req, res) => {
  const { path: p } = req.query;
  if (!p) return res.status(400).json({ error: 'path required' });

  const k = `folders|${p}`, c = cGet(k); if (c) return res.json(c);

  const html    = await scrape(BASE + p);
  const { movies, folders, total } = parseListing(html, { allowAtoZ: true });

  // Check if this is an A-Z category:
  // 1. By detecting 20+ letter folders from the page
  // 2. Or by checking if path contains 'atoz' or 'a-z' or 'a2z'
  const letterCount = folders.filter(f => f.isLetter).length;
  const isAtoZPath = p.toLowerCase().includes('atoz') || p.toLowerCase().includes('a-z') || p.toLowerCase().includes('a2z');
  
  if (letterCount >= 20 || isAtoZPath) {
    // Generate all 26 letters with proper paths
    let letters = folders.filter(f => f.isLetter);
    
    // If we detected too few or none, generate them
    if (letters.length < 20) {
      letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => ({
        name    : l,
        path    : `/tamil-movies/${l.toLowerCase()}/`,
        isLetter: true,
      }));
    }
    
    return res.json(cSet(k, { folders: letters, movies: [], total: 1, type: 'atoz' }));
  }

  res.json(cSet(k, { folders, movies, total, type: folders.length > 0 ? 'collection' : 'movies' }));
});

/* ── /api/items?path=PATH ────────────────────────────────────────
   Deep item fetch: returns quality sub-folders + direct download files.
   Used inside the movie detail modal. */
app.get('/api/items', async (req, res) => {
  const { path: p } = req.query;
  if (!p) return res.status(400).json({ error: 'path required' });

  const k = `items|${p}`, c = cGet(k); if (c) return res.json(c);

  const html = await scrape(BASE + p);
  const $    = cheerio.load(html);

  // Quality / version sub-folders
  const subItems = [];
  $('div.f a').each((_,el) => {
    const href = $(el).attr('href')||'', name = $(el).text().trim();
    if (!href.startsWith('/') || !name) return;
    if (href.match(/^\/tamil-movies\/[a-z0-9]\/$/) || href.includes('isaidub') || href.includes('/page/')) return;
    subItems.push({ name, path: href });
  });

  // Direct download file rows
  const files = [];
  $('div.folder').each((_,el) => {
    // Try multiple selectors to find thumbnail
    let imgSrc = $(el).find('div.tblimg img').attr('src') || '';
    if (!imgSrc) {
      imgSrc = $(el).find('img').first().attr('src') || '';
    }
    const link   = $(el).find('a.coral');
    const dlPath = link.attr('href')||'';
    const lis    = $(el).find('li');
    if (dlPath.startsWith('/download/')) {
      let thumbUrl = '';
      if (imgSrc) {
        thumbUrl = imgSrc.startsWith('http') ? imgSrc : BASE+imgSrc;
      }
      files.push({
        name   : link.text().trim(),
        size   : lis.eq(1).text().replace('File Size:','').trim(),
        format : lis.eq(2).text().replace('Download Format:','').trim(),
        dlPath,
        thumb  : thumbUrl,
      });
    }
  });

  res.json(cSet(k, { subItems, files }));
});

/* ── /api/links?dlpath=/download/slug/ ───────────────────────────
   3-hop chain → direct MP4 download URL + watch stream URL */
app.get('/api/links', async (req, res) => {
  const { dlpath } = req.query;
  if (!dlpath) return res.status(400).json({ error: 'dlpath required' });

  const k = `lnk|${dlpath}`, c = cGet(k); if (c) return res.json(c);

  const $1  = cheerio.load(await scrape(BASE+dlpath));
  const raw = $1('div.bf img,div.albumcover img').first().attr('src')||'';
  const meta = {
    thumb      : raw ? (raw.startsWith('http')?raw:BASE+raw) : '',
    fileName   : $1('.details').eq(0).text().replace('File Name:','').trim(),
    fileSize   : $1('.details').eq(1).text().replace('File Size:','').trim(),
    duration   : $1('.details').eq(2).text().replace('Duration:','').trim(),
    resolution : $1('.details').eq(3).text().replace('Video Resolution:','').trim(),
    format     : $1('.details').eq(4).text().replace('Download Format:','').trim(),
    addedOn    : $1('.details').eq(5).text().replace('Added On:','').trim(),
  };
  const hop1 = $1('div.dlink a').first().attr('href')||'';
  if (!hop1) return res.json({ ...meta, downloadUrls:[], watchUrls:[] });

  const $2   = cheerio.load(await scrape(hop1));
  const hop2 = $2('div.dlink a').first().attr('href')||'';

  const dlUrls = [], wtUrls = [];
  const classify = (href, txt) => {
    if (!href || href==='#') return;
    if (txt.includes('watch') || href.includes('stream') || href.includes('play.'))
         { if (!wtUrls.includes(href)) wtUrls.push(href); }
    else { if (!dlUrls.includes(href)) dlUrls.push(href); }
  };

  if (hop2 && hop2.includes('downloadpage.xyz')) {
    const $3 = cheerio.load(await scrape(hop2));
    $3('div.dlink a').each((_,el) => classify($3(el).attr('href')||'',$3(el).text().toLowerCase()));
  } else {
    $2('div.dlink a').each((_,el) => classify($2(el).attr('href')||'',$2(el).text().toLowerCase()));
  }

  res.json(cSet(k, { ...meta, downloadUrls: dlUrls, watchUrls: wtUrls }));
});

/* ── /api/stream?url=URL ─────────────────────────────────────────
   Resolves a watch page to a direct MP4 src */
app.get('/api/stream', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });
  const k = `stream|${url}`, c = cGet(k); if (c) return res.json(c);

  const html = await scrape(url);
  const $    = cheerio.load(html);
  let src = '';
  $('video source').each((_,el) => {
    const s = $(el).attr('src')||'';
    if (!src && (s.includes('.mp4')||s.includes('.m3u8'))) src = s;
  });
  if (!src) {
    for (const re of [
      /["']?src["']?\s*:\s*["'](https?:\/\/[^"']+\.mp4)/i,
      /<source[^>]+src=["'](https?:\/\/[^"']+\.mp4)/i,
      /file\s*:\s*["'](https?:\/\/[^"']+\.mp4)/i,
    ]) { const m = html.match(re); if (m) { src = m[1]; break; } }
  }
  res.json(cSet(k, { streamUrl: src }));
});

/* ── /api/imdb?title=NAME ────────────────────────────────────────*/
app.get('/api/imdb', async (req, res) => {
  const { title } = req.query;
  if (!title) return res.status(400).json({ error: 'title required' });
  const k = `imdb|${title}`, c = cGet(k); if (c) return res.json(c);

  const clean = title
    .replace(/\(?\d{4}\)?/g,'').replace(/\(.*?\)/g,'')
    .replace(/\b(HD|720p|1080p|480p|360p|Original|DVDRip|BluRay|WEB-DL|WEBRip|CAMRip)\b/gi,'')
    .trim();
  try {
    const d = await fetch(
      `https://www.omdbapi.com/?t=${encodeURIComponent(clean)}&apikey=trilogy`,
      { timeout: 8000 }
    ).then(r => r.json());
    if (d.Response === 'True') return res.json(cSet(k, {
      poster   : d.Poster     !== 'N/A' ? d.Poster     : null,
      rating   : d.imdbRating !== 'N/A' ? d.imdbRating : null,
      plot     : d.Plot       !== 'N/A' ? d.Plot       : null,
      genre    : d.Genre      !== 'N/A' ? d.Genre      : null,
      year     : d.Year       !== 'N/A' ? d.Year       : null,
      director : d.Director   !== 'N/A' ? d.Director   : null,
      actors   : d.Actors     !== 'N/A' ? d.Actors     : null,
      runtime  : d.Runtime    !== 'N/A' ? d.Runtime    : null,
      language : d.Language   !== 'N/A' ? d.Language   : null,
      awards   : d.Awards     !== 'N/A' ? d.Awards     : null,
    }));
  } catch(e) {}
  res.json(cSet(k, {}));
});

/* ── /api/updates ────────────────────────────────────────────────*/
app.get('/api/updates', async (req, res) => {
  const k = 'updates', c = cGet(k); if (c) return res.json(c);
  const $ = cheerio.load(await scrape(BASE+'/'));
  const list = [];
  $('div.latest').each((_,el) => {
    const text = $(el).text().trim(), href = $(el).find('a').attr('href')||'';
    if (text) list.push({ text, href, at: new Date().toISOString() });
  });
  res.json(cSet(k, list));
});

/* ── /api/health ─────────────────────────────────────────────────*/
app.get('/api/health', (_,res) =>
  res.json({ ok:true, cache: CACHE.size, uptime: Math.floor(process.uptime()) })
);

/* ════ SERVER START / VERCEL COMPAT ═══════════════════════════════════ */
if (require.main === module) {
  app.listen(PORT, () => {
    console.log('\n  ✓ P.S Movizx is running!');
    console.log(`  => Open: http://localhost:${PORT}\n`);
  });
}

module.exports = app;
