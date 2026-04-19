#!/usr/bin/env npx tsx
/**
 * One-time Strava OAuth2 setup helper.
 * Run this once to obtain a refresh token, then store it in your OpenClaw config.
 *
 * Usage:
 *   STRAVA_CLIENT_ID=<id> STRAVA_CLIENT_SECRET=<secret> npx tsx setup-auth.ts
 *
 * Steps:
 *   1. Opens (prints) an authorization URL — open it in your browser
 *   2. Approve access on Strava
 *   3. Strava redirects to localhost:8888 — this script catches the code
 *   4. Exchanges the code for tokens and prints your STRAVA_REFRESH_TOKEN
 */

import { createServer } from "http";

const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:8888/callback";
const PORT = 8888;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "Error: STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET must be set.\n" +
      "Create a Strava API application at https://www.strava.com/settings/api"
  );
  process.exit(1);
}

const authUrl =
  `https://www.strava.com/oauth/authorize` +
  `?client_id=${CLIENT_ID}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&response_type=code` +
  `&scope=activity:read_all`;

console.log("\n=== Strava OAuth Setup ===\n");
console.log("1. Open this URL in your browser:\n");
console.log(`   ${authUrl}\n`);
console.log("2. Approve access on Strava.");
console.log("3. You will be redirected to localhost — this script will catch it.\n");
console.log("Waiting for callback on http://localhost:8888 ...\n");

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error || !code) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h2>Authorization denied or failed. You can close this tab.</h2>");
    console.error(`\nAuthorization failed: ${error ?? "no code returned"}`);
    server.close();
    return;
  }

  try {
    const tokenRes = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
      }),
    });

    const data = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      athlete?: { firstname?: string; lastname?: string };
      errors?: unknown;
    };

    if (!data.refresh_token) {
      throw new Error(JSON.stringify(data.errors ?? data));
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(
      "<h2>Success! You can close this tab and check your terminal.</h2>"
    );

    const name =
      data.athlete
        ? `${data.athlete.firstname ?? ""} ${data.athlete.lastname ?? ""}`.trim()
        : "unknown";

    console.log(`Authorized as: ${name}\n`);
    console.log("=== Add this to your OpenClaw config (skills.entries.strava.env) ===\n");
    console.log(`STRAVA_REFRESH_TOKEN=${data.refresh_token}\n`);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end("<h2>Token exchange failed. Check your terminal.</h2>");
    console.error("\nFailed to exchange code for tokens:", err);
  } finally {
    server.close();
  }
});

server.listen(PORT);
