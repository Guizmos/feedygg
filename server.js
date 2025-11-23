// server.js
// Backend YGG Feed avec SQLite + scan intelligent

const express = require("express");
const Parser = require("rss-parser");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const pkg = require("./package.json");
const APP_VERSION = pkg.version;

// -----------------------------------------------------------------------------
// CONFIG ENV
// -----------------------------------------------------------------------------

const PORT = process.env.PORT || 8080;

const RSS_PASSKEY = process.env.RSS_PASSKEY;

// Films (par défaut: ancien RSS_ID ou 2183)
const RSS_MOVIES_ID = process.env.RSS_MOVIES_ID || process.env.RSS_ID || "2183";
// Séries TV
const RSS_SERIES_ID = process.env.RSS_SERIES_ID || "2184";
// Émissions TV
const RSS_SHOWS_ID = process.env.RSS_SHOWS_ID || "2182";
// Animation
const RSS_ANIMATION_ID = process.env.RSS_ANIMATION_ID || "2178";
// Jeux vidéo
const RSS_GAMES_ID = process.env.RSS_GAMES_ID || "2161";
// Spectacle
const RSS_SPECTACLE_ID = process.env.RSS_SPECTACLE_ID || "2185";

const TMDB_API_KEY = process.env.TMDB_API_KEY || "";
const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w500";

const IGDB_CLIENT_ID = process.env.IGDB_CLIENT_ID || "";
const IGDB_CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET || "";
const IGDB_BASE_URL = "https://api.igdb.com/v4";

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "yggfeed.db");
const SYNC_INTERVAL_MINUTES = Number(process.env.SYNC_INTERVAL_MINUTES || 10); // ex: 10 min

const LOG_FILE =
  process.env.LOG_FILE || path.join(__dirname, "yggfeed.log");
const LOG_MAX_BYTES = Number(
  process.env.LOG_MAX_BYTES || 5 * 1024 * 1024 // 5 Mo
);

// -----------------------------------------------------------------------------
// LOGS → niveaux + fichier + rotation simple
// -----------------------------------------------------------------------------

const LOG_LEVELS = {
  INFO: "INFO",
  WARN: "WARN",
  ERROR: "ERROR",
};

let logCount = 0;

// masque passkey / api_key dans tout ce qu'on log
function maskSecrets(str) {
  if (str == null) return "";
  const s = String(str);
  return s.replace(/(passkey|api_key)=[^&\s]+/gi, "$1=********");
}

function appendLogLine(line) {
  try {
    fs.appendFile(LOG_FILE, line + "\n", (err) => {
      if (err) {
        console.error("[LOGS] Erreur append:", err.message);
      }
    });
  } catch (e) {
    console.error("[LOGS] Exception append:", e.message);
  }
}

function rotateLogsIfNeeded() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;

    const stat = fs.statSync(LOG_FILE);
    if (stat.size <= LOG_MAX_BYTES) return;

    const data = fs.readFileSync(LOG_FILE, "utf8");
    const lines = data.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-1000); // on garde les 1000 dernières lignes

    fs.writeFileSync(LOG_FILE, tail.join("\n") + "\n", "utf8");
    console.log(
      `[LOGS] Rotation effectuée, fichier tronqué à ${tail.length} lignes`
    );
  } catch (e) {
    console.error("[LOGS] Erreur rotation:", e.message);
  }
}

function writeLog(level, tag, message) {
  const now = new Date();
  const stamp = now.toLocaleString("fr-FR");
  const safeMsg = maskSecrets(message || "");
  const line = `[${stamp}] [${level}] [${tag}] ${safeMsg}`;

  // Affiché dans les logs Docker
  console.log(line);

  // Append dans le fichier
  appendLogLine(line);

  // Check périodique de la taille pour rotation
  logCount++;
  if (logCount % 50 === 0) {
    rotateLogsIfNeeded();
  }
}

// raccourcis
const logInfo = (tag, msg) => writeLog(LOG_LEVELS.INFO, tag, msg);
const logWarn = (tag, msg) => writeLog(LOG_LEVELS.WARN, tag, msg);
const logError = (tag, msg) => writeLog(LOG_LEVELS.ERROR, tag, msg);

// -----------------------------------------------------------------------------
// CHECK CONFIG
// -----------------------------------------------------------------------------

if (!RSS_PASSKEY) {
  logError("CONFIG", "Missing RSS_PASSKEY env var");
  process.exit(1);
}

// -----------------------------------------------------------------------------
// EXPRESS APP
// -----------------------------------------------------------------------------

const app = express();

// static front (public/)
app.use(express.static(path.join(__dirname, "public")));

// Route pour exposer la version de l'appli
app.get("/version", (req, res) => {
  res.json({ version: APP_VERSION });
});

// -----------------------------------------------------------------------------
// SQLITE INIT
// -----------------------------------------------------------------------------

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Table principale
db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guid          TEXT UNIQUE,
    category      TEXT,
    raw_title     TEXT,
    title         TEXT,
    year          INTEGER,
    episode       TEXT,
    size          TEXT,
    seeders       INTEGER,
    quality       TEXT,
    added_at      TEXT,
    added_at_ts   INTEGER,
    poster        TEXT,
    page_link     TEXT,
    download_link TEXT,
    created_at    INTEGER,
    updated_at    INTEGER
  );
`);

// Index pour accélérer les requêtes
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_items_category_date
    ON items (category, added_at_ts DESC);

  CREATE INDEX IF NOT EXISTS idx_items_category_seeders
    ON items (category, seeders DESC);
`);

// -----------------------------------------------------------------------------
// RSS PARSER
// -----------------------------------------------------------------------------

const parser = new Parser({
  customFields: {
    item: [
      "enclosure",
      "category",
      "size",
      "seeders",
      "leechers",
      "uploaded_at",
      ["ygg:seeders", "seeders"],
      ["ygg:leechers", "leechers"],
      ["ygg:size", "size"],
    ],
  },
});

// -----------------------------------------------------------------------------
// HELPERS CATEGORIES / URL RSS
// -----------------------------------------------------------------------------

// Normalise les clés venant du front / interne
function normalizeCategoryKey(raw) {
  const c = (raw || "film").toLowerCase();

  if (c.startsWith("film")) return "film";
  if (c.startsWith("seri")) return "series";
  if (c.startsWith("emiss")) return "emissions";
  if (c.startsWith("spect")) return "spectacle";
  if (c.startsWith("anim")) return "animation";
  if (c.startsWith("jeu") || c.startsWith("game")) return "games";

  return "film";
}

function getRssConfigForCategoryKey(catKey) {
  let id;
  switch (catKey) {
    case "series":
      id = RSS_SERIES_ID;
      break;
    case "emissions":
      id = RSS_SHOWS_ID;
      break;
    case "spectacle":
      id = RSS_SPECTACLE_ID;
      break;
    case "animation":
      id = RSS_ANIMATION_ID;
      break;
    case "games":
      id = RSS_GAMES_ID;
      break;
    case "film":
    default:
      id = RSS_MOVIES_ID;
      break;
  }

  if (!id) {
    throw new Error(`No RSS ID configured for category "${catKey}"`);
  }

  const url = `https://yggapi.eu/rss?id=${id}&passkey=${RSS_PASSKEY}`;
  return { id, url };
}

// -----------------------------------------------------------------------------
// HELPERS TITRE / QUALITÉ / EPISODE
// -----------------------------------------------------------------------------

/**
 * Nettoie un titre YGG et tente d'en extraire:
 * - cleanTitle
 * - year
 */
function guessTitleAndYear(rawTitle = "", kind = "film") {
  if (!rawTitle) {
    return { cleanTitle: "", year: null };
  }

  let t = rawTitle;

  // Enlever blocs parasites entre [] (tags ripper, etc.)
  t = t.replace(/\[.*?\]/g, " ");

  // Pour les séries: couper tout ce qui suit un token de type S01, S01E05, etc.
  if (kind === "series") {
    const seriesCutRegexes = [/\bS\d{1,2}E\d{1,3}\b/i, /\bS\d{1,2}\b/i];
    for (const re of seriesCutRegexes) {
      const m = re.exec(t);
      if (m && m.index > 0) {
        t = t.slice(0, m.index);
        break;
      }
    }
  }

  // Normaliser séparateurs
  t = t.replace(/[._]/g, " ");

  // Chercher une année
  const yearMatch = t.match(/(19|20)\d{2}(?!\d)/);
  let year = null;
  let name = t;

  if (yearMatch) {
    year = parseInt(yearMatch[0], 10);
    name = t.slice(0, yearMatch.index).trim();
  }

  // Tags techniques à virer
  const tags = [
    "HYBRID",
    "MULTI",
    "MULTI VF2",
    "VF2",
    "VFF",
    "VFI",
    "VOSTFR",
    "TRUEFRENCH",
    "FRENCH",
    "WEBRIP",
    "WEB",
    "WEB DL",
    "WEBDL",
    "WEB-DL",
    "NF",
    "AMZN",
    "HMAX",
    "BLURAY",
    "BDRIP",
    "BRRIP",
    "BR RIP",
    "HDRIP",
    "DVDRIP",
    "HDTV",
    "1080P",
    "2160P",
    "720P",
    "4K",
    "UHD",
    "10BIT",
    "8BIT",
    "HDR",
    "HDR10",
    "HDR10PLUS",
    "DOLBY VISION",
    "DV",
    "X264",
    "X265",
    "H264",
    "H265",
    "AV1",
    "DDP5",
    "DDP5.1",
    "DDP",
    "AC3",
    "DTS",
    "DTS HD",
    "TRUEHD",
    "ATMOS",
    "THESYNDICATE",
    "QTZ",
    "SUPPLY",
    "BTT",
    "OUI",
  ];
  const tagRegex = new RegExp(`\\b(${tags.join("|")})\\b`, "gi");
  name = name.replace(tagRegex, " ");

  // Nettoyage fin
  name = name.replace(/[-–_:()\[\]]+$/g, "");
  name = name.replace(/\s+/g, " ").trim();

  let cleanTitle = "";

  if (name) {
    cleanTitle = name;
  } else if (!name && !year) {
    cleanTitle = rawTitle.replace(/[._]/g, " ").trim();
  } else {
    cleanTitle = "";
  }

  return { cleanTitle, year };
}

function extractEpisodeInfo(rawTitle = "") {
  if (!rawTitle) return null;

  // On enlève les tags entre crochets qui parasitent
  let t = rawTitle.replace(/\[.*?\]/g, " ");

  // 1) Forme classique S01E03
  const fullEp = t.match(/\bS\d{1,2}E\d{1,3}\b/i);
  if (fullEp) {
    return fullEp[0].toUpperCase(); // ex: S01E03
  }

  // 2) "Saison 1"
  const saisonWord = t.match(/\bSaison\s+\d{1,2}\b/i);
  if (saisonWord) {
    // on normalise un peu les espaces
    return saisonWord[0].replace(/\s+/g, " ");
  }

  // 3) Forme courte "S01" (sans E)
  const seasonOnly = t.match(/\bS\d{1,2}\b/i);
  if (seasonOnly) {
    return seasonOnly[0].toUpperCase(); // ex: S01
  }

  return null;
}

function extractQuality(rawTitle = "") {
  if (!rawTitle) return null;

  const upper = rawTitle.toUpperCase();

  // Résolution
  let resolution = null;
  if (/\b(2160P|4K)\b/.test(upper)) {
    resolution = "2160p";
  } else if (/\b1080P\b/.test(upper)) {
    resolution = "1080p";
  } else if (/\b720P\b/.test(upper)) {
    resolution = "720p";
  }

  // Codec
  let codec = null;
  if (/\b(HEVC|H\.?265|X265)\b/.test(upper)) {
    codec = "x265 / H.265";
  } else if (/\b(H\.?264|X264)\b/.test(upper)) {
    codec = "x264 / H.264";
  } else if (/\bAV1\b/.test(upper)) {
    codec = "AV1";
  }

  const parts = [];
  if (resolution) parts.push(resolution);
  if (codec) parts.push(codec);

  return parts.length ? parts.join(" - ") : null;
}

// -----------------------------------------------------------------------------
// Helpers spécifiques JEUX : titre "propre" pour affichage + IGDB
// -----------------------------------------------------------------------------

function cleanGameTitle(rawTitle = "") {
  if (!rawTitle) return "";

  let t = rawTitle;

  // 1) Blocs [ ... ] (plateforme, portable, etc.)
  t = t.replace(/\[.*?\]/g, " ");

  // 2) Stats YGG (S:xx/L:xx)
  t = t.replace(/\(S:\d+\/L:\d+\)/gi, " ");

  // 3) Parenthèses qui ne contiennent que de la "technique" (versions, builds, etc.)
  //    Exemple : (v1.2.3), (1.0.0.23891), (v20251118), (86364)...
  t = t.replace(/\([^)]*\d[^)]*\)/g, " ");

  // 4) Normaliser . et _ → espaces
  t = t.replace(/[._]/g, " ");

  // 5) Groupes / plateformes / tags de release
  t = t.replace(
    /\b(FitGirl|Repack|ElAmigos|TENOKE|RUNE|Mephisto|GOG|PORTABLE|WIN|X64|X86|MULTI\d*|MULTI|EN|FR|VOICES\d+|Net8)\b/gi,
    " "
  );

  // 6) Patterns avec "build" et IDs derrière
  //    " / 20804565 build ...", " / build 20804565 ...", "build 20804565 ..."
  t = t.replace(/\s*\/\s*\d+\s*build\b.*$/i, " ");
  t = t.replace(/\s*\/\s*build\b.*$/i, " ");
  t = t.replace(/\bbuild\b.*$/i, " ");

  // 7) Suffixes "Update ..."
  //    "Dispatch (Update 1.0.16254)-ElAmigos"
  t = t.replace(/[:\-]\s*Update\b.*$/i, " ");
  t = t.replace(/\bUpdate\b.*$/i, " ");

  // 8) Dates/IDs de type "2025-11-14-113464"
  t = t.replace(/\b\d{4}-\d{2}-\d{2}-\d+\b/g, " ");

  // 9) Tokens de type "V20251118.8820.W"
  t = t.replace(/\bV\d{6,}(?:\.\d+)*\b/gi, " ");

  // 10) Versions "v1.2.3", "1.4.0", "0.1.26.2.47138.12"
  //     → on cible les chaînes avec au moins un point (v1.2, 1.4.0, 0.1.26.2...)
  t = t.replace(/\bv\d+(?:[._]\d+){1,}\b/gi, " ");   // v1.2, v1.2.3 etc.
  t = t.replace(/\b\d+(?:[._]\d+){1,}\b/gi, " ");    // 1.4.0, 0.1.26.2.47138.12

  // 11) Gros IDs purement numériques (ex: "20804565") => on garde les petits nombres (2, 3, 4...)
  t = t.replace(/\b\d{5,}\b/g, " ");

  // 12) Nettoyage ponctuation / espaces
  t = t.replace(/[:\-–_]+$/g, " ");
  t = t.replace(/\s+/g, " ").trim();

  // Fallback : au pire, on retourne le rawTitle un peu normalisé
  if (!t) {
    return rawTitle.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
  }

  return t;
}


function cleanGameTitleForIgdb(rawTitle = "") {
  let t = cleanGameTitle(rawTitle);
  if (!t) return "";

  // virer les suffixes genre Manual / CE
  t = t.replace(/\b(Manual|CE)\b.*$/i, " ");

  // virer les suffixes d'édition + tout ce qui suit
  // ex : "Royal Edition", "Deluxe Edition", "Ultimate Edition", "Relaunched"
  t = t.replace(
    /\b(Relaunched|Deluxe Edition|Ultimate Edition|Royal Edition|Digital Deluxe Edition|Complete Edition|Game of the Year)\b.*$/i,
    " "
  );

  // cas " + 7 DLCs/Bonuses"
  t = t.replace(/\+\s*DLCs?\/?Bonuses?.*$/i, " ");

  //  virer les suffixes "Update ..." (patchs)
  // ex: "Ready or Not Update v97150" → "Ready or Not"
  t = t.replace(/\bUpdate\b.*$/i, " ");

  // virer les suffixes "/ build 123456" ou " / 123456 build"
  // ex: "Enshrouded / build 20801121" → "Enshrouded"
  t = t.replace(/\/\s*build\b.*$/i, " ");
  t = t.replace(/\bbuild\s*\d+\b.*$/i, " ");

  // virer les suffixes "- P2P", "- Repack" etc
  t = t.replace(/\s*[-–]\s*(P2P|Repack.*)$/i, " ");

  // clean final
  t = t.replace(/[:\-–_]+$/g, " ");
  t = t.replace(/\s+/g, " ").trim();

  return t;
}


// -----------------------------------------------------------------------------
// HELPERS TEXTE RSS (date / taille / seeders)
// -----------------------------------------------------------------------------

function getItemText(item) {
  return (
    [
      item.contentSnippet,
      item.content,
      item.summary,
      item.description,
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim() || ""
  );
}

function parseYggMeta(item) {
  const text = getItemText(item);

  // Ajouté le: 13/11/2025 10:04:28
  let addedAtStr = null;
  const dateMatch = text.match(
    /Ajouté le\s*:\s*([0-9]{2}\/[0-9]{2}\/[0-9]{4}\s+[0-9]{2}:[0-9]{2}:[0-9]{2})/i
  );
  if (dateMatch) {
    addedAtStr = dateMatch[1];
  }

  // Taille
  let sizeStr = null;

  const sizeMatch1 = text.match(
    /Taille(?:\s+de l'upload)?\s*:\s*([0-9.,]+\s*[A-Za-z]+)\b/i
  );
  if (sizeMatch1) {
    sizeStr = sizeMatch1[1].replace(/\s+/g, "");
  } else {
    const sizeMatch2 = text.match(/Taille[^0-9]*([0-9.,]+\s*[A-Za-z]+)/i);
    if (sizeMatch2) {
      sizeStr = sizeMatch2[1].replace(/\s+/g, "");
    }
  }

  // Seeders
  let seedersParsed = null;
  const seedMatch = text.match(/(\d+)\s*seeders?/i);
  if (seedMatch) {
    seedersParsed = Number(seedMatch[1]);
  }

  return { addedAtStr, sizeStr, seedersParsed };
}

function timestampFromYggDate(str) {
  if (!str) return 0;
  const m = str.match(
    /^([0-9]{2})\/([0-9]{2})\/([0-9]{4})\s+([0-9]{2}):([0-9]{2}):([0-9]{2})$/
  );
  if (!m) return 0;
  const [, dd, mm, yyyy, hh, ii, ss] = m;
  const d = new Date(
    Number(yyyy),
    Number(mm) - 1,
    Number(dd),
    Number(hh),
    Number(ii),
    Number(ss)
  );
  const t = d.getTime();
  return Number.isNaN(t) ? 0 : t;
}

// -----------------------------------------------------------------------------
// TMDB HELPERS + CACHE
// -----------------------------------------------------------------------------

const posterCache = new Map();

async function tmdbSearch(pathUrl, params) {
  const url = new URL(`${TMDB_BASE_URL}${pathUrl}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") {
      url.searchParams.set(k, v);
    }
  });

  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      logWarn("TMDB_HTTP", `HTTP ${resp.status} ${url.toString()}`);
      return null;
    }
    const data = await resp.json();
    if (!data.results || !data.results.length) return null;
    const best = data.results.find((r) => r.poster_path) || data.results[0];
    if (!best.poster_path) return null;
    return `https://image.tmdb.org/t/p/w342${best.poster_path}`;
  } catch (err) {
    logError("TMDB", `Erreur: ${err.message} ${url.toString()}`);
    return null;
  }
}

async function fetchPosterForTitle(rawTitle, categoryRaw) {
  if (!TMDB_API_KEY) return null;
  if (!rawTitle) return null;

  const cacheKey = `${categoryRaw || "any"}::${rawTitle.toLowerCase()}`;
  if (posterCache.has(cacheKey)) {
    return posterCache.get(cacheKey);
  }

  const catKey = normalizeCategoryKey(categoryRaw);

  // Pour les jeux vidéo on ne tente pas TMDB
  if (catKey === "games") {
    posterCache.set(cacheKey, null);
    return null;
  }

  // animation => film
  const kind =
    catKey === "series" || catKey === "emissions" ? "series" : "film";

  const { cleanTitle, year } = guessTitleAndYear(rawTitle, kind);
  const queryBase =
    cleanTitle && cleanTitle.length > 0
      ? cleanTitle
      : rawTitle.replace(/[._]/g, " ").trim();

  if (!queryBase) {
    posterCache.set(cacheKey, null);
    return null;
  }

  let poster = null;

  // 1) Movie FR + année
  if (year && kind === "film") {
    poster =
      (await tmdbSearch("/search/movie", {
        api_key: TMDB_API_KEY,
        language: "fr-FR",
        query: queryBase,
        year,
      })) || null;
  }

  // 2) Movie FR sans année
  if (!poster && kind === "film") {
    poster = await tmdbSearch("/search/movie", {
      api_key: TMDB_API_KEY,
      language: "fr-FR",
      query: queryBase,
    });
  }

  // 3) Movie EN
  if (!poster && kind === "film") {
    poster = await tmdbSearch("/search/movie", {
      api_key: TMDB_API_KEY,
      language: "en-US",
      query: queryBase,
      year,
    });
  }

  // 4) TV FR
  if (!poster && kind === "series" && year) {
    poster = await tmdbSearch("/search/tv", {
      api_key: TMDB_API_KEY,
      language: "fr-FR",
      query: queryBase,
      first_air_date_year: year,
    });
  }

  if (!poster && kind === "series") {
    poster = await tmdbSearch("/search/tv", {
      api_key: TMDB_API_KEY,
      language: "fr-FR",
      query: queryBase,
    });
  }

  // 5) TV EN
  if (!poster && kind === "series") {
    poster = await tmdbSearch("/search/tv", {
      api_key: TMDB_API_KEY,
      language: "en-US",
      query: queryBase,
    });
  }

  // 6) Dernier essai brut
  if (!poster && rawTitle !== queryBase) {
    const q = rawTitle.replace(/[._]/g, " ");
    poster =
      (await tmdbSearch("/search/movie", {
        api_key: TMDB_API_KEY,
        language: "fr-FR",
        query: q,
      })) ||
      (await tmdbSearch("/search/tv", {
        api_key: TMDB_API_KEY,
        language: "fr-FR",
        query: q,
      }));
  }

  if (!poster) {
    logWarn(
      "TMDB_NO_POSTER",
      `AUCUN POSTER | rawTitle="${rawTitle}" | query="${queryBase}" | year=${year != null ? year : "?"} | kind=${kind}`
    );
  }

  posterCache.set(cacheKey, poster || null);
  return poster || null;
}

// -----------------------------------------------------------------------------
// IGDB HELPERS + CACHE (pour les jeux vidéo)
// -----------------------------------------------------------------------------

let igdbToken = null;
let igdbTokenExpiry = 0; // timestamp en ms

async function getIgdbToken() {
  if (!IGDB_CLIENT_ID || !IGDB_CLIENT_SECRET) {
    logWarn("IGDB", "IGDB_CLIENT_ID ou IGDB_CLIENT_SECRET non configuré");
    return null;
  }

  const now = Date.now();
  if (igdbToken && now < igdbTokenExpiry - 60 * 1000) {
    // on garde une marge de 60s avant expiration
    return igdbToken;
  }

  try {
    const params = new URLSearchParams({
      client_id: IGDB_CLIENT_ID,
      client_secret: IGDB_CLIENT_SECRET,
      grant_type: "client_credentials",
    });

    const resp = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (!resp.ok) {
      logError("IGDB_TOKEN", `HTTP ${resp.status} lors de la récupération du token`);
      return null;
    }

    const data = await resp.json();
    igdbToken = data.access_token;
    const expiresIn = data.expires_in || 0;
    igdbTokenExpiry = now + expiresIn * 1000;

    logInfo("IGDB", `Token obtenu (expire dans ${expiresIn}s)`);
    return igdbToken;
  } catch (err) {
    logError("IGDB_TOKEN", `Erreur: ${err.message}`);
    return null;
  }
}

async function igdbSearchGame(title) {
  const token = await getIgdbToken();
  if (!token) return null;

  // on nettoie un minimum le titre (guillemets, etc.)
  const safeTitle = title.replace(/"/g, '\\"');

  const query = [
    `search "${safeTitle}";`,
    "fields name, cover.image_id, first_release_date;",
    "limit 10;",
  ].join(" ");

  try {
    const resp = await fetch(`${IGDB_BASE_URL}/games`, {
      method: "POST",
      headers: {
        "Client-ID": IGDB_CLIENT_ID,
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain",
      },
      body: query,
    });

    if (!resp.ok) {
      logWarn("IGDB_HTTP", `HTTP ${resp.status} pour "${safeTitle}"`);
      return null;
    }

    const games = await resp.json();
    if (!Array.isArray(games) || games.length === 0) {
      return null;
    }

    // on privilégie ceux avec cover.image_id
    const withCover = games.filter(
      (g) => g.cover && g.cover.image_id
    );
    const chosen = withCover[0] || games[0];

    if (!chosen.cover || !chosen.cover.image_id) {
      return null;
    }

    const imageId = chosen.cover.image_id;
    // format standard IGDB : t_cover_big = ~600px de haut
    const url = `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
    return url;
  } catch (err) {
    logError("IGDB", `Erreur recherche IGDB pour "${title}": ${err.message}`);
    return null;
  }
}

async function fetchIgdbCoverForTitle(rawTitle = "") {
  if (!rawTitle) return null;

  const cacheKey = `games::${rawTitle.toLowerCase()}`;
  if (posterCache.has(cacheKey)) {
    return posterCache.get(cacheKey);
  }

  const mainTitle = cleanGameTitleForIgdb(rawTitle);
  if (!mainTitle) {
    posterCache.set(cacheKey, null);
    return null;
  }

  // variantes de requêtes pour IGDB
  const queries = new Set();
  queries.add(mainTitle);

  // si il y a " : " on tente aussi la partie avant
  if (mainTitle.includes(":")) {
    queries.add(mainTitle.split(":")[0].trim());
  }

  // si il y a " - " ou " – " on tente aussi la partie avant
  if (mainTitle.includes(" - ")) {
    queries.add(mainTitle.split(" - ")[0].trim());
  }
  if (mainTitle.includes(" – ")) {
    queries.add(mainTitle.split(" – ")[0].trim());
  }

  let coverUrl = null;
  let usedQuery = mainTitle;

  for (const q of queries) {
    if (!q) continue;
    coverUrl = await igdbSearchGame(q);
    if (coverUrl) {
      usedQuery = q;
      break;
    }
  }

  if (!coverUrl) {
    logWarn(
      "IGDB_NO_COVER",
      `Aucune cover IGDB | rawTitle="${rawTitle}" | query="${Array.from(queries).join(" || ")}"`
    );
  } else {
    logInfo("IGDB_MATCH", `Match cover IGDB | rawTitle="${rawTitle}" | query="${usedQuery}"`);
  }

  posterCache.set(cacheKey, coverUrl || null);
  return coverUrl || null;
}


// -----------------------------------------------------------------------------
// SYNC INTELLIGENT : YGG -> SQLITE
// -----------------------------------------------------------------------------

const insertItemStmt = db.prepare(`
  INSERT INTO items (
    guid, category, raw_title, title, year, episode,
    size, seeders, quality,
    added_at, added_at_ts,
    poster, page_link, download_link,
    created_at, updated_at
  )
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`);

const updateItemStmt = db.prepare(`
  UPDATE items
  SET
    size = COALESCE(?, size),
    seeders = ?,
    added_at = COALESCE(?, added_at),
    added_at_ts = CASE
      WHEN ? > 0 THEN ?
      ELSE added_at_ts
    END,
    updated_at = ?
  WHERE guid = ?
`);

const getItemByGuidStmt = db.prepare(`
  SELECT id, poster FROM items WHERE guid = ?
`);

async function syncCategory(catKey) {
  const normCat = normalizeCategoryKey(catKey);
  const { id, url } = getRssConfigForCategoryKey(normCat);

  logInfo("SYNC", `Catégorie ${normCat} → id=${id} (YGGAPI)`);

  const feed = await parser.parseURL(url);

  const items = feed.items || [];
  logInfo("SYNC", `${normCat}: ${items.length} items RSS`);

  for (const item of items) {
    try {
      const rawTitle = item.title || "";
      const kind =
        normCat === "series" || normCat === "emissions" ? "series" : "film";

      const { cleanTitle, year } = guessTitleAndYear(rawTitle, kind);
      const quality = extractQuality(rawTitle);
      const episode = kind === "series" ? extractEpisodeInfo(rawTitle) : null;
      
      let displayTitle = cleanTitle || rawTitle;
      if (normCat === "games") {
        displayTitle = cleanGameTitle(rawTitle);
      }
      
      const { addedAtStr, sizeStr, seedersParsed } = parseYggMeta(item);

      const guid = item.guid || item.link || rawTitle;
      const pageLink =
        item.link ||
        (item.guid && item.guid.includes("http") ? item.guid : null) ||
        null;
      const downloadLink =
        (item.enclosure && item.enclosure.url) || pageLink || null;

      const addedAt = addedAtStr || null;
      const addedAtTs =
        addedAtStr != null
          ? timestampFromYggDate(addedAtStr)
          : (() => {
              const d = new Date(
                item.uploaded_at || item.pubDate || item.isoDate || ""
              );
              const t = d.getTime();
              return Number.isNaN(t) ? 0 : t;
            })();

      const size = sizeStr || (item.size != null ? String(item.size) : null);
      const seeders =
        item.seeders != null && !Number.isNaN(Number(item.seeders))
          ? Number(item.seeders)
          : seedersParsed != null
          ? seedersParsed
          : 0;

      const now = Date.now();

      const existing = getItemByGuidStmt.get(guid);

      if (!existing) {
        // Nouveau torrent => TMDB (films/séries/émissions/anim) ou IGDB (jeux)
        let poster = null;

        try {
          if (normCat === "games") {
            // Jeux vidéo → IGDB
            poster = await fetchIgdbCoverForTitle(rawTitle);
          } else if (TMDB_API_KEY) {
            // Reste → TMDB
            poster = await fetchPosterForTitle(rawTitle, normCat);
          }
        } catch (e) {
          const src = normCat === "games" ? "IGDB" : "TMDB";
          logError(
            src,
            `Poster error pour "${rawTitle}" (${normCat}): ${e.message}`
          );
        }

        insertItemStmt.run(
          guid,
          normCat,
          rawTitle,
          displayTitle,
          year || null,
          episode,
          size,
          seeders,
          quality,
          addedAt,
          addedAtTs,
          poster,
          pageLink,
          downloadLink,
          now,
          now
        );
      } else {
        // Déjà connu => update uniquement les champs qui bougent
        updateItemStmt.run(
          size,
          seeders,
          addedAt,
          addedAtTs,
          addedAtTs,
          now,
          guid
        );
      }
    } catch (e) {
      logError("SYNC", `Erreur item ${normCat}: ${e.message}`);
    }
  }

  logInfo("SYNC", `Catégorie ${normCat} terminée.`);
  return items.length;
}

function purgeOldItems(maxAgeHours = 168) {
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000; // 48h par défaut

  const stmt = db.prepare(`
    DELETE FROM items
    WHERE added_at_ts IS NOT NULL
      AND added_at_ts > 1000000000000
      AND added_at_ts < ?
  `);

  const info = stmt.run(cutoff);
  const deleted = info.changes || 0;

  logInfo(
    "PURGE",
    `${deleted} anciens items supprimés (avant ${new Date(
      cutoff
    ).toLocaleString("fr-FR")})`
  );

  return deleted;
}

async function syncAllCategories() {
  const cats = ["film", "series", "emissions", "spectacle", "animation", "games"];

  logInfo("SYNC", "Lancement de la synchronisation globale…");

  const summary = {};
  let purgedCount = 0;

  for (const cat of cats) {
    try {
      const count = await syncCategory(cat);
      summary[cat] = count;
    } catch (e) {
      logError("SYNC", `Erreur catégorie ${cat}: ${e.message}`);
      summary[cat] = null;
    }
  }

  purgedCount = purgeOldItems(48);

  const parts = Object.entries(summary).map(
    ([key, count]) => `${key}=${count != null ? count : "?"}`
  );
  parts.push(`purged=${purgedCount}`);

  logInfo("SYNC", `Résumé: ${parts.join(", ")}`);
  logInfo("SYNC", "Synchronisation globale terminée.");
}

// -----------------------------------------------------------------------------
// SELECT EN BDD POUR /api/feed
// -----------------------------------------------------------------------------

function selectItemsFromDb(category, sort, limitParam) {
  let orderBy = "added_at_ts DESC";
  if (sort === "seeders") orderBy = "seeders DESC";
  if (sort === "name") orderBy = "title COLLATE NOCASE ASC";

  let limitClause = "";
  const limitNum = limitParam === "all" ? null : Number(limitParam);
  if (limitNum && !Number.isNaN(limitNum)) {
    limitClause = `LIMIT ${limitNum}`;
  }

  const sql = `
    SELECT
      category,                    -- <--- AJOUT
      title,
      raw_title as rawTitle,
      year,
      episode,
      size,
      seeders,
      quality,
      added_at as addedAt,
      added_at_ts as addedAtTs,
      poster,
      page_link as pageLink,
      download_link as download
    FROM items
    WHERE category = ?
    ORDER BY ${orderBy}
    ${limitClause};
  `;

  const stmt = db.prepare(sql);
  return stmt.all(category);
}

// -----------------------------------------------------------------------------
// API LOGS (pour le popup "Logs")
// -----------------------------------------------------------------------------

app.get("/api/logs", (req, res) => {
  const limit = Number(req.query.limit || 200);

  fs.readFile(LOG_FILE, "utf8", (err, data) => {
    if (err) {
      if (err.code === "ENOENT") {
        // fichier pas encore créé
        return res.json({ lines: [] });
      }
      console.error("[LOGS] Erreur lecture fichier:", err.message);
      return res.status(500).json({ error: "Erreur lecture logs" });
    }

    const lines = data.split(/\r?\n/).filter(Boolean);

    // on garde les N dernières lignes, mais on les renvoie dans l'ordre
    // décroissant (la plus récente en premier)
    const tail = lines.slice(-limit).reverse();

    res.json({ lines: tail });
  });
});

// -----------------------------------------------------------------------------
// API CATEGORIES (pour le front)
// -----------------------------------------------------------------------------

app.get("/api/categories", (req, res) => {
  res.json([
    { key: "all", label: "Tout" },
    { key: "film", label: "Films" },
    { key: "series", label: "Séries TV" },
    { key: "emissions", label: "Émissions TV" },
    { key: "spectacle", label: "Spectacles" },
    { key: "animation", label: "Animation" },
    { key: "games", label: "Jeux vidéo" },
  ]);
});

// -----------------------------------------------------------------------------
// API FEED (lit uniquement en BDD)
// -----------------------------------------------------------------------------

app.get("/api/feed", (req, res) => {
  try {
    const sort = (req.query.sort || "seeders").toLowerCase();
    const limitParam = (req.query.limit || "all").toLowerCase();
    const category = req.query.category || "film";

    if (category === "all") {
      const catConfigs = [
        { key: "film", label: "Films" },
        { key: "series", label: "Séries TV" },
        { key: "emissions", label: "Émissions TV" },
        { key: "spectacle", label: "Spectacles" },
        { key: "animation", label: "Animation" },
        { key: "games", label: "Jeux vidéo" },
      ];

      const groups = catConfigs.map((cfg) => {
        const items = selectItemsFromDb(cfg.key, sort, limitParam);
        return {
          key: cfg.key,
          label: cfg.label,
          items,
        };
      });

      return res.json({ groups });
    }

    const normCat = normalizeCategoryKey(category);
    const items = selectItemsFromDb(normCat, sort, limitParam);
    res.json({ items });
  } catch (err) {
    console.error("API /api/feed error:", err);
    res.status(500).json({ error: "Erreur récupération BDD" });
  }
});

// -----------------------------------------------------------------------------
// API DETAILS (fiche détaillée via TMDB en FR)
// -----------------------------------------------------------------------------

app.get("/api/details", async (req, res) => {
  try {
    const rawTitle = (req.query.title || "").toString().trim();
    const category = (req.query.category || "film").toString();
    const yearHint = req.query.year ? parseInt(req.query.year, 10) : undefined;

    if (!rawTitle) {
      return res.status(400).json({ error: "Missing title" });
    }
    if (!TMDB_API_KEY) {
      logWarn("TMDB_DETAILS", "TMDB_API_KEY non configuré");
      return res
        .status(500)
        .json({ error: "TMDB_API_KEY non configuré côté serveur." });
    }

    const catKey = normalizeCategoryKey(category);

    // type TMDB (movie / tv)
    const tmdbType = catKey === "series" ? "tv" : "movie";

    // pour guessTitleAndYear on reste sur film/série
    const guessKind = catKey === "series" ? "series" : "film";

    const { cleanTitle, year } = guessTitleAndYear(rawTitle, guessKind);
    const baseTitle =
      cleanTitle && cleanTitle.length
        ? cleanTitle
        : rawTitle.replace(/[._]/g, " ").trim();

    if (!baseTitle) {
      return res.status(400).json({ error: "Titre non exploitable" });
    }

    const searchUrl = new URL(`${TMDB_BASE_URL}/search/${tmdbType}`);
    searchUrl.searchParams.set("api_key", TMDB_API_KEY);
    searchUrl.searchParams.set("language", "fr-FR");
    searchUrl.searchParams.set("query", baseTitle);
    searchUrl.searchParams.set("include_adult", "false");

    const y = yearHint || year;
    if (y && !Number.isNaN(y)) {
      if (tmdbType === "movie") {
        searchUrl.searchParams.set("year", String(y));
      } else {
        searchUrl.searchParams.set("first_air_date_year", String(y));
      }
    }

    logInfo(
      "TMDB_DETAILS",
      `Search "${baseTitle}" (type=${tmdbType}, year=${y || "?"})`
    );

    const searchResp = await fetch(searchUrl.toString());
    if (!searchResp.ok) {
      logWarn(
        "TMDB_DETAILS_HTTP",
        `HTTP ${searchResp.status} pour ${searchUrl.toString()}`
      );
      return res.status(502).json({ error: "Erreur HTTP TMDB (search)" });
    }

    const searchData = await searchResp.json();
    const results = Array.isArray(searchData.results)
      ? searchData.results
      : [];

    if (!results.length) {
      logWarn("TMDB_DETAILS_NO_RESULT", `Aucun résultat pour "${baseTitle}"`);
      return res.status(404).json({ error: "Aucune fiche trouvée" });
    }

    const best = results[0];
    const tmdbId = best.id;

    const detailsUrl = new URL(
      `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}`
    );
    detailsUrl.searchParams.set("api_key", TMDB_API_KEY);
    detailsUrl.searchParams.set("language", "fr-FR");
    detailsUrl.searchParams.set("append_to_response", "credits,external_ids");

    const detailsResp = await fetch(detailsUrl.toString());
    if (!detailsResp.ok) {
      logWarn(
        "TMDB_DETAILS_HTTP",
        `HTTP ${detailsResp.status} pour ${detailsUrl.toString()}`
      );
      return res.status(502).json({ error: "Erreur HTTP TMDB (details)" });
    }

    const d = await detailsResp.json();

    // Titre / année / dates
    const title = d.title || d.name || baseTitle;
    const released = d.release_date || d.first_air_date || "";
    const yearStr =
      (d.release_date && d.release_date.slice(0, 4)) ||
      (d.first_air_date && d.first_air_date.slice(0, 4)) ||
      "";

    // Durée
    let runtime = null;
    if (typeof d.runtime === "number" && d.runtime > 0) {
      runtime = `${d.runtime} min`;
    } else if (
      Array.isArray(d.episode_run_time) &&
      d.episode_run_time.length &&
      d.episode_run_time[0] > 0
    ) {
      runtime = `${d.episode_run_time[0]} min / épisode`;
    }

    // Genres
    const genre =
      Array.isArray(d.genres) && d.genres.length
        ? d.genres.map((g) => g.name).join(", ")
        : null;

    // Réalisateur / créateur
    let director = null;
    if (d.credits && Array.isArray(d.credits.crew)) {
      const directors = d.credits.crew.filter((p) => p.job === "Director");
      if (directors.length) {
        director = directors.map((p) => p.name).join(", ");
      }
    }
    if (!director && Array.isArray(d.created_by) && d.created_by.length) {
      director = d.created_by.map((p) => p.name).join(", ");
    }

    // Acteurs principaux
    let actors = null;
    if (d.credits && Array.isArray(d.credits.cast) && d.credits.cast.length) {
      actors = d.credits.cast
        .slice(0, 5)
        .map((p) => p.name)
        .join(", ");
    }

    // Langues parlées
    const language =
      Array.isArray(d.spoken_languages) && d.spoken_languages.length
        ? d.spoken_languages.map((l) => l.name || l.english_name).join(", ")
        : null;

    // Pays de production
    const country =
      Array.isArray(d.production_countries) && d.production_countries.length
        ? d.production_countries.map((c) => c.name).join(", ")
        : null;

    // Tagline comme "awards" (ça remplit la ligne bonus)
    const awards = d.tagline || null;

    // Poster
    const poster = d.poster_path ? `${TMDB_IMG_BASE}${d.poster_path}` : null;

    // Note / votes TMDB → on les mappe sur les champs IMDb pour ne pas changer le front
    const imdbRating =
      typeof d.vote_average === "number" && d.vote_average > 0
        ? d.vote_average.toFixed(1)
        : null;
    const imdbVotes =
      typeof d.vote_count === "number" && d.vote_count > 0
        ? d.vote_count.toLocaleString("fr-FR")
        : null;

    // ID IMDb (si dispo) pour le lien
    const imdbID =
      d.external_ids && d.external_ids.imdb_id
        ? d.external_ids.imdb_id
        : null;

    const payload = {
      title,
      year: yearStr || null,
      released: released || null,
      runtime: runtime || null,
      genre,
      director,
      writer: null, // TMDB ne donne pas exactement l'équivalent, on laisse null
      actors,
      plot: d.overview || null,
      language,
      country,
      awards,
      poster,
      imdbRating,
      imdbVotes,
      imdbID,
      type: tmdbType,
      totalSeasons: tmdbType === "tv" ? d.number_of_seasons || null : null,
    };

    return res.json(payload);
  } catch (err) {
    logError("TMDB_DETAILS", `Erreur /api/details: ${err.message}`);
    return res.status(500).json({ error: "Erreur serveur sur /api/details" });
  }
});

// -----------------------------------------------------------------------------
// LANCEMENT SERVEUR + SYNC PÉRIODIQUE
// -----------------------------------------------------------------------------

app.listen(PORT, () => {
  logInfo("SERVER", `YGGFeed DB server running on http://localhost:${PORT}`);
  logInfo("SERVER", `Base SQLite : ${DB_PATH}`);
  logInfo("SERVER", `Fichier de logs : ${LOG_FILE}`);

  // Sync initial au démarrage
  syncAllCategories().catch((e) =>
    logError("SYNC_INIT", `Erreur: ${e.message}`)
  );

  // Sync périodique si configuré
  if (SYNC_INTERVAL_MINUTES > 0) {
    const ms = SYNC_INTERVAL_MINUTES * 60 * 1000;
    logInfo(
      "SYNC",
      `Programmation: toutes les ${SYNC_INTERVAL_MINUTES} minutes`
    );
    setInterval(() => {
      syncAllCategories().catch((e) =>
        logError("SYNC_PERIODIC", `Erreur: ${e.message}`)
      );
    }, ms);
  } else {
    logWarn("SYNC", "SYNC_INTERVAL_MINUTES <= 0 → pas de sync automatique");
  }
});
