<script setup lang="ts">
import { computed, watch } from 'vue'
import { FolderOpen, Trash2, X } from 'lucide-vue-next'
import type { ProjectSummary } from '@/features/project/persistence'
import ActionButton from '@/components/common/ActionButton.vue'
import { useWorkflowStore } from '@/stores/workflow'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = useWorkflowStore()
const records = computed<ProjectSummary[]>(() => store.getProjectRecords())

function refresh() {
  void store.projectListVersion
}

function openProject(id: string) {
  if (store.restore(id)) emit('close')
}

function removeProject(record: ProjectSummary) {
  if (window.confirm(`确定删除项目“${record.name}”吗？`)) store.removeProject(record.id)
}

watch(() => props.open, (open) => { if (open) refresh() })
</script>

<template>
  <div v-if="open" class="records-backdrop" @click.self="emit('close')">
    <aside class="records-drawer" aria-label="项目记录">
      <header>
        <div><span class="eyebrow">PROJECTS</span><h2>项目记录</h2></div>
        <button class="icon-button" title="关闭" @click="emit('close')"><X :size="19" /></button>
      </header>
      <p class="records-hint">项目会自动保存在当前浏览器中，重新打开即可继续编辑。</p>
      <div v-if="records.length" class="records-list">
        <article v-for="record in records" :key="record.id" class="record-item" :class="{ current: record.id === store.project.id }">
          <button class="record-open" @click="openProject(record.id)">
            <FolderOpen :size="17" />
            <span><strong>{{ record.name }}</strong><small>{{ new Date(record.updatedAt).toLocaleString() }} · {{ record.episodeCount }} 集</small></span>
          </button>
          <button class="icon-button record-delete" title="删除项目" @click="removeProject(record)"><Trash2 :size="16" /></button>
        </article>
      </div>
      <div v-else class="records-empty">还没有保存的项目记录。</div>
      <footer><ActionButton label="关闭" @click="emit('close')" /></footer>
    </aside>
  </div>
</template>
