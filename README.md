# opencode-idle-compact

An OpenCode 2 server plugin that compacts a large, idle root session shortly
before its prompt cache expires, like Claude Code's idle compaction. The
summary request still reads the history from the cache, and the next turn
starts from the summary instead of re-sending the whole history uncached.

It fires 4 minutes 15 seconds after the session's last model request,
including OpenCode's `warming` keep-alives, so with warming on it compacts
when warming stops. It skips busy sessions, subagent sessions, sessions from
other directories, and prompts under 100,000 tokens.

## Use

Add the repository directory to `plugins` in `~/.config/opencode/opencode.json`:

```json
{ "plugins": ["/absolute/path/to/opencode-idle-compact"] }
```

`OPENCODE_IDLE_COMPACT_SECONDS` and `OPENCODE_IDLE_COMPACT_MIN_TOKENS`
override the delay and the token threshold. Keep the delay above the
`warming.interval`, or the plugin compacts sessions warming still keeps warm.

## Test

```sh
npm test
```
