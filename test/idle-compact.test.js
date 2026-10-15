import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { test } from "node:test";

process.env.OPENCODE_IDLE_COMPACT_SECONDS = "0.1";
process.env.OPENCODE_IDLE_COMPACT_MIN_TOKENS = "1000";
const { default: plugin } = await import("../index.js");

// A fake OpenCode 2 plugin context. `compact` behaves like the real one: the
// summary request is itself a model request, and its end resets the prompt.
function fakeContext(sessions) {
	const hooks = {};
	const queue = [];
	let wake = () => {};
	const emit = (type, data) => {
		queue.push({ type, data });
		wake();
	};
	const compacted = [];
	const ctx = {
		location: { directory: "/project" },
		session: {
			hook: async (name, callback) => {
				hooks[name] = callback;
			},
			get: async ({ sessionID }) => ({
				location: { directory: "/project" },
				...sessions[sessionID],
			}),
			compact: async ({ sessionID }) => {
				compacted.push(sessionID);
				hooks["model.request"]({ sessionID, kind: "compaction" });
				emit("session.compaction.ended", { sessionID });
			},
		},
		event: {
			async *subscribe({ signal }) {
				while (!signal.aborted) {
					if (queue.length) yield queue.shift();
					else await new Promise((resolve) => (wake = resolve));
				}
			},
		},
	};
	const request = (sessionID) =>
		hooks["model.request"]({ sessionID, kind: "primary" });
	return { ctx, emit, request, compacted };
}

test("compacts only large, idle, owned root sessions, once", async () => {
	const prompts = { big: 2000, small: 500, busy: 2000, child: 2000, elsewhere: 2000 };
	const { ctx, emit, request, compacted } = fakeContext({
		child: { parentID: "big" },
		elsewhere: { location: { directory: "/other" } },
	});
	const cleanup = await plugin.setup(ctx);

	for (const [sessionID, input] of Object.entries(prompts)) {
		emit("session.execution.started", { sessionID });
		request(sessionID);
		const tokens = { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } };
		emit("session.step.ended", { sessionID, tokens });
		if (sessionID !== "busy") emit("session.execution.succeeded", { sessionID });
	}
	await sleep(400);
	cleanup();

	assert.deepEqual(compacted, ["big"]);
});
