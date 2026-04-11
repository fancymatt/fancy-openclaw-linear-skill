# Auth & Bootstrap

This skill authenticates to Linear using **personal API keys** (Linear calls them "developer tokens" in their settings UI). No OAuth flow is needed — each agent or user generates a token from their Linear account settings and stores it locally.

## Generating a Linear API Key

1. Open Linear → Settings → Account → Security & access → API
2. Click **New token**
3. Give it a label (e.g. `openclaw-agent-charles`)
4. Set the scopes you need (typically full read/write for agents)
5. Copy the token — it starts with `lin_api_` and you won't see it again

## Where to Put the Key

There are two places the auth system looks, in priority order:

### 1. Environment variable (highest priority)

```bash
export LINEAR_API_KEY=lin_api_your_token_here
```

If this is set, no other discovery happens. Use this when running one-off commands or in CI.

### 2. Agent workspace secret file

```
~/.openclaw/workspace-{agent}/.secrets/linear.env
```

The file is a plain shell-style env file. The key name inside the file **must** contain both `linear` and `api_key` (case-insensitive). Common patterns:

```bash
# Conventional: includes agent name for readability
LINEAR_CHARLES_API_KEY=lin_api_abc123...

# Also works: the scanner only checks that the key name matches *linear* and *api_key*
LINEAR_API_KEY=lin_api_abc123...
MY_LINEAR_API_KEY=lin_api_abc123...
```

The scanner reads every `KEY=VALUE` line, ignores comments and blank lines, and picks the first key whose name matches. Quotes around the value are stripped.

## Agent Name Discovery

When looking for the secret file, the auth system needs to know which agent is running. It tries these sources in order:

| Source | Example | Notes |
|---|---|---|
| `OPENCLAW_AGENT_NAME` | `charles` | Set by OpenClaw runtime |
| `OPENCLAW_AGENT_ID` | `charles` | Alternative runtime variable |
| `account_id` | `charles` | OpenClaw account config |
| `$USER` | `fancymatt` | OS user (less specific) |
| Home directory basename | `fancymatt` | Last resort, after stripping `workspace-` or `openclaw-` prefix |

The agent name is lowercased and used to build the path: `~/.openclaw/workspace-{name}/.secrets/linear.env`.

The current working directory is also checked: `{cwd}/.secrets/linear.env`. This covers cases where the skill is installed directly inside a workspace directory.

## New Agent Onboarding Checklist

Setting up Linear auth for a fresh agent:

1. **Generate the token** in Linear (see above)
2. **Create the secrets directory:**
   ```bash
   mkdir -p ~/.openclaw/workspace-{agent}/.secrets
   ```
3. **Write the env file:**
   ```bash
   echo "LINEAR_{AGENT}_API_KEY=lin_api_your_token_here" > ~/.openclaw/workspace-{agent}/.secrets/linear.env
   chmod 600 ~/.openclaw/workspace-{agent}/.secrets/linear.env
   ```
4. **Verify from the CLI:**
   ```bash
   cd ~/.openclaw/workspace/skills/fancy-openclaw-linear-skill
   node dist/index.js auth check --human
   ```
5. **Expected output:** Your Linear user name, email, and ID printed in human-readable form.

If you see `No Linear API key found for agent ...`, the env file is missing or the agent name isn't being discovered correctly. Check that `OPENCLAW_AGENT_NAME` is set or that the directory name matches.

If you see `LINEAR_API_KEY is invalid`, the token was copied incorrectly or has been revoked.

## Security Notes

- The token is a personal API key — it has the same access as the Linear user who generated it
- Store it in `.secrets/` (not tracked by git)
- `chmod 600` the env file so only your user can read it
- Rotate the token in Linear settings if it's ever exposed
