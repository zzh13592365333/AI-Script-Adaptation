import JSZip from 'jszip'
import type { Project } from '@/domain/project'

export function exportEpisodeTxt(project: Project, episodeNumber: number): string {
  const script = project.scripts.find((item) => item.episodeNumber === episodeNumber)
  if (!script) throw new Error(`第 ${episodeNumber} 集不存在`)
  return `《${project.planning.title || project.name}》\n第 ${episodeNumber} 集\n\n${script.content}`
}

export function exportSeriesTxt(project: Project): string {
  return project.scripts
    .filter((script) => script.content.trim())
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((script) => exportEpisodeTxt(project, script.episodeNumber))
    .join('\n\n================================\n\n')
}

export function exportProjectJson(project: Project): string {
  return JSON.stringify(project, null, 2)
}

export async function exportProjectZip(project: Project): Promise<Blob> {
  const zip = new JSZip()
  zip.file('project.json', exportProjectJson(project))
  zip.file('全集剧本.txt', exportSeriesTxt(project))
  for (const script of project.scripts.filter((item) => item.content.trim())) {
    zip.file(`episodes/第${String(script.episodeNumber).padStart(2, '0')}集.txt`, exportEpisodeTxt(project, script.episodeNumber))
  }
  return zip.generateAsync({ type: 'blob' })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
