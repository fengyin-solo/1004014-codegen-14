import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { buildDistribution, LEVEL_ORDER } from '@/data/leak-analysis'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

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

function nextSerial(rows: EntryRow[], field: string, prefix: string, width: number): string {
  let max = 0
  for (const row of rows) {
    const matched = String(row[field] ?? '').match(new RegExp(`^${prefix}-(\\d+)$`))
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `${prefix}-${String(max + 1).padStart(width, '0')}`
}

// 录入检测结果并生成报告：结果为空时保持检测中，提示补录，避免出现没有结论的报告。
export function submitLeakReport(
  id: number,
  payload: { leakCount: number; level: string },
): ActionResult {
  const rows = listRows('leak_detect')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的漏水检测记录` }
  }
  const current = rows[index]
  if (String(current.status) === '已出报告') {
    return { ok: false, message: '该轮检测已生成报告，重复提交只生效一次' }
  }
  if (String(current.status) === '已修复') {
    return { ok: false, message: '该管段已修复，不能再录入报告' }
  }
  if (!Number.isFinite(payload.leakCount) || payload.leakCount < 0) {
    return { ok: false, message: '漏点数量需为不小于 0 的数字' }
  }
  if (!(LEVEL_ORDER as readonly string[]).includes(payload.level)) {
    return { ok: false, message: '漏损程度只能为「轻微 / 中等 / 严重」' }
  }
  if (String(current['检测设备'] ?? '').trim() === '') {
    return { ok: false, message: '检测设备数据缺失，请先补全设备后再生成报告' }
  }

  const updated: EntryRow = {
    ...current,
    status: '已出报告',
    pending: false,
    abnormal: payload.level === '严重',
    漏点数量: payload.leakCount,
    漏损程度: payload.level,
    检测状态: '已出报告',
  }
  const next = [...rows]
  next[index] = updated
  saveRows('leak_detect', next)
  return { ok: true, message: `报告已生成，当前漏损程度「${payload.level}」` }
}

// 连续检测同一管段：保留两轮报告，复检沿用初检的管段/方法/设备/人员，
// 新的一轮先进入「检测中」，报告录入后再复核最新一轮结果。
export function registerLeakRecheck(id: number, date: string): ActionResult {
  const rows = listRows('leak_detect')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的漏水检测记录` }
  }
  const summary = buildDistribution(rows).find(
    (item) => item.segment === String(rows[index]['检测管段'] ?? ''),
  )
  if (!summary) {
    return { ok: false, message: '检测管段信息缺失，无法安排复检' }
  }
  if (summary.latest.row.id !== id) {
    return { ok: false, message: '复检只能在该管段最新一轮检测记录上安排' }
  }
  if (summary.pendingReason !== '') {
    return { ok: false, message: `当前为「${summary.pendingReason}」状态，暂不能安排复检` }
  }
  if (summary.latest.status !== '已出报告') {
    return { ok: false, message: '只有已出报告的检测才能安排复检' }
  }
  if (summary.rounds.length >= 2) {
    return { ok: false, message: '同一管段已保留初检与复检两轮报告，不能再安排复检' }
  }

  const source = rows[index]
  const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const created: EntryRow = {
    id: nextId,
    status: '检测中',
    pending: true,
    abnormal: false,
    检测编号: nextSerial(rows, '检测编号', 'LEAK', 4),
    检测管段: source['检测管段'] ?? '',
    检测方法: source['检测方法'] ?? '',
    检测设备: source['检测设备'] ?? '',
    检测人员: source['检测人员'] ?? '',
    检测日期: date,
    漏点数量: '',
    漏损程度: '',
    检测状态: '检测中',
  }
  saveRows('leak_detect', [...rows, created])
  return { ok: true, message: `已安排复检，复检记录 ${String(created['检测编号'])} 进入检测中` }
}

// 确认已修复：同管段两轮报告一并置为已修复，管道清洗页新增复查事项，
// 关联缺陷同步关闭。重复提交（含已存在的复查事项）只生效一次。
export function confirmLeakRepaired(id: number): ActionResult {
  const rows = listRows('leak_detect')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的漏水检测记录` }
  }
  const target = rows[index]
  if (String(target.status) === '已修复') {
    return { ok: false, message: '该管段已确认修复，重复提交只生效一次' }
  }

  const segment = String(target['检测管段'] ?? '')
  const summary = buildDistribution(rows).find((item) => item.segment === segment)
  if (!summary || summary.latest.row.id !== id) {
    return { ok: false, message: '请在该管段最新一轮检测记录上确认修复' }
  }
  if (summary.pendingReason !== '') {
    return { ok: false, message: `当前为「${summary.pendingReason}」状态，无法确认修复` }
  }
  if (summary.latest.status !== '已出报告') {
    return { ok: false, message: '最新一轮检测尚未出报告，不能确认修复' }
  }

  const segmentIds = new Set(summary.rounds.map((round) => round.row.id))
  const updatedLeaks = rows.map((row) =>
    segmentIds.has(row.id)
      ? { ...row, status: '已修复', pending: false, abnormal: false, 检测状态: '已修复' }
      : row,
  )
  saveRows('leak_detect', updatedLeaks)

  // 关联缺陷同步关闭：所属管线与检测管段一致且未关闭的缺陷标记修复。
  const defects = listRows('defect')
  const openStatuses = ['待确认', '已确认']
  let closedDefects = 0
  const updatedDefects = defects.map((row) => {
    if (String(row['所属管线'] ?? '') === segment && openStatuses.includes(String(row.status))) {
      closedDefects += 1
      return { ...row, status: '已修复', pending: false, abnormal: false, 记录状态: '已修复' }
    }
    return row
  })
  if (closedDefects > 0) {
    saveRows('defect', updatedDefects)
  }

  // 管道清洗页新增复查事项：同一检测编号只建一条，重复提交不重复生成。
  const cleanings = listRows('pipe_cleaning')
  const sourceCode = String(summary.latest.row['检测编号'] ?? '')
  const existed = cleanings.some((row) => String(row['关联检测'] ?? '') === sourceCode)
  let reviewCode = ''
  if (!existed) {
    reviewCode = nextSerial(cleanings, '清洗编号', 'REVC', 4)
    const reviewId = cleanings.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
    const review: EntryRow = {
      id: reviewId,
      status: '需复查',
      pending: false,
      abnormal: false,
      清洗编号: reviewCode,
      清洗管段: segment,
      清洗方式: '修复后复查',
      清洗设备: summary.latest.device,
      计划日期: '',
      实际日期: '',
      清洗长度: '',
      关联检测: sourceCode,
      清洗状态: '需复查',
    }
    saveRows('pipe_cleaning', [...cleanings, review])
  }

  const notes = [
    '两轮检测报告均已标记已修复',
    closedDefects > 0 ? `同步关闭 ${closedDefects} 条关联缺陷` : '',
    reviewCode ? `已生成管道清洗复查事项 ${reviewCode}` : '复查事项此前已生成，本次不重复创建',
  ].filter(Boolean)
  return { ok: true, message: `管段 ${segment} 确认修复：${notes.join('；')}` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 管道清洗页确认复查：仅对关联漏水检测的复查事项生效，回填实际日期并关闭。
// 已完成的事项再次提交直接拒绝，保证重复提交只生效一次。
export function confirmCleaningReview(id: number, date: string): ActionResult {
  const rows = listRows('pipe_cleaning')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的管道清洗记录` }
  }
  const current = rows[index]
  if (String(current['关联检测'] ?? '').trim() === '') {
    return { ok: false, message: '该记录不是漏点修复复查事项' }
  }
  if (String(current.status) === '已完成') {
    return { ok: false, message: '该复查事项已确认通过，重复提交只生效一次' }
  }
  if (String(current.status) !== '需复查') {
    return { ok: false, message: `当前状态为「${String(current.status)}」，不能确认复查` }
  }

  const updated: EntryRow = {
    ...current,
    status: '已完成',
    pending: false,
    abnormal: false,
    实际日期: date,
    清洗状态: '已完成',
  }
  const next = [...rows]
  next[index] = updated
  saveRows('pipe_cleaning', next)
  return { ok: true, message: `复查事项 ${String(current['清洗编号'])} 已确认通过` }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
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
