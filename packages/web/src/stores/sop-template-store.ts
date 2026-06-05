import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'

interface SopTemplate {
  id: string
  name: string
  icon: string | null
  description: string | null
  agent_type: 'programming' | 'general' | 'any'
  instruction: string
  input_contract: string | null
  output_contract: string
  plan_template: string | null
  todo_items_json: string | null
  builtin: boolean
  created_at: number
  updated_at: number
}

type SopTemplateDraft = Omit<SopTemplate, 'id' | 'builtin' | 'created_at' | 'updated_at'>

interface SopTemplateState {
  templates: SopTemplate[]
  generatedDraft: SopTemplateDraft | null
  setTemplates: (templates: SopTemplate[]) => void
  setGeneratedDraft: (draft: SopTemplateDraft | null) => void
}

export const useSopTemplateStore = create<SopTemplateState>()(
  immer((set) => ({
    templates: [],
    generatedDraft: null,

    setTemplates: (templates) => {
      set((s) => {
        s.templates = templates
      })
    },

    setGeneratedDraft: (draft) => {
      set((s) => {
        s.generatedDraft = draft
      })
    },
  })),
)

export type { SopTemplate, SopTemplateDraft }
