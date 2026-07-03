# Jasper Heavy Dashboard

Responsive premium dashboard for the `jasper-heavy` cat wheel telemetry in InfluxDB.

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

## UI Architecture

The dashboard is organized as a fitness-style story flow:

1. Hero section (main distance focus + activity rings + status)
2. Period selector (Heute, Gestern, Woche, Monat, Gesamt)
3. 4 primary KPI cards (Distanz, Aktivzeit, Zoomies, Top-Speed)
4. Main chart area (large 24h activity chart + secondary charts)
5. Recent sessions card grid
6. Period comparison cards
7. Monthly highlight cards

## Included Views

- Selectable period KPIs: today, yesterday, week, month, total
- Hero status with distance focus and activity rings
- 24h speed activity chart (main)
- Daily distance trend (30 days)
- Daily zoomies trend
- Activity distribution by hour
- Session performance cards
- Period comparison cards
- Monthly highlights (best day, fastest session, longest session, longest distance, most active hour, session count)

## Frontend Stack

- Express static frontend (`public/`)
- Chart.js via CDN
- Font Awesome Free via CDN
- Custom CSS design system (dark pastel palette, responsive layout, micro animations)
- Web App support (Manifest + Service Worker + Mobile/Share Meta Tags)

## PWA & Sharing

- Installable on mobile home screens (manifest + service worker + Apple mobile tags)
- Social link preview (Open Graph + Twitter card)
- Background media loading with AV1 (`/videos/hero.av1.webm`) and MP4 fallback (`/videos/hero.mp4`)

## Project Structure

```text
public/
  index.html
  site.webmanifest
  about.txt
  images/
    hero-poster.webp
  videos/
    hero.av1.webm
    hero.mp4
  assets/
    css/
      styles.css
    js/
      app.js
    icons/
      favicon + app icons
    images/
      hero-poster.png (share preview image)
  sw.js
```
