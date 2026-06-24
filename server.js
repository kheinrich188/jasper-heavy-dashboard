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

async function fetchLatestDailyCounters() {
  const query = `
from(bucket: "${influxConfig.bucket}")
  |> range(start: -2d)
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "daily_distance_m" or r._field == "daily_rotations" or r._field == "daily_zoomies" or r._field == "daily_zoomies_index")
  |> last()
  |> pivot(rowKey:["_time"], columnKey:["_field"], valueColumn:"_value")
  |> sort(columns: ["_time"], desc: true)
  |> limit(n: 1)
`;
  const [row] = await runRowsQuery(query);
  return {
    dailyDistanceM: parseNum(row?.daily_distance_m),
    dailyRotations: parseNum(row?.daily_rotations),
    dailyZoomies: parseNum(row?.daily_zoomies),
    dailyZoomiesIndex: parseNum(row?.daily_zoomies_index),
  };
}

async function fetchTopSpeed() {
  const query = `
from(bucket: "${influxConfig.bucket}")
  |> range(start: -30d)
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

async function fetchTodayActivitySeconds() {
  const query = `
import "date"

from(bucket: "${influxConfig.bucket}")
  |> range(start: -2d)
  |> filter(fn: (r) => r._measurement == "cat_wheel")
  ${tagFilter}
  |> filter(fn: (r) => r._field == "speed_kmh")
  |> aggregateWindow(every: 1m, fn: max, createEmpty: false)
  |> filter(fn: (r) => r._value > 0.2)
  |> filter(fn: (r) => date.truncate(t: r._time, unit: 1d) == date.truncate(t: now(), unit: 1d))
  |> count(column: "_value")
  |> keep(columns: ["_value"])
`;
  const [row] = await runRowsQuery(query);
  return Math.max(0, parseNum(row?._value) * 60);
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
    const [daily, topSpeedKmh, inactivitySeconds, dailyActiveSeconds, speedSeries, distanceSeries, zoomiesSeries, activityByHour, sessions] =
      await Promise.all([
        fetchLatestDailyCounters(),
        fetchTopSpeed(),
        fetchLastInactivitySeconds(),
        fetchTodayActivitySeconds(),
        fetchSpeedSeries(),
        fetchDailyDistanceSeries(),
        fetchZoomiesSeries(),
        fetchActivityByHour(),
        fetchRecentSessions(),
      ]);

    const catAthleteScore = Math.round(
      Math.min(100, daily.dailyDistanceM / 2 + topSpeedKmh * 10 + daily.dailyZoomies * 8)
    );

    res.json({
      overview: {
        ...daily,
        topSpeedKmh,
        inactivitySeconds,
        dailyActiveSeconds,
        catAthleteScore,
      },
      series: {
        speedSeries,
        distanceSeries,
        zoomiesSeries,
        activityByHour,
      },
      recentSessions: sessions,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Dashboard-Daten konnten nicht geladen werden.",
    });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`Cat wheel dashboard running on http://localhost:${PORT}`);
});
