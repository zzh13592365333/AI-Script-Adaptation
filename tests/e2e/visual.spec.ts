import { expect, test } from '@playwright/test'

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 }
]

for (const viewport of viewports) {
  test(`renders without horizontal overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    await page.getByRole('button', { name: '载入示例' }).click()
    await expect(page.getByRole('heading', { name: '导入与分析' })).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.screenshot({ path: `work/${viewport.name}.png`, fullPage: true })
  })
}
