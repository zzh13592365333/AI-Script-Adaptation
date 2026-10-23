<script setup lang="ts">
import { computed } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { useWorkflowStore } from '@/stores/workflow'
import { canConfirmStage } from '@/domain/workflow'
import ActionButton from '@/components/common/ActionButton.vue'
import FieldEditor from '@/components/common/FieldEditor.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { toReadableText } from '@/features/ai/normalize-output'
import StageReviewPanel from '@/components/review/StageReviewPanel.vue'
const store = useWorkflowStore()
const canConfirm = computed(() => canConfirmStage(store.project, 'planning').allowed)
function updateEpisodeCount(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isInteger(value) && value >= 1 && value <= 100) store.updateEpisodeCount(value)
}
</script>
<template>
  <div class="stage-view">
    <header class="view-header"><div><span class="eyebrow">STAGE 03</span><h1>全剧规划</h1><p>确定剧名、类型、集数、全剧总纲和阶段节奏。</p></div><div class="header-actions"><StatusBadge :status="store.project.planning.status" /><ActionButton label="生成全剧规划" variant="primary" :loading="store.busyAction === 'planning'" :disabled="!store.project.adaptation.direction" @click="store.generatePlan"><Sparkles :size="17" /></ActionButton></div></header>
    <div class="planning-controls"><label><span>剧名</span><input :value="toReadableText(store.project.planning.title)" @input="store.updatePlanning('title', ($event.target as HTMLInputElement).value)" /></label><label><span>类型</span><input :value="toReadableText(store.project.planning.genre)" @input="store.updatePlanning('genre', ($event.target as HTMLInputElement).value)" /></label><label><span>总集数</span><input type="number" min="1" max="100" step="1" :value="store.project.planning.episodeCount" @input="updateEpisodeCount" /></label><label><span>单集目标字数</span><input type="number" min="300" max="5000" step="100" :value="store.project.planning.targetWords" @change="store.updateTargetWords(Number(($event.target as HTMLInputElement).value))" /></label></div>
    <section v-if="store.project.planning.titleCandidates.length" class="title-candidates"><h2>剧名候选</h2><div><button v-for="title in store.project.planning.titleCandidates" :key="title" :class="{ selected: title === store.project.planning.title }" @click="store.updatePlanning('title', title)">{{ title }}</button></div></section>
    <div class="planning-editors"><section class="editor-panel"><FieldEditor label="全剧总纲" hint="主角成长线、冲突升级、关键反转与结局回报" :rows="12" :model-value="toReadableText(store.project.planning.seriesOutline)" @update:model-value="store.updatePlanning('seriesOutline', $event)" /></section><section class="editor-panel"><FieldEditor label="阶段剧情" hint="起势、升级、失控、反击与收束" :rows="12" :model-value="toReadableText(store.project.planning.phasePlan)" @update:model-value="store.updatePlanning('phasePlan', $event)" /></section></div>
    <StageReviewPanel v-if="store.project.planning.seriesOutline" :state="store.project.stageReviews.planning" confirm-label="确认规划并进入分集大纲" :can-confirm="canConfirm" :busy="Boolean(store.busyAction)" @check="store.checkStage('planning')" @revise="store.reviseStage('planning', $event)" @restore="store.restoreStageVersion('planning', $event)" @confirm="store.confirmPlan" />
  </div>
</template>
