<script setup lang="ts">
defineProps<{ progress: number; label: string }>()
</script>

<template>
  <div class="generation-progress">
    <div><strong>{{ label }}</strong><span>{{ progress }}%</span></div>
    <div class="progress-track"><i :style="{ width: progress + '%' }" /></div>
  </div>
</template>
