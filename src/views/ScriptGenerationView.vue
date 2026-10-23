<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckCheck, Download, RefreshCw, Sparkles, Square } from 'lucide-vue-next'
import { useWorkflowStore } from '@/stores/workflow'
import { downloadBlob, exportEpisodeTxt, exportProjectZip, exportSeriesTxt } from '@/features/project/export'
import ActionButton from '@/components/common/ActionButton.vue'
import EpisodeList from '@/components/episodes/EpisodeList.vue'
import RewriteDialog from '@/components/episodes/RewriteDialog.vue'
import ScriptEditor from '@/components/episodes/ScriptEditor.vue'
import ScriptReviewPanel from '@/components/episodes/ScriptReviewPanel.vue'
import ScriptVersionHistory from '@/components/episodes/ScriptVersionHistory.vue'
const store = useWorkflowStore()
const selected = ref(1)
const rewriteOpen = ref(false)
const selectedScript = computed(() => store.project.scripts[selected.value - 1])
const confirmationDisabled = computed(() => Boolean(store.busyAction) || store.project.scripts.some((item) => item.status === 'generating'))
const canConfirmAll = computed(() => !confirmationDisabled.value
  && !store.project.scripts.some((item) => item.taskId && item.taskStatus !== 'completed')
  && store.project.scripts.some((item) => Boolean(item.content)))
function downloadText(content: string, filename: string) { downloadBlob(new Blob([content], { type: 'text/plain;charset=utf-8' }), filename) }
async function exportZip() { downloadBlob(await exportProjectZip(store.project), `${store.project.name}.zip`) }
async function rewrite(instruction: string) { rewriteOpen.value = false; await store.rewriteEpisode(selected.value, instruction) }
function confirmSelected() { selected.value = store.confirmScript(selected.value) }
async function acceptScript() { await store.reviewScriptTask(selected.value, { action: 'accept' }) }
async function acceptEditedScript() { await store.reviewScriptTask(selected.value, { action: 'edit_accept', edited_content: selectedScript.value.content }) }
async function requestRevision(feedback: string) { await store.reviewScriptTask(selected.value, { action: 'request_revision', feedback }) }
</script>
<template>
  <div class="stage-view">
    <header class="view-header"><div><span class="eyebrow">STAGE 05</span><h1>漫剧脚本</h1><p>单集或批量扩写，生成适合画面制作的分场脚本，支持停止、重写和导出。</p></div><div class="header-actions"><ActionButton label="批量生成" :loading="store.busyAction === 'batch-scripts'" @click="store.generateBatch(selected)"><Sparkles :size="17" /></ActionButton><ActionButton label="确认全部剧本" variant="primary" :disabled="!canConfirmAll" @click="store.confirmAllScripts"><CheckCheck :size="17" /></ActionButton><ActionButton label="导出 ZIP" @click="exportZip"><Download :size="17" /></ActionButton></div></header>
    <div class="script-toolbar"><div><ActionButton label="生成本集" variant="primary" :loading="store.busyAction === `script-${selected}`" :disabled="!store.project.outlines[selected - 1].content" @click="store.generateEpisode(selected)"><Sparkles :size="17" /></ActionButton><ActionButton v-if="store.currentTaskId" label="停止" variant="danger" @click="store.stopCurrentGeneration"><Square :size="15" /></ActionButton><ActionButton label="重写" :disabled="!store.project.scripts[selected - 1].content" @click="rewriteOpen = true"><RefreshCw :size="16" /></ActionButton></div><div><button class="text-button" @click="downloadText(exportEpisodeTxt(store.project, selected), `第${selected}集.txt`)">导出本集</button><button class="text-button" @click="downloadText(exportSeriesTxt(store.project), '全集剧本.txt')">导出全集</button></div></div>
    <div class="episode-workspace">
      <EpisodeList mode="script" :items="store.project.scripts" :selected="selected" @select="selected = $event" />
      <div class="script-workbench-detail">
        <ScriptEditor :script="selectedScript" :confirmation-disabled="confirmationDisabled" :show-confirmation="!selectedScript.taskId" @update="store.updateScript(selected, $event)" @confirm="confirmSelected" />
        <ScriptReviewPanel
          v-if="selectedScript.taskId"
          :script="selectedScript"
          :busy="Boolean(store.busyAction)"
          @accept="acceptScript"
          @edit-accept="acceptEditedScript"
          @request-revision="requestRevision"
          @cancel="store.cancelScriptTask(selected)"
        />
        <ScriptVersionHistory :versions="selectedScript.versions ?? []" :current-version="selectedScript.versions?.at(-1)?.version" @select="store.updateScript(selected, $event)" />
      </div>
    </div>
    <RewriteDialog :open="rewriteOpen" @cancel="rewriteOpen = false" @submit="rewrite" />
  </div>
</template>
