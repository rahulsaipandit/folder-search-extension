/**
 * Grants the extension origin microphone / camera access. Side panels usually cannot show Chrome's
 * permission prompt, but a normal tab can, and the grant is stored for the whole extension origin,
 * so the side panel's own getUserMedia() succeeds afterwards. Opened with `?kind=audio|video`.
 */
const kind = new URLSearchParams(location.search).get('kind') === 'video' ? 'video' : 'audio'
const device = kind === 'video' ? 'camera' : 'microphone'

const title = document.getElementById('title')!
const status = document.getElementById('status')!
const retry = document.getElementById('retry') as HTMLButtonElement

title.textContent = `Allow ${device} access`

async function request(): Promise<void> {
	retry.hidden = true
	status.className = ''
	status.textContent = `Your browser will ask to use the ${device}. Choose Allow. Nothing is recorded or uploaded here: it is only used when you press the ${device} button in Folder Search.`
	try {
		const stream = await navigator.mediaDevices.getUserMedia(kind === 'video' ? { video: true } : { audio: true })
		stream.getTracks().forEach(t => t.stop())
		title.textContent = 'All set'
		status.textContent = `${device[0]!.toUpperCase()}${device.slice(1)} access is allowed. This tab will close; go back to Folder Search and try again.`
		setTimeout(() => window.close(), 1500)
	} catch (e) {
		const name = e instanceof DOMException ? e.name : ''
		status.className = 'err'
		if (name === 'NotFoundError') {
			status.textContent = `No ${device} was found on this device.`
		} else if (name === 'NotAllowedError') {
			status.textContent = `${device[0]!.toUpperCase()}${device.slice(1)} access is blocked for this extension. Click the lock or tune icon in the address bar, set ${device === 'camera' ? 'Camera' : 'Microphone'} to Allow, then press the button below.`
		} else {
			status.textContent = `Could not use the ${device}: ${e instanceof Error ? e.message : String(e)}`
		}
		retry.hidden = false
	}
}

retry.addEventListener('click', () => void request())
void request()
