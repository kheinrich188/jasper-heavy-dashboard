const path = require("path");
const express = require("express");
const dotenv = require("dotenv");
const { InfluxDB } = require("@influxdata/influxdb-client");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const influxConfig = {
  url: process.env.INFLUX_BASE_URL,
  token: process.env.INFLUX_TOKEN,
  org: process.env.INFLUX_ORG,
  bucket: process.env.INFLUX_BUCKET,
  device: process.env.INFLUX_DEVICE || "heltec_v3",
  direction: process.env.INFLUX_DIRECTION || "clockwise",
};

function areInfluxEnvVarsPresent() {
  return Boolean(
    influxConfig.url &&
      influxConfig.token &&
      influxConfig.org &&
      influxConfig.bucket
  );
}

function createTagFilter() {
  const filters = [];
  if (influxConfig.device) {
    filters.push(`r.device == "${influxConfig.device.replace(/"/g, '\\"')}"`);
  }
  if (influxConfig.direction) {
    filters.push(`r.direction == "${influxConfig.direction.replace(/"/g, '\\"')}"`);
  }
  return filters.length ? `|> filter(fn: (r) => ${filters.join(" and ")})` : "";
}

const influx = areInfluxEnvVarsPresent() ? new InfluxDB({ url: influxConfig.url, token: influxConfig.token }) : null;
const queryApi = influx ? influx.getQueryApi(influxConfig.org) : null;
const tagFilter = createTagFilter();

function parseNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

async function runRowsQuery(query) {
  if (!queryApi) {
    throw new Error("InfluxDB-Umgebungsvariablen fehlen.");
  }
  return queryApi.collectRows(query);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getPeriodRanges(now = new Date()) {
  const todayStart = startOfDay(now);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 6);
  const monthStart = startOfMonth(now);
  const totalStart = new Date("1970-01-01T00:00:00.000Z");
  const lastMonthStart = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
  const lastMonthEnd = monthStart;

  return {
    today: { start: todayStart, stop: now },
    yesterday: { start: yesterdayStart, stop: todayStart },
    week: { start: weekStart, stop: now },
    month: { start: monthStart, stop: now },
    total: { start: totalStart, stop: now },
    lastMonth: { start: lastMonthStart, stop: lastMonthEnd },
  };
}

function fluxRange(start, stop) {
  return `|> range(start: time(v: "${start.toISOString()}"), stop: time(v: "${stop.toISOString()}"))`;
}

async function fetchMaxSpeedInRange(start, stop) {
  const query = `
from(bucket: "${influxConfig.bucket}")
  ${fluxRange(start, stop)}
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "speed_kmh")
  |> max()
`;
  const [row] = await runRowsQuery(query);
  return parseNum(row?._value);
}

async function fetchLastInactivitySeconds() {
  const inactivityFieldQuery = `
from(bucket: "${influxConfig.bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "inactivity_duration_s")
  |> last()
`;
  const lastActivityQuery = `
from(bucket: "${influxConfig.bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "speed_kmh")
  |> filter(fn: (r) => r._value > 0.2)
  |> last()
  |> keep(columns: ["_time"])
`;

  const [inactivityRow, lastActivityRow] = await Promise.all([
    runRowsQuery(inactivityFieldQuery),
    runRowsQuery(lastActivityQuery),
  ]);

  const inactivityFromField = parseNum(inactivityRow?.[0]?._value);
  const lastActivityTime = lastActivityRow?.[0]?._time ? new Date(lastActivityRow[0]._time).getTime() : NaN;
  const inactivityFromLastActivity =
    Number.isFinite(lastActivityTime) && lastActivityTime > 0
      ? Math.max(0, Math.floor((Date.now() - lastActivityTime) / 1000))
      : 0;

  return Math.max(inactivityFromField, inactivityFromLastActivity);
}

async function fetchActivitySecondsInRange(start, stop) {
  const query = `
from(bucket: "${influxConfig.bucket}")
  ${fluxRange(start, stop)}
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "speed_kmh")
  |> aggregateWindow(every: 1m, fn: max, createEmpty: false)
  |> filter(fn: (r) => r._value > 0.2)
  |> count(column: "_value")
  |> keep(columns: ["_value"])
`;
  const [row] = await runRowsQuery(query);
  return Math.max(0, parseNum(row?._value) * 60);
}

async function fetchSessionsInRange(start, stop, limit = null) {
  const limitPart = Number.isFinite(limit) ? `|> limit(n: ${Math.max(1, Math.floor(limit))})` : "";
  const query = `
from(bucket: "${influxConfig.bucket}")
  ${fluxRange(start, stop)}
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "session_ended" or r._field == "session_id" or r._field == "session_duration_s" or r._field == "session_distance_m" or r._field == "session_max_kmh" or r._field == "session_rotations" or r._field == "zoomies")
  |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
  |> filter(fn: (r) => exists r.session_ended and r.session_ended == 1)
  |> keep(columns: ["_time", "session_id", "session_duration_s", "session_distance_m", "session_max_kmh", "session_rotations", "zoomies"])
  |> sort(columns: ["_time"], desc: true)
  ${limitPart}
`;
  const rows = await runRowsQuery(query);
  return rows.map((r) => ({
    time: r._time,
    sessionId: String(r.session_id || ""),
    durationS: parseNum(r.session_duration_s),
    distanceM: parseNum(r.session_distance_m),
    maxKmh: parseNum(r.session_max_kmh),
    rotations: parseNum(r.session_rotations),
    zoomies: parseNum(r.zoomies),
  }));
}

async function fetchMostActiveHourInRange(start, stop) {
  const query = `
import "date"

from(bucket: "${influxConfig.bucket}")
  ${fluxRange(start, stop)}
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "speed_kmh")
  |> filter(fn: (r) => r._value > 0.2)
  |> map(fn: (r) => ({ r with hour: date.hour(t: r._time) }))
  |> group(columns: ["hour"])
  |> count(column: "_value")
  |> keep(columns: ["hour", "_value"])
  |> sort(columns: ["_value"], desc: true)
  |> limit(n: 1)
`;
  const [row] = await runRowsQuery(query);
  return row ? { hour: parseNum(row.hour), samples: parseNum(row._value) } : null;
}

async function fetchPeriodKpis(start, stop) {
  const [sessions, topSpeedKmh, activeSeconds] = await Promise.all([
    fetchSessionsInRange(start, stop),
    fetchMaxSpeedInRange(start, stop),
    fetchActivitySecondsInRange(start, stop),
  ]);

  const distanceM = sessions.reduce((sum, s) => sum + s.distanceM, 0);
  const rotations = sessions.reduce((sum, s) => sum + s.rotations, 0);
  const zoomies = sessions.reduce((sum, s) => sum + (s.zoomies >= 1 ? 1 : 0), 0);
  const sessionsCount = sessions.length;
  const catAthleteScore = Math.round(Math.min(100, distanceM / 2 + topSpeedKmh * 10 + zoomies * 8));

  return {
    distanceM,
    rotations,
    topSpeedKmh,
    zoomies,
    activeSeconds,
    sessionsCount,
    catAthleteScore,
  };
}

async function fetchLastMonthReport(lastMonthRange) {
  const [sessions, activitySeconds, mostActiveHour] = await Promise.all([
    fetchSessionsInRange(lastMonthRange.start, lastMonthRange.stop),
    fetchActivitySecondsInRange(lastMonthRange.start, lastMonthRange.stop),
    fetchMostActiveHourInRange(lastMonthRange.start, lastMonthRange.stop),
  ]);

  const totalDistanceM = sessions.reduce((sum, s) => sum + s.distanceM, 0);
  const totalRotations = sessions.reduce((sum, s) => sum + s.rotations, 0);
  const totalZoomies = sessions.reduce((sum, s) => sum + (s.zoomies >= 1 ? 1 : 0), 0);
  const fastestSession = sessions.reduce((best, s) => (s.maxKmh > (best?.maxKmh || 0) ? s : best), null);
  const longestSession = sessions.reduce((best, s) => (s.durationS > (best?.durationS || 0) ? s : best), null);
  const longestDistanceSession = sessions.reduce((best, s) => (s.distanceM > (best?.distanceM || 0) ? s : best), null);

  const sessionsByDay = sessions.reduce((acc, s) => {
    const day = new Date(s.time).toISOString().slice(0, 10);
    acc[day] = (acc[day] || 0) + s.distanceM;
    return acc;
  }, {});

  const bestDayEntry = Object.entries(sessionsByDay).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    range: {
      start: lastMonthRange.start.toISOString(),
      stop: lastMonthRange.stop.toISOString(),
    },
    totals: {
      sessions: sessions.length,
      totalDistanceM,
      totalRotations,
      totalZoomies,
      activitySeconds,
    },
    highlights: {
      bestDay: bestDayEntry ? { day: bestDayEntry[0], distanceM: bestDayEntry[1] } : null,
      fastestSession: fastestSession
        ? { time: fastestSession.time, sessionId: fastestSession.sessionId, maxKmh: fastestSession.maxKmh }
        : null,
      longestSession: longestSession
        ? { time: longestSession.time, sessionId: longestSession.sessionId, durationS: longestSession.durationS }
        : null,
      longestDistanceSession: longestDistanceSession
        ? { time: longestDistanceSession.time, sessionId: longestDistanceSession.sessionId, distanceM: longestDistanceSession.distanceM }
        : null,
      mostActiveHour,
    },
  };
}

async function fetchSpeedSeries() {
  const query = `
from(bucket: "${influxConfig.bucket}")
  |> range(start: -24h)
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "speed_kmh")
  |> aggregateWindow(every: 10m, fn: max, createEmpty: false)
  |> keep(columns: ["_time", "_value"])
  |> sort(columns: ["_time"], desc: false)
`;
  const rows = await runRowsQuery(query);
  return rows.map((r) => ({
    time: r._time,
    value: parseNum(r._value),
  }));
}

async function fetchDailyDistanceSeries() {
  const query = `
from(bucket: "${influxConfig.bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "daily_distance_m")
  |> aggregateWindow(every: 1d, fn: max, createEmpty: false)
  |> keep(columns: ["_time", "_value"])
  |> sort(columns: ["_time"], desc: false)
`;
  const rows = await runRowsQuery(query);
  return rows.map((r) => ({
    day: r._time,
    value: parseNum(r._value),
  }));
}

async function fetchZoomiesSeries() {
  const query = `
from(bucket: "${influxConfig.bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "daily_zoomies")
  |> aggregateWindow(every: 1d, fn: max, createEmpty: false)
  |> keep(columns: ["_time", "_value"])
  |> sort(columns: ["_time"], desc: false)
`;
  const rows = await runRowsQuery(query);
  return rows.map((r) => ({
    day: r._time,
    value: parseNum(r._value),
  }));
}

async function fetchActivityByHour() {
  const query = `
import "date"

from(bucket: "${influxConfig.bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "speed_kmh")
  |> filter(fn: (r) => r._value > 0.2)
  |> map(fn: (r) => ({ r with hour: date.hour(t: r._time) }))
  |> group(columns: ["hour"])
  |> count(column: "_value")
  |> keep(columns: ["hour", "_value"])
  |> sort(columns: ["hour"], desc: false)
`;
  const rows = await runRowsQuery(query);
  return rows.map((r) => ({
    hour: parseNum(r.hour),
    value: parseNum(r._value),
  }));
}

async function fetchRecentSessions() {
  const query = `
from(bucket: "${influxConfig.bucket}")
  |> range(start: -30d)
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "session_ended" or r._field == "session_id" or r._field == "session_duration_s" or r._field == "session_distance_m" or r._field == "session_max_kmh")
  |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
  |> filter(fn: (r) => exists r.session_ended and r.session_ended == 1)
  |> keep(columns: ["_time", "session_id", "session_duration_s", "session_distance_m", "session_max_kmh"])
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 8)
`;
  const rows = await runRowsQuery(query);
  return rows.map((r) => ({
    time: r._time,
    sessionId: String(r.session_id || ""),
    durationS: parseNum(r.session_duration_s),
    distanceM: parseNum(r.session_distance_m),
    maxKmh: parseNum(r.session_max_kmh),
  }));
}

app.get("/api/dashboard", async (_req, res) => {
  if (!areInfluxEnvVarsPresent()) {
    res.status(500).json({
      error: "Influx ist nicht konfiguriert. Bitte INFLUX_BASE_URL, INFLUX_ORG, INFLUX_BUCKET und INFLUX_TOKEN setzen.",
    });
    return;
  }

  try {
    const ranges = getPeriodRanges();
    const [inactivitySeconds, speedSeries, distanceSeries, zoomiesSeries, activityByHour, recentSessions, periodToday, periodYesterday, periodWeek, periodMonth, periodTotal, lastMonthReport] =
      await Promise.all([
        fetchLastInactivitySeconds(),
        fetchSpeedSeries(),
        fetchDailyDistanceSeries(),
        fetchZoomiesSeries(),
        fetchActivityByHour(),
        fetchSessionsInRange(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30), new Date(), 8),
        fetchPeriodKpis(ranges.today.start, ranges.today.stop),
        fetchPeriodKpis(ranges.yesterday.start, ranges.yesterday.stop),
        fetchPeriodKpis(ranges.week.start, ranges.week.stop),
        fetchPeriodKpis(ranges.month.start, ranges.month.stop),
        fetchPeriodKpis(ranges.total.start, ranges.total.stop),
        fetchLastMonthReport(ranges.lastMonth),
      ]);

    res.json({
      selectedPeriod: "today",
      periods: {
        today: periodToday,
        yesterday: periodYesterday,
        week: periodWeek,
        month: periodMonth,
        total: periodTotal,
      },
      inactivitySeconds,
      series: {
        speedSeries,
        distanceSeries,
        zoomiesSeries,
        activityByHour,
      },
      recentSessions,
      monthlyReport: lastMonthReport,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Dashboard-Daten konnten nicht geladen werden.",
    });
  }
});

const publicDir = path.join(__dirname, "public");

app.use(express.static(publicDir));
app.use("/dashboard", express.static(publicDir));

app.get(/^\/dashboard\/?$/, (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Cat wheel dashboard running on http://localhost:${PORT}`);
});
