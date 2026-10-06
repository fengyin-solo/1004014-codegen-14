<template>
  <section class="page" data-module="leak_detect">
    <header class="page-head">
      <div>
        <h2>漏水检测管理</h2>
        <p class="page-desc">按检测管段、检测方法和漏损程度查看管网漏损分布；连续检测同一管段保留初检、复检两轮报告，当前漏损程度以最新复核为准。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记漏水检测记录</button>
        <button class="btn" type="button" @click="exportRows">导出漏水检测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in overviewCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div class="tab-bar" role="tablist">
      <button
        class="tab-item"
        :class="{ active: activeTab === 'distribution' }"
        type="button"
        @click="activeTab = 'distribution'"
      >
        管网漏损分布
      </button>
      <button
        class="tab-item"
        :class="{ active: activeTab === 'records' }"
        type="button"
        @click="activeTab = 'records'"
      >
        单次检测记录（共 {{ total }} 条）
      </button>
    </div>

    <!-- 管网漏损分布视图：管段 × 检测方法，初检/复检分列，钻取到单次记录 -->
    <div v-if="activeTab === 'distribution'">
      <form class="filter-bar" @submit.prevent="reloadDistribution">
        <label class="filter-item">
          <span>检测管段</span>
          <input v-model="distFilters.segment" placeholder="按检测管段检索" />
        </label>
        <label class="filter-item">
          <span>检测方法</span>
          <select v-model="distFilters.method">
            <option value="">全部方法</option>
            <option v-for="method in methodOptions" :key="method" :value="method">{{ method }}</option>
          </select>
        </label>
        <label class="filter-item">
          <span>当前漏损程度</span>
          <select v-model="distFilters.level">
            <option value="">全部程度</option>
            <option v-for="level in levelOptions" :key="level" :value="level">{{ level }}</option>
          </select>
        </label>
        <label class="filter-check">
          <input v-model="recheckOnly" type="checkbox" />
          <span>仅看复检管段</span>
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetDistributionFilters">重置条件</button>
      </form>

      <!-- 钻取面板：从汇总行进入，展示该管段+方法下的单次检测记录 -->
      <div v-if="drillGroup" class="drill-panel">
        <div class="drill-head">
          <strong>检测记录钻取：{{ drillGroup.segment }} · {{ drillGroup.method }}</strong>
          <button class="btn ghost" type="button" @click="drillGroup = null">返回分布汇总</button>
        </div>
        <p class="drill-tip">同一管段连续检测保留两轮报告；状态与漏损程度以最新复核结果为准。</p>
        <table class="data-table">
          <thead>
            <tr>
              <th>检测编号</th>
              <th>检测轮次</th>
              <th>检测人员</th>
              <th>检测设备</th>
              <th>检测日期</th>
              <th>漏点数量</th>
              <th>漏损程度</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in drillRows" :key="String(row.id)">
              <td>{{ row['检测编号'] }}</td>
              <td><span class="round-badge" :class="roundClass(row)">{{ roundLabel(row) }}</span></td>
              <td>{{ row['检测人员'] }}</td>
              <td>{{ display(row['检测设备']) }}</td>
              <td>{{ display(row['检测日期']) }}</td>
              <td>
                <span v-if="resultMissing(row)" class="pending-text">待检测</span>
                <template v-else>{{ row['漏点数量'] }}</template>
              </td>
              <td>
                <span v-if="resultMissing(row)" class="pending-text">待检测</span>
                <span v-else class="level-badge" :class="levelClass(row['漏损程度'])">{{ row['漏损程度'] }}</span>
              </td>
              <td>{{ row.status }}</td>
              <td class="row-actions">
                <button
                  v-for="action in availableLeakActions(row)"
                  :key="action"
                  class="link"
                  type="button"
                  @click="runAction(action, row)"
                >
                  {{ action }}
                </button>
                <span v-if="!availableLeakActions(row).length" class="muted-text">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <template v-else>
        <table class="data-table">
          <thead>
            <tr>
              <th rowspan="2">检测管段</th>
              <th rowspan="2">检测方法</th>
              <th colspan="2" class="sub-head">初检（第一轮）</th>
              <th colspan="2" class="sub-head">复检（最新复核）</th>
              <th colspan="4">漏点数量分布（按漏损程度）</th>
              <th rowspan="2">当前漏损程度</th>
              <th rowspan="2">整体状态</th>
              <th rowspan="2">操作</th>
            </tr>
            <tr>
              <th>漏点数</th>
              <th>漏损程度</th>
              <th>漏点数</th>
              <th>漏损程度</th>
              <th>轻微</th>
              <th>中等</th>
              <th>严重</th>
              <th>无漏损</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="group in distribution" :key="`${group.segment}-${group.method}`">
              <td>{{ group.segment }}</td>
              <td>{{ group.method }}</td>
              <td>
                <span v-if="group.roundOneLeakCount === null" class="pending-text">待检测</span>
                <template v-else>{{ group.roundOneLeakCount }}</template>
              </td>
              <td>
                <span v-if="group.roundOne.level === null" class="pending-text">待检测</span>
                <span v-else class="level-badge" :class="levelClass(group.roundOne.level)">{{ group.roundOne.level }}</span>
              </td>
              <td>
                <span v-if="!group.hasRecheck" class="muted-text">未复检</span>
                <span v-else-if="group.roundTwoLeakCount === null" class="pending-text">待检测</span>
                <template v-else>{{ group.roundTwoLeakCount }}</template>
              </td>
              <td>
                <span v-if="!group.hasRecheck" class="muted-text">—</span>
                <span v-else-if="group.roundTwo.level === null" class="pending-text">待检测</span>
                <span v-else class="level-badge latest" :class="levelClass(group.roundTwo.level)">{{ group.roundTwo.level }}</span>
              </td>
              <td>{{ group.levelCounts['轻微'] }}</td>
              <td>{{ group.levelCounts['中等'] }}</td>
              <td>
                <strong v-if="group.levelCounts['严重'] > 0" class="level-严重">{{ group.levelCounts['严重'] }}</strong>
                <template v-else>0</template>
              </td>
              <td>{{ group.levelCounts['无漏损'] }}</td>
              <td>
                <span v-if="group.currentLevel === null" class="pending-text">待检测</span>
                <span v-else class="level-badge" :class="levelClass(group.currentLevel)">{{ group.currentLevel }}</span>
              </td>
              <td><span class="status-badge" :class="`status-${group.status}`">{{ group.status }}</span></td>
              <td>
                <button class="link" type="button" @click="openDrill(group)">检测记录（{{ group.recordIds.length }}）</button>
              </td>
            </tr>
            <tr v-if="!distribution.length">
              <td :colspan="13" class="empty-state">没有符合条件的检测管段</td>
            </tr>
          </tbody>
          <tfoot v-if="distribution.length">
            <tr class="total-row">
              <td colspan="2">合计（{{ distribution.length }} 个管段）</td>
              <td>{{ totals.roundOne }}</td>
              <td>—</td>
              <td>{{ totals.roundTwo }}</td>
              <td>—</td>
              <td>{{ totals.levels['轻微'] }}</td>
              <td>{{ totals.levels['中等'] }}</td>
              <td>{{ totals.levels['严重'] }}</td>
              <td>{{ totals.levels['无漏损'] }}</td>
              <td>—</td>
              <td>—</td>
              <td>—</td>
            </tr>
          </tfoot>
        </table>
        <p class="table-note">「待检测」表示检测结果为空或设备数据缺失；复检列显示「未复检」时，当前漏损程度沿用初检。</p>
      </template>
    </div>

    <!-- 单次检测记录列表 -->
    <div v-else>
      <form class="filter-bar" @submit.prevent="reload">
        <label v-for="field in filterFields" :key="field" class="filter-item">
          <span>{{ field }}</span>
          <input v-model="filters[field]" :placeholder="`按${field}检索`" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>

      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">
              <span v-if="resultColumnMissing(row, column)" class="pending-text">待检测</span>
              <span v-else-if="column === '检测轮次'" class="round-badge" :class="roundClass(row)">{{ roundLabel(row) }}</span>
              <span v-else-if="column === '漏损程度'" class="level-badge" :class="levelClass(row[column])">{{ row[column] }}</span>
              <template v-else>{{ row[column] ?? '—' }}</template>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in availableLeakActions(row)"
                :key="action"
                :class="{ primary: action === '标记已修复' }"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
              <span v-if="!availableLeakActions(row).length" class="muted-text">—</span>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无漏水检测数据，可先登记漏水检测记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条漏水检测记录 · {{ overview.segmentCount }} 个检测管段</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 录入检测结果：结果与设备数据不齐不能生成报告 -->
    <div v-if="reportTarget" class="modal-mask" @click.self="closeReportDialog">
      <div class="modal-dialog">
        <h3 class="modal-title">录入检测结果 · {{ reportTarget['检测编号'] }}</h3>
        <p class="modal-sub">{{ reportTarget['检测管段'] }} · {{ roundLabel(reportTarget) }}</p>
        <div class="form-grid">
          <label>
            <span>检测设备（必填）</span>
            <input v-model="reportForm.device" placeholder="如：数字听漏仪 LM-3" />
          </label>
          <label>
            <span>漏点数量（必填）</span>
            <input v-model.number="reportForm.leakCount" min="0" type="number" />
          </label>
          <label>
            <span>漏损程度（必填）</span>
            <select v-model="reportForm.level">
              <option value="" disabled>请选择漏损程度</option>
              <option v-for="level in levelOptions" :key="level" :value="level">{{ level }}</option>
            </select>
          </label>
        </div>
        <p class="modal-tip">设备数据或结果为空时，该记录在分布视图中显示为「待检测」，不能生成报告。</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="closeReportDialog">取消</button>
          <button class="btn primary" type="button" @click="submitReport">生成报告</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  availableLeakActions,
  downloadEntries,
  leakDistribution,
  leakOverview,
  leakRecordsOfSegment,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  submitLeakReport,
} from '@/api/local-service'
import type { EntryRow, LeakDistributionRow, LeakLevel, ReportDraft } from '@/data/types'
import { LEAK_LEVELS } from '@/data/types'

const meta = moduleMeta('leak_detect')
const columns = ['检测编号', '检测管段', '检测方法', '检测人员', '检测设备', '检测日期', '漏点数量', '漏损程度', '检测轮次', '关联初检']
const filterFields = ['检测管段', '检测方法', '检测人员']
const levelOptions = LEAK_LEVELS

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const activeTab = ref<'distribution' | 'records'>('distribution')

const distribution = ref<LeakDistributionRow[]>([])
const overview = ref(leakOverview())
const distFilters = reactive({ segment: '', method: '', level: '' })
const recheckOnly = ref(false)
const drillGroup = ref<LeakDistributionRow | null>(null)

const reportTarget = ref<EntryRow | null>(null)
const reportForm = reactive<{ device: string; leakCount: number | null; level: LeakLevel | '' }>({
  device: '',
  leakCount: null,
  level: '',
})

const methodOptions = computed(() =>
  Array.from(new Set(rows.value.map((row) => String(row['检测方法'] ?? '')).filter(Boolean))),
)

const overviewCards = computed(() => [
  { label: '检测管段', value: overview.value.segmentCount },
  { label: '当前漏点总数', value: overview.value.totalLeakCount },
  { label: '待复检管段', value: overview.value.recheckPendingCount },
  { label: '已修复管段', value: overview.value.repairedCount },
  { label: '待检测管段', value: overview.value.pendingCount },
])

const statusSummary = computed(() => {
  const statuses = ['待检测', '检测中', '已出报告', '待复检', '已修复']
  return statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  }))
})

const totals = computed(() => {
  const levels = { 轻微: 0, 中等: 0, 严重: 0, 无漏损: 0 }
  let roundOne = 0
  let roundTwo = 0
  for (const group of distribution.value) {
    levels['轻微'] += group.levelCounts['轻微']
    levels['中等'] += group.levelCounts['中等']
    levels['严重'] += group.levelCounts['严重']
    levels['无漏损'] += group.levelCounts['无漏损']
    roundOne += group.roundOneLeakCount ?? 0
    roundTwo += group.roundTwoLeakCount ?? 0
  }
  return { levels, roundOne, roundTwo }
})

const drillRows = computed(() => {
  if (!drillGroup.value) {
    return []
  }
  return leakRecordsOfSegment(drillGroup.value.segment, drillGroup.value.method)
})

function display(value: unknown): string {
  return value === null || value === undefined || String(value).trim() === ''
    ? '—'
    : String(value)
}

function resultMissing(row: EntryRow): boolean {
  const leakCount = row['漏点数量']
  const device = String(row['检测设备'] ?? '').trim()
  return leakCount === '' || leakCount === null || leakCount === undefined || device === ''
}

function resultColumnMissing(row: EntryRow, column: string): boolean {
  if (!resultMissing(row)) {
    return false
  }
  return column === '漏点数量' || column === '漏损程度' || column === '检测设备'
}

function roundLabel(row: EntryRow): string {
  return String(row['检测轮次'] ?? '初检') === '复检' ? '复检' : '初检'
}

function roundClass(row: EntryRow): string {
  return roundLabel(row) === '复检' ? 'round-two' : 'round-one'
}

function levelClass(level: unknown): string {
  const text = String(level ?? '')
  return `level-${text}`
}

function flash(message: string, ok: boolean) {
  if (ok) {
    successMessage.value = message
    errorMessage.value = ''
  } else {
    errorMessage.value = message
    successMessage.value = ''
  }
}

function resetFilters() {
  filters.value = {}
  reload()
}

function resetDistributionFilters() {
  distFilters.segment = ''
  distFilters.method = ''
  distFilters.level = ''
  recheckOnly.value = false
  reloadDistribution()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  flash('漏水检测记录登记入口尚未接入审批流', false)
}

function openDrill(group: LeakDistributionRow) {
  drillGroup.value = group
}

function openReportDialog(row: EntryRow) {
  reportTarget.value = row
  reportForm.device = String(row['检测设备'] ?? '')
  reportForm.leakCount = null
  reportForm.level = ''
}

function closeReportDialog() {
  reportTarget.value = null
}

function submitReport() {
  if (!reportTarget.value) {
    return
  }
  if (reportForm.leakCount === null || Number.isNaN(reportForm.leakCount)) {
    flash('请填写漏点数量', false)
    return
  }
  if (!reportForm.level) {
    flash('请选择漏损程度', false)
    return
  }
  if (!reportForm.device.trim()) {
    flash('设备数据缺失，暂不能生成报告', false)
    return
  }
  const draft: ReportDraft = {
    leakCount: reportForm.leakCount,
    level: reportForm.level,
    device: reportForm.device,
  }
  const result = submitLeakReport(Number(reportTarget.value.id), draft)
  flash(result.message, result.ok)
  if (result.ok) {
    closeReportDialog()
  }
  reloadAll()
}

function runAction(action: string, row: EntryRow) {
  if (action === '生成报告') {
    openReportDialog(row)
    return
  }
  const result = applyAction(meta.key, Number(row.id), action)
  flash(result.message, result.ok)
  reloadAll()
}

function reloadDistribution() {
  distribution.value = leakDistribution({
    segment: distFilters.segment,
    method: distFilters.method,
    level: distFilters.level,
    recheckOnly: recheckOnly.value,
  })
  overview.value = leakOverview()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    flash(error instanceof Error ? error.message : '漏水检测列表读取失败', false)
  }
}

function reloadAll() {
  reload()
  reloadDistribution()
}

onMounted(reloadAll)
</script>
