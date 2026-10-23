import { describe, expect, it, vi } from 'vitest'
import { StageReviewClient } from '@/features/stage-reviews/client'

describe('stage review client', () => {
  it('uses the same-origin API path by default', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ passed: true, issues: [], revision_instructions: [] }), { status: 200 }))
    const client = new StageReviewClient(undefined, fetcher as typeof fetch)

    await client.check({ stage: 'analysis', content: { content: '分析' }, upstream_context: {} })

    expect(fetcher).toHaveBeenCalledWith('/api/stage-reviews/check', expect.anything())
  })

  it('calls the backend check and revise endpoints', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ passed: true, issues: [], revision_instructions: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: { content: '修订结果' } }), { status: 200 }))
    const client = new StageReviewClient('/backend-api', fetcher as typeof fetch)
    const payload = { stage: 'analysis' as const, content: { content: '分析' }, upstream_context: {} }

    await client.check(payload)
    await client.revise({ ...payload, issues: [], revision_instructions: [], user_requirements: '加强冲突' })

    expect(fetcher).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({ method: 'POST' }))
    expect(String(fetcher.mock.calls[0][0])).toContain('/api/stage-reviews/check')
    expect(String(fetcher.mock.calls[1][0])).toContain('/api/stage-reviews/revise')
  })
})
