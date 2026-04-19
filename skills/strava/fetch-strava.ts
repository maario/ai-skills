#!/usr/bin/env npx tsx

/**
 * Fetches today's and recent Strava workout activities from the Strava API v3.
 *
 * Usage:
 *   npx tsx fetch-strava.ts                    # today + last 14 days
 *   npx tsx fetch-strava.ts 2026-04-18         # specific date + last 14 days
 *   npx tsx fetch-strava.ts 2026-04-18 7       # specific date + last 7 days
 *   npx tsx fetch-strava.ts today 30           # today + last 30 days
 *
 * Requires env vars:
 *   STRAVA_CLIENT_ID
 *   STRAVA_CLIENT_SECRET
 *   STRAVA_REFRESH_TOKEN   (obtain once via setup-auth.ts)
 *
 * Always exits with code 0. Errors are expressed in the JSON output
 * via `available: false` so the calling agent can parse cleanly.
 */

const BASE_URL = "https://www.strava.com/api/v3";
const RUN_TYPES = new Set(["Run", "Trail Run", "Walk", "Hike", "VirtualRun"]);

type StravaActivity = {
  id: number;
  name: string;
  sport_type: string;
  start_time: string;
  distance_km: number;
  moving_time_minutes: number;
  elevation_gain_m: number;
  pace_per_km: string | null;   // "M:SS" format — runs/walks only
  speed_kmh: number | null;     // all other sport types
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  suffer_score: number | null;
  average_watts: number | null;
};

type StravaOutput =
  | {
      available: true;
      date: string;
      today_activities: StravaActivity[];    // workouts on the target date
      recent_activities: StravaActivity[];   // last 7 days, newest first
    }
  | {
      available: false;
      date: string;
      reason: string;
    };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Convert m/s to "M:SS" pace per km (for runs). */
function toPacePerKm(metersPerSecond: number): string {
  if (metersPerSecond <= 0) return "0:00";
  const secondsPerKm = 1000 / metersPerSecond;
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Convert m/s to km/h rounded to 1 decimal. */
function toKmh(metersPerSecond: number): number {
  return Math.round(metersPerSecond * 3.6 * 10) / 10;
}

/** Start of a given date in UTC, as a Unix timestamp (seconds). */
function startOfDayUtc(date: string): number {
  return Math.floor(new Date(`${date}T00:00:00Z`).getTime() / 1000);
}

/** Current time as a Unix timestamp (seconds). */
function nowUtc(): number {
  return Math.floor(Date.now() / 1000);
}

async function getAccessToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<string> {
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { access_token?: string; errors?: unknown };
  if (!data.access_token) {
    throw new Error(`Token refresh returned no access_token: ${JSON.stringify(data.errors ?? data)}`);
  }

  return data.access_token;
}

async function fetchActivities(
  accessToken: string,
  after: number,
  before: number
): Promise<Record<string, unknown>[]> {
  const url =
    `${BASE_URL}/athlete/activities` +
    `?after=${after}&before=${before}&per_page=50`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Activities fetch failed: ${res.status} ${res.statusText}`);
  }

  return res.json() as Promise<Record<string, unknown>[]>;
}

function parseActivity(raw: Record<string, unknown>): StravaActivity {
  const sportType = (raw.sport_type as string) ?? (raw.type as string) ?? "Unknown";
  const speedMs = (raw.average_speed as number) ?? 0;
  const isRun = RUN_TYPES.has(sportType);

  return {
    id: raw.id as number,
    name: (raw.name as string) ?? "",
    sport_type: sportType,
    start_time: (raw.start_date_local as string) ?? "",
    distance_km: Math.round(((raw.distance as number) ?? 0) / 10) / 100,
    moving_time_minutes: Math.round(((raw.moving_time as number) ?? 0) / 60),
    elevation_gain_m: Math.round((raw.total_elevation_gain as number) ?? 0),
    pace_per_km: isRun && speedMs > 0 ? toPacePerKm(speedMs) : null,
    speed_kmh: !isRun && speedMs > 0 ? toKmh(speedMs) : null,
    avg_heart_rate: (raw.average_heartrate as number | null) ?? null,
    max_heart_rate: (raw.max_heartrate as number | null) ?? null,
    suffer_score: (raw.suffer_score as number | null) ?? null,
    average_watts: (raw.average_watts as number | null) ?? null,
  };
}

async function main(): Promise<void> {
  const date = process.argv[2] ?? today();
  const lookbackDays = parseInt(process.argv[3] ?? "14", 10);

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const refreshToken = process.env.STRAVA_REFRESH_TOKEN;

  for (const [name, val] of [
    ["STRAVA_CLIENT_ID", clientId],
    ["STRAVA_CLIENT_SECRET", clientSecret],
    ["STRAVA_REFRESH_TOKEN", refreshToken],
  ] as [string, string | undefined][]) {
    if (!val) {
      console.log(
        JSON.stringify({ available: false, date, reason: `${name} environment variable is not set` }, null, 2)
      );
      return;
    }
  }

  try {
    const accessToken = await getAccessToken(clientId!, clientSecret!, refreshToken!);

    const todayStart = startOfDayUtc(date);
    const weekStart = todayStart - lookbackDays * 24 * 60 * 60;
    const now = nowUtc();

    // Fetch the full 7-day window; split into today vs. recent in-memory
    const allRaw = await fetchActivities(accessToken, weekStart, now);

    // Strava returns activities newest-first; preserve that order
    const all = allRaw.map(parseActivity);

    const todayActivities = all.filter((a) => a.start_time.startsWith(date));
    const recentActivities = all; // full 7 days including today

    const out: StravaOutput = {
      available: true,
      date,
      today_activities: todayActivities,
      recent_activities: recentActivities,
    };

    console.log(JSON.stringify(out, null, 2));
  } catch (err) {
    console.log(
      JSON.stringify(
        {
          available: false,
          date,
          reason:
            err instanceof Error
              ? `Strava API error: ${err.message}`
              : "Unknown error fetching Strava data",
        },
        null,
        2
      )
    );
  }
}

main();
