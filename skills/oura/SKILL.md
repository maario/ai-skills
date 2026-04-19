---
name: oura
description: Fetches today's Oura Ring health data (sleep, readiness, heart rate, activity, SpO2) and returns structured JSON
metadata: {"openclaw": {"primaryEnv": "OURA_ACCESS_TOKEN", "requires": {"env": ["OURA_ACCESS_TOKEN"]}}}
user-invocable: false
---

## When to use

Use this skill whenever you need the user's current health and recovery data from their Oura Ring.

## How to use

1. Run the fetch script:
   ```
   cd {baseDir} && npx tsx fetch-oura.ts
   ```
2. Parse the JSON output printed to stdout.
3. If `available` is `false`: the Oura device hasn't synced yet — inform the user and offer to check again later.
4. If `available` is `true`: use the returned data as needed for the task at hand.

## Output contract

### When data is available

```json
{
  "available": true,
  "date": "2026-04-19",
  "sleep": {
    "score": 82,
    "total_sleep_minutes": 452,
    "efficiency": 88,
    "deep_sleep_minutes": 74,
    "rem_sleep_minutes": 108,
    "light_sleep_minutes": 270,
    "awake_minutes": 18,
    "latency_minutes": 9
  },
  "readiness": {
    "score": 76,
    "hrv_balance_score": 65,
    "resting_heart_rate": 52,
    "temperature_deviation": 0.1,
    "recovery_index": 80
  },
  "activity": {
    "date": "2026-04-19",
    "score": null,
    "steps": 1200,
    "active_calories": 95,
    "sedentary_minutes": 30
  },
  "yesterday_activity": {
    "date": "2026-04-18",
    "score": 71,
    "steps": 8540,
    "active_calories": 620,
    "sedentary_minutes": 480
  },
  "spo2": {
    "avg_saturation_percentage": 97.4
  }
}
```

### When data is not yet available

```json
{
  "available": false,
  "date": "2026-04-19",
  "reason": "Sleep data not yet synced for this date"
}
```

## Notes

- Scores are 0–100 (Oura's standard scale). `null` means the metric wasn't computed.
- `temperature_deviation` is in °C relative to the user's baseline.
- `activity` is today's data and will be partial/zero early in the morning as the day accumulates. `yesterday_activity` is always the previous day's completed data.
- Pass a date argument to fetch historical data: `npx tsx fetch-oura.ts 2026-04-18`
