import { useCallback, useEffect, useRef, useState } from 'react'
import { CornerUpLeft, Download, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SkillList } from './SkillList'
import { SkillEditor } from './SkillEditor'
import { exportSkillsToJSON, importSkillsFromJSON } from '@page-agent/core/skills'
import type { Skill } from '@page-agent/core/skills'
import { getAllSkills, saveSkill, deleteSkill, seedDefaultSkills } from '@/skills/skill-store'

interface SkillManagerViewProps {
  onBack: () => void
}

type ManagerMode = { type: 'list' } | { type: 'edit'; skill: Skill } | { type: 'new' }

export function SkillManagerView({ onBack }: SkillManagerViewProps) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [mode, setMode] = useState<ManagerMode>({ type: 'list' })
  const importRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    await seedDefaultSkills()
    setSkills(await getAllSkills())
  }, [])

  useEffect(() => { reload() }, [reload])

  const handleSave = async (skill: Skill) => {
    await saveSkill(skill)
    await reload()
    setMode({ type: 'list' })
  }

  const handleDelete = async (id: string) => {
    await deleteSkill(id)
    await reload()
  }

  const handleClone = (source: Skill) => {
    const now = Date.now()
    const clone: Skill = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name}-copy`,
      displayName: `${source.displayName} (Copy)`,
      isBuiltIn: false,
      createdAt: now,
      updatedAt: now,
    }
    setMode({ type: 'edit', skill: clone })
  }

  const handleExport = () => {
    const userSkills = skills.filter((s) => !s.isBuiltIn)
    const blob = new Blob([exportSkillsToJSON(userSkills)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'skills-export.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      const imported = importSkillsFromJSON(text)
      for (const skill of imported) {
        const existing = skills.find((s) => s.name === skill.name)
        await saveSkill({
          ...skill,
          id: existing?.id ?? skill.id,
          name: existing ? `${skill.name}-imported` : skill.name,
          isBuiltIn: false,
        })
      }
      await reload()
    } catch (err) {
      console.error('[SkillManager] Import failed:', err)
    }
    if (importRef.current) importRef.current.value = ''
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={mode.type === 'list' ? onBack : () => setMode({ type: 'list' })}
            className="cursor-pointer"
          >
            <CornerUpLeft className="size-3.5" />
          </Button>
          <span className="text-sm font-medium">Skill Manager</span>
        </div>
        {mode.type === 'list' && (
          <div className="flex items-center gap-1">
            <input
              ref={importRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImport}
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 cursor-pointer"
              title="Import skills from JSON"
              onClick={() => importRef.current?.click()}
            >
              <Upload className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 cursor-pointer"
              title="Export user skills to JSON"
              onClick={handleExport}
            >
              <Download className="size-3.5" />
            </Button>
          </div>
        )}
      </header>

      <main className="flex-1 overflow-hidden">
        {mode.type === 'list' && (
          <SkillList
            skills={skills}
            onNew={() => setMode({ type: 'new' })}
            onEdit={(skill) => setMode({ type: 'edit', skill })}
            onDelete={handleDelete}
            onClone={handleClone}
          />
        )}
        {(mode.type === 'new' || mode.type === 'edit') && (
          <SkillEditor
            skill={mode.type === 'edit' ? mode.skill : undefined}
            onSave={handleSave}
            onCancel={() => setMode({ type: 'list' })}
          />
        )}
      </main>
    </div>
  )
}
