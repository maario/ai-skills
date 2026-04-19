#!/usr/bin/env npx tsx

/**
 * Fetches today's (or a given date's) Oura Ring health data from the Oura API v2.
 *
 * Usage:
 *   npx tsx fetch-oura.ts              # today
 *   npx tsx fetch-oura.ts 2026-04-18   # specific date
 *
 * Requires: OURA_ACCESS_TOKEN env var
 *
 * Always exits with code 0. Errors are expressed in the JSON output
 * via `available: false` so the calling agent can parse cleanly.
 *
 * Endpoint notes:
 *   daily_sleep  → score + contributor scores (no durations)
 *   sleep        → session durations, efficiency, HR, latency
 *                  dated by BEDTIME, so we query [yesterday, today] to
 *                  catch the session that started last night
 *   daily_readiness → readiness score + contributor scores
 *   daily_activity  → activity score + steps/calories (dated by wake day)
 *   daily_spo2      → SpO2 average
 */

const BASE_URL = "https://api.ouraring.com/v2/usercollection";

type SleepData = {
  score: number | null;
  total_sleep_minutes: number;
  efficiency: number;
  deep_sleep_minutes: number;
  rem_sleep_minutes: number;
  light_sleep_minutes: number;
  awake_minutes: number;
  latency_minutes: number;
  resting_heart_rate: number | null;
};

type ReadinessData = {
  score: number | null;
  hrv_balance_score: number | null;
  temperature_deviation: number | null;
  recovery_index: number | null;
};

type ActivityData = {
  date: string;           // may be yesterday when fetched in the morning
  score: number | null;
  steps: number;
  active_calories: number;
  sedentary_minutes: number;
};

type Spo2Data = {
  avg_saturation_percentage: number | null;
};

type OuraOutput =
  | {
      available: true;
      date: string;
      sleep: SleepData;
      readiness: ReadinessData;
      activity: ActivityData;             // today (partial if fetched in the morning)
      yesterday_activity: ActivityData;   // previous day's completed activity
      spo2: Spo2Data;
    }
  | {
      available: false;
      date: string;
      reason: string;
    };

function toMinutes(seconds: number | null | undefined): number {
  if (seconds == null) return 0;
  return Math.round(seconds / 60);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function previousDay(date: string): string {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function fetchEndpoint(
  endpoint: string,
  startDate: string,
  endDate: string,
  token: string
): Promise<{ data: unknown[] }> {
  const url = `${BASE_URL}/${endpoint}?start_date=${startDate}&end_date=${endDate}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<{ data: unknown[] }>;
}

/**
 * Pick the primary sleep session from a list that may span two days.
 * Oura dates sessions by bedtime, so the session for "tonight's sleep"
 * typically appears with yesterday's date.
 * Preference order: type==="long_sleep" → longest total_sleep_duration.
 */
function pickPrimarySession(
  sessions: Record<string, unknown>[]
): Record<string, unknown> | null {
  if (sessions.length === 0) return null;
  const longSleep = sessions.find((s) => s.type === "long_sleep");
  if (longSleep) return longSleep;
  return sessions.reduce((best, cur) => {
    const bestDur = (best.total_sleep_duration as number) ?? 0;
    const curDur = (cur.total_sleep_duration as number) ?? 0;
    return curDur > bestDur ? cur : best;
  });
}

function parseSleepSession(
  score: number | null,
  session: Record<string, unknown>
): SleepData {
  return {
    score,
    total_sleep_minutes: toMinutes(session.total_sleep_duration as number | null),
    efficiency: (session.efficiency as number) ?? 0,
    deep_sleep_minutes: toMinutes(session.deep_sleep_duration as number | null),
    rem_sleep_minutes: toMinutes(session.rem_sleep_duration as number | null),
    light_sleep_minutes: toMinutes(session.light_sleep_duration as number | null),
    awake_minutes: toMinutes(session.awake_time as number | null),
    latency_minutes: toMinutes(session.latency as number | null),
    resting_heart_rate: (session.lowest_heart_rate as number | null) ?? null,
  };
}

function parseReadiness(raw: Record<string, unknown>): ReadinessData {
  const contributors = (raw.contributors ?? {}) as Record<string, unknown>;
  return {
    score: (raw.score as number | null) ?? null,
    hrv_balance_score: (contributors.hrv_balance as number | null) ?? null,
    temperature_deviation: (raw.temperature_deviation as number | null) ?? null,
    recovery_index: (contributors.recovery_index as number | null) ?? null,
  };
}

function parseActivity(raw: Record<string, unknown>): ActivityData {
  return {
    date: raw.day as string,
    score: (raw.score as number | null) ?? null,
    steps: (raw.steps as number) ?? 0,
    active_calories: (raw.active_calories as number) ?? 0,
    sedentary_minutes: toMinutes(raw.sedentary_time as number | null),
  };
}

function parseSpo2(raw: Record<string, unknown>): Spo2Data {
  const pct = raw.spo2_percentage as { average: number } | null | undefined;
  return {
    avg_saturation_percentage: pct?.average ?? null,
  };
}

async function main(): Promise<void> {
  const date = process.argv[2] ?? today();
  const prev = previousDay(date);

  const token = process.env.OURA_ACCESS_TOKEN;
  if (!token) {
    console.log(
      JSON.stringify(
        { available: false, date, reason: "OURA_ACCESS_TOKEN environment variable is not set" },
        null,
        2
      )
    );
    return;
  }

  try {
    const [dailySleepRes, sleepSessionRes, readinessRes, activityRes, spo2Res] =
      await Promise.all([
        fetchEndpoint("daily_sleep", date, date, token),     // score only, wake-day dated
        fetchEndpoint("sleep", prev, date, token),           // sessions, bedtime-dated → query prev+today
        fetchEndpoint("daily_readiness", date, date, token),
        fetchEndpoint("daily_activity", prev, date, token),  // query prev+today — morning may have no today data
        fetchEndpoint("daily_spo2", date, date, token),
      ]);

    if (dailySleepRes.data.length === 0) {
      console.log(
        JSON.stringify(
          { available: false, date, reason: "Sleep data not yet synced for this date" },
          null,
          2
        )
      );
      return;
    }

    if (readinessRes.data.length === 0) {
      console.log(
        JSON.stringify(
          { available: false, date, reason: "Readiness data not yet synced for this date" },
          null,
          2
        )
      );
      return;
    }

    const dailySleepRaw = dailySleepRes.data[0] as Record<string, unknown>;
    const sleepScore = (dailySleepRaw.score as number | null) ?? null;

    const sessions = sleepSessionRes.data as Record<string, unknown>[];
    const primarySession = pickPrimarySession(sessions);

    const emptySleep: SleepData = {
      score: sleepScore,
      total_sleep_minutes: 0,
      efficiency: 0,
      deep_sleep_minutes: 0,
      rem_sleep_minutes: 0,
      light_sleep_minutes: 0,
      awake_minutes: 0,
      latency_minutes: 0,
      resting_heart_rate: null,
    };

    const activityRecords = activityRes.data as Record<string, unknown>[];
    const todayActivity = activityRecords.find((r) => r.day === date);
    const yesterdayActivity = activityRecords.find((r) => r.day === prev);

    const emptyActivity = (d: string): ActivityData => ({
      date: d,
      score: null,
      steps: 0,
      active_calories: 0,
      sedentary_minutes: 0,
    });

    const out: OuraOutput = {
      available: true,
      date,
      sleep: primarySession ? parseSleepSession(sleepScore, primarySession) : emptySleep,
      readiness: parseReadiness(readinessRes.data[0] as Record<string, unknown>),
      activity: todayActivity ? parseActivity(todayActivity) : emptyActivity(date),
      yesterday_activity: yesterdayActivity ? parseActivity(yesterdayActivity) : emptyActivity(prev),
      spo2:
        spo2Res.data.length > 0
          ? parseSpo2(spo2Res.data[0] as Record<string, unknown>)
          : { avg_saturation_percentage: null },
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
              ? `Oura API error: ${err.message}`
              : "Unknown error fetching Oura data",
        },
        null,
        2
      )
    );
  }
}

main();
