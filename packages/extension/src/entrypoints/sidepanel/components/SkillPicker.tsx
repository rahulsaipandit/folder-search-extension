import { useEffect, useRef, useState } from 'react'
import { Settings, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Skill } from '@page-agent/core/skills'
import { getAllSkills, seedDefaultSkills } from '@/skills/skill-store'

interface SkillPickerProps {
  activeSkillId: string | null
  onActivate: (skill: Skill) => void
  onManage: () => void
  onClose: () => void
}

export function SkillPicker({ activeSkillId, onActivate, onManage, onClose }: SkillPickerProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    seedDefaultSkills()
      .then(() => getAllSkills())
      .then(setSkills)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose])

  const filtered = skills.filter(
    (s) =>
      !query ||
      s.displayName.toLowerCase().includes(query.toLowerCase()) ||
      s.description.toLowerCase().includes(query.toLowerCase()) ||
      s.tags.some((t) => t.toLowerCase().includes(query.toLowerCase()))
  )

  return (
    <div
      ref={ref}
      className="absolute bottom-full mb-2 left-0 w-72 bg-popover border rounded-lg shadow-lg z-50 overflow-hidden"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-1.5">
          <Zap className="size-3.5 text-primary" />
          <span className="text-xs font-medium">Skills</span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="size-6 cursor-pointer"
          title="Manage skills"
          onClick={onManage}
        >
          <Settings className="size-3" />
        </Button>
      </div>

      {skills.length > 4 && (
        <div className="px-2 pt-2">
          <input
            className="w-full text-xs border rounded-md px-2 py-1.5 bg-background"
            placeholder="Search skills..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
        </div>
      )}

      <div className="max-h-60 overflow-y-auto p-2 space-y-0.5">
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-3">
            {skills.length === 0
              ? 'No skills yet — create one in Skill Manager'
              : 'No matching skills'}
          </p>
        )}
        {filtered.map((skill) => (
          <button
            key={skill.id}
            className={`w-full text-left px-2 py-1.5 rounded-md hover:bg-muted transition-colors ${
              skill.id === activeSkillId ? 'bg-primary/10 text-primary' : ''
            }`}
            onClick={() => {
              onActivate(skill)
              onClose()
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium truncate">{skill.displayName}</span>
              {skill.id === activeSkillId && (
                <span className="text-[9px] text-primary flex-shrink-0">active</span>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground line-clamp-1 mt-0.5">{skill.description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
