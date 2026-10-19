<script setup lang="ts">
import { ref, watch } from 'vue'
defineProps<{ open: boolean }>()
const emit = defineEmits<{ cancel: []; submit: [instruction: string] }>()
const instruction = ref('加强冲突升级，并让结尾悬念更明确。')
watch(() => instruction.value, () => undefined)
</script>
<template><div v-if="open" class="dialog-backdrop" @click.self="emit('cancel')"><section class="dialog" role="dialog" aria-modal="true"><h2>重写本集</h2><p>说明希望调整的节奏、台词、情绪或剧情点。</p><textarea v-model="instruction" rows="5" /><div class="dialog-actions"><button class="text-button" @click="emit('cancel')">取消</button><button class="action-button is-primary" @click="emit('submit', instruction)">开始重写</button></div></section></div></template>
