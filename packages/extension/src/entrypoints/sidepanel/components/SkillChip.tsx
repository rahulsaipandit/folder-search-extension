import { X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Skill } from '@page-agent/core/skills'

interface SkillChipProps {
  skill: Skill
  onDismiss: () => void
}

export function SkillChip({ skill, onDismiss }: SkillChipProps) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary w-fit max-w-full">
      <Zap className="size-3 flex-shrink-0" />
      <span className="text-[11px] font-medium truncate">{skill.displayName}</span>
      <Button
        variant="ghost"
        size="icon-sm"
        className="size-4 p-0 hover:bg-primary/20 cursor-pointer flex-shrink-0"
        onClick={onDismiss}
        title="Dismiss skill"
      >
        <X className="size-2.5" />
      </Button>
    </div>
  )
}
