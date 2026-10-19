<script setup lang="ts">
defineProps<{ message: string }>()
defineEmits<{ close: [] }>()
</script>
<template><div v-if="message" class="toast" role="status"><span>{{ message }}</span><button title="关闭" @click="$emit('close')">×</button></div></template>
