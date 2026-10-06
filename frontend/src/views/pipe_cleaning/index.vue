<template>
  <section class="page" data-module="pipe_cleaning">
    <header class="page-head">
      <div>
        <h2>管道清洗管理</h2>
        <p class="page-desc">维护管道清洗记录；漏水检测确认修复后在此生成复查事项，复查通过后事项关闭，重复提交只生效一次。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记管道清洗记录</button>
        <button class="btn" type="button" @click="exportRows">导出管道清洗清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 漏点修复复查事项：由漏水检测「确认修复」联动生成 -->
    <section class="review-block">
      <header class="review-head">
        <h3>漏点修复复查事项</h3>
        <span class="review-count">待复查 {{ reviewRows.length }} 项 · 已复查 {{ finishedReviewRows.length }} 项</span>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>复查编号</th>
            <th>复查管段</th>
            <th>关联漏水检测</th>
            <th>复查设备</th>
            <th>计划日期</th>
            <th>实际日期</th>
            <th>复查状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in reviewRows" :key="`review-${String(row.id)}`">
            <td>{{ row['清洗编号'] }}</td>
            <td>{{ row['清洗管段'] }}</td>
            <td>
              <span class="badge linked">{{ row['关联检测'] }}</span>
            </td>
            <td>{{ row['清洗设备'] || '—' }}</td>
            <td>{{ row['计划日期'] || '—' }}</td>
            <td>{{ row['实际日期'] || '待复查' }}</td>
            <td><span class="badge pending">需复查</span></td>
            <td class="row-actions">
              <button class="link" type="button" @click="runAction('确认复查', row)">确认复查</button>
            </td>
          </tr>
          <tr v-if="!reviewRows.length">
            <td colspan="8" class="empty-state">暂无待复查事项，漏水检测确认修复后会自动生成</td>
          </tr>
        </tbody>
      </table>
      <table v-if="finishedReviewRows.length" class="data-table finished-review">
        <thead>
          <tr>
            <th>已完成复查</th>
            <th>复查管段</th>
            <th>关联漏水检测</th>
            <th>实际日期</th>
            <th>复查状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in finishedReviewRows" :key="`done-${String(row.id)}`">
            <td>{{ row['清洗编号'] }}</td>
            <td>{{ row['清洗管段'] }}</td>
            <td>{{ row['关联检测'] }}</td>
            <td>{{ row['实际日期'] || '—' }}</td>
            <td><span class="badge resolved">复查完成</span></td>
          </tr>
        </tbody>
      </table>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

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
            <template v-if="column === '关联检测'">
              <span v-if="row[column]" class="badge linked">{{ row[column] }}</span>
              <template v-else>—</template>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无管道清洗数据，可先登记管道清洗记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管道清洗记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  confirmCleaningReview,
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pipe_cleaning')
const columns = ["清洗编号", "清洗管段", "清洗方式", "清洗设备", "计划日期", "实际日期", "清洗长度", "关联检测"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["清洗编号", "清洗管段", "清洗方式"]

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isReview(row: EntryRow): boolean {
  return String(row['关联检测'] ?? '') !== ''
}

const reviewRows = computed(() => rows.value.filter((row) => isReview(row) && String(row.status) === '需复查'))
const finishedReviewRows = computed(() =>
  rows.value.filter((row) => isReview(row) && String(row.status) === '已完成'),
)

const stats = computed(() => [
  { label: '待复查事项', value: reviewRows.value.length },
  { label: '清洗中管段', value: rows.value.filter((row) => String(row.status) === '清洗中').length },
  {
    label: '已完成记录',
    value: rows.value.filter((row) => String(row.status) === '已完成').length,
  },
])

// 复查事项只允许确认复查；普通清洗记录走原有流转，避免动作串到复查单上。
function actionsFor(row: EntryRow): string[] {
  if (isReview(row)) {
    return String(row.status) === '需复查' ? ['确认复查'] : []
  }
  const status = String(row.status)
  if (status === '待清洗') {
    return ['安排清洗']
  }
  if (status === '清洗中') {
    return ['开始清洗']
  }
  if (status === '已完成') {
    return ['确认完成']
  }
  return []
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '管道清洗记录登记入口尚未接入审批流'
  successMessage.value = ''
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  let result: { ok: boolean; message: string }
  if (action === '确认复查') {
    result = confirmCleaningReview(Number(row.id), today())
  } else {
    result = applyAction(meta.key, Number(row.id), action)
  }
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  successMessage.value =
    action === '确认复查' ? `复查事项 ${String(row['清洗编号'])} 已确认通过，事项关闭` : result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管道清洗列表读取失败'
  }
}

onMounted(reload)
</script>
