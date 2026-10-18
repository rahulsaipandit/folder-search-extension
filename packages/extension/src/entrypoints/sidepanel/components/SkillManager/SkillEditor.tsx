import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { Skill } from '@page-agent/core/skills'

interface SkillEditorProps {
  skill?: Skill
  onSave: (skill: Skill) => void
  onCancel: () => void
}

function makeEmpty(): Omit<Skill, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '',
    displayName: '',
    description: '',
    tags: [],
    instructionBody: '',
    version: '1.0.0',
    author: 'user',
    isBuiltIn: false,
  }
}

export function SkillEditor({ skill, onSave, onCancel }: SkillEditorProps) {
  const isNew = !skill
  const [form, setForm] = useState<Omit<Skill, 'id' | 'createdAt' | 'updatedAt'>>(
    skill
      ? {
          name: skill.name,
          displayName: skill.displayName,
          description: skill.description,
          tags: skill.tags,
          instructionBody: skill.instructionBody,
          version: skill.version,
          author: skill.author,
          isBuiltIn: skill.isBuiltIn,
        }
      : makeEmpty()
  )
  const [tagsInput, setTagsInput] = useState(skill?.tags.join(', ') ?? '')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    if (!form.name.trim()) errs.name = 'Name is required'
    else if (!/^[a-z0-9-]+$/.test(form.name)) errs.name = 'Lowercase letters, numbers, and hyphens only'
    if (!form.displayName.trim()) errs.displayName = 'Display name is required'
    if (!form.description.trim()) errs.description = 'Description is required — it controls when this skill activates'
    if (!form.instructionBody.trim()) errs.instructionBody = 'Instruction body is required'
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = () => {
    if (!validate()) return
    const now = Date.now()
    onSave({
      ...form,
      id: skill?.id ?? crypto.randomUUID(),
      createdAt: skill?.createdAt ?? now,
      updatedAt: now,
      tags: tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
    })
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">{isNew ? 'New Skill' : `Edit: ${skill.displayName}`}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-xs h-7 cursor-pointer" onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" className="text-xs h-7 cursor-pointer" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-medium">
            Display Name <span className="text-destructive">*</span>
          </label>
          <input
            className="w-full text-xs border rounded-md px-2 py-1.5 bg-background"
            placeholder="e.g. Code Reviewer"
            value={form.displayName}
            onChange={set('displayName')}
          />
          {errors.displayName && <p className="text-[10px] text-destructive">{errors.displayName}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">
            Name (identifier) <span className="text-destructive">*</span>
          </label>
          <input
            className="w-full text-xs border rounded-md px-2 py-1.5 bg-background font-mono"
            placeholder="e.g. code-reviewer"
            value={form.name}
            onChange={set('name')}
          />
          <p className="text-[10px] text-muted-foreground">Lowercase, hyphens only.</p>
          {errors.name && <p className="text-[10px] text-destructive">{errors.name}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">
            Description <span className="text-destructive">*</span>
          </label>
          <textarea
            className="w-full text-xs border rounded-md px-2 py-1.5 bg-background min-h-[56px] resize-none"
            placeholder='e.g. "Use when reviewing code for correctness, style, or security issues."'
            value={form.description}
            onChange={set('description')}
          />
          <p className="text-[10px] text-muted-foreground">
            Most important field. Write as "Use when..." or "Applies when...". 1–3 sentences.
          </p>
          {errors.description && <p className="text-[10px] text-destructive">{errors.description}</p>}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Tags</label>
          <input
            className="w-full text-xs border rounded-md px-2 py-1.5 bg-background"
            placeholder="e.g. coding, review, javascript"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
          />
          <p className="text-[10px] text-muted-foreground">Comma-separated.</p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">
            Instructions <span className="text-destructive">*</span>
          </label>
          <textarea
            className="w-full text-xs border rounded-md px-2 py-1.5 bg-background min-h-[200px] resize-y font-mono"
            placeholder="What the LLM should do when this skill is active. Write as if briefing a senior expert: steps, rules, examples, tone, format requirements."
            value={form.instructionBody}
            onChange={set('instructionBody')}
          />
          {errors.instructionBody && (
            <p className="text-[10px] text-destructive">{errors.instructionBody}</p>
          )}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium">Version</label>
          <input
            className="w-full text-xs border rounded-md px-2 py-1.5 bg-background font-mono"
            placeholder="1.0.0"
            value={form.version}
            onChange={set('version')}
          />
        </div>
      </div>
    </div>
  )
}
