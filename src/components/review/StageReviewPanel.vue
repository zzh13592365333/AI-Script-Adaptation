<script setup lang="ts">
import { ref } from 'vue'
import { Check, History, RotateCcw, SearchCheck, UserRoundCheck } from 'lucide-vue-next'
import type { StageReviewState } from '@/domain/project'
import ActionButton from '@/components/common/ActionButton.vue'

defineProps<{ state: StageReviewState; confirmLabel: string; canConfirm: boolean; busy?: boolean }>()
const emit = defineEmits<{ check: []; revise: [feedback: string]; restore: [version: number]; confirm: [] }>()
const manualOpen = ref(false)
const feedback = ref('')

function submitManualRevision() {
  const value = feedback.value.trim()
  if (!value) return
  emit('revise', value)
  manualOpen.value = false
}
</script>

<template>
  <section class="stage-review-panel">
    <header>
      <div><span class="panel-label">阶段审核</span><h2>自查与人工确认</h2></div>
      <span class="review-version">V{{ state.currentVersion || 0 }}</span>
    </header>

    <div class="review-primary-actions">
      <ActionButton data-test="ai-check" label="AI 自查" :loading="state.status === 'checking'" :disabled="busy || !state.currentVersion" @click="emit('check')"><SearchCheck :size="16" /></ActionButton>
      <ActionButton data-test="manual-review" label="人工审查" :disabled="busy || !state.currentVersion" @click="manualOpen = !manualOpen"><UserRoundCheck :size="16" /></ActionButton>
    </div>

    <div v-if="state.status === 'passed'" class="review-pass"><Check :size="16" />当前版本自查通过，可以人工确认。</div>
    <div v-else-if="state.issues.length" class="review-issues">
      <strong>AI 自查问题清单</strong>
      <ol><li v-for="issue in state.issues" :key="issue">{{ issue }}</li></ol>
      <ActionButton label="按建议修订" :disabled="busy" @click="emit('revise', '')"><RotateCcw :size="15" /></ActionButton>
    </div>
    <p v-if="state.error" class="task-error">{{ state.error }}</p>

    <div v-if="manualOpen" class="manual-review-box">
      <label><span>人工修改要求</span><textarea v-model="feedback" data-test="manual-feedback" rows="4" placeholder="说明需要调整的人物、节奏、剧情、结构或表达" /></label>
      <ActionButton data-test="manual-revise" label="按要求重新生成" variant="primary" :disabled="busy || !feedback.trim()" @click="submitManualRevision"><RotateCcw :size="15" /></ActionButton>
    </div>

    <div v-if="state.versions.length" class="stage-version-history">
      <div class="version-heading"><History :size="15" /><strong>版本历史</strong></div>
      <div class="version-list">
        <button v-for="item in state.versions" :key="item.version" :class="{ active: item.version === state.currentVersion }" @click="emit('restore', item.version)">
          <strong>V{{ item.version }}</strong><span>{{ item.source === 'human' ? '人工编辑' : item.source === 'restored' ? '历史恢复' : 'AI 生成' }}</span><small>{{ item.confirmed ? '已确认' : '草稿' }}</small>
        </button>
      </div>
    </div>

    <footer><span>AI 自查为可选，可直接人工确认当前版本。</span><ActionButton data-test="confirm-stage" :label="confirmLabel" variant="primary" :disabled="busy || !canConfirm" @click="emit('confirm')"><Check :size="16" /></ActionButton></footer>
  </section>
</template>
