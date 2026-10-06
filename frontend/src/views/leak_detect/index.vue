<template>
  <section class="page" data-module="leak_detect">
    <header class="page-head">
      <div>
        <h2>漏水检测管理</h2>
        <p class="page-desc">
          维护漏水检测记录，按检测管段、检测方法、漏损程度展示漏点数量；同一管段连续检测保留初检与复检两轮报告，当前漏损程度以最新复核为准。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记漏水检测记录</button>
        <button class="btn" type="button" @click="exportRows">导出漏水检测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div class="view-tabs" role="tablist">
      <button
        class="tab"
        :class="{ active: viewMode === 'distribution' }"
        type="button"
        role="tab"
        @click="viewMode = 'distribution'"
      >
        管网漏损分布
      </button>
      <button
        class="tab"
        :class="{ active: viewMode === 'list' }"
        type="button"
        role="tab"
        @click="viewMode = 'list'"
      >
        检测记录清单
      </button>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>检测方法</span>
        <select v-model="methodFilter">
          <option value="">全部方法</option>
          <option v-for="method in methodOptions" :key="method" :value="method">{{ method }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 汇总：管段 × 检测方法 × 漏损程度，单元格为最新复核轮次的漏点数量 -->
    <div v-if="viewMode === 'distribution'" class="distribution">
      <article v-for="item in filteredDistribution" :key="item.segment" class="segment-card">
        <header class="segment-head" @click="toggleSegment(item.segment)">
          <div class="segment-main">
            <span class="drill-arrow" :class="{ open: expandedSegments.has(item.segment) }">▸</span>
            <strong class="segment-name">{{ item.segment }}</strong>
            <span class="method-tag">{{ item.method || '方法未登记' }}</span>
            <span class="round-count">保留报告 {{ item.rounds.length }} 轮</span>
          </div>
          <div class="level-cells">
            <template v-if="item.pendingReason">
              <span class="badge pending">{{ item.pendingReason }}</span>
            </template>
            <template v-else>
              <span
                v-for="level in levels"
                :key="level"
                class="level-cell"
                :class="['level-' + level, { dim: item.currentLevel !== level }]"
              >
                {{ level }}
                <b>{{ item.currentLevel === level && item.currentCount !== null ? item.currentCount : '·' }}</b>
              </span>
              <span class="badge" :class="['level-badge', 'level-' + item.currentLevel]">
                当前：{{ item.currentLevel || '未评级' }}
              </span>
              <span v-if="item.resolvedCount > 0" class="badge resolved">
                复检后消除 {{ item.resolvedCount }} 个漏点
              </span>
            </template>
          </div>
        </header>

        <!-- 钻取：从汇总展开到该管段每一轮单次检测记录，复检前后分别标注 -->
        <div v-if="expandedSegments.has(item.segment)" class="round-panel">
          <table class="round-table">
            <thead>
              <tr>
                <th>轮次</th>
                <th>检测编号</th>
                <th>检测日期</th>
                <th>检测方法</th>
                <th>检测设备</th>
                <th>检测人员</th>
                <th>漏点数量</th>
                <th>漏损程度</th>
                <th>记录状态</th>
                <th>可执行动作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="round in item.rounds" :key="round.row.id">
                <td>
                  <span class="badge" :class="round.roundIndex === 0 ? 'round-first' : 'round-latest'">
                    {{ roundTag(round) }}
                  </span>
                </td>
                <td>{{ round.row['检测编号'] }}</td>
                <td>{{ round.date || '—' }}</td>
                <td>{{ round.method || '—' }}</td>
                <td>
                  <span v-if="!round.device" class="badge pending">设备数据缺失</span>
                  <template v-else>{{ round.device }}</template>
                </td>
                <td>{{ round.staff || '—' }}</td>
                <td>
                  <span v-if="round.leakCount === null" class="badge pending">待检测</span>
                  <template v-else>{{ round.leakCount }}</template>
                </td>
                <td>
                  <span v-if="!round.level" class="badge pending">待检测</span>
                  <span v-else class="badge level-badge" :class="'level-' + round.level">{{ round.level }}</span>
                </td>
                <td>{{ round.status }}</td>
                <td class="row-actions">
                  <template v-if="round.row.id === item.latest.row.id">
                    <button
                      v-if="round.status === '待检测'"
                      class="link"
                      type="button"
                      @click="runAction('安排检测', round.row)"
                    >
                      安排检测
                    </button>
                    <button
                      v-if="round.status === '检测中'"
                      class="link"
                      type="button"
                      @click="runAction('生成报告', round.row)"
                    >
                      生成报告
                    </button>
                    <button v-if="item.canRecheck" class="link" type="button" @click="runAction('安排复检', round.row)">
                      安排复检
                    </button>
                    <button v-if="item.canRepair" class="link" type="button" @click="runAction('标记已修复', round.row)">
                      标记已修复
                    </button>
                  </template>
                  <span v-else class="hint">历史报告保留</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="item.rounds.length === 2" class="round-compare">
            复检前后对比：初检 {{ item.rounds[0].leakCount ?? '—' }} 个漏点（{{ item.rounds[0].level || '待检测' }}）
            → 最新复核 {{ item.rounds[1].leakCount ?? '—' }} 个漏点（{{ item.rounds[1].level || '待检测' }}），
            当前漏损程度以最新复核为准。
          </p>
        </div>
      </article>

      <p v-if="!filteredDistribution.length" class="empty-block">
        没有符合筛选条件的检测管段，可调整条件或先登记漏水检测记录。
      </p>
    </div>

    <!-- 清单：每一轮单次检测记录各占一行 -->
    <table v-else class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>轮次</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">
            <template v-if="column === '漏点数量'">
              <span v-if="row[column] === '' || row[column] === undefined || row[column] === null" class="badge pending">
                待检测
              </span>
              <template v-else>{{ row[column] }}</template>
            </template>
            <template v-else-if="column === '漏损程度'">
              <span v-if="!row[column]" class="badge pending">待检测</span>
              <span v-else class="badge level-badge" :class="'level-' + row[column]">{{ row[column] }}</span>
            </template>
            <template v-else-if="column === '检测设备'">
              <span v-if="!row[column]" class="badge pending">设备数据缺失</span>
              <template v-else>{{ row[column] }}</template>
            </template>
            <template v-else>{{ row[column] || '—' }}</template>
          </td>
          <td>
            <span class="badge" :class="roundMap.get(Number(row.id)) === 0 ? 'round-first' : 'round-latest'">
              {{ roundLabel(Number(row.id)) }}
            </span>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actionsFor(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无漏水检测数据，可先登记漏水检测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条漏水检测记录 · {{ distribution.length }} 个检测管段</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  confirmLeakRepaired,
  downloadEntries,
  listEntries,
  moduleMeta,
  registerLeakRecheck,
  runAction as applyAction,
  submitLeakReport,
} from '@/api/local-service'
import {
  LEVEL_ORDER,
  buildDistribution,
  pendingReasonOf,
  roundTag,
  type SegmentSummary,
} from '@/data/leak-analysis'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('leak_detect')
const columns = [
  '检测编号',
  '检测管段',
  '检测方法',
  '检测设备',
  '检测人员',
  '检测日期',
  '漏点数量',
  '漏损程度',
]
const levels = [...LEVEL_ORDER]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({ 检测管段: '', 检测方法: '' })
const filterFields = ['检测管段']
const methodFilter = ref('')
const viewMode = ref<'distribution' | 'list'>('distribution')
const expandedSegments = ref<Set<string>>(new Set())

const distribution = ref<SegmentSummary[]>([])

const methodOptions = computed(() => {
  const set = new Set<string>()
  for (const item of distribution.value) {
    if (item.method) {
      set.add(item.method)
    }
  }
  return [...set]
})

const filteredDistribution = computed(() => {
  const segmentKeyword = filters.value['检测管段']?.trim() ?? ''
  return distribution.value.filter((item) => {
    const matchSegment = !segmentKeyword || item.segment.includes(segmentKeyword)
    const matchMethod = !methodFilter.value || item.method === methodFilter.value
    return matchSegment && matchMethod
  })
})

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  // 待检测：最新一轮结果为空或设备数据缺失的管段。
  const pendingSegments = distribution.value.filter((item) => item.pendingReason !== '').length
  // 漏点总数：取每个管段最新复核轮次的漏点数量，待检测不计入。
  const activeLeaks = distribution.value.reduce(
    (sum, item) => (item.status !== '已修复' ? sum + (item.currentCount ?? 0) : sum),
    0,
  )
  // 已修复漏点：按已修复管段初检轮次的漏点数量统计。
  const fixedLeaks = distribution.value.reduce((sum, item) => {
    if (item.status !== '已修复') {
      return sum
    }
    return sum + (item.rounds[0]?.leakCount ?? 0)
  }, 0)
  return [
    { label: '待检测管段', value: pendingSegments },
    { label: '当前漏点总数（最新复核）', value: activeLeaks },
    { label: '已修复漏点（按初检计）', value: fixedLeaks },
  ]
})

// 行 id -> 所在管段的轮次序号，用于清单标注复检前后。
const roundMap = computed(() => {
  const map = new Map<number, number>()
  for (const item of distribution.value) {
    for (const round of item.rounds) {
      map.set(Number(round.row.id), round.roundIndex)
    }
  }
  return map
})

function roundLabel(id: number): string {
  const index = roundMap.value.get(id)
  if (index === undefined) {
    return '—'
  }
  return index === 0 ? '复检前（初检）' : `复检后（第${index + 1}轮）`
}

function segmentOf(row: EntryRow): SegmentSummary | undefined {
  return distribution.value.find((item) => item.segment === String(row['检测管段'] ?? ''))
}

function isLatestRound(row: EntryRow): boolean {
  return segmentOf(row)?.latest.row.id === Number(row.id)
}

function actionsFor(row: EntryRow): string[] {
  const status = String(row.status)
  if (!isLatestRound(row)) {
    return []
  }
  if (status === '待检测') {
    return ['安排检测']
  }
  if (status === '检测中') {
    return ['生成报告']
  }
  const summary = segmentOf(row)
  if (status === '已出报告') {
    return summary && summary.canRecheck ? ['安排复检', '标记已修复'] : ['标记已修复']
  }
  return []
}

function toggleSegment(segment: string) {
  const next = new Set(expandedSegments.value)
  if (next.has(segment)) {
    next.delete(segment)
  } else {
    next.add(segment)
  }
  expandedSegments.value = next
}

function resetFilters() {
  filters.value = { 检测管段: '', 检测方法: '' }
  methodFilter.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '漏水检测记录登记入口尚未接入审批流'
  successMessage.value = ''
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  let result: { ok: boolean; message: string }

  if (action === '生成报告') {
    const deviceMissing = pendingReasonOf(row) === '设备数据缺失'
    if (deviceMissing) {
      errorMessage.value = '检测设备数据缺失，请先补全设备后再生成报告'
      return
    }
    const countInput = window.prompt('请输入本轮检测漏点数量（不小于 0 的整数）', '0')
    if (countInput === null) {
      return
    }
    const leakCount = Number(countInput)
    if (!Number.isInteger(leakCount) || leakCount < 0) {
      errorMessage.value = '漏点数量需为不小于 0 的整数'
      return
    }
    const level = window.prompt('请录入漏损程度：轻微 / 中等 / 严重', '轻微')
    if (level === null) {
      return
    }
    if (!(LEVEL_ORDER as readonly string[]).includes(level.trim())) {
      errorMessage.value = '漏损程度只能为「轻微 / 中等 / 严重」'
      return
    }
    result = submitLeakReport(Number(row.id), { leakCount, level: level.trim() })
  } else if (action === '安排复检') {
    const date = window.prompt('请输入复检日期', today())
    if (date === null) {
      return
    }
    result = registerLeakRecheck(Number(row.id), date.trim() || today())
  } else if (action === '标记已修复') {
    result = confirmLeakRepaired(Number(row.id))
  } else {
    result = applyAction(meta.key, Number(row.id), action)
  }

  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, {
      检测管段: filters.value['检测管段'] ?? '',
    })
    rows.value = payload.items
    total.value = payload.total
    // 分布始终基于全量记录计算，保证同管段两轮报告一起展示。
    distribution.value = buildDistribution(listEntries(meta.key).items)
    if (methodFilter.value && !methodOptions.value.includes(methodFilter.value)) {
      methodFilter.value = ''
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '漏水检测列表读取失败'
  }
}

onMounted(reload)
</script>
