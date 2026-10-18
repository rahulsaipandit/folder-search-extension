export type View =
	| { name: 'chat' }
	| { name: 'config' }
	| { name: 'settings' }
	| { name: 'history' }
	| { name: 'history-detail'; sessionId: string }
	| { name: 'widgets' }
	| { name: 'dashboard' }
	| { name: 'library' }
	| { name: 'memory' }
	| { name: 'skill-manager' }
	| { name: 'how-do-i' }
