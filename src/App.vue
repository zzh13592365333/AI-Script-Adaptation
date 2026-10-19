<script setup lang="ts">
import { computed, ref } from 'vue'
import AppToolbar from '@/components/layout/AppToolbar.vue'
import ContextPanel from '@/components/layout/ContextPanel.vue'
import MobileContextDrawer from '@/components/layout/MobileContextDrawer.vue'
import StageNavigation from '@/components/layout/StageNavigation.vue'
import ToastRegion from '@/components/common/ToastRegion.vue'
import PromptSettingsDrawer from '@/components/settings/PromptSettingsDrawer.vue'
import { downloadBlob, exportProjectJson } from '@/features/project/export'
import SourceAnalysisView from '@/views/SourceAnalysisView.vue'
import AdaptationSetupView from '@/views/AdaptationSetupView.vue'
import SeriesPlanningView from '@/views/SeriesPlanningView.vue'
import EpisodeOutlinesView from '@/views/EpisodeOutlinesView.vue'
import ScriptGenerationView from '@/views/ScriptGenerationView.vue'
import { useWorkflowStore } from '@/stores/workflow'

const store = useWorkflowStore()
const contextOpen = ref(false)
const settingsOpen = ref(false)
const views = { source: SourceAnalysisView, adaptation: AdaptationSetupView, planning: SeriesPlanningView, outlines: EpisodeOutlinesView, scripts: ScriptGenerationView }
const activeView = computed(() => views[store.project.activeStage])
function exportProject() { downloadBlob(new Blob([exportProjectJson(store.project)], { type: 'application/json' }), `${store.project.name}.json`) }
function importProjectFile(file: File) { const reader = new FileReader(); reader.onload = () => store.importProjectJson(String(reader.result)); reader.readAsText(file) }
</script>

<template>
  <div class="workbench">
    <AppToolbar @context="contextOpen = true" @settings="settingsOpen = true" @export="exportProject" @import-project="importProjectFile" />
    <div class="app-grid">
      <aside class="left-sidebar"><StageNavigation /></aside>
      <main class="main-workspace"><component :is="activeView" /></main>
      <div class="right-sidebar"><ContextPanel /></div>
    </div>
    <MobileContextDrawer :open="contextOpen" @close="contextOpen = false" />
    <PromptSettingsDrawer :open="settingsOpen" @close="settingsOpen = false" />
    <ToastRegion :message="store.notice" @close="store.clearNotice" />
  </div>
</template>
