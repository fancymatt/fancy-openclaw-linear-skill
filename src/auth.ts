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
