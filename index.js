// Compacts a large, idle root session shortly before its prompt cache expires.
//
// This mirrors Claude Code's idle compaction. The summary request still reads
// the history at the cached rate, and the next turn starts from the short
// summary instead of re-sending the whole history uncached.
//
// A provider keeps the cache for one TTL (five minutes here) after any model
// request. OpenCode's `warming` setting sends keep-alive requests every four
// minutes for a while after each turn, so this plugin counts every model
// request, keep-alives included, and fires IDLE_MS after the last one: about
// 45 seconds before the cache expires, either when warming stops or, with
// warming off, after the last turn. IDLE_MS must stay above the warming
// interval, or the plugin compacts sessions warming still keeps warm.

const IDLE_MS =
	(Number(process.env.OPENCODE_IDLE_COMPACT_SECONDS) || 255) * 1000;
const MIN_TOKENS =
	Number(process.env.OPENCODE_IDLE_COMPACT_MIN_TOKENS) || 100_000;

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

		const compactIfIdle = async (sessionID, state) => {
			if (state.busy || state.tokens < MIN_TOKENS) return;
			if (Date.now() - state.last > IDLE_MS + LATE_MS) return;
			const info = await ctx.session.get({ sessionID });
			// Events are server-wide, but each directory runs its own instance.
			if (info.parentID || info.location.directory !== ctx.location.directory)
				return;
			await ctx.session.compact({ sessionID });
		};

		// Every request kind refreshes the cache: turns, keep-alives, compactions.
		await ctx.session.hook("model.request", ({ sessionID }) => {
			const state = stateFor(sessionID);
			clearTimeout(state.timer);
			state.last = Date.now();
			state.timer = setTimeout(
				() =>
					compactIfIdle(sessionID, state).catch((error) =>
						console.warn(`idle-compact: ${sessionID}: ${error}`),
					),
				IDLE_MS,
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
