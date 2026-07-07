import { test, expect, type Page, type Request } from "@playwright/test";

const AUTH_FILE = "e2e/.auth/prod.json";

const MENUS: Array<{ label: string; menuParam: string }> = [
  { label: "智能体广场", menuParam: "agent_square" },
  { label: "技能广场", menuParam: "skills_square" },
  { label: "库", menuParam: "library" },
  { label: "聊天", menuParam: "current_session" },
];

function isPageData(req: Request) {
  return req.url().includes("page-data.json");
}

async function logout(page: Page) {
  const logoutBtn = page.getByRole("button", { name: /退出|登出|logout/i }).first();
  if (await logoutBtn.isVisible().catch(() => false)) {
    await logoutBtn.click();
  } else {
    await page.goto("/umt/logout");
  }
  await page.waitForLoadState("networkidle").catch(() => {});
}

test.describe("生产环境：SSO 登出→再登→菜单", () => {
  test.use({ storageState: AUTH_FILE });

  test.beforeEach(async ({}, testInfo) => {
    const fs = await import("fs");
    if (!fs.existsSync(AUTH_FILE)) {
      testInfo.skip(
        true,
        `缺少 ${AUTH_FILE}，请先运行: npm run test:e2e:auth-save`
      );
    }
  });

  test("登出后再进首页并连点菜单", async ({ page, context }) => {
    await page.goto("/?menu=current_session&view=chat");
    await page.waitForLoadState("networkidle").catch(() => {});

    await logout(page);

    await page.goto("/login/");
    await page.getByRole("button", { name: /IHEP-SSO|SSO/i }).click();
    await page.waitForURL(/menu=|current_session/, { timeout: 120_000 }).catch(() => {});

    const pageDataUrls: string[] = [];
    page.on("request", (req) => {
      if (isPageData(req)) pageDataUrls.push(req.url());
    });

    for (const { label, menuParam } of MENUS) {
      await page.getByRole("button", { name: label }).first().click();
      await expect(page).toHaveURL(new RegExp(`menu=${menuParam}`), {
        timeout: 15_000,
      });
      await page.waitForTimeout(250);
    }

    console.log("[e2e] page-data count:", pageDataUrls.length, pageDataUrls);
    expect(pageDataUrls.length).toBeLessThanOrEqual(2);

    await context.storageState({ path: AUTH_FILE });
  });
});
