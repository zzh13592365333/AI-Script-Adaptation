<script setup lang="ts">
import { Check, FileUp, FlaskConical, Sparkles } from 'lucide-vue-next'
import { useWorkflowStore } from '@/stores/workflow'
import ActionButton from '@/components/common/ActionButton.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
const store = useWorkflowStore()
async function onFile(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (file) await store.importSourceFile(file) }
</script>
<template>
  <div class="stage-view">
    <header class="view-header"><div><span class="eyebrow">STAGE 01</span><h1>导入与分析</h1><p>解析原稿结构，提取人物、冲突、视觉看点和漫剧创作机会。</p></div><StatusBadge :status="store.project.analysis.status" /></header>
    <section v-if="!store.project.source" class="upload-zone">
      <FileUp :size="30" /><h2>导入故事原稿</h2><p>支持 TXT、DOCX、EPUB，长原稿会提取开头、中段和结尾进行快速分析。</p>
      <div class="button-row"><label class="action-button is-primary"><FileUp :size="17" />选择文件<input type="file" accept=".txt,.docx,.epub" hidden @change="onFile" /></label><ActionButton data-test="load-sample" label="载入示例" @click="store.loadSample"><FlaskConical :size="17" /></ActionButton></div>
    </section>
    <template v-else>
      <section class="source-summary"><div><span class="file-icon"><FileUp :size="20" /></span><span><strong>{{ store.project.source.name }}</strong><small>{{ store.project.source.characterCount.toLocaleString() }} 字 · {{ store.project.source.chapters.length }} 个章节</small></span></div><div class="button-row"><label class="text-button">替换<input type="file" accept=".txt,.docx,.epub" hidden @change="onFile" /></label><ActionButton data-test="analyze" label="分析原稿" variant="primary" :loading="store.busyAction === 'analysis'" @click="store.analyzeSource"><Sparkles :size="17" /></ActionButton></div></section>
      <div class="split-editor"><section><div class="section-heading"><h2>原稿预览</h2><span>{{ store.project.source.truncated ? '分析内容已截断' : '全文可用于分析' }}</span></div><pre class="source-preview">{{ store.project.source.text }}</pre></section><section><div class="section-heading"><h2>AI 分析</h2><StatusBadge :status="store.project.analysis.status" /></div><textarea v-model="store.project.analysis.content" class="result-editor" rows="18" placeholder="点击“分析原稿”生成题材、卖点、人物关系和漫剧创作建议。" /><div class="section-actions"><ActionButton label="确认分析" variant="primary" :disabled="!store.project.analysis.content || store.project.analysis.status === 'generating'" @click="store.confirmAnalysis"><Check :size="17" /></ActionButton></div></section></div>
    </template>
  </div>
</template>
