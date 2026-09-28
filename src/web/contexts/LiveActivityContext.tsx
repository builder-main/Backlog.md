import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { type Task } from '../../types';
import {
	ACTIVITY_API_PATH,
	type ActivitySession,
	type LiveState,
	matchLiveTasks,
	parseActivityMessage,
} from '../../utils/live-activity';

const RECONNECT_DELAY_MS = 3000;
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
	children: React.ReactNode;
}

export const LiveActivityProvider: React.FC<LiveActivityProviderProps> = ({ tasks, children }) => {
	const [sessions, setSessions] = useState<ActivitySession[]>([]);

	useEffect(() => {
		let disposed = false;
		let socket: WebSocket | undefined;
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

		//operation : snapshot on every (re)connect, pushed updates in between
		const connect = () => {
			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			socket = new WebSocket(`${protocol}//${window.location.host}`);
			socket.onopen = () => {
				void fetch(ACTIVITY_API_PATH)
					.then((response) => (response.ok ? (response.json() as Promise<ActivitySession[]>) : []))
					.then((snapshot) => !disposed && setSessions(snapshot))
					.catch(() => {});
			};
			socket.onmessage = (event) => {
				const next = parseActivityMessage(event.data);
				if (next) setSessions(next);
			};
			socket.onclose = () => {
				if (disposed) return;
				setSessions([]);
				reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
			};
		};
		connect();

		return () => {
			disposed = true;
			clearTimeout(reconnectTimer);
			socket?.close();
		};
	}, []);

	const live = useMemo(() => matchLiveTasks(tasks, sessions), [tasks, sessions]);

	return <LiveActivityContext.Provider value={live}>{children}</LiveActivityContext.Provider>;
};
