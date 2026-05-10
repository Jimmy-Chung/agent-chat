import { upsertSystemTopic } from './db/repos/topic.repo'
import * as sopRepo from './db/repos/sop_template.repo'
import { logger } from './logger'

const SYSTEM_TOPICS = [
  {
    id: 'system_cron_admin',
    name: '⏰ 定时任务管理',
    kind: 'system_cron_admin' as const,
  },
  {
    id: 'system_artifact_pool',
    name: '📦 产物池',
    kind: 'system_artifact_pool' as const,
  },
  {
    id: 'system_sop_library',
    name: '📋 SOP 模板库',
    kind: 'system_sop_library' as const,
  },
]

const BUILTIN_TEMPLATES = [
  {
    name: '数据拉取分析',
    icon: '📊',
    description: '从指定数据源拉取数据，清洗并生成分析报告',
    agentType: 'general' as const,
    systemPromptAddon: '你是一个数据分析专家。请按步骤完成数据拉取、清洗、分析，并输出结构化报告。',
    planTemplate: '## 数据分析计划\n\n1. 确认数据源和范围\n2. 拉取数据\n3. 数据清洗与预处理\n4. 统计分析\n5. 生成报告',
    todosTemplateJson: JSON.stringify([
      { id: '1', content: '确认数据源和查询范围', status: 'pending' },
      { id: '2', content: '拉取原始数据', status: 'pending' },
      { id: '3', content: '数据清洗与预处理', status: 'pending' },
      { id: '4', content: '统计分析与可视化', status: 'pending' },
    ]),
  },
  {
    name: '周报生成',
    icon: '📝',
    description: '基于本周工作内容自动生成周报',
    agentType: 'general' as const,
    systemPromptAddon: '你是周报助手。请根据用户提供的工作内容，整理成结构化的周报格式。',
    planTemplate: '## 周报生成计划\n\n1. 收集本周工作项\n2. 分类整理（已完成/进行中/计划中）\n3. 生成周报文档\n4. 标注下周计划',
    todosTemplateJson: JSON.stringify([
      { id: '1', content: '收集本周完成的工作项', status: 'pending' },
      { id: '2', content: '收集进行中的任务', status: 'pending' },
      { id: '3', content: '整理分类并生成周报', status: 'pending' },
      { id: '4', content: '添加下周工作计划', status: 'pending' },
      { id: '5', content: '最终审核与输出', status: 'pending' },
    ]),
  },
  {
    name: '读书笔记',
    icon: '📖',
    description: '阅读指定内容并生成结构化读书笔记',
    agentType: 'general' as const,
    systemPromptAddon: '你是读书笔记助手。请根据用户提供的阅读材料，提取关键信息，生成结构化笔记。',
    planTemplate: '## 读书笔记计划\n\n1. 通读材料提取关键概念\n2. 梳理逻辑框架\n3. 记录核心观点\n4. 生成总结与思考',
    todosTemplateJson: JSON.stringify([
      { id: '1', content: '通读并标记关键段落', status: 'pending' },
      { id: '2', content: '提取核心概念和术语', status: 'pending' },
      { id: '3', content: '梳理逻辑框架和论证', status: 'pending' },
      { id: '4', content: '生成个人总结与思考', status: 'pending' },
    ]),
  },
  {
    name: '代码重构方案',
    icon: '🔧',
    description: '分析代码结构并生成重构方案',
    agentType: 'programming' as const,
    systemPromptAddon: '你是代码重构专家。请分析给定代码的结构问题，制定重构方案，确保不破坏现有功能。',
    planTemplate: '## 重构方案\n\n1. 分析现有代码结构\n2. 识别设计问题和坏味道\n3. 制定重构策略\n4. 逐步执行重构',
    todosTemplateJson: JSON.stringify([
      { id: '1', content: '分析现有代码结构和依赖关系', status: 'pending' },
      { id: '2', content: '识别代码坏味道和设计问题', status: 'pending' },
      { id: '3', content: '制定重构策略和优先级', status: 'pending' },
      { id: '4', content: '执行重构并验证测试通过', status: 'pending' },
    ]),
  },
]

export function seedSystemTopics(): void {
  for (const t of SYSTEM_TOPICS) {
    upsertSystemTopic(t.id, t.name, t.kind)
    logger.info({ id: t.id, name: t.name }, 'System topic ensured')
  }

  // Seed built-in SOP templates (idempotent)
  const existing = sopRepo.listTemplates()
  if (existing.length === 0) {
    for (const tpl of BUILTIN_TEMPLATES) {
      sopRepo.createTemplate({
        name: tpl.name,
        icon: tpl.icon,
        description: tpl.description,
        agentType: tpl.agentType,
        systemPromptAddon: tpl.systemPromptAddon,
        planTemplate: tpl.planTemplate,
        todosTemplateJson: tpl.todosTemplateJson,
        workflowMode: 'lazy',
        builtin: true,
      })
    }
    logger.info({ count: BUILTIN_TEMPLATES.length }, 'Built-in SOP templates seeded')
  }
}
