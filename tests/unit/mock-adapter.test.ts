import { describe, expect, it } from 'vitest'
import { createProject } from '@/domain/project'
import { MockAiAdapter } from '@/features/ai/mock-adapter'

describe('MockAiAdapter', () => {
  it('advances an outline job and preserves locked local outlines when merging', async () => {
    const adapter = new MockAiAdapter({ latencyMs: 1 })
    const project = createProject()
    project.outlines[0] = { ...project.outlines[0], title: '人工标题', content: '人工内容', locked: true }
    const job = await adapter.createOutlineJob({ project })
    let result = await adapter.getJob(job.jobId)
    while (result.status !== 'completed') result = await adapter.getJob(job.jobId)

    expect(result.progress).toBe(100)
    expect(result.outlines?.[0].title).toBe('人工标题')
    expect(result.outlines?.[0].content).toBe('人工内容')
    expect(result.outlines?.[1].content).toContain('第 2 集')
  })

  it('streams deterministic episode chunks', async () => {
    const adapter = new MockAiAdapter({ latencyMs: 1 })
    const chunks: string[] = []
    await adapter.generateEpisode(
      { episodeNumber: 2, outline: '发现继承文件', targetWords: 1200 },
      { onChunk: (chunk) => chunks.push(chunk) }
    )
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks.join('')).toContain('第 2 集')
  })

  it('stops between chunks and keeps already received text', async () => {
    const adapter = new MockAiAdapter({ latencyMs: 5 })
    const chunks: string[] = []
    let taskId = ''
    const generation = adapter.generateEpisode(
      { episodeNumber: 1, outline: '开场冲突', targetWords: 1200 },
      {
        onStart: (id) => { taskId = id },
        onChunk: (chunk) => {
          chunks.push(chunk)
          if (chunks.length === 1) adapter.stopGeneration(taskId)
        }
      }
    )
    await expect(generation).rejects.toThrow('已停止')
    expect(chunks.join('').length).toBeGreaterThan(0)
    expect(chunks.length).toBe(1)
  })
})
