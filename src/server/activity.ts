import {
	ACTIVITY_MESSAGE_TYPE,
	type ActivitySession,
	type ActivityState,
	isActivityState,
} from "../utils/live-activity.ts";

/** A session without a report for this long is treated as gone (crashed agent, closed opencode). */
export const ACTIVITY_TTL_MS = 90_000;
const SWEEP_INTERVAL_MS = 15_000;
const JSON_CONTENT_TYPE = "application/json";

export interface ActivityReport {
	sessionId: string;
	state: ActivityState;
	title?: string;
	directory?: string;
	at: number;
}

interface ActivityEntry extends ActivityReport {
	receivedAt: number;
}

export function parseActivityReport(body: unknown): ActivityReport | null {
	//pre-condition : object, session id, known state, numeric time
	if (typeof body !== "object" || body === null) return null;
	const { sessionId, state, title, directory, at } = body as Record<string, unknown>;
	if (typeof sessionId !== "string" || sessionId.length === 0) return null;
	if (!isActivityState(state)) return null;
	if (typeof at !== "number" || !Number.isFinite(at)) return null;

	//operation : optional strings kept only when typed right
	return {
		sessionId,
		state,
		...(typeof title === "string" ? { title } : {}),
		...(typeof directory === "string" ? { directory } : {}),
		at,
	};
}

/** In-memory session -> latest report. Idle entries stay until expiry so a late, older report cannot revive them. */
export class ActivityStore {
	private readonly entries = new Map<string, ActivityEntry>();

	constructor(private readonly ttlMs = ACTIVITY_TTL_MS) {}

	/** True when the visible snapshot changed. */
	report(report: ActivityReport, now: number): boolean {
		//pre-condition : report not older than the last one
		const previous = this.entries.get(report.sessionId);
		if (previous && report.at < previous.at) return false;

		//operation : latest report, receive time for expiry
		this.entries.set(report.sessionId, { ...report, receivedAt: now });

		//post-condition : state or title change
		return previous?.state !== report.state || previous?.title !== report.title;
	}

	/** Drops expired entries; true when a visible one went away. */
	prune(now: number): boolean {
		//operation : expired entries removed
		let changed = false;
		for (const [sessionId, entry] of this.entries) {
			if (now - entry.receivedAt <= this.ttlMs) continue;
			this.entries.delete(sessionId);
			changed ||= entry.state !== "idle";
		}
		return changed;
	}

	snapshot(now: number): ActivitySession[] {
		//operation : live, unexpired entries
		const sessions: ActivitySession[] = [];
		for (const { receivedAt, state, ...rest } of this.entries.values()) {
			if (state === "idle" || now - receivedAt > this.ttlMs) continue;
			sessions.push({ ...rest, state });
		}
		return sessions;
	}
}

/** The server's activity surface: REST routes, websocket broadcast, expiry sweep. Nothing is persisted. */
export class ActivityFeed {
	private readonly store = new ActivityStore();
	private sweepTimer?: ReturnType<typeof setInterval>;

	constructor(private readonly publish: (message: string) => void) {}

	readonly routes = {
		GET: () => Response.json(this.store.snapshot(Date.now())),
		POST: async (req: Request) => await this.handleReport(req),
	};

	start(): void {
		//pre-condition : not already sweeping
		if (this.sweepTimer) return;

		//operation : periodic expiry, broadcast on change
		this.sweepTimer = setInterval(() => {
			if (this.store.prune(Date.now())) this.broadcast();
		}, SWEEP_INTERVAL_MS);
	}

	stop(): void {
		clearInterval(this.sweepTimer);
		this.sweepTimer = undefined;
	}

	/** Snapshot message for a client that just connected; undefined when nothing is live. */
	greeting(): string | undefined {
		//pre-condition : live session
		const sessions = this.store.snapshot(Date.now());
		if (sessions.length === 0) return undefined;

		//operation : snapshot message
		return JSON.stringify({ type: ACTIVITY_MESSAGE_TYPE, sessions });
	}

	private broadcast(): void {
		this.publish(JSON.stringify({ type: ACTIVITY_MESSAGE_TYPE, sessions: this.store.snapshot(Date.now()) }));
	}

	private async handleReport(req: Request): Promise<Response> {
		// A JSON content type forces a CORS preflight, which this server never grants, so web pages cannot post here.
		//pre-condition : JSON body, valid report
		if (!req.headers.get("content-type")?.includes(JSON_CONTENT_TYPE)) {
			return Response.json({ error: `Content-Type must be ${JSON_CONTENT_TYPE}` }, { status: 415 });
		}
		const report = parseActivityReport(await req.json().catch(() => null));
		if (!report) return Response.json({ error: "Invalid activity report" }, { status: 400 });

		//operation : store, broadcast on visible change
		if (this.store.report(report, Date.now())) this.broadcast();
		return new Response(null, { status: 204 });
	}
}
