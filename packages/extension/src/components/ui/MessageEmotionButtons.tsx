import React, { useState } from 'react'
import { ThumbsUp, ThumbsDown, Flag } from 'lucide-react'

interface MessageEmotionButtonsProps {
  messageId: string | number
  message: any
  onEmotionClick: (event: string, messageId: string | number, message: any, feedback?: string) => void
  isCurrentUser: boolean
}

const MessageEmotionButtons: React.FC<MessageEmotionButtonsProps> = ({
  messageId,
  message,
  onEmotionClick,
  isCurrentUser,
}) => {
  const [feedbackMode, setFeedbackMode] = useState<'dislike' | 'report' | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const [liked, setLiked] = useState(false)

  if (isCurrentUser) {
    return null
  }

  const sanitize = (text: string) => {
    // strip control chars, limit length to prevent injection
    const cleaned = text.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 500)
    return cleaned.trim()
  }

  const submitFeedback = (type: 'dislike' | 'report') => {
    const safe = sanitize(feedbackText)
    if (safe) {
      const tagged = `<user_feedback>${safe}</user_feedback>`
      onEmotionClick(type, messageId, message, tagged)
    }
    setFeedbackMode(null)
    setFeedbackText('')
  }

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation()
    setLiked(true)
    onEmotionClick('like', messageId, message)
  }
  const handleDislike = (e: React.MouseEvent) => { e.stopPropagation(); setFeedbackMode('dislike'); setFeedbackText('') }
  const handleReport = (e: React.MouseEvent) => { e.stopPropagation(); setFeedbackMode('report'); setFeedbackText('') }

  if (feedbackMode) {
    return (
      <div className="mt-1 w-full">
        <textarea
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          onClick={e => e.stopPropagation()}
          placeholder={feedbackMode === 'dislike' ? 'What did you dislike? (feedback for skill)' : 'Report details... (feedback for skill)'}
          className="w-full text-xs p-1 border rounded resize-y min-h-[40px]"
          rows={2}
        />
        <div className="flex gap-1 mt-1">
          <button onClick={(e) => { e.stopPropagation(); submitFeedback(feedbackMode) }} className="text-xs px-2 py-0.5 bg-primary text-primary-foreground rounded">Submit</button>
          <button onClick={(e) => { e.stopPropagation(); setFeedbackMode(null); setFeedbackText('') }} className="text-xs px-2 py-0.5 border rounded">Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 mt-1">
      <button
        onClick={handleLike}
        className={`p-1 rounded-full bg-green-500/10 hover:bg-green-500/20 transition-colors ${liked ? 'text-yellow-500' : 'text-green-600'}`}
        aria-label="Like"
      >
        <ThumbsUp size={14} />
      </button>
      <button
        onClick={handleDislike}
        className="p-1 rounded-full bg-red-500/10 hover:bg-red-500/20 text-red-600 transition-colors"
        aria-label="Dislike"
      >
        <ThumbsDown size={14} />
      </button>
      <button
        onClick={handleReport}
        className="p-1 rounded-full bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 transition-colors"
        aria-label="Report"
      >
        <Flag size={14} />
      </button>
    </div>
  )
}

export default MessageEmotionButtons
