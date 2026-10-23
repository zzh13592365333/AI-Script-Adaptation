<script setup lang="ts">
import { computed, ref } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { useWorkflowStore } from '@/stores/workflow'
import { canConfirmStage } from '@/domain/workflow'
import ActionButton from '@/components/common/ActionButton.vue'
import EpisodeList from '@/components/episodes/EpisodeList.vue'
import GenerationProgress from '@/components/episodes/GenerationProgress.vue'
import OutlineEditor from '@/components/episodes/OutlineEditor.vue'
import StageReviewPanel from '@/components/review/StageReviewPanel.vue'
const store = useWorkflowStore()
const selected = ref(1)
const confirmationDisabled = computed(() => store.busyAction === 'outlines' || store.project.outlines.some((item) => item.status === 'generating'))
const canConfirmAll = computed(() => !confirmationDisabled.value && store.project.outlines.some((item) => Boolean(item.content)))
const stageCanConfirm = computed(() => canConfirmAll.value && canConfirmStage(store.project, 'outlines').allowed)
function confirmSelected() { selected.value = store.confirmOutline(selected.value) }
</script>
<template>
  <div class="stage-view">
    <header class="view-header"><div><span class="eyebrow">STAGE 04</span><h1>分集大纲</h1><p>批量生成并逐集确认开场钩子、冲突升级和结尾悬念。</p></div><div class="header-actions"><ActionButton label="生成全部大纲" :loading="store.busyAction === 'outlines'" :disabled="!store.project.planning.seriesOutline" @click="store.generateOutlines"><Sparkles :size="17" /></ActionButton></div></header>
    <GenerationProgress v-if="store.busyAction === 'outlines'" :progress="store.progress" label="正在规划分集结构" />
    <StageReviewPanel v-if="store.project.outlines.some((item) => item.content)" :state="store.project.stageReviews.outlines" confirm-label="确认全部大纲并进入漫剧脚本" :can-confirm="stageCanConfirm" :busy="Boolean(store.busyAction)" @check="store.checkStage('outlines')" @revise="store.reviseStage('outlines', $event)" @restore="store.restoreStageVersion('outlines', $event)" @confirm="store.confirmAllOutlines" />
    <div class="episode-workspace"><EpisodeList mode="outline" :items="store.project.outlines" :selected="selected" @select="selected = $event" /><OutlineEditor :outline="store.project.outlines[selected - 1]" :confirmation-disabled="confirmationDisabled" @update="(title, content) => store.updateOutline(selected, title, content)" @lock="store.toggleOutlineLock(selected)" @confirm="confirmSelected" /></div>
  </div>
</template>
