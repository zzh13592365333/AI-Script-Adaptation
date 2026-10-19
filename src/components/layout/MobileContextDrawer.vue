<script setup lang="ts">
import ContextPanel from './ContextPanel.vue'
defineProps<{ open: boolean }>()
defineEmits<{ close: [] }>()
</script>
<template><div v-if="open" class="drawer-backdrop" @click.self="$emit('close')"><div class="mobile-drawer"><button class="drawer-close" @click="$emit('close')">关闭</button><ContextPanel /></div></div></template>
