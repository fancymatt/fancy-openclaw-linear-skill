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
    if (!key.toLowerCase().includes("linear") || !key.toLowerCase().includes("api_key")) {
      continue;
    }

    const value = rawValue.replace(/^['"]|['"]$/g, "").trim();
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function ensureApiKey(): string {
  if (process.env.LINEAR_API_KEY) {
    return process.env.LINEAR_API_KEY;
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
    `No Linear API key found for agent ${agentName}. Set LINEAR_API_KEY or provision .secrets/linear.env. Looked in: ${tried}`
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
