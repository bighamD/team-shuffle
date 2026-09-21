import { expect, test } from '@playwright/test';

test('shuffle overlay plays before result screen', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: '导入预设' }).click();
	await page.getByTestId('shuffle-button').click();

	const overlay = page.getByTestId('shuffle-overlay');
	await expect(overlay).toHaveClass(/visible/);
	await expect(page.getByTestId('result-screen')).toBeVisible({
		timeout: 8000,
	});
	await expect(overlay).not.toHaveClass(/visible/);
});

test('tapping the overlay skips straight to the result', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/');
	await page.getByRole('button', { name: '导入预设' }).click();
	await page.getByTestId('shuffle-button').click();
	await page.getByTestId('shuffle-overlay').click();

	await expect(page.getByTestId('result-screen')).toBeVisible({
		timeout: 2000,
	});
});
