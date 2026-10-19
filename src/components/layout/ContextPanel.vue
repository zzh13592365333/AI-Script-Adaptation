<script setup lang="ts">
import { computed } from 'vue'
import { CircleCheck, FileText, Sparkles } from 'lucide-vue-next'
import { useWorkflowStore } from '@/stores/workflow'
const store = useWorkflowStore()
const sourceLabel = computed(() => store.project.source ? `${store.project.source.characterCount.toLocaleString()} 字 · ${store.project.source.chapters.length} 章` : '尚未导入原稿')
</script>
<template>
  <aside class="context-panel">
    <section><h2>项目上下文</h2><div class="context-row"><FileText :size="17" /><span><strong>原稿</strong><small>{{ sourceLabel }}</small></span></div><div class="context-row"><CircleCheck :size="17" /><span><strong>已生成剧本</strong><small>{{ store.completedEpisodes }} / {{ store.project.planning.episodeCount }} 集</small></span></div></section>
    <section><h2>当前模型</h2><div class="model-box"><Sparkles :size="18" /><span><strong>Mock Creative v1</strong><small>本地演示模式</small></span><i>MOCK</i></div></section>
      <section class="context-note"><h2>依赖提示</h2><p v-if="store.project.planning.status === 'dirty'">漫剧设定发生变化，全剧规划需要更新。</p><p v-else>当前内容会作为后续生成的上下文，确认后再继续可减少重复生成。</p></section>
  </aside>
</template>
