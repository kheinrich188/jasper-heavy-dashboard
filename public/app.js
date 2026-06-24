const cardsEl = document.getElementById("cards");
const sessionsEl = document.getElementById("sessions");
const refreshBtn = document.getElementById("refreshBtn");

const chartRefs = {};
const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function fmt(value, unit = "") {
  return `${numberFormatter.format(Number(value || 0))}${unit}`;
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

function buildCards(overview) {
  cardsEl.innerHTML = "";
  const cards = [
    ["Distanz heute", fmt(overview.dailyDistanceM, " m")],
    ["Umdrehungen heute", fmt(overview.dailyRotations)],
    ["Top-Speed (30 Tage)", fmt(overview.topSpeedKmh, " km/h")],
    ["Zoomies heute", fmt(overview.dailyZoomies)],
    ["Zoomies Index", fmt(overview.dailyZoomiesIndex)],
    ["Gesamtaktivität heute", formatDuration(overview.dailyActiveSeconds)],
    ["Inaktiv seit", formatDuration(overview.inactivitySeconds)],
    ["Score", `${overview.catAthleteScore}/100`],
  ];

  cards.forEach(([label, value]) => {
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `<h3>${label}</h3><strong>${value}</strong>`;
    cardsEl.appendChild(card);
  });
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

  upsertChart("distanceChart", {
    type: "bar",
    data: {
      labels: series.distanceSeries.map((p) => dayLabel(p.day)),
      datasets: [
        { label: "Meter", data: series.distanceSeries.map((p) => p.value), backgroundColor: "#7de0a099" },
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
      <div>${fmt(s.distanceM, " m")} in ${formatDuration(s.durationS)}</div>
      <div>Spitze: ${fmt(s.maxKmh, " km/h")}</div>
      <div class="score">${hype}</div>
    `;
    list.appendChild(item);
  });

  sessionsEl.innerHTML = "";
  sessionsEl.appendChild(list);
}

async function loadDashboard() {
  const response = await fetch("/api/dashboard");
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Dashboard konnte nicht geladen werden.");
  }
  buildCards(data.overview);
  buildCharts(data.series);
  buildSessions(data.recentSessions);
}

refreshBtn.addEventListener("click", () => {
  refreshBtn.disabled = true;
  loadDashboard().catch((error) => {
    sessionsEl.textContent = error.message;
  }).finally(() => {
    refreshBtn.disabled = false;
  });
});

loadDashboard().catch((error) => {
  sessionsEl.textContent = error.message;
});
