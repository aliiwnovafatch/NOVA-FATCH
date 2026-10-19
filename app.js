(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STORE = {
    api: "novafetch.apiBase",
    history: "novafetch.history",
    settings: "novafetch.settings"
  };
  const DEFAULT_SETTINGS = { historyEnabled: true, thumbnailsEnabled: true, reduceMotion: false };
  let settings = { ...DEFAULT_SETTINGS, ...readJson(STORE.settings, {}) };
  let historyItems = readJson(STORE.history, []);
  let currentResult = null;
  let currentFormatTab = "video";
  let activeView = "extract";
  let isLoading = false;

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }
  function apiBase() {
    return (localStorage.getItem(STORE.api) || "").trim().replace(/\/+$/, "");
  }
  function safeUrl(value) {
    try {
      const parsed = new URL(value);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
    } catch {
      return "";
    }
  }
  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }
  function fmtDuration(value) {
    if (typeof value === "string" && value.trim()) return value;
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return "—";
    const s = Math.floor(seconds % 60).toString().padStart(2, "0");
    const m = Math.floor((seconds / 60) % 60).toString().padStart(2, "0");
    const h = Math.floor(seconds / 3600);
    return h ? `${h}:${m}:${s}` : `${Math.floor(seconds / 60)}:${s}`;
  }
  function platformLabel(platform) {
    return ({ tiktok: "TikTok", instagram: "Instagram", facebook: "Facebook" })[platform] || "Social media";
  }
  function toast(message, type = "success") {
    const region = $("#toast-region");
    const el = document.createElement("div");
    el.className = `toast ${type === "error" ? "error" : ""}`;
    el.innerHTML = `<span class="toast-icon">${type === "error" ? "!" : "✓"}</span><span>${esc(message)}</span>`;
    region.appendChild(el);
    window.setTimeout(() => el.remove(), 3600);
  }
  function setApiStatus(state, label) {
    ["#side-status-dot", "#top-status-dot"].forEach(sel => {
      const dot = $(sel);
      dot.classList.remove("online", "offline");
      if (state === "online") dot.classList.add("online");
      if (state === "offline") dot.classList.add("offline");
    });
    $("#side-status-text").textContent = label;
    $("#top-status-text").textContent = label === "Connected" ? "API online" : label === "Offline" ? "API offline" : label;
  }
  async function checkApi(showToast = false) {
    const base = apiBase();
    if (!base) {
      setApiStatus("unknown", "Not configured");
      if (showToast) toast("Add your Railway backend URL in Settings first.", "error");
      return false;
    }
    try {
      const response = await fetch(`${base}/api/health`, { method: "GET", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Health endpoint returned ${response.status}`);
      const data = await response.json();
      if (data.status !== "ok") throw new Error("Backend reported an unhealthy status.");
      setApiStatus("online", "Connected");
      if (showToast) toast("Backend connection successful.");
      return true;
    } catch (error) {
      setApiStatus("offline", "Offline");
      if (showToast) toast(`Could not connect to API. Check the URL and CORS settings.`, "error");
      return false;
    }
  }
  function showView(view) {
    activeView = view;
    $$(".view").forEach(el => el.classList.remove("active-view"));
    $(`#view-${view}`).classList.add("active-view");
    $$(".nav-item").forEach(el => el.classList.toggle("active", el.dataset.view === view));
    const labels = { extract: "Extract media", history: "Recent history", settings: "Settings" };
    $("#breadcrumb-current").textContent = labels[view] || "Workspace";
    $("#sidebar").classList.remove("open");
    $("#mobile-scrim").classList.remove("show");
    if (view === "history") renderHistory();
    if (view === "settings") syncSettingsUI();
    window.scrollTo({ top: 0, behavior: settings.reduceMotion ? "auto" : "smooth" });
  }
  function setLoading(loading) {
    isLoading = loading;
    $("#extract-button").disabled = loading;
    $("#extract-button-label").textContent = loading ? "Checking available formats…" : "Fetch available formats";
    $(".button-spark").textContent = loading ? "◌" : "✦";
  }
  function validateMediaUrl(raw) {
    let parsed;
    try { parsed = new URL(raw.trim()); } catch { return "Enter a valid URL to continue."; }
    if (parsed.protocol !== "https:") return "Please use an HTTPS link.";
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    const supported = [
      ["tiktok.com", "TikTok"],
      ["instagram.com", "Instagram"],
      ["facebook.com", "Facebook"],
      ["fb.watch", "Facebook"]
    ];
    const match = supported.find(([domain]) => host === domain || host.endsWith(`.${domain}`));
    if (!match) return "Supported links are from TikTok, Instagram or Facebook.";
    if (!parsed.pathname || parsed.pathname === "/") return "Paste a link to a specific media page.";
    return "";
  }
  async function extract(url, fromHistory = false) {
    if (isLoading) return;
    const validation = validateMediaUrl(url);
    if (validation) { toast(validation, "error"); $("#url-hint").textContent = validation; return; }
    const base = apiBase();
    if (!base) {
      toast("Configure your Railway API URL in Settings before extracting.", "error");
      showView("settings");
      return;
    }
    let baseUrl;
    try {
      baseUrl = new URL(base);
      if (!["https:", "http:"].includes(baseUrl.protocol)) throw new Error();
    } catch {
      toast("The API base URL in Settings is invalid.", "error");
      showView("settings");
      return;
    }

    setLoading(true);
    $("#url-hint").textContent = "Connecting to your API…";
    $("#results-section").hidden = true;
    try {
      const endpoint = `${baseUrl.href.replace(/\/+$/, "")}/api/extract?url=${encodeURIComponent(url.trim())}`;
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 45000);
      let response;
      try {
        response = await fetch(endpoint, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
      } finally {
        window.clearTimeout(timeout);
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data.detail === "string" ? data.detail : `Request failed (${response.status}).`;
        throw new Error(detail);
      }
      if (data.status !== "success") throw new Error("The API did not return a successful extraction.");
      currentResult = { ...data, source_url: url.trim(), extracted_at: new Date().toISOString() };
      currentFormatTab = "video";
      renderResult(currentResult);
      $("#results-section").hidden = false;
      $("#url-hint").textContent = "Extraction complete. Direct media URLs may expire.";
      if (!fromHistory) saveHistory(currentResult);
      $("#results-section").scrollIntoView({ behavior: settings.reduceMotion ? "auto" : "smooth", block: "start" });
      checkApi(false);
    } catch (error) {
      let message = error.name === "AbortError"
        ? "The request took too long. Try again in a moment."
        : (error.message || "Could not extract this media.");
      if (/failed to fetch|networkerror|load failed/i.test(message)) {
        message = "Could not reach the API. Check your Railway URL, deployment status and backend CORS_ORIGINS.";
      }
      toast(message, "error");
      $("#url-hint").textContent = message;
    } finally {
      setLoading(false);
    }
  }
  function saveHistory(result) {
    if (!settings.historyEnabled) return;
    const record = {
      title: result.title || "Social Media Video",
      platform: result.platform || "unknown",
      thumbnail: result.thumbnail || "",
      uploader: result.uploader || "Unknown creator",
      source_url: result.source_url,
      extracted_at: result.extracted_at,
      duration: result.duration,
      duration_string: result.duration_string,
      views: result.views,
      likes: result.likes,
      video_formats: result.video_formats || [],
      audio_formats: result.audio_formats || [],
      download_url: result.download_url || null
    };
    historyItems = [record, ...historyItems.filter(item => item.source_url !== record.source_url)].slice(0, 30);
    persistHistory();
  }
  function persistHistory() {
    try { localStorage.setItem(STORE.history, JSON.stringify(historyItems)); }
    catch { toast("Browser storage is full. Clear some history.", "error"); }
    updateHistoryCount();
  }
  function updateHistoryCount() {
    $("#history-count").textContent = String(historyItems.length);
    $("#history-summary").textContent = `${historyItems.length} saved item${historyItems.length === 1 ? "" : "s"}`;
  }
  function renderResult(data) {
    const thumbnail = settings.thumbnailsEnabled && safeUrl(data.thumbnail)
      ? `<img src="${esc(safeUrl(data.thumbnail))}" alt="Media thumbnail" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
      : `<span class="thumb-placeholder">✦</span>`;
    const duration = fmtDuration(data.duration_string || data.duration);
    const views = Number(data.views || 0);
    const likes = Number(data.likes || 0);
    const info = `
      <article class="result-card">
        <div class="result-overview">
          <div class="thumbnail-wrap">${thumbnail}<span class="duration-pill">${esc(duration)}</span></div>
          <div class="result-info">
            <span class="result-platform">${esc(platformLabel(data.platform))} · AVAILABLE MEDIA</span>
            <h3>${esc(data.title || "Social Media Video")}</h3>
            <p class="result-uploader">by ${esc(data.uploader || "Unknown creator")}</p>
            <div class="meta-chips">
              ${views ? `<span class="meta-chip">◉ ${esc(views.toLocaleString())} views</span>` : ""}
              ${likes ? `<span class="meta-chip">♡ ${esc(likes.toLocaleString())} likes</span>` : ""}
              <span class="meta-chip">${(data.video_formats || []).length} video formats</span>
              <span class="meta-chip">${(data.audio_formats || []).length} audio formats</span>
            </div>
          </div>
        </div>
        <div class="format-block">
          <div class="format-tabs" role="tablist" aria-label="Media format types">
            <button class="format-tab ${currentFormatTab === "video" ? "active" : ""}" role="tab" aria-selected="${currentFormatTab === "video"}" data-format-tab="video">Video <span class="format-count">${(data.video_formats || []).length}</span></button>
            <button class="format-tab ${currentFormatTab === "audio" ? "active" : ""}" role="tab" aria-selected="${currentFormatTab === "audio"}" data-format-tab="audio">Audio <span class="format-count">${(data.audio_formats || []).length}</span></button>
          </div>
          <div class="format-list" id="format-list">${renderFormats(data, currentFormatTab)}</div>
          <p class="settings-help">Direct URLs may expire. Separate video-only streams may not include audio. Choose formats only for content you are authorized to access.</p>
        </div>
      </article>`;
    $("#result-content").innerHTML = info;
    $$("[data-format-tab]", $("#result-content")).forEach(button => {
      button.addEventListener("click", () => {
        currentFormatTab = button.dataset.formatTab;
        $$(".format-tab", $("#result-content")).forEach(tab => {
          const active = tab.dataset.formatTab === currentFormatTab;
          tab.classList.toggle("active", active);
          tab.setAttribute("aria-selected", String(active));
        });
        $("#format-list").innerHTML = renderFormats(currentResult, currentFormatTab);
      });
    });
    bindFormatActions($("#result-content"));
  }
  function renderFormats(data, kind) {
    const formats = (kind === "audio" ? data.audio_formats : data.video_formats) || [];
    if (!formats.length) return `<div class="empty-formats">No ${kind} formats were returned for this media.<br>Availability depends on the source platform and its current restrictions.</div>`;
    return formats.map((format, index) => {
      const url = safeUrl(format.url);
      const label = format.quality || (kind === "audio" ? "Audio" : "Video");
      const ext = String(format.ext || "media").toUpperCase();
      const size = format.filesize ? formatBytes(format.filesize) : "Size not provided";
      const height = format.height ? `${format.height}p` : "";
      const detail = [height, ext, size, format.has_audio === false && kind === "video" ? "Video only" : ""].filter(Boolean).join(" · ");
      const formatUrl = url || "";
      return `<div class="format-row">
        <span class="format-badge">${esc(ext.slice(0, 5))}</span>
        <div class="format-detail"><strong>${esc(label)}</strong><span>${esc(detail || "Format details unavailable")}</span></div>
        <div class="format-actions">
          <button class="format-action copy" data-copy-url="${esc(formatUrl)}" ${formatUrl ? "" : "disabled"}>Copy link</button>
          <button class="format-action" data-open-url="${esc(formatUrl)}" ${formatUrl ? "" : "disabled"}>Open ↗</button>
        </div>
      </div>`;
    }).join("");
  }
  function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return "Size not provided";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
    return `${(n / (1024 ** i)).toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
  }
  function bindFormatActions(root) {
    $$("[data-copy-url]", root).forEach(button => button.addEventListener("click", async () => {
      const url = button.dataset.copyUrl;
      if (!url) return;
      await copyText(url);
    }));
    $$("[data-open-url]", root).forEach(button => button.addEventListener("click", () => {
      const url = safeUrl(button.dataset.openUrl);
      if (!url) return;
      window.open(url, "_blank", "noopener,noreferrer");
    }));
  }
  async function copyText(value) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(value);
      else {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed"; input.style.opacity = "0";
        document.body.appendChild(input); input.select();
        const ok = document.execCommand("copy"); input.remove();
        if (!ok) throw new Error("Copy unavailable");
      }
      toast("Link copied to clipboard.");
    } catch {
      toast("Could not copy automatically. Open the link and copy it manually.", "error");
    }
  }
  function renderHistory() {
    updateHistoryCount();
    if (!historyItems.length) {
      $("#history-list").innerHTML = `<div class="empty-state"><div class="empty-icon">◷</div><h3>Your history is clear</h3><p>Successful extractions will appear here when local history is enabled.</p></div>`;
      return;
    }
    $("#history-list").innerHTML = historyItems.map((item, index) => {
      const thumb = settings.thumbnailsEnabled && safeUrl(item.thumbnail)
        ? `<img src="${esc(safeUrl(item.thumbnail))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`
        : "✦";
      const when = item.extracted_at ? new Date(item.extracted_at).toLocaleString() : "Previously extracted";
      return `<article class="history-item">
        <div class="history-thumb">${thumb}</div>
        <div class="history-info"><strong title="${esc(item.title)}">${esc(item.title || "Social Media Video")}</strong><span>${esc(platformLabel(item.platform))} · ${esc(when)}</span></div>
        <div class="history-actions"><button data-reopen="${index}">View</button><button data-copy-source="${index}">Copy source</button></div>
      </article>`;
    }).join("");
    $$("[data-reopen]", $("#history-list")).forEach(button => button.addEventListener("click", () => {
      const item = historyItems[Number(button.dataset.reopen)];
      if (!item) return;
      currentResult = item;
      currentFormatTab = "video";
      showView("extract");
      $("#media-url").value = item.source_url || "";
      updateUrlCounter();
      $("#results-section").hidden = false;
      renderResult(item);
      $("#results-section").scrollIntoView({ behavior: settings.reduceMotion ? "auto" : "smooth", block: "start" });
      toast("Showing saved metadata. Direct links may have expired.");
    }));
    $$("[data-copy-source]", $("#history-list")).forEach(button => button.addEventListener("click", () => {
      const item = historyItems[Number(button.dataset.copySource)];
      if (item?.source_url) copyText(item.source_url);
    }));
  }
  function syncSettingsUI() {
    $("#api-base").value = apiBase();
    $("#history-enabled").checked = settings.historyEnabled;
    $("#thumbnails-enabled").checked = settings.thumbnailsEnabled;
    $("#reduce-motion").checked = settings.reduceMotion;
  }
  function saveSettings() {
    settings = {
      historyEnabled: $("#history-enabled").checked,
      thumbnailsEnabled: $("#thumbnails-enabled").checked,
      reduceMotion: $("#reduce-motion").checked
    };
    document.body.classList.toggle("reduce-motion", settings.reduceMotion);
    try { localStorage.setItem(STORE.settings, JSON.stringify(settings)); }
    catch { /* UI preferences still work for this session. */ }
    if (!settings.historyEnabled) {
      historyItems = [];
      persistHistory();
    }
  }
  function updateUrlCounter() {
    const input = $("#media-url");
    $("#url-counter").textContent = `${input.value.length} / 2048`;
    $("#clear-url").hidden = !input.value;
  }

  // Navigation
  $$(".nav-item").forEach(button => button.addEventListener("click", () => showView(button.dataset.view)));
  $("#settings-shortcut").addEventListener("click", () => showView("settings"));
  $("#footer-settings").addEventListener("click", event => { event.preventDefault(); showView("settings"); });
  $("#menu-toggle").addEventListener("click", () => {
    $("#sidebar").classList.add("open");
    $("#mobile-scrim").classList.add("show");
  });
  $("#mobile-scrim").addEventListener("click", () => {
    $("#sidebar").classList.remove("open");
    $("#mobile-scrim").classList.remove("show");
  });

  // Extraction form
  $("#extract-form").addEventListener("submit", event => {
    event.preventDefault();
    const value = $("#media-url").value.trim();
    extract(value);
  });
  $("#media-url").addEventListener("input", updateUrlCounter);
  $("#clear-url").addEventListener("click", () => {
    $("#media-url").value = "";
    updateUrlCounter();
    $("#media-url").focus();
  });
  $("#new-extraction").addEventListener("click", () => {
    $("#media-url").value = "";
    updateUrlCounter();
    $("#results-section").hidden = true;
    $("#media-url").focus();
    window.scrollTo({ top: 0, behavior: settings.reduceMotion ? "auto" : "smooth" });
  });

  // API settings and health
  $("#settings-form").addEventListener("submit", async event => {
    event.preventDefault();
    const value = $("#api-base").value.trim().replace(/\/+$/, "");
    if (value) {
      try {
        const parsed = new URL(value);
        if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      } catch {
        toast("Enter a valid API base URL, such as https://your-service.up.railway.app", "error");
        return;
      }
    }
    if (value) localStorage.setItem(STORE.api, value);
    else localStorage.removeItem(STORE.api);
    toast("API connection settings saved.");
    await checkApi(true);
  });
  $("#test-api").addEventListener("click", () => checkApi(true));
  $("#check-api-side").addEventListener("click", () => checkApi(true));

  // Preferences
  ["#history-enabled", "#thumbnails-enabled", "#reduce-motion"].forEach(selector => {
    $(selector).addEventListener("change", () => {
      saveSettings();
      if (currentResult && !$("#results-section").hidden) renderResult(currentResult);
      if (activeView === "history") renderHistory();
      toast("Preferences updated.");
    });
  });
  $("#clear-history").addEventListener("click", () => {
    if (!historyItems.length) { toast("History is already empty."); return; }
    if (!window.confirm("Clear all locally saved extraction history?")) return;
    historyItems = [];
    persistHistory();
    renderHistory();
    toast("Local history cleared.");
  });

  // Initial render
  document.body.classList.toggle("reduce-motion", settings.reduceMotion);
  updateUrlCounter();
  updateHistoryCount();
  syncSettingsUI();
  checkApi(false);
})();