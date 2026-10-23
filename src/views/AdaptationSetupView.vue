<script setup lang="ts">
import { computed } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { useWorkflowStore } from '@/stores/workflow'
import { canConfirmStage } from '@/domain/workflow'
import ActionButton from '@/components/common/ActionButton.vue'
import FieldEditor from '@/components/common/FieldEditor.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import StageReviewPanel from '@/components/review/StageReviewPanel.vue'
const store = useWorkflowStore()
const canConfirm = computed(() => canConfirmStage(store.project, 'adaptation').allowed)
</script>
<template>
  <div class="stage-view">
    <header class="view-header"><div><span class="eyebrow">STAGE 02</span><h1>漫剧设定</h1><p>把创作方向、主角身份、世界观和人物关系放在同一上下文中确认。</p></div><div class="header-actions"><StatusBadge :status="store.project.adaptation.status" /><ActionButton label="生成全部设定" variant="primary" :loading="store.busyAction === 'adaptation'" :disabled="!store.project.analysis.content" @click="store.generateAdaptation"><Sparkles :size="17" /></ActionButton></div></header>
    <div v-if="!store.project.analysis.content" class="empty-state"><h2>需要原稿分析</h2><p>返回第一阶段完成分析后，即可生成漫剧设定。</p></div>
    <div v-else class="editor-grid">
      <section class="editor-panel"><FieldEditor label="创作方向" hint="目标受众、画面风格、调性和叙事策略" :model-value="store.project.adaptation.direction" @update:model-value="store.updateAdaptation('direction', $event)" /></section>
      <section class="editor-panel"><FieldEditor label="核心身份" hint="主角身份、目标、困境、秘密和成长方向" :model-value="store.project.adaptation.identity" @update:model-value="store.updateAdaptation('identity', $event)" /></section>
      <section class="editor-panel"><FieldEditor label="世界观" hint="时代、地点、规则、组织和资源约束" :model-value="store.project.adaptation.world" @update:model-value="store.updateAdaptation('world', $event)" /></section>
      <section class="editor-panel"><FieldEditor label="主要人物" hint="人物动机、秘密、关系和原稿映射" :rows="7" :model-value="store.project.adaptation.characters" @update:model-value="store.updateAdaptation('characters', $event)" /></section>
    </div>
    <StageReviewPanel v-if="store.project.adaptation.direction" :state="store.project.stageReviews.adaptation" confirm-label="确认设定并进入全剧规划" :can-confirm="canConfirm" :busy="Boolean(store.busyAction)" @check="store.checkStage('adaptation')" @revise="store.reviseStage('adaptation', $event)" @restore="store.restoreStageVersion('adaptation', $event)" @confirm="store.confirmAdaptation" />
  </div>
</template>
