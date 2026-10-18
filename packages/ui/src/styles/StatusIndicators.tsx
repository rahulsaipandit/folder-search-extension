import React from 'react'

export const StatusIndicator: React.FC<{ status: string }> = ({ status }) => (
	<div className={`status-indicator ${status.toLowerCase()}`} />
)

export const RunningIndicator: React.FC = () => (
	<div className="running-pulse">
		<div style={{ width: '50%', height: 4, background: 'currentColor', borderRadius: 2 }} />
	</div>
)

export const WaitingIndicator: React.FC = () => (
	<div className="waiting-hourglass">
		<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M5 22h14" />
			<path d="M5 2h14" />
			<path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
			<path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
		</svg>
	</div>
)

export const ScheduledIndicator: React.FC = () => (
	<div className="scheduled-countdown">
		<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="10" />
			<polyline points="12 6 12 12 16 14" />
		</svg>
	</div>
)

export const FailedIndicator: React.FC = () => (
	<div className="failed-error">
		<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<circle cx="12" cy="12" r="10" />
			<line x1="12" y1="8" x2="12" y2="12" />
			<line x1="12" y1="16" x2="12.01" y2="16" />
		</svg>
	</div>
)

export const CompletedIndicator: React.FC = () => (
	<div className="completed-checkmark">
		<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<polyline points="20 6 9 17 4 12" />
		</svg>
	</div>
)

export const DeadLetterIndicator: React.FC = () => (
	<div className="dead-letter">
		<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<line x1="18" y1="6" x2="6" y2="18" />
			<line x1="6" y1="6" x2="18" y2="18" />
		</svg>
	</div>
)
