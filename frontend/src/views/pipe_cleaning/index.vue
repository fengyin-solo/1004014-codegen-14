<template>
  <section class="page" data-module="pipe_cleaning">
    <header class="page-head">
      <div>
        <h2>管道清洗管理</h2>
        <p class="page-desc">维护管道清洗记录，围绕清洗编号、清洗管段、清洗方式、清洗设备做登记、筛选与状态流转；漏水检测确认修复后自动生成复查事项。</p>
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
            <span v-if="column === '关联漏检' && String(row[column] ?? '').trim() === ''" class="muted-text">—</span>
            <span v-else-if="column === '关联漏检'" class="link-badge">{{ row[column] }}</span>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td><span class="status-badge" :class="`status-${row.status}`">{{ row.status }}</span></td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
            <span v-if="!availableActions(row).length" class="muted-text">—</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无管道清洗数据，可先登记管道清洗记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管道清洗记录</span>
      <span v-if="successMessage" class="success-text">{{ successMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pipe_cleaning')
const columns = ['清洗编号', '清洗管段', '清洗方式', '清洗设备', '计划日期', '实际日期', '清洗长度', '关联漏检']
const filterFields = ['清洗编号', '清洗管段', '清洗方式']
const statuses = ['待清洗', '清洗中', '已完成', '需复查', '复查完成']

// 只允许往状态机的下一步走；复查事项（需复查）通过「确认复查」收口。
const NEXT_ACTIONS: Record<string, string[]> = {
  待清洗: ['安排清洗'],
  清洗中: ['开始清洗'],
  已完成: ['确认完成'],
  需复查: ['确认复查'],
  复查完成: [],
}

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const successMessage = ref('')
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待清洗管段', value: rows.value.filter((row) => String(row.status) === '待清洗').length },
  { label: '清洗中管段', value: rows.value.filter((row) => String(row.status) === '清洗中').length },
  {
    label: '待复查管段',
    value: rows.value.filter((row) => String(row.status) === '需复查').length,
  },
])

function availableActions(row: EntryRow): string[] {
  return NEXT_ACTIONS[String(row.status)] ?? []
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

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  successMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
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
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '管道清洗列表读取失败'
  }
}

onMounted(reload)
</script>
