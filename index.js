// Compacts a large, idle root session shortly before its prompt cache expires.
//
// This mirrors Claude Code's idle compaction. The summary request still reads
// the history at the cached rate, and the next turn starts from the short
// summary instead of re-sending the whole history uncached.
//
// The plugin fires a fixed delay after the session's last primary request,
// shortly before the cache expires. It only acts on models whose cache
// lifetime is known; an unknown or best-effort cache may already be gone,
// and compacting it then pays full price and loses detail.

const MINUTE = 60_000;
const OVERRIDE_MS = Number(process.env.OPENCODE_IDLE_COMPACT_SECONDS) * 1000;
const MIN_TOKENS =
	Number(process.env.OPENCODE_IDLE_COMPACT_MIN_TOKENS) || 100_000;

// Anthropic counts the lifetime from the start of the request that reads or
// writes the cache, which is when `model.request` fires.
function compactionDelay({ providerID, id }) {
	// Claude Code writes one-hour caches on a Claude subscription.
	if (providerID === "claude-agent") return 55 * MINUTE;
	// These two need `cache.ttl: 1h` in the provider or model options.
	if (providerID === "anthropic") return 55 * MINUTE;
	if (providerID === "amazon-bedrock" && id === "eu.anthropic.claude-haiku-5-5")
		return 55 * MINUTE;
	// OpenAI and Bedrock keep GPT-5.6 and later caches for at least 30 minutes.
	if (providerID === "openai") return 25 * MINUTE;
	if (providerID === "amazon-bedrock" && id.includes("openai.gpt-6.1-"))
		return 25 * MINUTE;
	// Vertex keeps Gemini implicit caches for about five to seven minutes, and
	// misses about one request in seven at random. Keep-alive pings then cost
	// more than they save, so compact while the cache is still warm.
	if (providerID === "google-vertex" && id.startsWith("gemini-"))
		return 4 * MINUTE;
	return undefined;
}

// A timer that fires this late slept through the TTL with the machine, so
// the cache is already gone and compacting would only lose detail.
const LATE_MS = 30_000;

export default {
	id: "idle-compact",

	async setup(ctx) {
		// V1 passes a context with no session domain; this plugin is V2 only.
		if (typeof ctx?.session?.hook !== "function") return;

		const sessions = new Map();
		const stateFor = (sessionID) => {
			if (!sessions.has(sessionID))
				sessions.set(sessionID, { busy: false, tokens: 0 });
			return sessions.get(sessionID);
		};

		const compactIfIdle = async (sessionID, state, delay) => {
			if (state.busy || state.tokens < MIN_TOKENS) return;
			if (Date.now() - state.last > delay + LATE_MS) return;
			const info = await ctx.session.get({ sessionID });
			// Events are server-wide, but each directory runs its own instance.
			if (info.parentID || info.location.directory !== ctx.location.directory)
				return;
			await ctx.session.compact({ sessionID });
		};

		// Title and other side requests may run on another model with its own cache.
		await ctx.session.hook("model.request", ({ sessionID, model, kind }) => {
			if (kind !== "primary") return;
			const state = stateFor(sessionID);
			clearTimeout(state.timer);
			const cacheDelay = compactionDelay(model);
			if (cacheDelay === undefined) return;
			const delay = OVERRIDE_MS || cacheDelay;
			state.last = Date.now();
			state.timer = setTimeout(
				() =>
					compactIfIdle(sessionID, state, delay).catch((error) =>
						console.warn(`idle-compact: ${sessionID}: ${error}`),
					),
				delay,
			);
		});

		const controller = new AbortController();
		void (async () => {
			try {
				for await (const { type, data } of ctx.event.subscribe({
					signal: controller.signal,
				})) {
					if (!data?.sessionID) continue;
					const state = stateFor(data.sessionID);
					switch (type) {
						case "session.step.ended":
							state.tokens =
								data.tokens.input +
								data.tokens.cache.read +
								data.tokens.cache.write;
							break;
						// The next prompt is the summary, not the last step's prompt.
						case "session.compaction.ended":
							state.tokens = 0;
							break;
						case "session.execution.started":
							state.busy = true;
							break;
						case "session.execution.succeeded":
						case "session.execution.failed":
						case "session.execution.interrupted":
							state.busy = false;
							break;
						case "session.deleted":
							clearTimeout(state.timer);
							sessions.delete(data.sessionID);
							break;
					}
				}
			} catch {
				// The stream ends with the plugin.
			}
		})();

		return () => {
			controller.abort();
			for (const state of sessions.values()) clearTimeout(state.timer);
		};
	},
};
