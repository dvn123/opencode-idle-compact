# opencode-idle-compact

An OpenCode 2 server plugin that compacts a large, idle root session shortly
before its prompt cache expires, like Claude Code's idle compaction. The
summary request still reads the history from the cache, and the next turn
starts from the summary instead of re-sending the whole history uncached.

It fires shortly before the cache expires, counted from the session's last
primary request. It assumes a one-hour cache, compacting after 55 minutes,
except for models known to keep it for less:

| Model | Cache | Compacts after |
| --- | --- | --- |
| `openai` | at least 30 minutes | 25 minutes |
| `amazon-bedrock` `openai.gpt-5.6-*` and later | 30 minutes, measured | 25 minutes |
| `google-vertex` `gemini-*` | about 5–7 minutes, measured | 4 minutes |
| `google-vertex` `deepseek-*` | per replica, measured | never |

Gemini on Vertex misses about one request in seven at random, each miss paying
full price, so keep-alive pings cost more than compacting while the cache is
warm. It also skips busy sessions, subagent sessions, sessions from other
directories, and prompts under 100,000 tokens.

## Use

Add the repository directory to `plugins` in `~/.config/opencode/opencode.json`.
`idleMinutes` maps `provider/model` or `provider` to the minutes after which to
compact, most specific first, and wins over the table; `0` turns a model off.
Claude's cache lasts five minutes unless the provider or model sets
`cache.ttl: 1h`, so set that for every Claude model you use, or give a
shorter-lived model its own delay:

```json
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-idle-compact",
      "options": {
        "idleMinutes": {
          "fireworks-ai": 25,
          "google-vertex/gemini-4-argon": 0
        }
      }
    }
  ]
}
```

`OPENCODE_IDLE_COMPACT_SECONDS` overrides the delay for every model that would
compact, and `OPENCODE_IDLE_COMPACT_MIN_TOKENS` overrides the token threshold.

## Test

```sh
npm test
```
