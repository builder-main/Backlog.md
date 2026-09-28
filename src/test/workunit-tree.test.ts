import { describe, expect, it } from "bun:test";
import type { Task } from "../types/index.ts";
import {
	buildWorkUnitTree,
	formatWorkUnitTitle,
	indexTasksById,
	listWorkUnitNodes,
	matchesWorkUnitFilter,
	type WorkUnitNode,
	workUnitKey,
} from "../utils/workunit-tree.ts";

const makeTask = (overrides: Partial<Task>): Task => ({
	id: "T-1",
	title: "Task",
	status: "To Do",
	assignee: [],
	labels: [],
	dependencies: [],
	createdDate: "2026-01-01 10:00",
	...overrides,
});

const makeRoot = (id: string, path: string, overrides: Partial<Task> = {}): Task =>
	makeTask({ id, title: `Root ${id}`, labels: ["root", `wu:${path}`], ...overrides });

const makeSession = (id: string, parentTaskId: string, overrides: Partial<Task> = {}): Task =>
	makeTask({ id, title: `Session ${id}`, parentTaskId, ...overrides });

const findNode = (nodes: WorkUnitNode[], key: string): WorkUnitNode | undefined =>
	listWorkUnitNodes(nodes).find((node) => node.key === key);

describe("workUnitKey", () => {
	it("normalizes case, whitespace and empty segments", () => {
		expect(workUnitKey(" Lyra//STPS/ ")).toBe("lyra/stps");
	});
});

describe("formatWorkUnitTitle", () => {
	it("turns the last slug segment into a readable title", () => {
		expect(formatWorkUnitTitle("lyra/towercoop/feature-batch")).toBe("Feature batch");
		expect(formatWorkUnitTitle("lyra")).toBe("Lyra");
	});
});

describe("buildWorkUnitTree", () => {
	it("creates missing ancestors from the wu label path", () => {
		const tree = buildWorkUnitTree([makeRoot("T-19", "lyra/towercoop/feature-batch")]);

		expect(tree.map((node) => node.key)).toEqual(["lyra"]);
		expect(listWorkUnitNodes(tree).map((node) => [node.key, node.depth])).toEqual([
			["lyra", 0],
			["lyra/towercoop", 1],
			["lyra/towercoop/feature-batch", 2],
		]);
		expect(findNode(tree, "lyra")?.members).toEqual([]);
	});

	it("ignores tasks without the root label or without a wu label", () => {
		const tree = buildWorkUnitTree([
			makeTask({ id: "T-1", labels: ["wu:lyra"] }),
			makeTask({ id: "T-2", labels: ["root"] }),
		]);

		expect(tree).toEqual([]);
	});

	it("attaches sessions by parent and lists shared sessions without counting them", () => {
		const tasks = [
			makeRoot("T-8", "lyra/stps", { status: "Done" }),
			makeSession("T-8.1", "T-8", { status: "Done" }),
			makeRoot("T-15", "lyra/stps", { status: "In Progress", references: ["commit:abc", "T-8.1"] }),
			makeSession("T-15.1", "T-15"),
		];
		const node = findNode(buildWorkUnitTree(tasks), "lyra/stps");

		expect(node?.members.map((member) => member.root.id)).toEqual(["T-8", "T-15"]);
		const sharing = node?.members.find((member) => member.root.id === "T-15");
		expect(sharing?.sessions.map((task) => task.id)).toEqual(["T-15.1"]);
		expect(sharing?.sharedSessions.map((task) => task.id)).toEqual(["T-8.1"]);
		expect(node?.own.total).toBe(4);
	});

	it("counts Done, Abandoned and Rejected as closed and tracks blocked", () => {
		const tasks = [
			makeRoot("T-1", "admin", { status: "Done" }),
			makeRoot("T-2", "admin", { status: "Abandoned" }),
			makeRoot("T-3", "admin", { status: "Rejected" }),
			makeRoot("T-4", "admin", { status: "Blocked" }),
		];
		const node = findNode(buildWorkUnitTree(tasks), "admin");

		expect(node?.own.statusCounts).toEqual({ Done: 1, Abandoned: 1, Rejected: 1, Blocked: 1 });
		expect(node?.own.closed).toBe(3);
		expect(node?.own.progress).toBe(75);
		expect(node?.own.blocked).toBe(1);
	});

	it("rolls descendant stats up into ancestors", () => {
		const tasks = [
			makeRoot("T-29", "lyra", { status: "Done", createdDate: "2026-01-01 10:00" }),
			makeRoot("T-6", "lyra/stps", { status: "Blocked", createdDate: "2026-01-02 10:00" }),
			makeSession("T-6.1", "T-6", { createdDate: "2026-01-02 10:00", updatedDate: "2026-03-01 09:00" }),
		];
		const lyra = findNode(buildWorkUnitTree(tasks), "lyra");

		expect(lyra?.own.total).toBe(1);
		expect(lyra?.own.lastActivity).toBe("2026-01-01 10:00");
		expect(lyra?.rollup.total).toBe(3);
		expect(lyra?.rollup.closed).toBe(1);
		expect(lyra?.rollup.progress).toBe(33);
		expect(lyra?.rollup.blocked).toBe(1);
		expect(lyra?.rollup.lastActivity).toBe("2026-03-01 09:00");
	});

	it("collects the projects of the roots under a node", () => {
		const tasks = [makeRoot("T-1", "lyra", { project: "Lyra" }), makeRoot("T-2", "lyra/stps", { project: "Lyra" })];

		expect(findNode(buildWorkUnitTree(tasks), "lyra")?.projects).toEqual(["Lyra"]);
	});
});

describe("matchesWorkUnitFilter", () => {
	const tasks = [
		makeRoot("T-6", "lyra/stps"),
		makeSession("T-6.1", "T-6"),
		makeRoot("T-19", "lyra/towercoop/feature-batch"),
		makeRoot("T-34", "lmm"),
		makeSession("T-34.1", "T-34"),
		makeRoot("T-15", "lyra/stps-extra", { references: ["T-34.1"] }),
	];
	const tasksById = indexTasksById(tasks);
	const matching = (path: string) =>
		tasks.filter((task) => matchesWorkUnitFilter(task, path, tasksById)).map((task) => task.id);

	it("matches roots of the path and its descendants plus their sessions", () => {
		expect(matching("lyra")).toEqual(["T-6", "T-6.1", "T-19", "T-15"]);
	});

	it("matches whole segments only", () => {
		expect(matching("lyra/stps")).toEqual(["T-6", "T-6.1"]);
		expect(matching("lyra/st")).toEqual([]);
	});

	it("does not pull in shared sessions through references", () => {
		expect(matching("lyra/stps-extra")).toEqual(["T-15"]);
	});

	it("normalizes the filter path", () => {
		expect(matching("LMM/")).toEqual(["T-34", "T-34.1"]);
	});
});
