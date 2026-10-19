import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { createProject } from '@/domain/project'
import { exportEpisodeTxt, exportProjectJson, exportProjectZip, exportSeriesTxt } from '@/features/project/export'

function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
}

describe('project export', () => {
  it('exports episodes in numeric order', () => {
    const project = createProject()
    project.scripts[1].content = '第二集正文'
    project.scripts[0].content = '第一集正文'
    expect(exportEpisodeTxt(project, 1)).toContain('第一集正文')
    expect(exportSeriesTxt(project).indexOf('第一集正文')).toBeLessThan(exportSeriesTxt(project).indexOf('第二集正文'))
  })

  it('round-trips project JSON', () => {
    const project = createProject()
    expect(JSON.parse(exportProjectJson(project)).id).toBe(project.id)
  })

  it('creates predictable ZIP filenames', async () => {
    const project = createProject()
    project.name = '逆光计划'
    project.scripts[0].content = '正文'
    const zipBlob = await exportProjectZip(project)
    const zip = await JSZip.loadAsync(await blobArrayBuffer(zipBlob))
    expect(Object.keys(zip.files)).toContain('project.json')
    expect(Object.keys(zip.files)).toContain('episodes/第01集.txt')
    expect(Object.keys(zip.files)).toContain('全集剧本.txt')
  })
})
