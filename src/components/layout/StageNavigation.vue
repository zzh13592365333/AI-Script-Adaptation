<script setup lang="ts">
import { Clapperboard, FileSearch, ListChecks, ScrollText, Users } from 'lucide-vue-next'
import type { Component } from 'vue'
import type { StageId } from '@/domain/project'
import { useWorkflowStore } from '@/stores/workflow'
import StatusBadge from '@/components/common/StatusBadge.vue'
import { aggregateNodeStatuses } from '@/domain/workflow'

const store = useWorkflowStore()
const stages: Array<{ id: StageId; label: string; description: string; icon: Component }> = [
  { id: 'source', label: '导入与分析', description: '原稿解析与核心洞察', icon: FileSearch },
  { id: 'adaptation', label: '漫剧设定', description: '方向、身份、世界与人物', icon: Users },
  { id: 'planning', label: '全剧规划', description: '剧名、总纲与阶段剧情', icon: Clapperboard },
  { id: 'outlines', label: '分集大纲', description: '批量规划每集钩子', icon: ListChecks },
  { id: 'scripts', label: '漫剧脚本', description: '逐集扩写、重写与导出', icon: ScrollText }
]

function statusFor(stage: StageId) {
  if (stage === 'source') return store.project.analysis.status
  if (stage === 'adaptation') return store.project.adaptation.status
  if (stage === 'planning') return store.project.planning.status
  if (stage === 'outlines') return aggregateNodeStatuses(store.project.outlines)
  return aggregateNodeStatuses(store.project.scripts)
}
</script>

<template>
  <nav class="stage-navigation" aria-label="改编流程">
    <button v-for="(stage, index) in stages" :key="stage.id" :data-stage="stage.id" class="stage-item" :class="{ active: store.project.activeStage === stage.id }" @click="store.setStage(stage.id)">
      <span class="stage-index">{{ index + 1 }}</span>
      <component :is="stage.icon" :size="18" aria-hidden="true" />
      <span class="stage-copy"><strong>{{ stage.label }}</strong><small>{{ stage.description }}</small></span>
      <StatusBadge :status="statusFor(stage.id)" />
    </button>
  </nav>
</template>
