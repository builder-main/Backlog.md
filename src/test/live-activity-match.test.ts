import { describe, expect, it } from "bun:test";
import {
	ACTIVITY_MESSAGE_TYPE,
	type ActivitySession,
	type LiveTaskFields,
	matchLiveTasks,
	parseActivityMessage,
} from "../utils/live-activity.ts";

const FULL_SESSION_ID = "ses_f1ca23794ffelcDAqW4WvoU86m";
const ROOT_LABEL = "root";

const session = (sessionId: string, state: ActivitySession["state"]): ActivitySession => ({
	sessionId,
	state,
	at: 1,
});

const task = (id: string, extra: Partial<LiveTaskFields> = {}): LiveTaskFields => ({
	id,
	labels: [],
	...extra,
});

describe("matchLiveTasks id suffix", () => {
	it("matches an id ending with -SESSION-<id> equal to the session id", () => {
		const live = matchLiveTasks([task("T-SESSION-8QD")], [session("8QD", "running")]);
		expect(live.get("T-SESSION-8QD")).toBe("running");
	});

	it("matches a full session id that ends with the short id, case-insensitively", () => {
		const live = matchLiveTasks([task("t-session-u86m")], [session(FULL_SESSION_ID, "asks")]);
		expect(live.get("t-session-u86m")).toBe("asks");
	});

	it("ignores a session id that only contains the short id elsewhere", () => {
		const live = matchLiveTasks([task("T-SESSION-f1ca")], [session(FULL_SESSION_ID, "running")]);
		expect(live.size).toBe(0);
	});
});

describe("matchLiveTasks description fallback", () => {
	it("matches the backticked id on the first description line", () => {
		const entry = task("T-21.1", { description: "`8QD` · opencode · opus · 09-25\n\nrework" });
		const live = matchLiveTasks([entry], [session("ses_xyz8QD", "running")]);
		expect(live.get("T-21.1")).toBe("running");
	});

	it("ignores backticked ids after the first line", () => {
		const entry = task("T-21.1", { description: "`8QD` · opencode\n\n**Subagents folded** (1): `bBkLBj`" });
		const live = matchLiveTasks([entry], [session("bBkLBj", "running")]);
		expect(live.size).toBe(0);
	});

	it("skips leading blank lines before the first line", () => {
		const entry = task("T-28.1", { description: "\n  `gNl` · opencode · opus" });
		const live = matchLiveTasks([entry], [session("gNl", "asks")]);
		expect(live.get("T-28.1")).toBe("asks");
	});
});

describe("matchLiveTasks root aggregation", () => {
	const root = task("T-21", { labels: [ROOT_LABEL] });
	const first = task("T-21.1", { parentTaskId: "T-21", description: "`8QD` · opencode" });
	const second = task("T-21.2", { parentTaskId: "t-21", description: "`gNl` · opencode" });

	it("marks a root live when one of its subtasks is live", () => {
		const live = matchLiveTasks([root, first, second], [session("gNl", "asks")]);
		expect(live.get("T-21")).toBe("asks");
	});

	it("lets running win over asks on the root", () => {
		const live = matchLiveTasks([root, first, second], [session("gNl", "asks"), session("8QD", "running")]);
		expect(live.get("T-21")).toBe("running");
		expect(live.get("T-21.2")).toBe("asks");
	});

	it("does not aggregate onto a parent without the root label", () => {
		const parent = task("T-21");
		const live = matchLiveTasks([parent, first], [session("8QD", "running")]);
		expect(live.has("T-21")).toBe(false);
	});
});

describe("parseActivityMessage", () => {
	it("reads the sessions of an activity message", () => {
		const sessions = [session("8QD", "running")];
		const parsed = parseActivityMessage(JSON.stringify({ type: ACTIVITY_MESSAGE_TYPE, sessions }));
		expect(parsed).toEqual(sessions);
	});

	it("rejects other socket messages", () => {
		expect(parseActivityMessage("tasks-updated")).toBeNull();
		expect(parseActivityMessage(JSON.stringify({ type: "loaded" }))).toBeNull();
	});
});
