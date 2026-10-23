import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/stage-reviews/check', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ passed: true, issues: [], revision_instructions: [] }) })
  })
})

async function checkAndConfirm(page: Page, confirmLabel: string) {
  await page.getByRole('button', { name: 'AI 自查' }).click()
  await expect(page.getByText('当前版本自查通过，可以人工确认。')).toBeVisible()
  await page.getByRole('button', { name: confirmLabel }).click()
}

test('completes the five-stage mock workflow', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '载入示例' }).click()
  await page.getByRole('button', { name: '分析原稿' }).click()
  await checkAndConfirm(page, '确认分析并进入漫剧设定')

  await page.locator('[data-stage="adaptation"]').click()
  await page.getByRole('button', { name: '生成全部设定' }).click()
  await checkAndConfirm(page, '确认设定并进入全剧规划')

  await page.locator('[data-stage="planning"]').click()
  await page.getByRole('button', { name: '生成全剧规划' }).click()
  await page.getByLabel('总集数').fill('3')
  await expect(page.getByLabel('总集数')).toHaveValue('3')
  await checkAndConfirm(page, '确认规划并进入分集大纲')

  await page.locator('[data-stage="outlines"]').click()
  await page.getByRole('button', { name: '生成全部大纲' }).click()
  await expect(page.getByText('分集大纲已生成')).toBeVisible()
  await checkAndConfirm(page, '确认全部大纲并进入漫剧脚本')

  await page.locator('[data-stage="scripts"]').click()
  await expect(page.getByRole('button', { name: '确认全部剧本' })).toBeVisible()
  await page.getByRole('button', { name: '生成本集' }).click()
  await expect(page.locator('.script-textarea')).toHaveValue(/第 1 集/)
  await page.getByRole('button', { name: '确认全部剧本' }).click()
  await expect(page.locator('[data-stage="scripts"]')).toContainText('已确认')
  await page.getByRole('button', { name: '确认本集' }).click()
  await expect(page.locator('.episode-list button.selected .episode-number')).toHaveText('02')
  await expect(page.getByText('已生成剧本').locator('..')).toContainText('1 / 3')
})

test('marks planning dirty after an upstream setup edit', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '载入示例' }).click()
  await page.getByRole('button', { name: '分析原稿' }).click()
  await checkAndConfirm(page, '确认分析并进入漫剧设定')
  await page.locator('[data-stage="adaptation"]').click()
  await page.getByRole('button', { name: '生成全部设定' }).click()
  await checkAndConfirm(page, '确认设定并进入全剧规划')
  await page.locator('[data-stage="planning"]').click()
  await page.getByRole('button', { name: '生成全剧规划' }).click()
  await checkAndConfirm(page, '确认规划并进入分集大纲')
  await page.locator('[data-stage="adaptation"]').click()
  await page.getByLabel('创作方向').fill('改为国风悬疑漫剧，加强雨夜与档案室的视觉表现')
  await page.locator('[data-stage="planning"]').click()
  await expect(page.getByRole('main').locator('.status-dirty')).toHaveText('需更新')
})

test('completes backend script review against the local smoke service', async ({ page }) => {
  test.skip(process.env.BACKEND_SMOKE !== '1', 'requires the local fake FastAPI smoke service')
  await page.goto('/')
  await page.getByRole('button', { name: '载入示例' }).click()
  await page.getByRole('button', { name: '分析原稿' }).click()
  await checkAndConfirm(page, '确认分析并进入漫剧设定')
  await page.getByRole('button', { name: '生成全部设定' }).click()
  await checkAndConfirm(page, '确认设定并进入全剧规划')
  await page.getByRole('button', { name: '生成全剧规划' }).click()
  await page.getByLabel('总集数').fill('1')
  await checkAndConfirm(page, '确认规划并进入分集大纲')
  await page.getByRole('button', { name: '生成全部大纲' }).click()
  await checkAndConfirm(page, '确认全部大纲并进入漫剧脚本')
  await page.getByRole('button', { name: '生成本集' }).click()

  await expect(page.getByTestId('script-review-panel')).toContainText('等待人工确认')
  await page.getByRole('button', { name: '直接接受' }).click()
  await expect(page.getByTestId('script-review-panel')).toContainText('已完成')
  await expect(page.getByRole('heading', { name: '版本记录' })).toBeVisible()
})
