const heroEl = document.getElementById("hero");
const cardsEl = document.getElementById("cards");
const sessionsEl = document.getElementById("sessions");
const refreshBtn = document.getElementById("refreshBtn");
const periodSelectorEl = document.getElementById("periodSelector");
const periodSummaryEl = document.getElementById("periodSummary");
const monthlyReportEl = document.getElementById("monthlyReport");
const chartWrapEls = Array.from(document.querySelectorAll(".chart-wrap"));
const appRootEl = document.querySelector(".app");

const chartRefs = {};
const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
const valueState = new Map();

const periodOrder = ["today", "yesterday", "week", "month", "total"];
const periodLabels = {
  today: "Heute",
  yesterday: "Gestern",
  week: "Woche",
  month: "Monat",
  total: "Gesamt",
};

let selectedPeriod = "today";
let dashboardData = null;

if (appRootEl) {
  let hasRevealed = false;
  const triggerAppReveal = () => {
    if (hasRevealed) return;
    appRootEl.classList.remove("is-revealed");
    // Force a reflow so Safari reliably applies the staged transition.
    void appRootEl.offsetWidth;
    window.setTimeout(() => {
      appRootEl.classList.add("is-revealed");
      hasRevealed = true;
    }, 60);
  };

  // Trigger early (works more reliably on iOS than waiting for window load).
  window.setTimeout(triggerAppReveal, 20);

  document.addEventListener("DOMContentLoaded", triggerAppReveal, { once: true });
  window.addEventListener("load", triggerAppReveal, { once: true });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      hasRevealed = false;
      triggerAppReveal();
    }
  });
}

function fmt(value, unit = "") {
  return `${numberFormatter.format(Number(value || 0))}${unit}`;
}

function formatDistance(metersInput) {
  const meters = Number(metersInput || 0);
  if (Math.abs(meters) >= 1000) return `${numberFormatter.format(meters / 1000)} km`;
  return `${numberFormatter.format(meters)} m`;
}

function formatDuration(secondsInput) {
  const seconds = Math.max(0, Math.floor(Number(secondsInput || 0)));
  if (seconds < 60) return `${seconds} Sek`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} Min`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h} Std ${m} Min` : `${h} Std`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d} Tg ${h} Std` : `${d} Tg`;
}

function averageSpeedKmh(distanceM, durationS) {
  const duration = Number(durationS || 0);
  if (duration <= 0) return 0;
  return (Number(distanceM || 0) / 1000) / (duration / 3600);
}

function sessionStatus(maxKmh) {
  if (maxKmh >= 4.5) return { text: "Starkes Sprinttraining", className: "status-fast" };
  if (maxKmh >= 2.5) return { text: "Stabiles Cardio", className: "status-steady" };
  return { text: "Ruhiger Lauf", className: "status-light" };
}

function heroSubtitle(activeSeconds) {
  if (selectedPeriod !== "today") return `${periodLabels[selectedPeriod]} im Fokus`;
  if (activeSeconds >= 900) return "Heute war Jasper besonders aktiv.";
  if (activeSeconds >= 300) return "Heute war Jasper unterwegs.";
  return "Momentan schläft Jasper.";
}

function buildInsightMessage(periodKpis, series) {
  if (periodKpis.activeSeconds < 180) return "Momentan schläft Jasper.";
  const entries = series.activityByHour || [];
  if (!entries.length) return "Heute gab es bereits einige Zoomies.";
  const best = entries.reduce((a, b) => (Number(b.value) > Number(a.value) ? b : a), entries[0]);
  const hour = Number(best.hour);
  if (hour >= 22 || hour <= 4) return "Die meisten Läufe finden nachts statt.";
  if (periodKpis.zoomies >= 5) return `Heute gab es bereits ${fmt(periodKpis.zoomies)} Zoomies.`;
  return "Heute war Jasper besonders aktiv.";
}

function ringPercent(value, target) {
  return Math.max(0, Math.min(100, Math.round((Number(value || 0) / target) * 100)));
}

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function animateValue(from, to, durationMs, onUpdate) {
  const start = performance.now();
  const safeFrom = Number.isFinite(from) ? from : 0;
  const safeTo = Number.isFinite(to) ? to : 0;
  if (Math.abs(safeTo - safeFrom) < 0.001) {
    onUpdate(safeTo);
    return;
  }
  function step(now) {
    const progress = Math.min(1, (now - start) / durationMs);
    onUpdate(safeFrom + (safeTo - safeFrom) * easeOutCubic(progress));
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function dayLabel(iso) {
  return new Date(iso).toLocaleDateString("de-DE", { month: "short", day: "numeric" });
}

function timeLabel(iso) {
  return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

function makeChartOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 300, easing: "easeOutCubic" },
    plugins: {
      legend: {
        labels: {
          color: "#AEB8C5",
          boxWidth: 10,
          boxHeight: 10,
          font: { family: "Inter, SF Pro Text, Segoe UI, Roboto, Arial, sans-serif", size: 11 },
        },
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(255,255,255,0.02)", drawBorder: false },
        border: { display: false },
        ticks: {
          color: "#AEB8C5",
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 6,
          font: { family: "Inter, SF Pro Text, Segoe UI, Roboto, Arial, sans-serif", size: 11 },
        },
      },
      y: {
        grid: { color: "rgba(255,255,255,0.04)", drawBorder: false },
        border: { display: false },
        ticks: {
          color: "#AEB8C5",
          maxTicksLimit: 4,
          font: { family: "Inter, SF Pro Text, Segoe UI, Roboto, Arial, sans-serif", size: 11 },
        },
      },
    },
    layout: { padding: { top: 8, right: 8, bottom: 4, left: 4 } },
  };
}

function ensureLoadingHero() {
  heroEl.innerHTML = `
    <div class="hero-layout loading-card">
      <div>
        <span class="skeleton-line skeleton-title"></span>
        <span class="skeleton-line skeleton-value hero-skeleton-value"></span>
        <span class="skeleton-line skeleton-inline"></span>
      </div>
      <div class="hero-ring-skeleton"></div>
    </div>
  `;
}

function ensureLoadingCards() {
  const cards = [
    { icon: "fa-solid fa-route", label: "Distanz", tone: "tone-mint" },
    { icon: "fa-solid fa-clock", label: "Aktivzeit", tone: "tone-sky" },
    { icon: "fa-solid fa-bolt", label: "Zoomies", tone: "tone-peach" },
    { icon: "fa-solid fa-gauge-high", label: "Top-Speed", tone: "tone-lavender" },
  ];
  cardsEl.innerHTML = cards
    .map(
      (card) => `
      <article class="kpi-card ${card.tone}">
        <h3><span class="mini-icon"><i class="${card.icon}" aria-hidden="true"></i></span> ${card.label}</h3>
        <strong>—</strong>
      </article>
    `
    )
    .join("");
}

function ensureLoadingSessions() {
  sessionsEl.innerHTML = `
    <div class="session-list">
      ${Array.from({ length: 4 })
        .map(
          () => `
          <article class="session-item loading-card">
            <span class="skeleton-line skeleton-title"></span>
            <span class="skeleton-line skeleton-value"></span>
          </article>
        `
        )
        .join("")}
    </div>
  `;
}

function ensureLoadingPeriodSummary() {
  periodSummaryEl.innerHTML = `
    <div class="period-cards">
      ${Array.from({ length: 5 })
        .map(
          () => `
          <article class="period-card loading-card">
            <span class="skeleton-line skeleton-title"></span>
            <span class="skeleton-line skeleton-value"></span>
          </article>
        `
        )
        .join("")}
    </div>
  `;
}

function ensureLoadingMonthlyReport() {
  monthlyReportEl.innerHTML = `
    <div class="report-grid">
      ${Array.from({ length: 6 })
        .map(
          () => `
          <article class="highlight-card loading-card">
            <span class="skeleton-line skeleton-title"></span>
            <span class="skeleton-line skeleton-value"></span>
          </article>
        `
        )
        .join("")}
    </div>
  `;
}

function setDynamicValueLoading(isLoading) {
  const selectors = [
    "#heroDistanceValue",
    "#heroScoreValue",
    ".js-inactive-value",
    ".period-primary",
    ".period-line strong",
    ".highlight-big",
    ".session-distance",
    ".session-value",
  ];
  document.querySelectorAll(selectors.join(",")).forEach((el) => {
    el.classList.toggle("value-loading", isLoading);
  });
}

function setLoadingState(isLoading) {
  refreshBtn.classList.toggle("is-loading", isLoading);
  refreshBtn.disabled = isLoading;
  chartWrapEls.forEach((panel) => panel.classList.toggle("panel-loading", isLoading));
  if (isLoading) {
    if (!dashboardData) {
      ensureLoadingHero();
      ensureLoadingCards();
      ensureLoadingSessions();
      ensureLoadingPeriodSummary();
      ensureLoadingMonthlyReport();
    } else {
      setDynamicValueLoading(true);
    }
  } else {
    setDynamicValueLoading(false);
  }
}

function buildPeriodSelector(periods) {
  periodSelectorEl.innerHTML = "";
  periodOrder.forEach((periodKey) => {
    if (!periods[periodKey]) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `period-btn${selectedPeriod === periodKey ? " active" : ""}`;
    button.textContent = periodLabels[periodKey];
    button.addEventListener("click", () => {
      selectedPeriod = periodKey;
      renderPeriodDependentViews();
    });
    periodSelectorEl.appendChild(button);
  });
}

function buildHero(periodKpis, inactivitySeconds, series) {
  const status = sessionStatus(periodKpis.topSpeedKmh);
  const distancePct = ringPercent(periodKpis.distanceM, 300);
  const activityPct = ringPercent(periodKpis.activeSeconds, 1800);
  const sessionsPct = ringPercent(periodKpis.sessionsCount, 10);

  heroEl.innerHTML = `
    <div class="hero-layout">
      <div class="hero-left">
        <div class="hero-kicker"><i class="fa-solid fa-cat"></i> Jasper • Cat Wheel</div>
        <h2>${heroSubtitle(periodKpis.activeSeconds)}</h2>
        <div class="hero-distance"><span id="heroDistanceValue"></span></div>
        <div class="hero-label">Distanz ${selectedPeriod === "today" ? "heute" : periodLabels[selectedPeriod].toLowerCase()}</div>
        <div class="hero-meta">
          <span>• ${formatDuration(periodKpis.activeSeconds)} aktiv</span>
          <span>• ${fmt(periodKpis.sessionsCount)} Sessions</span>
          <span>• ${fmt(periodKpis.zoomies)} Zoomies</span>
        </div>
        <div class="hero-hint">${buildInsightMessage(periodKpis, series)}</div>
      </div>
      <div class="hero-right">
        <div class="multi-ring">
          <div class="ring ring-distance" style="--p:${distancePct}"></div>
          <div class="ring ring-activity" style="--p:${activityPct}"></div>
          <div class="ring ring-sessions" style="--p:${sessionsPct}"></div>
          <div class="ring-center">
            <div class="ring-score" id="heroScoreValue"></div>
            <div class="ring-score-label">Score</div>
          </div>
        </div>
        <div class="hero-status"><span class="status-dot ${status.className}"></span>${status.text}</div>
        <div class="hero-inactive">Inaktiv seit <span class="js-inactive-value">${formatDuration(inactivitySeconds)}</span></div>
      </div>
    </div>
  `;

  const heroDistanceEl = document.getElementById("heroDistanceValue");
  const heroScoreEl = document.getElementById("heroScoreValue");
  const prevDistance = valueState.get("heroDistance") ?? periodKpis.distanceM;
  const prevScore = valueState.get("heroScore") ?? periodKpis.catAthleteScore;
  animateValue(prevDistance, periodKpis.distanceM, 750, (v) => {
    heroDistanceEl.textContent = formatDistance(v);
  });
  animateValue(prevScore, periodKpis.catAthleteScore, 750, (v) => {
    heroScoreEl.textContent = `${Math.round(v)}/100`;
  });
  const ringEl = heroEl.querySelector(".multi-ring");
  if (ringEl) {
    ringEl.classList.remove("ring-refresh");
    // Restart animation on each refresh.
    void ringEl.offsetWidth;
    ringEl.classList.add("ring-refresh");
  }
  valueState.set("heroDistance", periodKpis.distanceM);
  valueState.set("heroScore", periodKpis.catAthleteScore);
}

function buildCards(periodKpis) {
  cardsEl.innerHTML = "";
  const cards = [
    { key: "distanceM", icon: "fa-solid fa-route", label: "Distanz", value: periodKpis.distanceM, formatter: formatDistance, tone: "tone-mint" },
    { key: "activeSeconds", icon: "fa-solid fa-clock", label: "Aktivzeit", value: periodKpis.activeSeconds, formatter: formatDuration, tone: "tone-sky" },
    { key: "zoomies", icon: "fa-solid fa-bolt", label: "Zoomies", value: periodKpis.zoomies, formatter: (v) => fmt(v), tone: "tone-peach" },
    { key: "topSpeedKmh", icon: "fa-solid fa-gauge-high", label: "Top-Speed", value: periodKpis.topSpeedKmh, formatter: (v) => fmt(v, " km/h"), tone: "tone-lavender" },
  ];
  cards.forEach((cardConfig) => {
    const card = document.createElement("article");
    card.className = `kpi-card ${cardConfig.tone}`;
    card.innerHTML = `<h3><span class="mini-icon"><i class="${cardConfig.icon}" aria-hidden="true"></i></span> ${cardConfig.label}</h3><strong></strong>`;
    const valueEl = card.querySelector("strong");
    const previous = valueState.get(cardConfig.key) ?? cardConfig.value;
    animateValue(previous, cardConfig.value, 650, (v) => {
      valueEl.textContent = cardConfig.formatter(v);
    });
    valueState.set(cardConfig.key, cardConfig.value);
    cardsEl.appendChild(card);
  });
}

function buildPeriodSummary(periods) {
  periodSummaryEl.innerHTML = `
    <div class="period-cards">
      ${periodOrder
        .filter((key) => periods[key])
        .map((key) => {
          const p = periods[key];
          return `
            <article class="period-card ${selectedPeriod === key ? "active" : ""}">
              <h3>${periodLabels[key]}</h3>
              <div class="period-primary">${formatDistance(p.distanceM)}</div>
              <div class="period-line"><span>Aktivzeit</span><strong>${formatDuration(p.activeSeconds)}</strong></div>
              <div class="period-line"><span>Zoomies</span><strong>${fmt(p.zoomies)}</strong></div>
              <div class="period-line"><span>Top-Speed</span><strong>${fmt(p.topSpeedKmh, " km/h")}</strong></div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function buildMonthlyReport(report) {
  const fmtDay = (day) => (day ? new Date(day).toLocaleDateString("de-DE") : "-");
  const highlights = [
    {
      icon: "fa-solid fa-trophy",
      iconClass: "icon-mint",
      big: report.highlights.bestDay ? formatDistance(report.highlights.bestDay.distanceM) : "-",
      title: "Bester Tag",
      meta: report.highlights.bestDay ? fmtDay(report.highlights.bestDay.day) : "",
    },
    {
      icon: "fa-solid fa-gauge-high",
      iconClass: "icon-sky",
      big: report.highlights.fastestSession ? fmt(report.highlights.fastestSession.maxKmh, " km/h") : "-",
      title: "Schnellste Session",
      meta: report.highlights.fastestSession ? new Date(report.highlights.fastestSession.time).toLocaleDateString("de-DE") : "",
    },
    {
      icon: "fa-solid fa-hourglass-half",
      iconClass: "icon-lavender",
      big: report.highlights.longestSession ? formatDuration(report.highlights.longestSession.durationS) : "-",
      title: "Längste Session",
      meta: report.highlights.longestSession ? new Date(report.highlights.longestSession.time).toLocaleDateString("de-DE") : "",
    },
    {
      icon: "fa-solid fa-ruler-horizontal",
      iconClass: "icon-peach",
      big: report.highlights.longestDistanceSession ? formatDistance(report.highlights.longestDistanceSession.distanceM) : "-",
      title: "Längste Distanz",
      meta: report.highlights.longestDistanceSession ? new Date(report.highlights.longestDistanceSession.time).toLocaleDateString("de-DE") : "",
    },
    {
      icon: "fa-solid fa-moon",
      iconClass: "icon-rose",
      big: report.highlights.mostActiveHour ? `${String(report.highlights.mostActiveHour.hour).padStart(2, "0")}:00` : "-",
      title: "Aktivste Stunde",
      meta: "",
    },
    {
      icon: "fa-solid fa-arrows-rotate",
      iconClass: "icon-yellow",
      big: fmt(report.totals.sessions),
      title: "Sessions gesamt",
      meta: "",
    },
  ];
  monthlyReportEl.innerHTML = `
    <div class="report-grid">
      ${highlights
        .map(
          (item) => `
          <article class="highlight-card">
            <div class="highlight-icon ${item.iconClass}"><i class="${item.icon}" aria-hidden="true"></i></div>
            <div class="highlight-big">${item.big}</div>
            <div class="highlight-title">${item.title}</div>
            <div class="highlight-meta">${item.meta}</div>
          </article>
        `
        )
        .join("")}
    </div>
  `;
}

function gradientFill(ctx, color) {
  const { chart } = ctx;
  const { chartArea } = chart;
  if (!chartArea) return color;
  const gradient = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  return gradient;
}

function upsertChart(id, config) {
  if (chartRefs[id]) chartRefs[id].destroy();
  chartRefs[id] = new Chart(document.getElementById(id), {
    ...config,
    options: {
      ...makeChartOptions(),
      ...(config.options || {}),
    },
  });
}

function buildCharts(series) {
  upsertChart("speedChart", {
    type: "line",
    data: {
      labels: series.speedSeries.map((p) => timeLabel(p.time)),
      datasets: [
        {
          label: "km/h",
          data: series.speedSeries.map((p) => p.value),
          borderColor: "#A7D2FF",
          backgroundColor: (ctx) => gradientFill(ctx, "rgba(167, 210, 255, 0.32)"),
          fill: true,
          tension: 0.3,
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 2,
        },
      ],
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 8 } } } },
  });

  const distanceValuesMeters = series.distanceSeries.map((p) => p.value);
  const useKilometers = Math.max(...distanceValuesMeters, 0) >= 1000;
  const divisor = useKilometers ? 1000 : 1;
  upsertChart("distanceChart", {
    type: "bar",
    data: {
      labels: series.distanceSeries.map((p) => dayLabel(p.day)),
      datasets: [
        {
          label: useKilometers ? "Kilometer" : "Meter",
          data: distanceValuesMeters.map((v) => v / divisor),
          backgroundColor: "rgba(158, 216, 181, 0.52)",
          borderColor: "rgba(158, 216, 181, 0.92)",
          borderWidth: 1,
          borderRadius: 10,
          borderSkipped: false,
        },
      ],
    },
  });

  upsertChart("zoomiesChart", {
    type: "line",
    data: {
      labels: series.zoomiesSeries.map((p) => dayLabel(p.day)),
      datasets: [
        {
          label: "Zoomies",
          data: series.zoomiesSeries.map((p) => p.value),
          borderColor: "#F6C8A9",
          backgroundColor: (ctx) => gradientFill(ctx, "rgba(246, 200, 169, 0.25)"),
          fill: true,
          tension: 0.25,
          borderWidth: 3,
          pointRadius: 0,
          pointHoverRadius: 2,
        },
      ],
    },
  });

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const found = series.activityByHour.find((item) => Number(item.hour) === hour);
    return found ? found.value : 0;
  });
  upsertChart("hourChart", {
    type: "bar",
    data: {
      labels: hourly.map((_, i) => `${String(i).padStart(2, "0")}:00`),
      datasets: [
        {
          label: "Aktive Samples",
          data: hourly,
          backgroundColor: "rgba(202, 184, 255, 0.58)",
          borderColor: "rgba(202, 184, 255, 0.95)",
          borderWidth: 1,
          borderRadius: 10,
          borderSkipped: false,
        },
      ],
    },
    options: { scales: { x: { ticks: { maxTicksLimit: 6 } } } },
  });
}

function buildSessions(sessions) {
  if (!sessions.length) {
    sessionsEl.textContent = "Noch keine beendeten Sessions gefunden.";
    return;
  }
  const maxSpeed = Math.max(...sessions.map((s) => s.maxKmh), 0.1);
  sessionsEl.innerHTML = `
    <div class="session-list">
      ${sessions
        .map((s) => {
          const status = sessionStatus(s.maxKmh);
          const avgKmh = averageSpeedKmh(s.distanceM, s.durationS);
          const speedPercent = Math.min(100, Math.round((s.maxKmh / maxSpeed) * 100));
          return `
            <article class="session-item">
              <div class="session-head">
                <div class="session-id"><i class="fa-solid fa-paw" aria-hidden="true"></i> Session #${s.sessionId || "-"}</div>
                <div class="session-time">${new Date(s.time).toLocaleString("de-DE")}</div>
              </div>
              <div class="session-distance">${formatDistance(s.distanceM)}</div>
              <div class="session-metric"><span class="session-label">Dauer</span> <span class="session-value">${formatDuration(s.durationS)}</span></div>
              <div class="session-metric"><span class="session-label">Ø</span> <span class="session-value">${fmt(avgKmh, " km/h")}</span> <span class="session-sep">·</span> <span class="session-label">Max</span> <span class="session-value">${fmt(s.maxKmh, " km/h")}</span></div>
              <div class="session-divider"></div>
              <div class="session-badge ${status.className}">${status.text}</div>
              <div class="session-progress"><span style="width:${speedPercent}%"></span></div>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPeriodDependentViews() {
  if (!dashboardData) return;
  const periodKpis = dashboardData.periods[selectedPeriod];
  buildHero(periodKpis, dashboardData.inactivitySeconds, dashboardData.series);
  buildPeriodSelector(dashboardData.periods);
  buildCards(periodKpis);
  buildPeriodSummary(dashboardData.periods);
}

async function loadDashboard() {
  setLoadingState(true);
  try {
    const response = await fetch("/api/dashboard");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Dashboard konnte nicht geladen werden.");

    dashboardData = data;
    selectedPeriod = data.selectedPeriod || "today";

    renderPeriodDependentViews();
    buildMonthlyReport(data.monthlyReport);
    buildCharts(data.series);
    buildSessions(data.recentSessions);
  } finally {
    setLoadingState(false);
  }
}

refreshBtn.addEventListener("click", () => {
  loadDashboard().catch((error) => {
    sessionsEl.textContent = error.message;
  });
});

loadDashboard().catch((error) => {
  sessionsEl.textContent = error.message;
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch((error) => {
      console.error("Service Worker konnte nicht registriert werden:", error);
    });
  });
}
