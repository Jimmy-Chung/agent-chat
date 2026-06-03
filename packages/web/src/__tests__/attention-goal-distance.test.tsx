import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import {
  computeGoalDistance,
  goalDistanceTone,
  goalDistanceColor,
  goalAlignmentToDistance,
  subGoalDistance,
} from '../lib/attention/goal-distance'
import type { GoalAnchor, TraceNode } from '../lib/attention'
import { GoalAnchorBar } from '../components/attention/GoalAnchorBar'

afterEach(cleanup)

function node(goal_distance: number): TraceNode {
  return {
    id: 'n', parent_id: null, branch_id: 'main', user_message: 'u', intent: '', rationale: null,
    conclusion: 'c', planned_ref: null, alignment: 'unplanned', goal_distance, status: 'done',
    event_ids: [], step_count: 0, ts_start: 0, ts_end: 1,
  }
}
const GOAL: GoalAnchor = { raw_query: '修复 SSE 端口泄漏', normalized_goal: '修复 SSE 端口泄漏', ts: 0 }

// ── TC-AIT-223-01：cosine 贴目标 vs 偏离 绿/橙 ───────────────────────────────
describe('TC-AIT-223-01 cosine 区分', () => {
  it('贴目标 → near(绿)，偏离 → off(橙)', () => {
    const aligned = computeGoalDistance('修复 SSE 端口泄漏', '修复 SSE 端口泄漏问题')
    const off = computeGoalDistance('修复 SSE 端口泄漏', '查询数据库表结构与字段类型')
    expect(aligned).toBeLessThan(off)
    expect(goalDistanceTone(aligned)).toBe('near')
    expect(goalDistanceColor(aligned)).toBe('#6FE39A')
    expect(goalDistanceTone(off)).toBe('off')
    expect(goalDistanceColor(off)).toBe('#F7A26B')
  })
})

// ── TC-AIT-223-02：goalAlignment → distance 映射 + 色段 ──────────────────────
describe('TC-AIT-223-02 LLM 映射 + 色段', () => {
  it('distance = 1 - ga/10，含钳制', () => {
    expect(goalAlignmentToDistance(9)).toBeCloseTo(0.1, 5)
    expect(goalAlignmentToDistance(2)).toBeCloseTo(0.8, 5)
    expect(goalAlignmentToDistance(99)).toBe(0)
    expect(goalAlignmentToDistance(-5)).toBe(1)
  })

  it('色段映射 <0.35 绿 / 0.35–0.65 黄 / >0.65 橙', () => {
    expect(goalDistanceTone(0.2)).toBe('near')
    expect(goalDistanceTone(0.5)).toBe('neutral')
    expect(goalDistanceTone(0.8)).toBe('off')
    expect(goalDistanceColor(0.5)).toBe('#F7C26B')
  })
})

// ── TC-AIT-223-03：偏离时 GoalAnchorBar 文案变化 + 无脉动告警 ────────────────
describe('TC-AIT-223-03 弱提示，无脉动告警', () => {
  it('最近节点偏离 → 文案「近期行为与目标距离拉大」', () => {
    const { container } = render(<GoalAnchorBar goalAnchor={GOAL} nodes={[node(0.85)]} />)
    expect(screen.getByText('近期行为与目标距离拉大')).toBeTruthy()
    // v1 边界：不引入脉动告警组件
    expect(container.querySelector('.animate-pulse')).toBeNull()
  })

  it('贴目标 → 文案「紧贴目标」', () => {
    render(<GoalAnchorBar goalAnchor={GOAL} nodes={[node(0.1)]} />)
    expect(screen.getByText('紧贴目标')).toBeTruthy()
  })
})

// ── 子层目标距离相对所在 Phase ───────────────────────────────────────────────
describe('subGoalDistance 相对 Phase 目标', () => {
  it('贴近 phase 目标的 exchange 距离 < 偏离的', () => {
    const phaseGoal = '修复端口泄漏'
    const near = subGoalDistance(phaseGoal, '排查端口泄漏并修复')
    const far = subGoalDistance(phaseGoal, '顺便改了下文档措辞')
    expect(near).toBeLessThan(far)
  })
})
