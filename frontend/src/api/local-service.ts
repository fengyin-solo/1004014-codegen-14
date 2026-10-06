import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  LeakDistributionRow,
  LeakOverview,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReportDraft,
} from '@/data/types'
import { LEAK_LEVELS } from '@/data/types'
import type { LeakLevel } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  // 漏水检测有复检两轮报告、修复联动等业务规则，单独走一套流转。
  if (key === 'leak_detect') {
    return runLeakAction(id, action)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// 漏水检测：管网漏损分布视图
// ---------------------------------------------------------------------------

export type LeakDistributionFilters = {
  segment?: string
  method?: string
  level?: string
  recheckOnly?: boolean
}

function textOf(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function levelOrNull(value: unknown): LeakLevel | null {
  const text = textOf(value)
  return (LEAK_LEVELS as string[]).includes(text) ? (text as LeakLevel) : null
}

// 单次检测结果是否有效：结果（漏点数量）和设备数据都到位才算数，否则视为待检测。
function hasValidResult(row: EntryRow): boolean {
  return numberOrNull(row['漏点数量']) !== null && textOf(row['检测设备']) !== ''
}

function roundOf(row: EntryRow): 1 | 2 {
  return textOf(row['检测轮次']) === '复检' ? 2 : 1
}

function emptyLevelCounts(): Record<LeakLevel, number> {
  return { 轻微: 0, 中等: 0, 严重: 0, 无漏损: 0 }
}

export function leakDistribution(filters: LeakDistributionFilters = {}): LeakDistributionRow[] {
  const rows = listRows('leak_detect')
  const groups = new Map<string, EntryRow[]>()
  for (const row of rows) {
    const segment = textOf(row['检测管段'])
    const method = textOf(row['检测方法'])
    const key = `${segment}__${method}`
    const bucket = groups.get(key)
    if (bucket) {
      bucket.push(row)
    } else {
      groups.set(key, [row])
    }
  }

  const result: LeakDistributionRow[] = []
  for (const [, bucket] of groups) {
    const segment = textOf(bucket[0]['检测管段'])
    const method = textOf(bucket[0]['检测方法'])

    const roundOne = bucket.find((row) => roundOf(row) === 1)
    const roundTwoRows = bucket
      .filter((row) => roundOf(row) === 2)
      .sort((a, b) => textOf(b['检测日期']).localeCompare(textOf(a['检测日期'])))
    const roundTwo = roundTwoRows[0]

    // 当前生效结果：复检以最新一轮复核为准，复检未出结果前沿用初检。
    const current = roundTwo && hasValidResult(roundTwo) ? roundTwo : roundOne
    const oneValid = roundOne ? hasValidResult(roundOne) : false
    const twoValid = roundTwo ? hasValidResult(roundTwo) : false

    const roundOneLeak = oneValid && roundOne ? numberOrNull(roundOne['漏点数量']) : null
    const roundTwoLeak = twoValid && roundTwo ? numberOrNull(roundTwo['漏点数量']) : null
    const currentLeak = current && hasValidResult(current) ? numberOrNull(current['漏点数量']) : null
    const currentLevel = current && hasValidResult(current) ? levelOrNull(current['漏损程度']) : null

    const levelCounts = emptyLevelCounts()
    for (const row of bucket) {
      if (!hasValidResult(row)) {
        continue
      }
      const level = levelOrNull(row['漏损程度'])
      const count = numberOrNull(row['漏点数量']) ?? 0
      if (level !== null) {
        levelCounts[level] += count
      }
    }

    const repaired = bucket.some((row) => textOf(row.status) === '已修复')
    const status: LeakDistributionRow['status'] = repaired
      ? '已修复'
      : roundTwo
        ? '待复检'
        : '待检测'

    result.push({
      segment,
      method,
      roundOne: {
        leakCount: roundOneLeak,
        level: oneValid && roundOne ? levelOrNull(roundOne['漏损程度']) : null,
        reportIds: roundOne ? [Number(roundOne.id)] : [],
      },
      roundTwo: {
        leakCount: roundTwoLeak,
        level: twoValid && roundTwo ? levelOrNull(roundTwo['漏损程度']) : null,
        reportIds: roundTwoRows.map((row) => Number(row.id)),
      },
      currentLevel,
      roundOneLeakCount: roundOneLeak,
      roundTwoLeakCount: roundTwoLeak,
      currentLeakCount: currentLeak,
      levelCounts,
      status,
      recordIds: bucket.map((row) => Number(row.id)),
      hasRecheck: Boolean(roundTwo),
    })
  }

  const segmentQ = filters.segment?.trim() ?? ''
  const methodQ = filters.method?.trim() ?? ''
  const levelQ = filters.level?.trim() ?? ''
  const filtered = result.filter((item) => {
    if (segmentQ && !item.segment.includes(segmentQ)) {
      return false
    }
    if (methodQ && !item.method.includes(methodQ)) {
      return false
    }
    if (levelQ && item.currentLevel !== levelQ) {
      return false
    }
    if (filters.recheckOnly && !item.hasRecheck) {
      return false
    }
    return true
  })

  return filtered.sort((a, b) => a.segment.localeCompare(b.segment, 'zh-Hans-CN'))
}

// 分布视图钻取：取出同一管段+检测方法下的单次检测记录，复检轮次聚在一起。
export function leakRecordsOfSegment(segment: string, method: string): EntryRow[] {
  return listRows('leak_detect')
    .filter(
      (row) => textOf(row['检测管段']) === segment && textOf(row['检测方法']) === method,
    )
    .sort((a, b) => {
      const roundDiff = roundOf(a) - roundOf(b)
      if (roundDiff !== 0) {
        return roundDiff
      }
      return textOf(b['检测日期']).localeCompare(textOf(a['检测日期']))
    })
}

export function leakOverview(): LeakOverview {
  const distribution = leakDistribution()
  return {
    segmentCount: distribution.length,
    pendingCount: distribution.filter((item) => item.status === '待检测').length,
    recheckPendingCount: distribution.filter((item) => item.status === '待复检').length,
    repairedCount: distribution.filter((item) => item.status === '已修复').length,
    totalLeakCount: distribution.reduce(
      (sum, item) => sum + (item.currentLeakCount ?? 0),
      0,
    ),
  }
}

// 当前状态下页面上允许执行的动作，业务规则在服务端判断。
export function availableLeakActions(row: EntryRow): string[] {
  switch (textOf(row.status)) {
    case '待检测':
      return ['安排检测']
    case '检测中':
      return ['生成报告']
    case '已出报告':
      return roundOf(row) === 1 ? ['发起复检', '标记已修复'] : ['标记已修复']
    case '待复检':
      // 初检报告仍有效，可在复检结论出来前直接确认修复；复检记录结果待录入不允许。
      return roundOf(row) === 1 ? ['标记已修复'] : []
    default:
      return []
  }
}

function persistLeak(rows: EntryRow[]): void {
  saveRows('leak_detect', rows)
}

function nextLeakCode(rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const match = textOf(row['检测编号']).match(/^LEAK-(\d+)$/)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  return `LEAK-${String(max + 1).padStart(4, '0')}`
}

// 发起复检：同一管段连续检测保留两轮报告，新增一条复检记录（检测中），初检报告留档。
function startRecheck(row: EntryRow, rows: EntryRow[]): ActionResult {
  if (roundOf(row) === 2) {
    return { ok: false, message: '复检报告不能再次发起复检，同一管段最多保留初检、复检两轮报告' }
  }
  if (rows.some((item) => textOf(item['关联初检']) === textOf(row['检测编号']))) {
    return { ok: false, message: '该管段复检已经安排过，不能重复发起' }
  }
  const today = new Date().toISOString().slice(0, 10)
  const recheck: EntryRow = {
    id: Math.max(0, ...rows.map((item) => Number(item.id))) + 1,
    status: '检测中',
    pending: true,
    abnormal: false,
    检测编号: nextLeakCode(rows),
    检测管段: row['检测管段'],
    检测方法: row['检测方法'],
    检测人员: row['检测人员'],
    检测设备: '',
    检测日期: today,
    漏点数量: '',
    漏损程度: '',
    检测轮次: '复检',
    关联初检: row['检测编号'],
    检测状态: '检测中',
  }
  const next = [...rows]
  const originIndex = next.findIndex((item) => Number(item.id) === Number(row.id))
  next[originIndex] = { ...row, status: '待复检', pending: true, 检测状态: '待复检' }
  persistLeak([...next, recheck])
  return {
    ok: true,
    message: `复检已安排（复检编号 ${recheck.检测编号}），初检报告 ${row['检测编号']} 保留，复检结果出来前为待复检状态`,
  }
}

// 生成报告：必须补齐漏点数量、漏损程度和设备数据，缺一项都只能停留在待检测。
function publishReport(row: EntryRow, rows: EntryRow[], draft?: ReportDraft): ActionResult {
  if (!draft) {
    return { ok: false, message: '请先录入本次检测的漏点数量、漏损程度与检测设备再生成报告' }
  }
  if (!Number.isFinite(draft.leakCount) || draft.leakCount < 0) {
    return { ok: false, message: '漏点数量必须是不小于 0 的数字' }
  }
  if (!(LEAK_LEVELS as string[]).includes(draft.level)) {
    return { ok: false, message: '请选择漏损程度' }
  }
  if (draft.level === '无漏损' && draft.leakCount > 0) {
    return { ok: false, message: '漏点数量大于 0 时，漏损程度不能选择「无漏损」' }
  }
  if (draft.level !== '无漏损' && draft.leakCount === 0) {
    return { ok: false, message: '漏点数量为 0 时，漏损程度应选择「无漏损」' }
  }
  if (!draft.device.trim()) {
    return { ok: false, message: '设备数据缺失，暂不能生成报告（结果显示为待检测）' }
  }
  const index = rows.findIndex((item) => Number(item.id) === Number(row.id))
  const updated: EntryRow = {
    ...rows[index],
    status: '已出报告',
    pending: true,
    漏点数量: draft.leakCount,
    漏损程度: draft.level,
    检测设备: draft.device.trim(),
    检测状态: '已出报告',
  }
  const next = [...rows]
  next[index] = updated
  persistLeak(next)
  const round = roundOf(updated) === 2 ? '复检' : '初检'
  return {
    ok: true,
    message: `${round}报告 ${updated['检测编号']} 已生成：${draft.level}，漏点 ${draft.leakCount} 处`,
  }
}

// 确认已修复：同管段关联缺陷同步关闭、管道清洗新增复查事项；整条链路幂等。
function confirmRepaired(row: EntryRow, rows: EntryRow[]): ActionResult {
  const segment = textOf(row['检测管段'])
  if (textOf(row.status) === '已修复') {
    return { ok: true, message: `管段 ${segment} 此前已确认修复，本次提交未重复生效` }
  }
  if (!hasValidResult(row)) {
    return { ok: false, message: '检测结果为空或设备数据缺失（待检测），不能确认修复' }
  }
  const repairedLeak = rows.filter((item) => textOf(item['检测管段']) === segment && textOf(item.status) === '已修复')
  // 重复提交只生效一次：已经有已修复记录时直接返回，不再联动。
  if (repairedLeak.length > 0) {
    return { ok: false, message: `管段 ${segment} 已确认修复，无需重复提交` }
  }

  const next = rows.map((item) =>
    textOf(item['检测管段']) === segment
      ? { ...item, status: '已修复', pending: false, 检测状态: '已修复' }
      : item,
  )
  persistLeak(next)

  const closedDefects = syncCloseDefects(segment)
  const cleaning = ensureCleaningReview(row)
  const detail = [`管段 ${segment} 已确认修复`]
  if (closedDefects > 0) {
    detail.push(`同步关闭关联缺陷 ${closedDefects} 条`)
  }
  if (cleaning.created) {
    detail.push(`管道清洗新增复查事项 ${cleaning.code}`)
  } else if (cleaning.code) {
    detail.push(`管道清洗复查事项 ${cleaning.code} 已存在，未重复生成`)
  }
  return { ok: true, message: detail.join('，') }
}

// 关联缺陷：按管段名匹配，待确认/已确认的同步置为已修复，已关闭的不动。
function syncCloseDefects(segment: string): number {
  const defects = listRows('defect')
  let closed = 0
  const next = defects.map((defect) => {
    const linked =
      textOf(defect['所属管线']) === segment &&
      (textOf(defect.status) === '待确认' || textOf(defect.status) === '已确认')
    if (!linked) {
      return defect
    }
    closed += 1
    return { ...defect, status: '已修复', pending: false, abnormal: false, 记录状态: '已修复' }
  })
  if (closed > 0) {
    saveRows('defect', next)
  }
  return closed
}

// 管道清洗页复查事项：一个漏检编号只生成一条，重复触发不新增。
function ensureCleaningReview(leakRow: EntryRow): { created: boolean; code: string } {
  const leakCode = textOf(leakRow['检测编号'])
  const cleaningRows = listRows('pipe_cleaning')
  const existing = cleaningRows.find(
    (item) => textOf(item['关联漏检']) === leakCode && leakCode !== '',
  )
  if (existing) {
    return { created: false, code: textOf(existing['清洗编号']) }
  }
  let max = 0
  for (const item of cleaningRows) {
    const match = textOf(item['清洗编号']).match(/^CLEA-(\d+)$/)
    if (match) {
      max = Math.max(max, Number(match[1]))
    }
  }
  const code = `CLEA-${String(max + 1).padStart(4, '0')}`
  const today = new Date().toISOString().slice(0, 10)
  const review: EntryRow = {
    id: Math.max(0, ...cleaningRows.map((item) => Number(item.id))) + 1,
    status: '需复查',
    pending: true,
    abnormal: false,
    清洗编号: code,
    清洗管段: leakRow['检测管段'],
    清洗方式: '修复后复查',
    清洗设备: textOf(leakRow['检测设备']) || '待安排',
    计划日期: today,
    实际日期: '',
    清洗长度: '',
    关联漏检: leakCode,
    清洗状态: '需复查',
  }
  saveRows('pipe_cleaning', [...cleaningRows, review])
  return { created: true, code }
}

function runLeakAction(id: number, action: string, draft?: ReportDraft): ActionResult {
  const rows = listRows('leak_detect')
  const row = rows.find((item) => Number(item.id) === id)
  if (!row) {
    return { ok: false, message: `没有找到编号为 ${id} 的漏水检测记录` }
  }
  switch (action) {
    case '安排检测': {
      if (textOf(row.status) !== '待检测') {
        return { ok: false, message: `记录已是「${row.status}」，不能重复安排检测` }
      }
      const index = rows.findIndex((item) => Number(item.id) === id)
      const next = [...rows]
      next[index] = { ...row, status: '检测中', pending: true, 检测状态: '检测中' }
      persistLeak(next)
      return { ok: true, message: `检测 ${row['检测编号']} 已安排，当前状态「检测中」` }
    }
    case '生成报告':
      if (textOf(row.status) !== '检测中') {
        return { ok: false, message: '只有检测中的记录才能生成报告' }
      }
      return publishReport(row, rows, draft)
    case '发起复检':
      if (textOf(row.status) !== '已出报告' || roundOf(row) !== 1) {
        return { ok: false, message: '只有初检已出报告的记录才能发起复检' }
      }
      return startRecheck(row, rows)
    case '标记已修复': {
      const status = textOf(row.status)
      const allowed =
        status === '已修复' ||
        status === '已出报告' ||
        (status === '待复检' && roundOf(row) === 1)
      if (!allowed) {
        return { ok: false, message: '只有已出报告（或复检中的初检报告）才能确认修复' }
      }
      return confirmRepaired(row, rows)
    }
    default:
      return { ok: false, message: `漏水检测记录没有登记「${action}」这个动作` }
  }
}

// 页面录入报告后调用，带上漏点数量、漏损程度与设备数据。
export function submitLeakReport(id: number, draft: ReportDraft): ActionResult {
  return runLeakAction(id, '生成报告', draft)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
