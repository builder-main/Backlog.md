import React, { createContext, useContext, useMemo } from 'react';
import { type Task } from '../../types';
import { type ActivitySession, type LiveState, matchLiveTasks } from '../../utils/live-activity';

const EMPTY_LIVE = new Map<string, LiveState>();

/** Card outline per live state; the styles live in source.css. */
export const LIVE_RING_CLASS: Record<LiveState, string> = {
	running: 'live-ring-running',
	asks: 'live-ring-asks',
};

const LiveActivityContext = createContext<Map<string, LiveState>>(EMPTY_LIVE);

/** Live agent state of one board entry, or undefined when no session works on it. */
export const useLiveActivity = (taskId: string) => useContext(LiveActivityContext).get(taskId);

interface LiveActivityProviderProps {
	tasks: Task[];
	sessions: ActivitySession[];
	children: React.ReactNode;
}

/** Sessions arrive on the App's websocket (activity-updated); this maps them onto board entries. */
export const LiveActivityProvider: React.FC<LiveActivityProviderProps> = ({ tasks, sessions, children }) => {
	const live = useMemo(() => matchLiveTasks(tasks, sessions), [tasks, sessions]);

	return <LiveActivityContext.Provider value={live}>{children}</LiveActivityContext.Provider>;
};
