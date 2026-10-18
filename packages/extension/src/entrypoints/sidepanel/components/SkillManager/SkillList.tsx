import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkillCard } from './SkillCard'
import type { Skill } from '@page-agent/core/skills'

interface SkillListProps {
  skills: Skill[]
  onNew: () => void
  onEdit: (skill: Skill) => void
  onDelete: (id: string) => void
  onClone: (skill: Skill) => void
}

export function SkillList({ skills, onNew, onEdit, onDelete, onClone }: SkillListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs text-muted-foreground">{skills.length} skill{skills.length !== 1 ? 's' : ''}</span>
        <Button size="sm" className="text-xs h-7 gap-1 cursor-pointer" onClick={onNew}>
          <Plus className="size-3" />
          New Skill
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {skills.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            No skills yet. Create one to augment how the agent responds.
          </p>
        )}
        {skills.map((skill) => (
          <SkillCard
            key={skill.id}
            skill={skill}
            onEdit={onEdit}
            onDelete={onDelete}
            onClone={onClone}
          />
        ))}
      </div>
    </div>
  )
}
