import { describe, it, expect, beforeEach } from 'vitest'
import { useSopTemplateStore } from '../stores/sop-template-store'
import type { SopTemplate } from '../stores/sop-template-store'

function makeTemplate(overrides: Partial<SopTemplate> = {}): SopTemplate {
  return {
    id: 'tpl1',
    name: 'Code Review',
    icon: null,
    description: 'Review code changes',
    agent_type: 'programming',
    instruction: 'Review the diff and report issues.',
    input_contract: 'A code diff',
    output_contract: 'A prioritized review report',
    plan_template: null,
    todo_items_json: null,
    builtin: true,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

describe('SopTemplateStore', () => {
  beforeEach(() => {
    useSopTemplateStore.setState({ templates: [], generatedDraft: null })
  })

  it('should have correct initial state', () => {
    expect(useSopTemplateStore.getState().templates).toEqual([])
  })

  it('setTemplates replaces all templates', () => {
    const templates = [
      makeTemplate({ id: 'tpl1' }),
      makeTemplate({ id: 'tpl2' }),
    ]
    useSopTemplateStore.getState().setTemplates(templates)
    expect(useSopTemplateStore.getState().templates).toEqual(templates)
  })

  it('setTemplates can clear all', () => {
    useSopTemplateStore
      .getState()
      .setTemplates([makeTemplate({ id: 'tpl1' })])
    useSopTemplateStore.getState().setTemplates([])
    expect(useSopTemplateStore.getState().templates).toEqual([])
  })

  it('stores generated SOP drafts', () => {
    const draft = {
      name: 'Draft',
      icon: null,
      description: null,
      agent_type: 'any' as const,
      instruction: 'Do the work',
      input_contract: null,
      output_contract: 'Result',
      plan_template: null,
      todo_items_json: null,
    }
    useSopTemplateStore.getState().setGeneratedDraft(draft)
    expect(useSopTemplateStore.getState().generatedDraft).toEqual(draft)
  })
})
