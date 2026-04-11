import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { linearGraphQL } from "./client";

export interface Team {
  id: string;
  key: string;
  name: string;
}

interface TeamsResponse {
  teams: {
    nodes: Team[];
  };
}

function cacheDir(): string {
  return path.join(os.homedir(), ".cache", "fancy-openclaw-linear-skill");
}

function cachePath(): string {
  return path.join(cacheDir(), "teams.json");
}

async function readCachedTeams(): Promise<Team[] | null> {
  try {
    const content = await fs.readFile(cachePath(), "utf8");
    return JSON.parse(content) as Team[];
  } catch {
    return null;
  }
}

async function writeCachedTeams(teams: Team[]): Promise<void> {
  await fs.mkdir(cacheDir(), { recursive: true });
  await fs.writeFile(cachePath(), JSON.stringify(teams, null, 2), "utf8");
}

export async function listTeams(refresh = false): Promise<Team[]> {
  if (!refresh) {
    const cached = await readCachedTeams();
    if (cached?.length) {
      return cached;
    }
  }

  const data = await linearGraphQL<TeamsResponse>(
    `
      query Teams {
        teams(first: 100) {
          nodes {
            id
            key
            name
          }
        }
      }
    `
  );

  const teams = data.teams.nodes;
  await writeCachedTeams(teams);
  return teams;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function resolveTeamId(keyOrId: string): Promise<string> {
  if (isUuid(keyOrId)) {
    return keyOrId;
  }

  const teams = await listTeams();
  const match = teams.find((t) => t.key.toLowerCase() === keyOrId.toLowerCase());
  if (!match) {
    const available = teams.map((t) => t.key).join(", ");
    throw new Error(`Unknown team key "${keyOrId}". Available: ${available}`);
  }
  return match.id;
}
