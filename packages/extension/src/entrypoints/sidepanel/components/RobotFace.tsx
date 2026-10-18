import { useEffect, useRef } from 'react'

export type AvatarState =
  | 'off'
  | 'passive'
  | 'active-idle'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'recording'

interface RobotFaceProps {
  state?: AvatarState
  size?: 'compact' | 'full'
}

// Canvas is always rendered at 500×430 logical pixels (matching robot_face_v2.html)
// and scaled down via CSS to avoid coordinate translation complexity.
const CANVAS_W = 500
const CANVAS_H = 430
const CSS_SIZES = { compact: { w: 100, h: 86 }, full: { w: 200, h: 172 } }

function stateColor(state: AvatarState, alpha: number): string {
  switch (state) {
    case 'listening':   return `rgba(0,212,255,${alpha})`
    case 'active-idle': return `rgba(0,212,255,${alpha * 0.6})`
    case 'thinking':    return `rgba(255,200,0,${alpha})`
    case 'speaking':    return `rgba(255,100,0,${alpha})`
    case 'recording':   return `rgba(255,50,50,${alpha})`
    case 'passive':     return `rgba(100,150,220,${alpha * 0.45})`
    default:            return `rgba(80,100,120,${alpha * 0.25})` // off
  }
}

function helmetHighlight(state: AvatarState): string {
  if (state === 'off') return '#3a4a5a'
  if (state === 'passive') return '#3a5070'
  return '#5a7090'
}

export function RobotFace({ state = 'off', size = 'compact' }: RobotFaceProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Sync state into a ref so the RAF loop picks up changes without remounting
  const stateRef = useRef<AvatarState>(state)
  stateRef.current = state

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const W = CANVAS_W, H = CANVAS_H
    const cx = W / 2, cy = H / 2

    let time = 0, scanY = 0, speakPhase = 0, spinAngle = 0
    let rafId: number

    function draw() {
      ctx!.clearRect(0, 0, W, H)
      time += 0.03

      const s = stateRef.current
      const isAnimated = s !== 'off'
      const breatheY = (s === 'off' || s === 'passive' || s === 'active-idle')
        ? Math.sin(time) * (s === 'off' ? 1.5 : 4)
        : 0
      const glowPulse = (Math.sin(time * 2) + 1) / 2

      if (s === 'thinking') { scanY = (scanY + 1.2) % 80; spinAngle += 0.015 }
      if (s === 'speaking') speakPhase += 0.25

      // Background radial glow
      const bg = ctx!.createRadialGradient(cx, cy + breatheY, 50, cx, cy + breatheY, 250)
      bg.addColorStop(0, stateColor(s, 0.12))
      bg.addColorStop(1, 'rgba(0,0,0,0)')
      ctx!.fillStyle = bg
      ctx!.fillRect(0, 0, W, H)

      ctx!.save()
      ctx!.translate(0, breatheY)

      // ── HELMET SHELL ──
      ctx!.shadowBlur = isAnimated ? 25 : 8
      ctx!.shadowColor = stateColor(s, 1)
      const hg = ctx!.createLinearGradient(cx - 140, 0, cx + 140, 0)
      hg.addColorStop(0, '#2a3a50')
      hg.addColorStop(0.5, helmetHighlight(s))
      hg.addColorStop(1, '#1e293b')
      ctx!.fillStyle = hg
      ctx!.strokeStyle = '#0f172a'
      ctx!.lineWidth = 5
      ctx!.beginPath()
      ctx!.moveTo(cx - 120, cy - 80)
      ctx!.bezierCurveTo(cx - 130, cy - 215, cx + 130, cy - 215, cx + 120, cy - 80)
      ctx!.lineTo(cx + 130, cy + 30)
      ctx!.lineTo(cx + 100, cy + 100)
      ctx!.lineTo(cx + 70,  cy + 148)
      ctx!.lineTo(cx,       cy + 162)
      ctx!.lineTo(cx - 70,  cy + 148)
      ctx!.lineTo(cx - 100, cy + 100)
      ctx!.lineTo(cx - 130, cy + 30)
      ctx!.closePath()
      ctx!.fill()
      ctx!.stroke()
      ctx!.shadowBlur = 0

      // ── EAR CUPS ──
      ctx!.fillStyle = '#1e293b'; ctx!.strokeStyle = '#0f172a'; ctx!.lineWidth = 3
      ctx!.beginPath(); ctx!.rect(cx - 145, cy - 35, 18, 80); ctx!.fill(); ctx!.stroke()
      ctx!.beginPath(); ctx!.rect(cx + 127, cy - 35, 18, 80); ctx!.fill(); ctx!.stroke()
      ctx!.shadowBlur = 10; ctx!.shadowColor = stateColor(s, 1)
      ctx!.fillStyle = stateColor(s, 0.4 + glowPulse * 0.6)
      ctx!.beginPath(); ctx!.arc(cx - 136, cy + 5, 5, 0, Math.PI * 2); ctx!.fill()
      ctx!.beginPath(); ctx!.arc(cx + 136, cy + 5, 5, 0, Math.PI * 2); ctx!.fill()
      ctx!.shadowBlur = 0

      // ── FOREHEAD PANEL ──
      ctx!.fillStyle = '#475569'; ctx!.strokeStyle = '#0f172a'; ctx!.lineWidth = 3
      ctx!.beginPath()
      ctx!.moveTo(cx - 55, cy - 148); ctx!.lineTo(cx + 55, cy - 148)
      ctx!.lineTo(cx + 36, cy - 98); ctx!.lineTo(cx - 36, cy - 98)
      ctx!.closePath(); ctx!.fill(); ctx!.stroke()

      // ── VISOR HOUSING ──
      ctx!.fillStyle = '#0f172a'; ctx!.strokeStyle = '#0a0a14'; ctx!.lineWidth = 4
      ctx!.beginPath()
      ctx!.moveTo(cx - 95, cy - 68); ctx!.lineTo(cx + 95, cy - 68)
      ctx!.lineTo(cx + 105, cy - 10); ctx!.lineTo(cx + 62, cy + 28)
      ctx!.lineTo(cx - 62, cy + 28); ctx!.lineTo(cx - 105, cy - 10)
      ctx!.closePath(); ctx!.fill(); ctx!.stroke()

      // ── VISOR GLOW ──
      ctx!.save()
      ctx!.shadowBlur = 15 + glowPulse * 15; ctx!.shadowColor = stateColor(s, 1)
      const vg = ctx!.createLinearGradient(0, cy - 58, 0, cy + 20)
      vg.addColorStop(0, stateColor(s, 0.9))
      vg.addColorStop(1, stateColor(s, 0.5))
      ctx!.fillStyle = vg
      ctx!.beginPath()
      ctx!.moveTo(cx - 84, cy - 58); ctx!.lineTo(cx + 84, cy - 58)
      ctx!.lineTo(cx + 93, cy - 12); ctx!.lineTo(cx + 56, cy + 20)
      ctx!.lineTo(cx - 56, cy + 20); ctx!.lineTo(cx - 93, cy - 12)
      ctx!.closePath(); ctx!.fill()
      ctx!.restore()

      // Scan lines over visor
      ctx!.strokeStyle = 'rgba(255,255,255,0.15)'; ctx!.lineWidth = 1
      for (let y = cy - 53; y < cy + 20; y += 6) {
        ctx!.beginPath(); ctx!.moveTo(cx - 88, y); ctx!.lineTo(cx + 88, y); ctx!.stroke()
      }

      // Thinking scan beam
      if (s === 'thinking') {
        const eyeTop = cy - 53, eyeH = 73
        const scanLineY = eyeTop + (scanY / 80) * eyeH
        for (const [startX, w] of [[-93, 87], [6, 87]] as [number, number][]) {
          ctx!.save()
          ctx!.beginPath(); ctx!.rect(cx + startX, eyeTop, w, eyeH); ctx!.clip()
          const lg = ctx!.createLinearGradient(0, scanLineY - 10, 0, scanLineY + 10)
          lg.addColorStop(0, 'rgba(255,200,0,0)')
          lg.addColorStop(0.5, 'rgba(255,200,0,0.7)')
          lg.addColorStop(1, 'rgba(255,200,0,0)')
          ctx!.fillStyle = lg
          ctx!.fillRect(cx + startX, scanLineY - 10, w, 20)
          ctx!.restore()
        }
      }

      // ── NOSE ──
      const noseTop = cy + 32, noseMid = cy + 58, noseBot = cy + 78
      const nosGrad = ctx!.createLinearGradient(cx - 18, 0, cx + 18, 0)
      nosGrad.addColorStop(0, '#1e293b'); nosGrad.addColorStop(0.3, '#5a7090')
      nosGrad.addColorStop(0.7, '#3a5068'); nosGrad.addColorStop(1, '#1e293b')
      ctx!.fillStyle = nosGrad; ctx!.strokeStyle = '#0f172a'; ctx!.lineWidth = 2
      ctx!.beginPath()
      ctx!.moveTo(cx - 10, noseTop); ctx!.lineTo(cx + 10, noseTop)
      ctx!.lineTo(cx + 18, noseMid); ctx!.lineTo(cx + 22, noseBot)
      ctx!.lineTo(cx - 22, noseBot); ctx!.lineTo(cx - 18, noseMid)
      ctx!.closePath(); ctx!.fill(); ctx!.stroke()
      ctx!.fillStyle = '#0a0f1a'; ctx!.strokeStyle = '#0f172a'; ctx!.lineWidth = 1
      ctx!.beginPath(); ctx!.ellipse(cx - 10, noseBot - 4, 5, 3, -0.2, 0, Math.PI * 2); ctx!.fill(); ctx!.stroke()
      ctx!.beginPath(); ctx!.ellipse(cx + 10, noseBot - 4, 5, 3,  0.2, 0, Math.PI * 2); ctx!.fill(); ctx!.stroke()
      ctx!.strokeStyle = 'rgba(120,160,200,0.35)'; ctx!.lineWidth = 1.5
      ctx!.beginPath(); ctx!.moveTo(cx, noseTop + 2); ctx!.lineTo(cx, noseMid + 6); ctx!.stroke()

      // ── MOUTH GRILL ──
      const mouthTop = noseBot + 10, mouthBot = mouthTop + 52
      ctx!.fillStyle = '#334155'; ctx!.strokeStyle = '#0f172a'; ctx!.lineWidth = 3
      ctx!.beginPath()
      ctx!.moveTo(cx - 46, mouthTop); ctx!.lineTo(cx + 46, mouthTop)
      ctx!.lineTo(cx + 30, mouthBot); ctx!.lineTo(cx - 30, mouthBot)
      ctx!.closePath(); ctx!.fill(); ctx!.stroke()
      const ventCount = 6
      for (let i = 0; i < ventCount; i++) {
        const u = (i - (ventCount - 1) / 2) * 13
        const vOpen = s === 'speaking' ? Math.abs(Math.sin(speakPhase + i * 0.7)) * 9 : 0
        ctx!.strokeStyle = '#0f172a'; ctx!.lineWidth = 3
        ctx!.beginPath()
        ctx!.moveTo(cx + u, mouthTop + 6); ctx!.lineTo(cx + u * 0.65, mouthBot - 6); ctx!.stroke()
        if (vOpen > 0) {
          ctx!.strokeStyle = stateColor(s, 0.5 + Math.sin(speakPhase + i) * 0.4)
          ctx!.lineWidth = vOpen
          ctx!.beginPath()
          ctx!.moveTo(cx + u + 1, mouthTop + 8); ctx!.lineTo(cx + u * 0.65 + 1, mouthBot - 8); ctx!.stroke()
        }
      }

      // Recording indicator - red dot top-right of visor
      if (s === 'recording') {
        ctx!.save()
        ctx!.shadowBlur = 12; ctx!.shadowColor = 'rgba(255,50,50,1)'
        ctx!.fillStyle = `rgba(255,50,50,${0.7 + glowPulse * 0.3})`
        ctx!.beginPath(); ctx!.arc(cx + 76, cy - 60, 8, 0, Math.PI * 2); ctx!.fill()
        ctx!.restore()
      }

      // ── AURA RING ──
      const auraAlpha = s === 'off' ? 0.05 : s === 'passive' ? 0.08 : s === 'listening' ? 0.18 : 0.13
      ctx!.strokeStyle = stateColor(s, auraAlpha); ctx!.lineWidth = 4
      ctx!.beginPath(); ctx!.arc(cx, cy, 215 + Math.sin(time) * 2, 0, Math.PI * 2); ctx!.stroke()
      if (s === 'listening') {
        ctx!.strokeStyle = `rgba(0,212,255,${0.08 + Math.sin(time * 1.5) * 0.05})`
        ctx!.lineWidth = 2
        ctx!.beginPath(); ctx!.arc(cx, cy, 225 + Math.sin(time * 2) * 3, 0, Math.PI * 2); ctx!.stroke()
      }
      if (s === 'thinking') {
        ctx!.strokeStyle = 'rgba(255,200,0,0.45)'; ctx!.lineWidth = 2
        ctx!.beginPath(); ctx!.arc(cx, cy, 215, spinAngle, spinAngle + Math.PI * 0.7); ctx!.stroke()
        ctx!.beginPath(); ctx!.arc(cx, cy, 215, spinAngle + Math.PI, spinAngle + Math.PI * 1.7); ctx!.stroke()
      }

      ctx!.restore()
      rafId = requestAnimationFrame(draw)
    }

    rafId = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(rafId)
  }, []) // size-independent: canvas always 500×430, CSS handles sizing

  const { w, h } = CSS_SIZES[size]
  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={CANVAS_H}
      style={{ width: w, height: h, borderRadius: 8, display: 'block' }}
    />
  )
}
