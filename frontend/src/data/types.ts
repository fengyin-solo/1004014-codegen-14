/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 漏水检测：漏损程度枚举，无漏损也要在分布里单列。
export type LeakLevel = '轻微' | '中等' | '严重' | '无漏损'
export const LEAK_LEVELS: LeakLevel[] = ['轻微', '中等', '严重', '无漏损']

// 管网漏损分布视图里的一行汇总（检测管段 + 检测方法 为一组）。
export type LeakDistributionRow = {
  segment: string
  method: string
  roundOne: { leakCount: number | null; level: LeakLevel | null; reportIds: number[] }
  roundTwo: { leakCount: number | null; level: LeakLevel | null; reportIds: number[] }
  // 当前漏损程度：有复检以复检为准，否则取初检；都没有结果为 null（待检测）。
  currentLevel: LeakLevel | null
  // 初检 / 复检 / 当前生效漏点数量，无结果为 null。
  roundOneLeakCount: number | null
  roundTwoLeakCount: number | null
  currentLeakCount: number | null
  levelCounts: Record<LeakLevel, number>
  status: '待检测' | '待复检' | '已修复'
  recordIds: number[]
  hasRecheck: boolean
}

export type LeakOverview = {
  segmentCount: number
  pendingCount: number
  recheckPendingCount: number
  repairedCount: number
  totalLeakCount: number
}

export type ReportDraft = {
  leakCount: number
  level: LeakLevel
  device: string
}
