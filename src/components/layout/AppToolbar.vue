<script setup lang="ts">
import { Download, PanelRightOpen, RotateCcw, Settings, Upload } from 'lucide-vue-next'
import { ref } from 'vue'
import { useWorkflowStore } from '@/stores/workflow'

const emit = defineEmits<{ settings: []; context: []; export: []; importProject: [file: File] }>()
const store = useWorkflowStore()
const editing = ref(false)
const draftName = ref(store.project.name)
function finishRename() { store.renameProject(draftName.value); editing.value = false }
function onImport(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (file) emit('importProject', file) }
</script>
<template>
  <header class="app-toolbar">
    <div class="brand"><span class="brand-mark">漫</span><span><strong>自动AI漫剧流程</strong><small>从原稿到分集脚本</small></span></div>
    <div class="project-title">
      <input v-if="editing" v-model="draftName" aria-label="项目名称" @blur="finishRename" @keyup.enter="finishRename" />
      <button v-else title="重命名项目" @click="editing = true">{{ store.project.name }}</button>
      <span v-if="store.savingPaused" class="save-warning">本地保存已暂停</span>
      <span v-else class="save-state">已自动保存</span>
    </div>
    <div class="toolbar-actions">
      <button class="icon-button mobile-only" title="上下文" @click="$emit('context')"><PanelRightOpen :size="18" /></button>
      <label class="icon-button" title="导入项目"><Upload :size="18" /><input type="file" accept=".json" hidden @change="onImport" /></label>
      <button class="icon-button" title="导出项目" @click="$emit('export')"><Download :size="18" /></button>
      <button class="icon-button" title="新建项目" @click="store.resetProject"><RotateCcw :size="18" /></button>
      <button class="icon-button" title="提示词设置" @click="$emit('settings')"><Settings :size="18" /></button>
    </div>
  </header>
</template>
