# ai-skills

A collection of reusable skills for OpenClaw agents.

## What's a skill?

Skills are self-contained modules that give OpenClaw agents access to external data or services. Each skill lives in `skills/<name>/` and contains a `SKILL.md` (agent instructions) plus any scripts the agent executes.

## Available skills

| Skill | Description |
|---|---|
| [oura](skills/oura/) | Fetches today's Oura Ring health data (sleep, readiness, HR, activity, SpO2) |

## Installing skills into OpenClaw

The recommended approach is to point OpenClaw at this repo's `skills/` directory so skills stay up to date automatically.

Add to `~/.openclaw/openclaw.json`:

```json
{
  "skills": {
    "load": {
      "extraDirs": ["/path/to/ai-skills/skills"]
    }
  }
}
```

Then configure each skill individually under `skills.entries`. See the skill's own README for what config it needs.

Alternatively, copy a skill directory into `~/.openclaw/skills/` if you prefer keeping it separate from this repo.

## Adding a new skill

1. Create `skills/<skill-name>/SKILL.md` with the required YAML frontmatter
2. Add any supporting scripts the agent will run
3. Add a row to the table above
