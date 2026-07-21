import { test, expect, type Page, type Request } from "@playwright/test";

const MENUS: Array<{ label: string; menuParam: string }> = [
  { label: "智能体广场", menuParam: "agent_square" },
  { label: "技能广场", menuParam: "skills_square" },
  { label: "库", menuParam: "library" },
  { label: "聊天", menuParam: "current_session" },
];

import * as fs from "fs";

const AUTH_FILE = "e2e/.auth/prod.json";
const hasAuth = fs.existsSync(AUTH_FILE);

function isPageData(req: Request) {
  return req.url().includes("page-data.json");
}

function isAppData(req: Request) {
  return req.url().includes("app-data.json");
}

async function clickSidebarMenu(page: Page, label: string) {
  const btn = page.getByRole("button", { name: label }).first();
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  await btn.click();
}

type NetworkCounters = { pageData: string[]; appData: string[] };

test.describe("生产环境：侧栏菜单导航", () => {
  test.use(hasAuth ? { storageState: AUTH_FILE } : {});

  test.beforeEach(async ({ page }, testInfo) => {
    if (!hasAuth) {
      testInfo.skip(true, `缺少 ${AUTH_FILE}，先运行 npm run test:e2e:auth-save`);
    }
    const counters: NetworkCounters = { pageData: [], appData: [] };
    page.on("request", (req) => {
      if (isPageData(req)) counters.pageData.push(req.url());
      if (isAppData(req)) counters.appData.push(req.url());
    });
    (page as Page & { __e2eCounters: NetworkCounters }).__e2eCounters = counters;
    await page.goto("/?menu=current_session&view=chat");
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  });

  test("连点菜单不应大量触发 page-data.json", async ({ page }) => {
    const counters = (page as Page & { __e2eCounters: NetworkCounters })
      .__e2eCounters;

    counters.pageData.length = 0;
    counters.appData.length = 0;

    for (const { label, menuParam } of MENUS) {
      await clickSidebarMenu(page, label);
      await expect(page).toHaveURL(new RegExp(`menu=${menuParam}`), {
        timeout: 10_000,
      });
      await page.waitForTimeout(300);
    }

    const pageDataCount = counters.pageData.length;
    const appDataCount = counters.appData.length;

    console.log("[e2e] page-data requests:", pageDataCount, counters.pageData);
    console.log("[e2e] app-data requests:", appDataCount, counters.appData);

    expect(
      pageDataCount,
      `菜单连点触发过多 page-data.json（${pageDataCount}），见控制台 URL 列表`
    ).toBeLessThanOrEqual(1);
    expect(
      appDataCount,
      `菜单连点触发过多 app-data.json（${appDataCount}）`
    ).toBeLessThanOrEqual(2);
  });

  test("菜单点击后侧栏应可继续点击（无长时间阻塞）", async ({ page }) => {
    const t0 = Date.now();
    for (const { label } of MENUS) {
      await clickSidebarMenu(page, label);
    }
    const elapsed = Date.now() - t0;
    console.log("[e2e] 四轮菜单点击总耗时 ms:", elapsed);
    expect(elapsed).toBeLessThan(20_000);
  });
});

test.describe("生产环境：菜单导航（无 storageState，需页面已登录）", () => {
  test.skip(
    !process.env.E2E_SKIP_AUTH_CHECK,
    "默认跳过：需手动登录或设置 storageState"
  );

  test("入口 URL 可打开", async ({ page }) => {
    await page.goto("/?menu=agent_square&view=chat");
    await expect(page).toHaveURL(/menu=agent_square/);
  });
});
