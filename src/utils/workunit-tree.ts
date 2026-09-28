import type { Task } from "../types/index.ts";
import { canonicalTaskId } from "./task-id.ts";

export const ROOT_TASK_LABEL = "root";
export const WORK_UNIT_LABEL_PREFIX = "wu:";
export const WORK_UNIT_PATH_SEPARATOR = "/";
/** Statuses that finish a work unit member; progress is closed / total. */
export const WORK_UNIT_CLOSED_STATUSES: readonly string[] = ["Done", "Abandoned", "Rejected"];
export const WORK_UNIT_BLOCKED_STATUS = "Blocked";

export interface WorkUnitStats {
	statusCounts: Record<string, number>;
	total: number;
	closed: number;
	progress: number;
	blocked: number;
	lastActivity?: string;
}

export interface WorkUnitMember {
	root: Task;
	sessions: Task[];
	/** Sessions of other roots named in this root's references: listed, never counted. */
	sharedSessions: Task[];
}

export interface WorkUnitNode {
	key: string;
	title: string;
	depth: number;
	children: WorkUnitNode[];
	members: WorkUnitMember[];
	projects: string[];
	own: WorkUnitStats;
	rollup: WorkUnitStats;
}

const normalizeStatus = (status: string | null | undefined): string => (status ?? "").trim().toLowerCase();

const CLOSED_STATUS_KEYS = new Set(WORK_UNIT_CLOSED_STATUSES.map(normalizeStatus));
const BLOCKED_STATUS_KEY = normalizeStatus(WORK_UNIT_BLOCKED_STATUS);

export function workUnitKey(path: string): string {
	return path
		.split(WORK_UNIT_PATH_SEPARATOR)
		.map((segment) => segment.trim().toLowerCase())
		.filter((segment) => segment.length > 0)
		.join(WORK_UNIT_PATH_SEPARATOR);
}

export function formatWorkUnitTitle(path: string): string {
	const segment = workUnitKey(path).split(WORK_UNIT_PATH_SEPARATOR).pop() ?? "";
	const words = segment.replace(/[-_]+/g, " ");
	return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Work unit path of a root task, or undefined for any other task. */
export function getWorkUnitPath(task: Task): string | undefined {
	//pre-condition : root label
	const labels = task.labels ?? [];
	if (!labels.some((label) => label.trim().toLowerCase() === ROOT_TASK_LABEL)) return undefined;

	//operation : first wu label -> normalized path
	const workUnitLabel = labels.find((label) => label.trim().toLowerCase().startsWith(WORK_UNIT_LABEL_PREFIX));
	const path = workUnitLabel ? workUnitKey(workUnitLabel.trim().slice(WORK_UNIT_LABEL_PREFIX.length)) : "";
	return path.length > 0 ? path : undefined;
}

export function indexTasksById(tasks: readonly Task[]): Map<string, Task> {
	return new Map(tasks.map((task) => [canonicalTaskId(task.id), task]));
}

const isPathWithin = (path: string, ancestor: string): boolean =>
	path === ancestor || path.startsWith(`${ancestor}${WORK_UNIT_PATH_SEPARATOR}`);

/** True for roots under `path` (itself or a descendant) and for the sessions of those roots. */
export function matchesWorkUnitFilter(task: Task, path: string, tasksById: ReadonlyMap<string, Task>): boolean {
	//pre-condition : filter path, owning root
	const filterKey = workUnitKey(path);
	if (!filterKey) return true;
	const parent = task.parentTaskId ? tasksById.get(canonicalTaskId(task.parentTaskId)) : undefined;
	const owner = getWorkUnitPath(task) ? task : parent;
	if (!owner) return false;

	//operation : owner path within filter path
	const ownerPath = getWorkUnitPath(owner);
	return ownerPath !== undefined && isPathWithin(ownerPath, filterKey);
}

const emptyStats = (): WorkUnitStats => ({ statusCounts: {}, total: 0, closed: 0, progress: 0, blocked: 0 });

const laterDate = (left: string | undefined, right: string | undefined): string | undefined =>
	!left || (right && right > left) ? right : left;

function addTaskToStats(stats: WorkUnitStats, task: Task): void {
	const status = normalizeStatus(task.status);
	stats.statusCounts[task.status] = (stats.statusCounts[task.status] ?? 0) + 1;
	stats.total += 1;
	stats.closed += CLOSED_STATUS_KEYS.has(status) ? 1 : 0;
	stats.blocked += status === BLOCKED_STATUS_KEY ? 1 : 0;
	stats.lastActivity = laterDate(stats.lastActivity, task.updatedDate ?? task.createdDate);
}

function mergeStats(target: WorkUnitStats, source: WorkUnitStats): void {
	for (const [status, count] of Object.entries(source.statusCounts)) {
		target.statusCounts[status] = (target.statusCounts[status] ?? 0) + count;
	}
	target.total += source.total;
	target.closed += source.closed;
	target.blocked += source.blocked;
	target.lastActivity = laterDate(target.lastActivity, source.lastActivity);
}

const withProgress = (stats: WorkUnitStats): WorkUnitStats => ({
	...stats,
	progress: stats.total > 0 ? Math.round((stats.closed / stats.total) * 100) : 0,
});

function buildMember(
	root: Task,
	sessionsByRoot: ReadonlyMap<string, Task[]>,
	tasksById: ReadonlyMap<string, Task>,
): WorkUnitMember {
	const rootKey = canonicalTaskId(root.id);
	const sharedSessions = (root.references ?? [])
		.map((reference) => tasksById.get(canonicalTaskId(reference)))
		.filter((task): task is Task => Boolean(task?.parentTaskId && canonicalTaskId(task.parentTaskId) !== rootKey));
	return { root, sessions: sessionsByRoot.get(rootKey) ?? [], sharedSessions };
}

function createNode(key: string): WorkUnitNode {
	return {
		key,
		title: formatWorkUnitTitle(key),
		depth: key.split(WORK_UNIT_PATH_SEPARATOR).length - 1,
		children: [],
		members: [],
		projects: [],
		own: emptyStats(),
		rollup: emptyStats(),
	};
}

/** Node for `key`, creating it and every missing ancestor. */
function ensureNode(nodesByKey: Map<string, WorkUnitNode>, topLevel: WorkUnitNode[], key: string): WorkUnitNode {
	//pre-condition : existing node
	const existing = nodesByKey.get(key);
	if (existing) return existing;

	//operation : new node, attach to parent or top level
	const node = createNode(key);
	nodesByKey.set(key, node);
	const separatorIndex = key.lastIndexOf(WORK_UNIT_PATH_SEPARATOR);
	const siblings =
		separatorIndex < 0 ? topLevel : ensureNode(nodesByKey, topLevel, key.slice(0, separatorIndex)).children;
	siblings.push(node);
	return node;
}

/** Own stats, rollup and projects for `node` and its subtree. */
function finalizeNode(node: WorkUnitNode): void {
	//operation : own stats, children first, rollup, projects
	const own = emptyStats();
	const projects = new Set<string>();
	for (const member of node.members) {
		addTaskToStats(own, member.root);
		for (const session of member.sessions) addTaskToStats(own, session);
		if (member.root.project) projects.add(member.root.project);
	}
	node.children.sort((left, right) => left.key.localeCompare(right.key));
	const rollup = emptyStats();
	mergeStats(rollup, own);
	for (const child of node.children) {
		finalizeNode(child);
		mergeStats(rollup, child.rollup);
		for (const project of child.projects) projects.add(project);
	}
	node.own = withProgress(own);
	node.rollup = withProgress(rollup);
	node.projects = Array.from(projects);
}

/** Work unit tree from the `wu:` labels of root tasks, top-level nodes sorted by key. */
export function buildWorkUnitTree(tasks: readonly Task[]): WorkUnitNode[] {
	//pre-condition : task index, sessions grouped by parent
	const tasksById = indexTasksById(tasks);
	const sessionsByRoot = new Map<string, Task[]>();
	for (const task of tasks) {
		if (!task.parentTaskId) continue;
		const parentKey = canonicalTaskId(task.parentTaskId);
		sessionsByRoot.set(parentKey, [...(sessionsByRoot.get(parentKey) ?? []), task]);
	}

	//operation : nodes per root path, stats bottom-up
	const nodesByKey = new Map<string, WorkUnitNode>();
	const topLevel: WorkUnitNode[] = [];
	for (const task of tasks) {
		const path = getWorkUnitPath(task);
		if (!path) continue;
		ensureNode(nodesByKey, topLevel, path).members.push(buildMember(task, sessionsByRoot, tasksById));
	}
	topLevel.sort((left, right) => left.key.localeCompare(right.key));
	for (const node of topLevel) finalizeNode(node);
	return topLevel;
}

/** Depth-first list of every node in the tree. */
export function listWorkUnitNodes(nodes: readonly WorkUnitNode[]): WorkUnitNode[] {
	return nodes.flatMap((node) => [node, ...listWorkUnitNodes(node.children)]);
}
