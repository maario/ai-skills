---
name: strava
description: Fetches today's and recent Strava workout activities (runs, rides, swims, etc.) and returns structured JSON
metadata: {"openclaw": {"requires": {"env": ["STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REFRESH_TOKEN"]}}}
user-invocable: false
---

## When to use

Use this skill whenever you need the user's workout and training activity data from Strava.

## How to use

1. Run the fetch script:
   ```
   cd {baseDir} && npx tsx fetch-strava.ts [date] [lookback_days]
   ```
   Both arguments are optional. Default: today, 14 days lookback.
2. Parse the JSON output printed to stdout.
3. If `available` is `false`: check the `reason` field — it may indicate missing credentials or an API error.
4. If `available` is `true`: `today_activities` contains workouts from today (may be empty), `recent_activities` contains all activities from the last 7 days newest-first.

## First-time setup

Before using this skill, a one-time OAuth authorization is needed to obtain the refresh token:

```bash
cd {baseDir}
STRAVA_CLIENT_ID=<id> STRAVA_CLIENT_SECRET=<secret> npx tsx setup-auth.ts
```

Follow the printed URL, approve in your browser, then copy the printed `STRAVA_REFRESH_TOKEN` into your OpenClaw config.

## Output contract

### When data is available

```json
{
  "available": true,
  "date": "2026-04-19",
  "today_activities": [
    {
      "id": 12345678,
      "name": "Morning Run",
      "sport_type": "Run",
      "start_time": "2026-04-19T07:15:00",
      "distance_km": 8.4,
      "moving_time_minutes": 47,
      "elevation_gain_m": 85,
      "pace_per_km": "5:35",
      "speed_kmh": null,
      "avg_heart_rate": 148,
      "max_heart_rate": 172,
      "suffer_score": 54,
      "average_watts": null
    }
  ],
  "recent_activities": [
    { "...": "same shape, all activities from the last 7 days newest-first" }
  ]
}
```

### When data is not available

```json
{
  "available": false,
  "date": "2026-04-19",
  "reason": "STRAVA_REFRESH_TOKEN environment variable is not set"
}
```

## Notes

- `today_activities` will be empty early in the day if no workout has been logged yet — this is normal.
- `pace_per_km` is set for Run, Trail Run, Walk, Hike types; `speed_kmh` is set for all others.
- `suffer_score`, `avg_heart_rate`, and `average_watts` are `null` if the user has no HR monitor or power meter.
- Pass a date argument to fetch a different reference date: `npx tsx fetch-strava.ts 2026-04-18`
- Pass a second argument to control the lookback window: `npx tsx fetch-strava.ts today 30` (default: 14 days)
