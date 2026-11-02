# opencode-idle-compact

An OpenCode 2 server plugin that compacts a large, idle root session shortly
before its prompt cache expires, like Claude Code's idle compaction. The
summary request still reads the history from the cache, and the next turn
starts from the summary instead of re-sending the whole history uncached.

It fires shortly before the cache expires, counted from the session's last
primary request, and only for models whose cache lifetime is known. These hold
without any provider configuration:

| Model | Cache | Compacts after |
| --- | --- | --- |
| `claude-agent` (Claude subscription) | 1 hour | 55 minutes |
| `openai` | at least 30 minutes | 25 minutes |
| `amazon-bedrock` `openai.gpt-6.1-*` | at least 30 minutes | 25 minutes |
| `google-vertex` `gemini-*` | about 5–7 minutes, measured | 4 minutes |

Gemini on Vertex misses about one request in seven at random, each miss paying
full price, so keep-alive pings cost more than compacting while the cache is
warm. Other models are left alone unless configured: their cache
lifetime is unknown, so the cache may be gone before compacting pays. It also skips busy sessions,
subagent sessions, sessions from other directories, and prompts under 100,000
tokens.

## Use

Add the repository directory to `plugins` in `~/.config/opencode/opencode.json`.
`idleMinutes` maps `provider/model` or `provider` to the minutes after which to
compact, most specific first, and wins over the table; `0` turns a model off.
Anthropic's cache lasts five minutes unless the provider sets `cache.ttl: 1h`,
so it has no default:

```json
{
  "plugins": [
    {
      "package": "/absolute/path/to/opencode-idle-compact",
      "options": {
        "idleMinutes": {
          "anthropic": 55,
          "amazon-bedrock/eu.anthropic.claude-haiku-5-5": 55,
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
