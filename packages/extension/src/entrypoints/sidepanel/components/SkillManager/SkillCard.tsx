import { Copy, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Skill } from '@page-agent/core/skills'

interface SkillCardProps {
  skill: Skill
  onEdit: (skill: Skill) => void
  onDelete: (id: string) => void
  onClone: (skill: Skill) => void
}

export function SkillCard({ skill, onEdit, onDelete, onClone }: SkillCardProps) {
  return (
    <div className="border rounded-lg p-3 space-y-1.5 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium truncate">{skill.displayName}</span>
            {skill.isBuiltIn && (
              <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                built-in
              </span>
            )}
          </div>
          <code className="text-[10px] text-muted-foreground font-mono">{skill.name}</code>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 cursor-pointer"
            title="Clone and customize"
            onClick={() => onClone(skill)}
          >
            <Copy className="size-3" />
          </Button>
          {!skill.isBuiltIn && (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 cursor-pointer"
                title="Edit skill"
                onClick={() => onEdit(skill)}
              >
                <Pencil className="size-3" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6 text-destructive hover:text-destructive cursor-pointer"
                title="Delete skill"
                onClick={() => onDelete(skill.id)}
              >
                <Trash2 className="size-3" />
              </Button>
            </>
          )}
          {skill.isBuiltIn && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-6 cursor-pointer"
              title="Edit built-in (clone first)"
              onClick={() => onEdit(skill)}
              disabled
            >
              <Pencil className="size-3" />
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
      {skill.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {skill.tags.map((tag) => (
            <span
              key={tag}
              className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
