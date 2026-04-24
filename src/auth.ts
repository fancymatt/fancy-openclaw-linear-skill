import fs from "node:fs";
import path from "node:path";

import { linearGraphQL, LinearApiError } from "./client";
import { User } from "./types";

interface ViewerResponse {
  viewer: User;
}

function candidateNames(): string[] {
  return [
    process.env.OPENCLAW_AGENT_NAME,
    process.env.OPENCLAW_AGENT_ID,
    process.env.account_id,
    process.env.USER,
    path.basename(process.env.HOME ?? "")
      .replace(/^workspace-/, "")
      .replace(/^openclaw-/, "")
  ].filter((value): value is string => Boolean(value));
}

function secretFileCandidates(): string[] {
  const home = process.env.HOME;
  const names = candidateNames().map((name) => name.toLowerCase());
  const files = new Set<string>();

  for (const name of names) {
    if (home) {
      files.add(path.join(home, `.openclaw/workspace-${name}/.secrets/linear.env`));
    }
  }

  if (process.cwd()) {
    files.add(path.join(process.cwd(), ".secrets/linear.env"));
  }

  return [...files];
}

/**
 * Patterns that match credential key names we accept.
 *
 * We accept env var names that look like any of:
 *   LINEAR_DEVELOPER_TOKEN, LINEAR_MCKELL_DEVELOPER_TOKEN
 *   LINEAR_API_KEY, LINEAR_CHARLES_API_KEY
 *   LINEAR_TOKEN
 *
 * The key must contain "linear" AND one of (token|key|developer).
 */
const TOKEN_NAME_PATTERNS = [
  /linear.*developer.*token/i,
  /linear.*api.*key/i,
  /linear.*token/i,
];

function isLinearTokenKey(key: string): boolean {
  return TOKEN_NAME_PATTERNS.some((pattern) => pattern.test(key));
}

function loadApiKeyFromEnvFile(filePath: string): string | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)\s*$/);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    if (!isLinearTokenKey(key)) {
      continue;
    }

    const value = rawValue.replace(/^['"]|['"]$/g, "").trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

/**
 * Env var names checked in priority order.
 * The first one that is set wins.
 */
function envVarCandidates(): string[] {
  return [
    "LINEAR_API_KEY",
    "LINEAR_DEVELOPER_TOKEN",
  ];
}

export function ensureApiKey(): string {
  for (const name of envVarCandidates()) {
    if (process.env[name]) {
      process.env.LINEAR_API_KEY = process.env[name]!;
      return process.env[name]!;
    }
  }

  for (const filePath of secretFileCandidates()) {
    const value = loadApiKeyFromEnvFile(filePath);
    if (value) {
      process.env.LINEAR_API_KEY = value;
      return value;
    }
  }

  const tried = secretFileCandidates().join(", ");
  const agentName = candidateNames()[0] ?? "unknown";
  throw new Error(
    `No Linear API key found for agent ${agentName}. Set LINEAR_API_KEY or LINEAR_DEVELOPER_TOKEN, or provision .secrets/linear.env. Looked in: ${tried}`
  );
}

export async function checkAuth(): Promise<User> {
  ensureApiKey();
  try {
    const data = await linearGraphQL<ViewerResponse>(`
      query AuthCheck {
        viewer {
          id
          name
          email
        }
      }
    `);
    return data.viewer;
  } catch (error) {
    if (error instanceof LinearApiError && error.code === "UNAUTHORIZED") {
      throw new Error(`LINEAR_API_KEY is invalid: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Run diagnostics on Linear auth and CLI setup
 * Checks: token validity, user identity, and basic read-only operation
 */
/**
 * Get the currently authenticated Linear user (the "self" for semantic commands).
 * Uses the same viewer query as checkAuth but returns a consistent User shape.
 */
export async function getSelfUser(): Promise<User> {
  ensureApiKey();
  const data = await linearGraphQL<ViewerResponse>(`
    query GetSelfUser {
      viewer {
        id
        name
        email
      }
    }
  `);
  return data.viewer;
}

export async function linearDoctor(): Promise<void> {
  console.log("🩺 Linear Doctor\n");
  try {
    const viewer = await checkAuth();
    console.log(`✅ Auth valid\n`);
    console.log(`   User: ${viewer.name} (${viewer.id})`);
    console.log(`   Email: ${viewer.email}`);
  } catch (err) {
    console.log(`❌ Auth failed: ${err instanceof Error ? err.message : String(err)}\n`);
    return;
  }

  try {
    const { listTeams } = await import("./teams.js");
    const teams = await listTeams();
    console.log(`✅ Teams fetch successful (${teams.length} teams)\n`);
  } catch (err) {
    console.log(`❌ Teams fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  try {
    const { getMyIssues } = await import("./issues.js");
    const myIssues = await getMyIssues();
    console.log(`✅ My issues fetch successful (${myIssues.length} issues)\n`);
  } catch (err) {
    console.log(`❌ My issues fetch failed: ${err instanceof Error ? err.message : String(err)}\n`);
  }

  // Token type detection
  const apiKey = process.env.LINEAR_API_KEY || "none";
  if (apiKey.startsWith("lin_oauth_")) {
    console.log("✅ Using OAuth token (auto-refreshes every ~20h)\n");
  } else if (apiKey.startsWith("lin_api_")) {
    console.log("✅ Using personal API key (does not expire)\n");
  } else {
    console.log(`⚠️  Unknown token format: ${apiKey.substring(0, 20)}...\n`);
  }
}
