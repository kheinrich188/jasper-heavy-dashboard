# Jasper Heavy Dashboard

Responsive web dashboard for the `jasper-heavy` cat wheel telemetry in InfluxDB.

## Setup

1. Copy `.env.example` to `.env` and fill your Influx credentials.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the dashboard:
   ```bash
   npm run start
   ```
4. Open `http://localhost:3000`.

## Included Dashboards

- KPI cards: distance, rotations, top speed, zoomies, inactivity, athlete score
- 24h speed bursts
- 30-day distance trend
- zoomies trend
- activity distribution by hour
- recent finished sessions with performance labels
