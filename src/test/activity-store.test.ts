import { describe, expect, it } from "bun:test";
import { ACTIVITY_TTL_MS, ActivityStore, parseActivityReport } from "../server/activity.ts";

const NOW = 1_000_000;

describe("ActivityStore", () => {
	it("lists a running session and hides it once idle", () => {
		const store = new ActivityStore();
		expect(store.report({ sessionId: "8QD", state: "running", at: 1 }, NOW)).toBe(true);
		expect(store.snapshot(NOW).map((s) => s.state)).toEqual(["running"]);

		expect(store.report({ sessionId: "8QD", state: "idle", at: 2 }, NOW)).toBe(true);
		expect(store.snapshot(NOW)).toEqual([]);
	});

	it("reports no change for a heartbeat of the same state", () => {
		const store = new ActivityStore();
		store.report({ sessionId: "8QD", state: "running", at: 1 }, NOW);
		expect(store.report({ sessionId: "8QD", state: "running", at: 2 }, NOW + 1)).toBe(false);
	});

	it("ignores a report older than the last one seen for the session", () => {
		const store = new ActivityStore();
		store.report({ sessionId: "8QD", state: "idle", at: 5 }, NOW);
		expect(store.report({ sessionId: "8QD", state: "running", at: 4 }, NOW)).toBe(false);
		expect(store.snapshot(NOW)).toEqual([]);
	});

	it("expires a session without heartbeat after the TTL", () => {
		const store = new ActivityStore();
		store.report({ sessionId: "gNl", state: "asks", at: 1 }, NOW);
		expect(store.prune(NOW + ACTIVITY_TTL_MS)).toBe(false);
		expect(store.snapshot(NOW + ACTIVITY_TTL_MS)).toHaveLength(1);

		expect(store.prune(NOW + ACTIVITY_TTL_MS + 1)).toBe(true);
		expect(store.snapshot(NOW + ACTIVITY_TTL_MS + 1)).toEqual([]);
	});

	it("keeps a session alive while heartbeats arrive", () => {
		const store = new ActivityStore();
		store.report({ sessionId: "gNl", state: "running", at: 1 }, NOW);
		store.report({ sessionId: "gNl", state: "running", at: 2 }, NOW + ACTIVITY_TTL_MS);
		expect(store.prune(NOW + ACTIVITY_TTL_MS + 1)).toBe(false);
		expect(store.snapshot(NOW + ACTIVITY_TTL_MS + 1)).toHaveLength(1);
	});
});

describe("parseActivityReport", () => {
	it("accepts a full report", () => {
		const body = { sessionId: "ses_1", state: "asks" as const, title: "t", directory: "D:/x", at: 3 };
		expect(parseActivityReport(body)).toEqual(body);
	});

	it("rejects unknown states, missing ids and non-numeric times", () => {
		expect(parseActivityReport({ sessionId: "ses_1", state: "busy", at: 1 })).toBeNull();
		expect(parseActivityReport({ sessionId: "", state: "idle", at: 1 })).toBeNull();
		expect(parseActivityReport({ sessionId: "ses_1", state: "idle", at: "1" })).toBeNull();
		expect(parseActivityReport(null)).toBeNull();
	});

	it("drops optional fields of the wrong type", () => {
		expect(parseActivityReport({ sessionId: "ses_1", state: "idle", at: 1, title: 4 })).toEqual({
			sessionId: "ses_1",
			state: "idle",
			at: 1,
		});
	});
});
