const cardsEl = document.getElementById("cards");
const sessionsEl = document.getElementById("sessions");
const refreshBtn = document.getElementById("refreshBtn");
const periodSelectorEl = document.getElementById("periodSelector");
const periodSummaryEl = document.getElementById("periodSummary");
const monthlyReportEl = document.getElementById("monthlyReport");

const chartRefs = {};
const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

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

function fmt(value, unit = "") {
  return `${numberFormatter.format(Number(value || 0))}${unit}`;
}

function formatDistance(metersInput) {
  const meters = Number(metersInput || 0);
  if (Math.abs(meters) >= 1000) {
    return `${numberFormatter.format(meters / 1000)} km`;
  }
  return `${numberFormatter.format(meters)} m`;
}

function formatDuration(secondsInput) {
  const seconds = Math.max(0, Math.floor(Number(secondsInput || 0)));
  if (seconds < 60) {
    return `${seconds} Sek`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)} Min`;
  }
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h} Std ${m} Min` : `${h} Std`;
  }
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  return h > 0 ? `${d} Tg ${h} Std` : `${d} Tg`;
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
    plugins: {
      legend: {
        labels: {
          color: "#d7dde7",
          font: { family: "Segoe UI, Roboto, Helvetica, Arial, sans-serif", size: 12 },
        },
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(255,255,255,0.05)" },
        ticks: {
          color: "#a8b1bf",
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 8,
          font: { family: "Segoe UI, Roboto, Helvetica, Arial, sans-serif", size: 11 },
        },
      },
      y: {
        grid: { color: "rgba(255,255,255,0.05)" },
        ticks: {
          color: "#a8b1bf",
          font: { family: "Segoe UI, Roboto, Helvetica, Arial, sans-serif", size: 11 },
        },
      },
    },
  };
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

function buildCards(periodKpis, inactivitySeconds) {
  cardsEl.innerHTML = "";
  const cards = [
    ["Distanz", formatDistance(periodKpis.distanceM)],
    ["Umdrehungen", fmt(periodKpis.rotations)],
    ["Aktivzeit", formatDuration(periodKpis.activeSeconds)],
    ["Sessions", fmt(periodKpis.sessionsCount)],
    ["Zoomies", fmt(periodKpis.zoomies)],
    ["Top-Speed", fmt(periodKpis.topSpeedKmh, " km/h")],
    ["Score", `${periodKpis.catAthleteScore}/100`],
    ["Inaktiv seit", formatDuration(inactivitySeconds)],
  ];

  cards.forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<h3>${label}</h3><strong>${value}</strong>`;
    cardsEl.appendChild(card);
  });
}

function buildPeriodSummary(periods) {
  const rows = periodOrder
    .filter((key) => periods[key])
    .map((key) => {
      const p = periods[key];
      return `
        <tr>
          <td>${periodLabels[key]}</td>
          <td>${formatDistance(p.distanceM)}</td>
          <td>${fmt(p.rotations)}</td>
          <td>${formatDuration(p.activeSeconds)}</td>
          <td>${fmt(p.zoomies)}</td>
          <td>${fmt(p.topSpeedKmh, " km/h")}</td>
        </tr>
      `;
    })
    .join("");

  periodSummaryEl.innerHTML = `
    <table class="period-table">
      <thead>
        <tr>
          <th>Zeitraum</th>
          <th>Distanz</th>
          <th>Umdrehungen</th>
          <th>Aktivzeit</th>
          <th>Zoomies</th>
          <th>Top-Speed</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function buildMonthlyReport(report) {
  const fmtDay = (day) => (day ? new Date(day).toLocaleDateString("de-DE") : "-");
  const fmtSessionTime = (iso) => (iso ? new Date(iso).toLocaleString("de-DE") : "-");
  monthlyReportEl.innerHTML = `
    <div class="report-grid">
      <div class="report-item">
        <div class="label">Zeitraum</div>
        <strong>${fmtDay(report.range.start)} - ${fmtDay(report.range.stop)}</strong>
      </div>
      <div class="report-item">
        <div class="label">Gesamtdistanz</div>
        <strong>${formatDistance(report.totals.totalDistanceM)}</strong>
      </div>
      <div class="report-item">
        <div class="label">Gesamtaktivität</div>
        <strong>${formatDuration(report.totals.activitySeconds)}</strong>
      </div>
      <div class="report-item">
        <div class="label">Sessions gesamt</div>
        <strong>${report.totals.sessions}</strong>
      </div>
      <div class="report-item">
        <div class="label">Bester Tag</div>
        <strong>${report.highlights.bestDay ? `${fmtDay(report.highlights.bestDay.day)} (${formatDistance(report.highlights.bestDay.distanceM)})` : "-"}</strong>
      </div>
      <div class="report-item">
        <div class="label">Schnellste Session</div>
        <strong>${report.highlights.fastestSession ? `${fmt(report.highlights.fastestSession.maxKmh, " km/h")} (${fmtSessionTime(report.highlights.fastestSession.time)})` : "-"}</strong>
      </div>
      <div class="report-item">
        <div class="label">Längste Session</div>
        <strong>${report.highlights.longestSession ? `${formatDuration(report.highlights.longestSession.durationS)} (${fmtSessionTime(report.highlights.longestSession.time)})` : "-"}</strong>
      </div>
      <div class="report-item">
        <div class="label">Längste Distanz in einer Session</div>
        <strong>${report.highlights.longestDistanceSession ? `${formatDistance(report.highlights.longestDistanceSession.distanceM)} (${fmtSessionTime(report.highlights.longestDistanceSession.time)})` : "-"}</strong>
      </div>
      <div class="report-item">
        <div class="label">Aktivste Stunde</div>
        <strong>${report.highlights.mostActiveHour ? `${String(report.highlights.mostActiveHour.hour).padStart(2, "0")}:00` : "-"}</strong>
      </div>
    </div>
  `;
}

function upsertChart(id, config) {
  if (chartRefs[id]) {
    chartRefs[id].destroy();
  }
  const mergedConfig = {
    ...config,
    options: {
      ...makeChartOptions(),
      ...(config.options || {}),
    },
  };
  chartRefs[id] = new Chart(document.getElementById(id), mergedConfig);
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
          borderColor: "#5ec4ff",
          tension: 0.25,
          borderWidth: 2,
          pointRadius: 0,
        },
      ],
    },
  });

  const distanceValuesMeters = series.distanceSeries.map((p) => p.value);
  const useKilometers = Math.max(...distanceValuesMeters, 0) >= 1000;
  const distanceScaleDivisor = useKilometers ? 1000 : 1;

  upsertChart("distanceChart", {
    type: "bar",
    data: {
      labels: series.distanceSeries.map((p) => dayLabel(p.day)),
      datasets: [
        {
          label: useKilometers ? "Kilometer" : "Meter",
          data: distanceValuesMeters.map((v) => v / distanceScaleDivisor),
          backgroundColor: "#7de0a099",
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
          borderColor: "#8e9cff",
          tension: 0.2,
          borderWidth: 2,
          pointRadius: 0,
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
      datasets: [{ label: "Läufe", data: hourly, backgroundColor: "#5ec4ff88" }],
    },
  });
}

function buildSessions(sessions) {
  if (!sessions.length) {
    sessionsEl.textContent = "Noch keine beendeten Sessions gefunden.";
    return;
  }

  const list = document.createElement("div");
  list.className = "session-list";

  sessions.forEach((s) => {
    const hype = s.maxKmh > 4 ? "Turbo-Pfoten" : s.maxKmh > 2 ? "Stabiles Cardio" : "Lockerer Trab";
    const item = document.createElement("div");
    item.className = "session-item";
    item.innerHTML = `
      <div><strong>Session ${s.sessionId || "-"}</strong></div>
      <div class="meta">${new Date(s.time).toLocaleString("de-DE")}</div>
      <div>${formatDistance(s.distanceM)} in ${formatDuration(s.durationS)}</div>
      <div>Spitze: ${fmt(s.maxKmh, " km/h")}</div>
      <div class="score">${hype}</div>
    `;
    list.appendChild(item);
  });

  sessionsEl.innerHTML = "";
  sessionsEl.appendChild(list);
}

function renderPeriodDependentViews() {
  if (!dashboardData) return;
  buildPeriodSelector(dashboardData.periods);
  buildCards(dashboardData.periods[selectedPeriod], dashboardData.inactivitySeconds);
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Dashboard konnte nicht geladen werden.");
  }

  dashboardData = data;
  selectedPeriod = data.selectedPeriod || "today";

  renderPeriodDependentViews();
  buildPeriodSummary(data.periods);
  buildMonthlyReport(data.monthlyReport);
  buildCharts(data.series);
  buildSessions(data.recentSessions);
}

refreshBtn.addEventListener("click", () => {
  refreshBtn.disabled = true;
  loadDashboard()
    .catch((error) => {
      sessionsEl.textContent = error.message;
    })
    .finally(() => {
      refreshBtn.disabled = false;
    });
});

loadDashboard().catch((error) => {
  sessionsEl.textContent = error.message;
});
