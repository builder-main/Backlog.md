import React, { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Task } from "../../types";
import { getProjectValues, matchesProjectFilter, resolveProjectValue } from "../../utils/project-config";
import {
	buildWorkUnitTree,
	getWorkUnitPath,
	isWorkUnitBlockedStatus,
	isWorkUnitClosedStatus,
	WORK_UNIT_QUERY_PARAM,
	type WorkUnitNode,
} from "../../utils/workunit-tree";
import { isDoneStatus } from "../utils/milestones";
import MilestoneTaskRow from "./MilestoneTaskRow";
import ProjectBadge from "./ProjectBadge";
import StoredDate from "./StoredDate";

const PROJECT_PARAM = "project";
const INDENT_REM_PER_DEPTH = 1.5;

interface WorkUnitsPageProps {
	tasks: Task[];
	statuses: string[];
	onEditTask: (task: Task) => void;
	dateFormat?: string;
	availableProjects?: string[];
}

interface StatusTone {
	bar: string;
	badge: string;
}

const getStatusTone = (status: string): StatusTone => {
	if (isWorkUnitBlockedStatus(status)) {
		return { bar: "bg-red-500", badge: "bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300" };
	}
	if (isDoneStatus(status)) {
		return {
			bar: "bg-emerald-500",
			badge: "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300",
		};
	}
	if (isWorkUnitClosedStatus(status)) {
		return { bar: "bg-slate-400", badge: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300" };
	}
	if (status.toLowerCase().includes("progress")) {
		return { bar: "bg-blue-500", badge: "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300" };
	}
	return { bar: "bg-gray-300 dark:bg-gray-600", badge: "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300" };
};

const PRIORITY_BADGE_CLASS = "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300";

const WorkUnitsPage: React.FC<WorkUnitsPageProps> = ({ tasks, statuses, onEditTask, dateFormat, availableProjects }) => {
	const [searchParams, setSearchParams] = useSearchParams();
	const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});
	const projectOptions = useMemo(() => getProjectValues(availableProjects), [availableProjects]);
	const filterProject = resolveProjectValue(searchParams.get(PROJECT_PARAM), availableProjects) ?? "";

	// Only roots carry a project decision; their sessions follow them into or out of the tree.
	const tree = useMemo(
		() =>
			buildWorkUnitTree(
				tasks.filter((task) => !getWorkUnitPath(task) || matchesProjectFilter(task.project, filterProject)),
			),
		[tasks, filterProject],
	);

	const handleProjectChange = (project: string) => {
		setSearchParams(
			(params) => {
				if (project) {
					params.set(PROJECT_PARAM, project);
				} else {
					params.delete(PROJECT_PARAM);
				}
				return params;
			},
			{ replace: true },
		);
	};

	const boardLink = (node: WorkUnitNode) => {
		const params = new URLSearchParams({ [WORK_UNIT_QUERY_PARAM]: node.key });
		if (filterProject) params.set(PROJECT_PARAM, filterProject);
		return `/board?${params.toString()}`;
	};

	const renderTaskRow = (task: Task, indentClass: string, marker?: string) => (
		<div key={`${marker ?? "own"}-${task.id}`} className={`flex items-center ${indentClass}`}>
			{marker && (
				<span className="ml-3 text-[10px] font-medium uppercase tracking-wider text-gray-400 dark:text-gray-500">
					{marker}
				</span>
			)}
			<div className="min-w-0 flex-1">
				<MilestoneTaskRow
					task={task}
					isDone={isWorkUnitClosedStatus(task.status)}
					statusBadgeClass={getStatusTone(task.status).badge}
					priorityBadgeClass={PRIORITY_BADGE_CLASS}
					onEditTask={onEditTask}
				/>
			</div>
		</div>
	);

	const renderStatusBar = (node: WorkUnitNode) => (
		<div
			className="flex h-2 w-40 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
			title={statuses
				.filter((status) => node.rollup.statusCounts[status])
				.map((status) => `${node.rollup.statusCounts[status]} ${status}`)
				.join(", ")}
		>
			{statuses.map((status) => {
				const count = node.rollup.statusCounts[status] ?? 0;
				if (count === 0) return null;
				return (
					<div
						key={status}
						className={getStatusTone(status).bar}
						style={{ width: `${(count / node.rollup.total) * 100}%` }}
					/>
				);
			})}
		</div>
	);

	const renderNode = (node: WorkUnitNode): React.ReactNode => {
		const isExpanded = expandedKeys[node.key] ?? false;
		const indent = { paddingLeft: `${node.depth * INDENT_REM_PER_DEPTH}rem` };
		const listId = `workunit-${node.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

		return (
			<div key={node.key}>
				<div
					className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40"
					style={indent}
				>
					<button
						type="button"
						aria-expanded={isExpanded}
						aria-controls={listId}
						onClick={() => setExpandedKeys((current) => ({ ...current, [node.key]: !isExpanded }))}
						className="flex min-w-0 flex-1 items-center gap-2 text-left"
					>
						<svg
							className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
						</svg>
						<span className="truncate font-semibold text-gray-900 dark:text-gray-100">{node.title}</span>
						<span className="truncate font-mono text-xs text-gray-400 dark:text-gray-500">{node.key}</span>
					</button>
					<div className="flex flex-wrap items-center gap-1">
						{node.projects.map((project) => (
							<ProjectBadge key={project} project={project} availableProjects={availableProjects} />
						))}
					</div>
					<span className="w-16 text-right text-xs text-gray-500 dark:text-gray-400">
						{node.rollup.total} task{node.rollup.total === 1 ? "" : "s"}
					</span>
					{renderStatusBar(node)}
					<span className="w-12 text-right text-sm font-bold text-emerald-600 dark:text-emerald-400">
						{node.rollup.progress}%
					</span>
					<span className="w-20">
						{node.rollup.blocked > 0 && (
							<span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/50 dark:text-red-300">
								{node.rollup.blocked} blocked
							</span>
						)}
					</span>
					<StoredDate
						value={node.rollup.lastActivity}
						dateFormat={dateFormat}
						compact
						className="w-20 text-xs text-gray-500 dark:text-gray-400"
					/>
					<Link
						to={boardLink(node)}
						className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
					>
						Board
					</Link>
				</div>
				{isExpanded && (
					<div
						id={listId}
						className="divide-y divide-gray-100 border-t border-gray-100 dark:divide-gray-700/60 dark:border-gray-700/60"
					>
						{node.members.length > 0 && (
							<div className="divide-y divide-gray-100 dark:divide-gray-700/60" style={indent}>
								{node.members.map((member) => (
									<React.Fragment key={member.root.id}>
										{renderTaskRow(member.root, "pl-6")}
										{member.sessions.map((session) => renderTaskRow(session, "pl-12"))}
										{member.sharedSessions.map((session) => renderTaskRow(session, "pl-12", "shared"))}
									</React.Fragment>
								))}
							</div>
						)}
						{node.children.map(renderNode)}
					</div>
				)}
			</div>
		);
	};

	return (
		<div className="page-shell transition-colors duration-200">
			<div className="mb-6 flex flex-wrap items-center justify-between gap-4">
				<h1 className="text-2xl font-bold text-gray-900 dark:text-white">Work units</h1>
				{projectOptions.length > 0 && (
					<select
						aria-label="Filter work units by project"
						value={filterProject}
						onChange={(event) => handleProjectChange(event.target.value)}
						className="h-10 min-w-[140px] rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
					>
						<option value="">All projects</option>
						{projectOptions.map((project) => (
							<option key={project} value={project}>
								{project}
							</option>
						))}
					</select>
				)}
			</div>
			{tree.length > 0 ? (
				<div className="divide-y divide-gray-200 overflow-hidden rounded-lg border border-gray-200 bg-white dark:divide-gray-700 dark:border-gray-700 dark:bg-gray-800">
					{tree.map(renderNode)}
				</div>
			) : (
				<p className="py-16 text-center text-gray-500 dark:text-gray-400">No work units.</p>
			)}
		</div>
	);
};

export default WorkUnitsPage;
