import type { Task } from "../types/index.ts";

/**
 * Live agent activity, reported by an opencode plugin and shown on board cards. Shared by the
 * server (store, broadcast) and the web client (matching sessions to entries).
 */
export const ACTIVITY_STATES = ["running", "asks", "idle"] as const;
export type ActivityState = (typeof ACTIVITY_STATES)[number];
export type LiveState = Exclude<ActivityState, "idle">;

export const ACTIVITY_API_PATH = "/api/activity";
export const ACTIVITY_MESSAGE_TYPE = "activity-updated";

export interface ActivitySession {
	sessionId: string;
	state: LiveState;
	title?: string;
	directory?: string;
	at: number;
}

export type LiveTaskFields = Pick<Task, "id" | "labels" | "description" | "parentTaskId">;

const ROOT_LABEL = "root";
const SESSION_ID_MARKER = /-SESSION-(.+)$/i;
const BACKTICKED = /`([^`\s]+)`/g;
// Higher rank wins when several sessions light the same entry.
const STATE_RANK: Record<LiveState, number> = { asks: 1, running: 2 };

export function isActivityState(value: unknown): value is ActivityState {
	return typeof value === "string" && (ACTIVITY_STATES as readonly string[]).includes(value);
}

export function strongerState(current: LiveState | undefined, next: LiveState): LiveState {
	//pre-condition : no current state
	if (!current) return next;

	//operation : higher rank
	return STATE_RANK[next] > STATE_RANK[current] ? next : current;
}

export function parseActivityMessage(value: unknown): ActivitySession[] | null {
	//pre-condition : JSON object string
	if (typeof value !== "string" || !value.startsWith("{")) return null;

	//operation : activity type, sessions array
	try {
		const message = JSON.parse(value) as { type?: unknown; sessions?: unknown };
		if (message.type !== ACTIVITY_MESSAGE_TYPE || !Array.isArray(message.sessions)) return null;
		return message.sessions as ActivitySession[];
	} catch {
		return null;
	}
}

/** Short ids an entry answers to: its `-SESSION-<id>` suffix and the backticked ids on its first description line. */
function sessionTokens(task: LiveTaskFields): string[] {
	//operation : id suffix, first non-blank description line
	const suffix = SESSION_ID_MARKER.exec(task.id)?.[1];
	const firstLine = (task.description ?? "").trimStart().split("\n", 1)[0] ?? "";
	const backticked = [...firstLine.matchAll(BACKTICKED)].map((match) => match[1] as string);

	//post-condition : lowercased tokens
	return (suffix ? [suffix, ...backticked] : backticked).map((token) => token.toLowerCase());
}

/** Entry id -> live state; a `root` entry takes the strongest state of its subtasks. */
export function matchLiveTasks(tasks: LiveTaskFields[], sessions: ActivitySession[]): Map<string, LiveState> {
	//pre-condition : any live session
	const live = new Map<string, LiveState>();
	if (sessions.length === 0) return live;
	const sessionIds = sessions.map((session) => ({ id: session.sessionId.toLowerCase(), state: session.state }));

	//operation : direct matches, then fold onto root parents
	for (const task of tasks) {
		for (const token of sessionTokens(task)) {
			for (const session of sessionIds) {
				if (session.id.endsWith(token)) live.set(task.id, strongerState(live.get(task.id), session.state));
			}
		}
	}
	const roots = new Map(
		tasks.filter((task) => task.labels.includes(ROOT_LABEL)).map((task) => [task.id.toLowerCase(), task.id]),
	);
	for (const task of tasks) {
		const state = live.get(task.id);
		const rootId = task.parentTaskId ? roots.get(task.parentTaskId.toLowerCase()) : undefined;
		if (!state || !rootId) continue;
		live.set(rootId, strongerState(live.get(rootId), state));
	}
	return live;
}
