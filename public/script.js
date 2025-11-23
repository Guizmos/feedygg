// --- Gestion du thème ---
function applyTheme(mode) {
  document.body.classList.remove("theme-light");

  if (mode === "light") {
    document.body.classList.add("theme-light");
  } else if (mode === "system") {
    const prefersLight = window.matchMedia(
      "(prefers-color-scheme: light)"
    ).matches;
    if (prefersLight) {
      document.body.classList.add("theme-light");
    }
  }
}

function autosizeSelect(select) {
  if (!select) return;

  const span = document.createElement("span");
  const style = window.getComputedStyle(select);

  span.style.visibility = "hidden";
  span.style.position = "fixed";
  span.style.whiteSpace = "nowrap";
  span.style.font = style.font;
  span.textContent =
    select.options[select.selectedIndex]?.textContent || "";

  document.body.appendChild(span);
  const width = span.getBoundingClientRect().width + 32;
  document.body.removeChild(span);

  select.style.width = width + "px";
}

document.addEventListener("DOMContentLoaded", () => {
  const categorySelect = document.getElementById("category-select");
  const limitSelect = document.getElementById("limit-select");
  const sortSelect = document.getElementById("sort-select");
  const refreshBtn = document.getElementById("refresh-btn");
  const settingsBtn = document.getElementById("settings-btn");
  const closeSettingsBtn = document.getElementById("close-settings");
  const overlay = document.getElementById("settings-overlay");
  const modal = document.getElementById("settings-modal");
  const resultsEl = document.getElementById("cards");
  const statsEl = document.getElementById("stats");
  const themeSelect = document.getElementById("theme-select");
  const headerEl = document.querySelector(".app-header");
  const loadingEl = document.getElementById("loading");
  const errorEl = document.getElementById("error");
  const emptyEl = document.getElementById("empty");
  const controlsEl = document.querySelector(".controls");
  const openLogsBtn = document.getElementById("open-logs");
  const logsOverlay = document.getElementById("logs-overlay");
  const logsModal = document.getElementById("logs-modal");
  const closeLogsBtn = document.getElementById("close-logs");
  const logsContent = document.getElementById("logs-content");
  const filtersContainer = document.getElementById("filters-container");
  const searchToggleBtn = document.getElementById("search-toggle");
  const searchContainer = document.getElementById("search-container");
  const searchInput = document.getElementById("search-input");
  const searchClearBtn = document.getElementById("search-clear");
  const filtersMiniBtn = document.getElementById("filters-mini");
  const defaultSortSelect = document.getElementById("default-sort-select");
  const detailsOverlay = document.getElementById("details-overlay");
  const detailsModal = document.getElementById("details-modal");
  const detailsCloseBtn = document.getElementById("details-close");
  const detailsPosterEl = document.getElementById("details-poster");
  const detailsPosterFallback = document.getElementById("details-poster-fallback");
  const detailsTitleEl = document.getElementById("details-title");
  const detailsMetaEl = document.getElementById("details-meta");
  const detailsPlotEl = document.getElementById("details-plot");
  const detailsExtraEl = document.getElementById("details-extra");
  const detailsImdbLinkEl = document.getElementById("details-imdb-link");

  // --- Footer / Version ---
  const footerEl = document.getElementById("app-footer");
  const appVersionEl = document.getElementById("app-version");

  let controlsCollapsed = false;
  let controlsManuallyExpanded = false;

  // --- State pour le feed + la recherche ---
  let currentSearch = "";
  const feedState = {
    mode: "single",        // "single" | "groups"
    categoryLabel: "",
    items: [],
    groups: [],
  };

  const FALLBACK_CATS = [
    { key: "all",        label: "Tout" },
    { key: "film",       label: "Films" },
    { key: "series",     label: "Séries TV" },
    { key: "emissions",  label: "Émissions TV" },
    { key: "spectacle",  label: "Spectacles" },
    { key: "animation",  label: "Animation" },
    { key: "games",      label: "Jeux vidéo" },
  ];
  
  const CATEGORY_LABELS = {
    film: "Film",
    series: "Série TV",
    emissions: "Émission TV",
    spectacle: "Spectacle",
    animation: "Animation",
    games: "Jeu vidéo",
  };
  
  // Thème au démarrage
  const savedTheme = localStorage.getItem("theme") || "system";
  applyTheme(savedTheme);
  if (themeSelect) {
    themeSelect.value = savedTheme;
  }
  
  themeSelect?.addEventListener("change", (e) => {
    const mode = e.target.value;
    localStorage.setItem("theme", mode);
    applyTheme(mode);
  });
  
  const savedDefaultSort = localStorage.getItem("defaultSort") || "seeders";
  if (defaultSortSelect) {
    defaultSortSelect.value = savedDefaultSort;
  }
  if (sortSelect) {
    sortSelect.value = savedDefaultSort;
  }
  
  // --- Catégories ---

  async function initCategories() {
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const cats = await res.json();
      fillCategorySelect(
        Array.isArray(cats) && cats.length ? cats : FALLBACK_CATS
      );
    } catch {
      fillCategorySelect(FALLBACK_CATS);
    }
  }

  function fillCategorySelect(cats) {
    categorySelect.innerHTML = "";
    cats.forEach((c, i) => {
      const opt = document.createElement("option");
      opt.value = c.key;
      opt.textContent = c.label;
      if (i === 0) opt.selected = true;
      categorySelect.appendChild(opt);
    });

    autosizeSelect(categorySelect);
  }

  // --- Chargement du flux ---

  async function loadFeed() {
    statsEl.textContent = "";
    resultsEl.innerHTML = "";
    loadingEl.classList.remove("hidden");
    errorEl.classList.add("hidden");
    emptyEl.classList.add("hidden");

    // à chaque reload du feed, on reset la recherche
    currentSearch = "";
    if (searchInput) {
      searchInput.value = "";
    }

    const category = categorySelect.value || "film";
    const limit = (limitSelect && limitSelect.value) || "all";
    const sort = (sortSelect && sortSelect.value) || "seeders";

    const params = new URLSearchParams({ category, limit, sort });

    try {
      const res = await fetch(`/api/feed?${params.toString()}`);
      if (!res.ok) throw new Error("Erreur API");
      const data = await res.json();

      loadingEl.classList.add("hidden");

      const categoryLabel =
        categorySelect.options[categorySelect.selectedIndex]?.textContent ||
        data.label ||
        "Catégorie";

      feedState.categoryLabel = categoryLabel;

      if (Array.isArray(data.groups)) {
        feedState.mode = "groups";
        feedState.groups = data.groups;
        feedState.items = [];
      } else {
        const items = data.items || [];
        feedState.mode = "single";
        feedState.items = items;
        feedState.groups = [];
      }

      renderFromState();
    } catch (err) {
      console.error(err);
      loadingEl.classList.add("hidden");
      resultsEl.innerHTML = "";
      errorEl.textContent = "Impossible de récupérer le flux.";
      errorEl.classList.remove("hidden");
      statsEl.textContent = "";
    }
  }

  function createMetaLine(label, value, extraClass = "") {
    const div = document.createElement("div");
    div.className = "meta-line" + (extraClass ? " " + extraClass : "");
  
    const spanLabel = document.createElement("span");
    spanLabel.className = "meta-label";
    spanLabel.textContent = label;
  
    const spanValue = document.createElement("span");
    spanValue.className = "meta-value";
    spanValue.textContent =
      value != null && value !== "" ? String(value) : "—";
  
    div.append(spanLabel, spanValue);
    return div;
  }

  function getDisplayTitle(item) {
    const source = item.title || item.rawTitle || "";
    if (!source) return "Sans titre";
  
    let t = source;
  
    // 1) Seeders/Leechers "(S:xx/L:xx)"
    t = t.replace(/\(S:\d+\/L:\d+\)/gi, "");
  
    // 2) Blocs de version/numéros entre parenthèses : (v1.2.3), (1.2.3), (86364)...
    t = t.replace(/\(\s*v?\s*\d[\d._]*\s*\)/gi, "");
    t = t.replace(/\(\s*\d+\s*\)/g, "");
  
    // 3) Parties " / build 20785690 ..." ou "build 20785690 ..."
    t = t.replace(/\s*\/\s*build\s*\d+.*$/i, "");
    t = t.replace(/\s*\/\s*\d+\s*build.*$/i, "");
    t = t.replace(/\s*build\s*\d+.*$/i, "");
  
    // 4) Traîne de version non parenthésée : " v1.2.381918 ..." ou " 0.1.26.2.47138.12 ..."
    t = t.replace(/\bv\d+(?:[._]\d+)*\b.*$/i, "");      // v1.2.3.4...
    t = t.replace(/\b\d+(?:[._]\d+){2,}\b.*$/i, "");    // 0.1.26.2.47138.12...
  
    // 5) "Update v97150", "Update 1.0.2.47088s" etc.
    t = t.replace(/\bUpdate\b.*$/i, "");
  
    // 6) Tags de groupe en fin : "-ElAmigos", "- Mephisto", "-TENOKE", etc.
    t = t.replace(
      /\s*-\s*(ElAmigos|Mephisto|TENOKE|RUNE|P2P|FitGirl Repack|voices\d+)\s*$/i,
      ""
    );
  
    // 7) Blocs de plateforme/sources à la fin : "[WIN X64 MULTI PORTABLE]", "[GOG]"...
    t = t.replace(/\s*\[[^\]]*\]\s*$/g, "");
  
    // 8) Remplacer . et _ par espace (Ready.or.Not → Ready or Not)
    t = t.replace(/[._]/g, " ");
  
    // 9) Nettoyage espaces
    t = t.replace(/\s+/g, " ").trim();
  
    // 10) Espaces autour des ":" et " - "
    t = t.replace(/\s+(:)/g, " $1");
    t = t.replace(/\s+-\s+/g, " - ");
  
    return t || source;
  }
  
  function createCard(item) {
    const card = document.createElement("div");
    card.className = "card";
  
    // --- Déterminer la catégorie à afficher sur le bandeau ---
    let catKey = item.category;
  
    // Si l'item n'a pas de catégorie, on utilise la catégorie sélectionnée,
    // sauf si c'est "all" (vue globale)
    if (!catKey && categorySelect) {
      const currentCat = categorySelect.value;
      if (currentCat && currentCat !== "all") {
        catKey = currentCat;
      }
    }
  
    if (catKey && catKey !== "all") {
      const catLabel =
        CATEGORY_LABELS[catKey] ||
        feedState.categoryLabel ||
        catKey;
  
      const catBadge = document.createElement("div");
      catBadge.className = `card-category card-category--${catKey}`;
      catBadge.textContent = catLabel;
      card.appendChild(catBadge);
    }
  
    const posterWrap = document.createElement("div");
    posterWrap.className = "card-poster-wrap";
  
    const posterUrl = item.poster || item.posterUrl;
    if (posterUrl) {
      const img = document.createElement("img");
      img.src = posterUrl;
      img.alt = item.title || "Affiche";
      img.className = "card-poster";
      posterWrap.appendChild(img);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "poster-fallback";
      fallback.textContent = "Affiche";
      posterWrap.appendChild(fallback);
    }
  
    const body = document.createElement("div");
    body.className = "card-body";
  
    const titleRow = document.createElement("div");
    titleRow.className = "card-title-row";
  
    const title = document.createElement("div");
    title.className = "card-title";
    title.textContent = getDisplayTitle(item);
  
    const infoBtn = document.createElement("button");
    infoBtn.className = "info-btn";
    infoBtn.textContent = "i";
    infoBtn.title = "Voir le titre original";
  
    const infoDetail = document.createElement("div");
    infoDetail.className = "info-detail";
    infoDetail.textContent = item.rawTitle || "";
    infoDetail.hidden = true;
  
    infoBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      infoDetail.hidden = !infoDetail.hidden;
    });
  
    titleRow.append(title, infoBtn);
    body.append(titleRow, infoDetail);
  
    const sub = document.createElement("div");
    sub.className = "card-sub";
  
    const added = item.addedAt || "—";
    sub.appendChild(createMetaLine("Date d'ajout :", added));
  
    const hasEpisode = item.episode != null && item.episode !== "";
    const labelEpisodeOrYear = hasEpisode ? "Épisode :" : "Année :";
    const valueEpisodeOrYear = hasEpisode ? item.episode : (item.year || "—");
    sub.appendChild(createMetaLine(labelEpisodeOrYear, valueEpisodeOrYear));
  
    sub.appendChild(createMetaLine("Taille :", item.size || "—"));
  
    if (item.quality) {
      sub.appendChild(createMetaLine("Qualité :", item.quality));
    }
  
    sub.appendChild(
      createMetaLine(
        "Seeders :",
        item.seeders != null ? String(item.seeders) : "—",
        "meta-line-seeders"
      )
    );
  
    body.appendChild(sub);
  
    const actions = document.createElement("div");
    actions.className = "card-actions";

    const btnDl = document.createElement("a");
    btnDl.href = item.download || "#";
    btnDl.className = "btn btn-download";
    btnDl.textContent = "Télécharger";
    btnDl.target = "_blank";
    btnDl.rel = "noopener noreferrer";

    const btnOpen = document.createElement("a");
    btnOpen.href = item.pageLink || "#";
    btnOpen.className = "btn btn-open";
    btnOpen.textContent = "Ouvrir";
    btnOpen.target = "_blank";
    btnOpen.rel = "noopener noreferrer";

    const showDetails =
      catKey === "film" || catKey === "series" || catKey === "spectacle";

    if (showDetails) {
      const btnDetails = document.createElement("button");
      btnDetails.type = "button";
      btnDetails.className = "btn btn-details";
      btnDetails.textContent = "Détails";

      btnDetails.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openDetails(
          {
            ...item,
            category: catKey,
          },
          catKey
        );
      });

      // petit espace visuel entre Détails et les autres boutons
      const spacer = document.createElement("div");
      spacer.style.width = "16px";
      spacer.style.flex = "0 0 16px";

      // ORDRE FINAL : Détails - [espace] - Télécharger - Ouvrir
      actions.append(btnDetails, spacer, btnDl, btnOpen);
    } else {
      // Pas de bouton Détails -> juste Télécharger / Ouvrir
      actions.append(btnDl, btnOpen);
    }

    body.append(actions);

  
    card.append(posterWrap, body);
    return card;
  }
  

  function renderItems(items) {
    if (!items.length) {
      resultsEl.innerHTML = "";
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");
  
    resultsEl.innerHTML = "";
  
    const grid = document.createElement("div");
    grid.className = "cards-grid";
  
    items.forEach((item) => {
      grid.appendChild(createCard(item));
    });
  
    resultsEl.appendChild(grid);
  }
  
  function renderGroups(groups) {
    if (!Array.isArray(groups) || !groups.length) {
      renderItems([]);
      return;
    }
  
    emptyEl.classList.add("hidden");
    resultsEl.innerHTML = "";
  
    let total = 0;
  
    groups.forEach((group) => {
      const items = group.items || [];
      if (!items.length) return;
  
      total += items.length;
  
      const section = document.createElement("section");
      section.className = "category-group";
  
      const header = document.createElement("div");
      header.className = "group-header";
      header.textContent = group.label || group.key || "Catégorie";
  
      const grid = document.createElement("div");
      grid.className = "cards-grid";
  
      items.forEach((item) => {
        grid.appendChild(createCard(item));
      });
  
      section.append(header, grid);
      resultsEl.appendChild(section);
    });
  
    if (!total) {
      renderItems([]);
    }
  }

  // --- Recherche / filtrage local ---

  function matchesSearch(item, q) {
    if (!q) return true;
    const qv = q.toLowerCase();
  
    const displayTitle = getDisplayTitle(item);
  
    const fields = [
      displayTitle,
      item.rawTitle,
      item.year != null ? String(item.year) : "",
      item.episode,
      item.size,
      item.quality,
    ];
  
    return fields.some((val) => {
      if (val == null) return false;
      return String(val).toLowerCase().includes(qv);
    });
  }
  

  function renderFromState() {
    if (!feedState.mode) return;

    const q = (currentSearch || "").trim().toLowerCase();

    if (feedState.mode === "groups") {
      let groupsToRender = feedState.groups || [];

      if (q) {
        groupsToRender = feedState.groups
          .map((g) => ({
            ...g,
            items: (g.items || []).filter((item) => matchesSearch(item, q)),
          }))
          .filter((g) => g.items && g.items.length);
      }

      renderGroups(groupsToRender);
      const total = (groupsToRender || []).reduce(
        (sum, g) => sum + (g.items ? g.items.length : 0),
        0
      );
      statsEl.textContent = `${feedState.categoryLabel} — ${total} élément${
        total > 1 ? "s" : ""
      }${q ? " (filtré)" : ""}`;
    } else {
      let itemsToRender = feedState.items || [];

      if (q) {
        itemsToRender = itemsToRender.filter((item) =>
          matchesSearch(item, q)
        );
      }

      renderItems(itemsToRender);
      const total = itemsToRender.length;
      statsEl.textContent = `${feedState.categoryLabel} — ${total} élément${
        total > 1 ? "s" : ""
      }${q ? " (filtré)" : ""}`;
    }
  }

  function openSearchMode() {
    if (!searchContainer || !searchToggleBtn || !filtersContainer || !controlsEl) return;

    // on fige la largeur actuelle de l'encadré central
    const w = controlsEl.offsetWidth;
    if (w && w > 0) {
      controlsEl.style.width = w + "px";
      controlsEl.style.flex = "0 0 auto";
    }

    searchContainer.classList.remove("hidden");
    filtersContainer.classList.add("hidden");
    document.body.classList.add("search-active");

    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
  }

  function closeSearchMode() {
    if (!searchContainer || !searchToggleBtn || !filtersContainer || !controlsEl) return;

    document.body.classList.remove("search-active");
    searchContainer.classList.add("hidden");
    filtersContainer.classList.remove("hidden");

    // on libère la largeur pour que les listes puissent se recalculer
    controlsEl.style.width = "";
    controlsEl.style.flex = "";

    currentSearch = "";
    if (searchInput) {
      searchInput.value = "";
    }
    renderFromState();
  }

  // --- Settings popup ---

  function openSettings() {
    if (!overlay || !modal) return;
    overlay.classList.remove("hidden");
    modal.classList.remove("hidden");
    requestAnimationFrame(() => modal.classList.add("show"));
  }

  function closeSettings() {
    if (!overlay || !modal) return;
    modal.classList.remove("show");
    setTimeout(() => {
      overlay.classList.add("hidden");
      modal.classList.add("hidden");
    }, 200);
  }

  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeSettings();
    }
  });

  // --- Logs popup ---

  function classifyLogLine(line) {
    // format attendu : [date] [LEVEL] [TAG] message...
    const m = line.match(/^\[[^\]]+\]\s+\[[^\]]+\]\s+\[([^\]]+)\]/);
    const tag = m ? m[1].toUpperCase() : "";

    if (tag === "PURGE") return "log-purge";
    if (tag === "SYNC") return "log-sync";
    if (tag.startsWith("TMDB")) return "log-tmdb";

    return "";
  }

  async function loadLogs() {
    if (!logsContent) return;
    logsContent.textContent = "Chargement des logs...";

    try {
      const res = await fetch("/api/logs?limit=300");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const lines = Array.isArray(data.lines) ? data.lines : [];

      logsContent.innerHTML = "";

      if (!lines.length) {
        logsContent.textContent = "Aucun log pour le moment.";
        return;
      }

      const frag = document.createDocumentFragment();

      lines.forEach((line) => {
        const div = document.createElement("div");
        div.className = "log-line";

        const extraClass = classifyLogLine(line);
        if (extraClass) {
          div.classList.add(extraClass);
        }

        div.textContent = line;
        frag.appendChild(div);
      });

      logsContent.appendChild(frag);
    } catch (err) {
      console.error(err);
      logsContent.textContent = "Erreur lors du chargement des logs.";
    }
  }


  function openLogs() {
    if (!logsOverlay || !logsModal) return;
    logsOverlay.classList.remove("hidden");
    logsModal.classList.remove("hidden");
    requestAnimationFrame(() => logsModal.classList.add("show"));
    loadLogs();
  }

  function closeLogs() {
    if (!logsOverlay || !logsModal) return;
    logsModal.classList.remove("show");
    setTimeout(() => {
      logsOverlay.classList.add("hidden");
      logsModal.classList.add("hidden");
    }, 200);
  }

  logsOverlay?.addEventListener("click", (e) => {
    if (e.target === logsOverlay) {
      closeLogs();
    }
  });

  function closeDetails() {
    if (!detailsOverlay || !detailsModal) return;
    detailsModal.classList.remove("show");
    setTimeout(() => {
      detailsOverlay.classList.add("hidden");
      detailsModal.classList.add("hidden");
    }, 200);
  }

  function renderDetailsSkeleton(item, catKey) {
    if (!detailsMetaEl || !detailsPlotEl || !detailsExtraEl) return;

    detailsMetaEl.innerHTML = "";
    detailsExtraEl.innerHTML = "";

    const meta = [];

    const hasEpisode = item.episode != null && item.episode !== "";
    const labelEpisodeOrYear = hasEpisode ? "Épisode" : "Année";
    const valueEpisodeOrYear = hasEpisode ? item.episode : (item.year || "—");
    meta.push(`${labelEpisodeOrYear} : ${valueEpisodeOrYear}`);
    meta.push(`Taille : ${item.size || "—"}`);
    meta.push(`Seeders : ${item.seeders != null ? item.seeders : "—"}`);
    if (item.quality) {
      meta.push(`Qualité : ${item.quality}`);
    }
    if (item.addedAt) {
      meta.push(`Ajouté le : ${item.addedAt}`);
    }

    detailsMetaEl.innerHTML = meta
      .map((line) => `<div class="details-meta-line">${line}</div>`)
      .join("");

    detailsPlotEl.textContent = "Chargement des infos IMDb…";
    detailsImdbLinkEl?.classList.add("hidden");
  }

  function applyDetailsPoster(src) {
    if (!detailsPosterEl || !detailsPosterFallback) return;
    if (src) {
      detailsPosterEl.src = src;
      detailsPosterEl.classList.remove("hidden");
      detailsPosterFallback.classList.add("hidden");
    } else {
      detailsPosterEl.src = "";
      detailsPosterEl.classList.add("hidden");
      detailsPosterFallback.classList.remove("hidden");
    }
  }

  async function fetchAndFillDetails(item, catKey) {
    if (!detailsPlotEl) return;

    const baseTitle = item.rawTitle || item.title || "";
    if (!baseTitle) {
      detailsPlotEl.textContent = "Titre introuvable pour la recherche.";
      return;
    }

    const params = new URLSearchParams({
      title: baseTitle,
      category: catKey || item.category || categorySelect?.value || "film",
    });

    try {
      const res = await fetch(`/api/details?${params.toString()}`);
      if (!res.ok) {
        detailsPlotEl.textContent = "Aucune fiche trouvée sur IMDb.";
        return;
      }

      const data = await res.json();

      if (data.title && detailsTitleEl) {
        detailsTitleEl.textContent = data.title;
      }

      // Poster IMDb prioritaire si dispo
      if (data.poster) {
        applyDetailsPoster(data.poster);
      }

      if (detailsMetaEl) {
        const meta = [];

        if (data.year) meta.push(`Année : ${data.year}`);
        if (data.released) meta.push(`Sortie : ${data.released}`);
        if (data.runtime) meta.push(`Durée : ${data.runtime}`);
        if (data.genre) meta.push(`Genre : ${data.genre}`);
        if (data.director && data.director !== "N/A") {
          meta.push(`Réalisateur : ${data.director}`);
        }
        if (data.actors && data.actors !== "N/A") {
          meta.push(`Acteurs : ${data.actors}`);
        }
        if (data.imdbRating && data.imdbRating !== "N/A") {
          meta.push(`Note IMDb : ${data.imdbRating}/10 (${data.imdbVotes || "?"} votes)`);
        }

        detailsMetaEl.innerHTML = meta
          .map((line) => `<div class="details-meta-line">${line}</div>`)
          .join("");
      }

      if (detailsPlotEl) {
        detailsPlotEl.textContent =
          data.plot && data.plot !== "N/A"
            ? data.plot
            : "Pas de résumé disponible.";
      }

      if (detailsExtraEl) {
        const extra = [];
        if (data.language && data.language !== "N/A") {
          extra.push(`Langues : ${data.language}`);
        }
        if (data.country && data.country !== "N/A") {
          extra.push(`Pays : ${data.country}`);
        }
        if (data.awards && data.awards !== "N/A") {
          extra.push(`Récompenses : ${data.awards}`);
        }

        detailsExtraEl.innerHTML = extra
          .map((line) => `<div class="details-extra-line">${line}</div>`)
          .join("");
      }

      if (detailsImdbLinkEl && data.imdbID) {
        const imdbUrl = `https://www.imdb.com/title/${data.imdbID}/`;
        detailsImdbLinkEl.href = imdbUrl;
        detailsImdbLinkEl.textContent = "Voir la fiche sur IMDb";
        detailsImdbLinkEl.classList.remove("hidden");
      }
    } catch (err) {
      console.error(err);
      detailsPlotEl.textContent =
        "Erreur lors du chargement de la fiche détaillée.";
    }
  }

  function openDetails(item, catKey) {
    if (!detailsOverlay || !detailsModal) return;

    const effectiveCat = catKey || item.category || categorySelect?.value || "film";

    // Titre initial = titre d'affichage actuel
    if (detailsTitleEl) {
      detailsTitleEl.textContent = getDisplayTitle(item);
    }

    // Poster de la carte tant qu'on n'a pas mieux
    applyDetailsPoster(item.poster || item.posterUrl || null);

    renderDetailsSkeleton(item, effectiveCat);

    detailsOverlay.classList.remove("hidden");
    detailsModal.classList.remove("hidden");
    requestAnimationFrame(() => detailsModal.classList.add("show"));

    fetchAndFillDetails(item, effectiveCat);
  }

  detailsOverlay?.addEventListener("click", (e) => {
    if (e.target === detailsOverlay) {
      closeDetails();
    }
  });

  detailsCloseBtn?.addEventListener("click", closeDetails);


  // --- Header compact au scroll ---

  window.addEventListener("scroll", () => {
    if (!headerEl) return;

    const scrolled = window.scrollY || document.documentElement.scrollTop;
    const isMobile = window.innerWidth <= 768;

    // Desktop : header-compact comme avant
    if (!isMobile) {
      if (scrolled > 40) {
        headerEl.classList.add("header-compact");
      } else {
        headerEl.classList.remove("header-compact");
      }
    } else {
      // Mobile : jamais de header-compact (évite les sauts de layout)
      headerEl.classList.remove("header-compact");

      // Étape 1 : léger resserrage
      if (scrolled > 20) {
        headerEl.classList.add("header-mobile-tight");
      } else {
        headerEl.classList.remove("header-mobile-tight");
      }

      // Étape 2 : fondu logo + boutons
      if (scrolled > 60) {
        headerEl.classList.add("header-mobile-faded");
      } else {
        headerEl.classList.remove("header-mobile-faded");
      }
    }

    // Étape 3 : collapse barre en rond uniquement en mobile
    if (!controlsEl || !isMobile) return;

    // Si l'utilisateur a RE-OUVERT manuellement la barre,
    // on NE recollapse plus tant qu'il n'est pas revenu vers le haut.
    if (controlsManuallyExpanded) {
      // quand on revient presque en haut, on réactive le comportement auto
      if (scrolled < 80) {
        controlsManuallyExpanded = false;
      }
      return;
    }

    if (scrolled > 140 && !controlsCollapsed) {
      controlsEl.classList.add("controls-collapsed");
      controlsCollapsed = true;
    } else if (scrolled < 100 && controlsCollapsed) {
      controlsEl.classList.remove("controls-collapsed");
      controlsCollapsed = false;
    }
  });


  // --- Settings footer/version ---

  async function initVersionFooter() {
    if (footerEl) {
      footerEl.addEventListener("click", () => {
        window.open("https://github.com/Guizmos/FeedyGG", "_blank");
      });
    }

    if (!appVersionEl) return;

    try {
      const res = await fetch("/version", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();

      if (data && data.version) {
        appVersionEl.textContent = `v${data.version}`;
      } else {
        appVersionEl.textContent = "";
      }
    } catch (err) {
      console.error("Erreur lors de la récupération de la version :", err);
      appVersionEl.textContent = "";
    }
  }

  // --- Events ---

  // changement du tri par défaut dans les paramètres
  defaultSortSelect?.addEventListener("change", (e) => {
    const value = e.target.value || "seeders";

    // on sauvegarde le choix
    localStorage.setItem("defaultSort", value);

    // on met à jour le select de tri du header
    if (sortSelect) {
      sortSelect.value = value;
      autosizeSelect(sortSelect);
    }

    // on recharge le flux avec ce nouveau tri
    loadFeed();
  });

  refreshBtn?.addEventListener("click", () => {
    loadFeed();
  });

  settingsBtn?.addEventListener("click", openSettings);
  closeSettingsBtn?.addEventListener("click", closeSettings);

  openLogsBtn?.addEventListener("click", openLogs);
  closeLogsBtn?.addEventListener("click", closeLogs);


  // --- Recherche ---

  searchToggleBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    openSearchMode();
  });

  filtersMiniBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    closeSearchMode();
  });

  searchInput?.addEventListener("input", (e) => {
    currentSearch = e.target.value || "";
    renderFromState();
  });

  searchClearBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!searchInput) return;
    searchInput.value = "";
    currentSearch = "";
    renderFromState();
    searchInput.focus();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
  
    if (detailsModal && !detailsModal.classList.contains("hidden") && detailsModal.classList.contains("show")) {
      closeDetails();
    } else if (logsModal && !logsModal.classList.contains("hidden") && logsModal.classList.contains("show")) {
      closeLogs();
    } else if (modal && !modal.classList.contains("hidden") && modal.classList.contains("show")) {
      closeSettings();
    } else if (searchContainer && !searchContainer.classList.contains("hidden")) {
      closeSearchMode();
    }
  });

  // --- Selects + autosize + reload ---
  categorySelect?.addEventListener("change", (e) => {
    autosizeSelect(e.target);
    loadFeed();
  });

  limitSelect?.addEventListener("change", (e) => {
    autosizeSelect(e.target);
    loadFeed();
  });

  sortSelect?.addEventListener("change", (e) => {
    autosizeSelect(e.target);
    loadFeed();
  });

  controlsEl?.addEventListener("click", () => {
    if (window.innerWidth > 768) return;

    // Si déjà ouverte, on ne fait rien de spécial
    if (!controlsCollapsed) return;

    // Mobile + barre actuellement en mode rond -> on la ré-ouvre et
    // on passe en "mode manuel" : le scroll ne la recollapsera plus
    // tant que l'utilisateur n'est pas remonté en haut.
    controlsEl.classList.remove("controls-collapsed");
    controlsCollapsed = false;
    controlsManuallyExpanded = true;
  });

  // --- Init ---
  (async () => {
    await initCategories();
    autosizeSelect(limitSelect);
    autosizeSelect(sortSelect);
    await loadFeed();
    await initVersionFooter();
  })();
});
