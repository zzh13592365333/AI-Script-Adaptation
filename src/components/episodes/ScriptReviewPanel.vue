<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, PencilLine, RotateCcw, Square } from 'lucide-vue-next'
import type { EpisodeScript } from '@/domain/project'
import ActionButton from '@/components/common/ActionButton.vue'

const props = defineProps<{ script: EpisodeScript; busy?: boolean }>()
const emit = defineEmits<{
  accept: []
  editAccept: []
  requestRevision: [feedback: string]
  cancel: []
}>()
const feedback = ref('')
const awaitingReview = computed(() => props.script.taskStatus === 'awaiting_human_review')
const active = computed(() => ['queued', 'running', 'quality_failed'].includes(props.script.taskStatus ?? ''))
const stageLabels = {
  queued: '等待执行', generating: '生成剧本', validating: '结构校验', reviewing: 'AI 质量审核',
  revising: '自动修订', human_review: '等待人工确认', completed: '已完成', failed: '执行失败', cancelled: '已取消'
}
const qualityDimensions = [
  ['outline_consistency', '大纲一致性'],
  ['character_consistency', '人物一致性'],
  ['continuity_consistency', '连续性'],
  ['format_compliance', '格式规范'],
  ['translation_compliance', '双语规范'],
  ['terminology_consistency', '术语一致性'],
  ['length_compliance', '篇幅要求'],
  ['user_requirements_compliance', '用户要求']
] as const

function requestRevision() {
  const value = feedback.value.trim()
  if (!value) return
  emit('requestRevision', value)
}
</script>

<template>
  <section class="script-review-panel" data-testid="script-review-panel">
    <header>
      <div>
        <span class="panel-label">LANGGRAPH TASK</span>
        <h2>{{ stageLabels[script.taskStage ?? 'queued'] }}</h2>
      </div>
      <strong>{{ script.taskProgress ?? 0 }}%</strong>
    </header>
    <div class="progress-track" aria-label="任务进度"><i :style="{ width: `${script.taskProgress ?? 0}%` }" /></div>
    <div class="task-summary">
      <span>状态 {{ script.taskStatus }}</span>
      <span>质量修订 {{ script.retryCount ?? 0 }} / {{ script.maxRetries ?? 0 }}</span>
    </div>

    <div v-if="script.qualityCheck" class="quality-review">
      <div class="quality-heading"><strong>质量检查</strong><span :class="script.qualityCheck.passed ? 'quality-pass' : 'quality-fail'">{{ script.qualityCheck.passed ? '通过' : '需处理' }}</span></div>
      <div class="quality-grid">
        <span v-for="[key, label] in qualityDimensions" :key="key" :class="script.qualityCheck[key] ? 'is-pass' : 'is-fail'">{{ label }} · {{ script.qualityCheck[key] ? '通过' : '未通过' }}</span>
      </div>
      <ul v-if="script.qualityCheck.issues.length" class="quality-issues"><li v-for="issue in script.qualityCheck.issues" :key="issue">{{ issue }}</li></ul>
    </div>

    <p v-if="script.taskErrorMessage" class="task-error">{{ script.taskErrorMessage }}</p>
    <label v-if="awaitingReview" class="review-feedback">
      <span>修订反馈</span>
      <textarea v-model="feedback" data-test="review-feedback" rows="3" placeholder="说明需要补强的剧情、台词或连续性问题" />
    </label>
    <footer>
      <ActionButton v-if="active" label="取消任务" variant="danger" :disabled="busy" @click="emit('cancel')"><Square :size="14" /></ActionButton>
      <span v-else />
      <div class="review-actions">
        <ActionButton label="请求修订" :disabled="!awaitingReview || busy || !feedback.trim()" data-test="request-revision" @click="requestRevision"><RotateCcw :size="15" /></ActionButton>
        <ActionButton label="接受当前编辑" :disabled="!awaitingReview || busy" @click="emit('editAccept')"><PencilLine :size="15" /></ActionButton>
        <ActionButton label="直接接受" variant="primary" :disabled="!awaitingReview || busy" data-test="accept-script" @click="emit('accept')"><Check :size="16" /></ActionButton>
      </div>
    </footer>
  </section>
</template>
