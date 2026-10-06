import type { EntryRow } from './types'

// 漏损分布视图：漏水检测页的汇总/钻取都由这里派生，页面只负责渲染。
// 同一条检测管段可连续检测两轮（初检 + 复检），两轮报告都保留，
// 当前漏损程度以最新一轮复核为准；结果为空或设备数据缺失时按待检测展示。

export const LEVEL_ORDER = ['轻微', '中等', '严重'] as const
export type LeakLevel = (typeof LEVEL_ORDER)[number]

export type PendingReason = '' | '待检测' | '设备数据缺失'

export type LeakRound = {
  row: EntryRow
  roundIndex: number
  label: string
  date: string
  method: string
  device: string
  staff: string
  leakCount: number | null
  level: LeakLevel | ''
  status: string
}

export type SegmentSummary = {
  segment: string
  method: string
  rounds: LeakRound[]
  latest: LeakRound
  pendingReason: PendingReason
  currentLevel: LeakLevel | ''
  currentCount: number | null
  status: string
  resolvedCount: number
  canRecheck: boolean
  canRepair: boolean
}

function asText(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }
  const text = String(value).trim()
  return text
}

function parseCount(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

export function levelOf(value: unknown): LeakLevel | '' {
  const text = asText(value)
  return (LEVEL_ORDER as readonly string[]).includes(text) ? (text as LeakLevel) : ''
}

// 设备数据缺失：没有登记检测设备（连续检测时设备数据要能跟上）。
export function missingDevice(row: EntryRow): boolean {
  return asText(row['检测设备']) === ''
}

// 结果为空：漏点数量与漏损程度都没有录入。
export function emptyResult(row: EntryRow): boolean {
  return parseCount(row['漏点数量']) === null && levelOf(row['漏损程度']) === ''
}

export function pendingReasonOf(row: EntryRow): PendingReason {
  if (asText(row.status) === '待检测') {
    return '待检测'
  }
  if (missingDevice(row) || emptyResult(row)) {
    return missingDevice(row) ? '设备数据缺失' : '待检测'
  }
  return ''
}

// 同管段按检测日期、编号排序，最后一轮即最新复核结果。
function toRounds(segment: string, rows: EntryRow[]): LeakRound[] {
  return rows
    .slice()
    .sort((a, b) => {
      const dateA = asText(a['检测日期'])
      const dateB = asText(b['检测日期'])
      if (dateA !== dateB) {
        return dateA.localeCompare(dateB)
      }
      return Number(a.id) - Number(b.id)
    })
    .map((row, index) => ({
      row,
      roundIndex: index,
      label: index === 0 ? '初检' : `第${index + 1}轮复检`,
      date: asText(row['检测日期']),
      method: asText(row['检测方法']),
      device: asText(row['检测设备']),
      staff: asText(row['检测人员']),
      leakCount: parseCount(row['漏点数量']),
      level: levelOf(row['漏损程度']),
      status: asText(row.status),
    }))
}

export function buildDistribution(rows: EntryRow[]): SegmentSummary[] {
  const groups = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const segment = asText(row['检测管段']) || '未登记管段'
    const bucket = groups.get(segment)
    if (bucket) {
      bucket.push(row)
    } else {
      groups.set(segment, [row])
    }
  }

  const summaries: SegmentSummary[] = []
  for (const [segment, groupRows] of groups) {
    const rounds = toRounds(segment, groupRows)
    const latest = rounds[rounds.length - 1]
    const pendingReason = pendingReasonOf(latest.row)
    const initial = rounds[0]
    const resolvedCount =
      latest.leakCount !== null && initial.leakCount !== null
        ? Math.max(0, initial.leakCount - latest.leakCount)
        : 0

    summaries.push({
      segment,
      method: latest.method,
      rounds,
      latest,
      pendingReason,
      currentLevel: pendingReason ? '' : latest.level,
      currentCount: pendingReason ? null : latest.leakCount,
      status: latest.status,
      resolvedCount,
      // 复检仅对已出报告的最新一轮开放，且最多保留两轮报告。
      canRecheck:
        pendingReason === '' && latest.status === '已出报告' && rounds.length < 2,
      // 已出报告且复核有结论的管段才能确认修复。
      canRepair: pendingReason === '' && latest.status === '已出报告',
    })
  }

  return summaries.sort((a, b) => a.segment.localeCompare(b.segment, 'zh-Hans-CN'))
}

// 复检前后对比用：漏点数量下降即视为已消除的漏点。
export function levelDelta(first: LeakRound, latest: LeakRound): number {
  if (first.leakCount === null || latest.leakCount === null) {
    return 0
  }
  return Math.max(0, first.leakCount - latest.leakCount)
}

export function roundTag(round: LeakRound): string {
  if (round.roundIndex === 0) {
    return '复检前（初检）'
  }
  return '复检后（最新复核）'
}
