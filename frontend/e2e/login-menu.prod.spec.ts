import { test, expect, type Page, type Request } from "@playwright/test";

const MENUS: Array<{ label: string; menuParam: string }> = [
  { label: "智能体广场", menuParam: "agent_square" },
  { label: "技能广场", menuParam: "skills_square" },
  { label: "库", menuParam: "library" },
  { label: "聊天", menuParam: "current_session" },
];

function isPageData(req: Request) {
  return req.url().includes("page-data.json");
}

async function loginLocal(page: Page, user: string, password: string) {
  await page.goto("/login/");
  await page.getByPlaceholder(/用户名|账号|user/i).fill(user);
  await page.getByPlaceholder(/密码|password/i).fill(password);
  await page.getByRole("button", { name: /登录|sign in/i }).click();
  await page.waitForURL(/\?menu=|\/$/, { timeout: 60_000 });
}

async function logout(page: Page) {
  const logoutBtn = page.getByRole("button", { name: /退出|登出|logout/i }).first();
  if (await logoutBtn.isVisible().catch(() => false)) {
    await logoutBtn.click();
    await page.waitForURL(/login/, { timeout: 30_000 }).catch(() => {});
  } else {
    await page.goto("/umt/logout");
    await page.waitForLoadState("networkidle").catch(() => {});
  }
}

async function clickMenusAndCountPageData(page: Page) {
  const pageDataUrls: string[] = [];
  page.on("request", (req) => {
    if (isPageData(req)) pageDataUrls.push(req.url());
  });

  for (const { label, menuParam } of MENUS) {
    await page.getByRole("button", { name: label }).first().click();
    await expect(page).toHaveURL(new RegExp(`menu=${menuParam}`), {
      timeout: 10_000,
    });
    await page.waitForTimeout(200);
  }
  return pageDataUrls;
}

test.describe("生产环境：本地账号 登出→再登→菜单", () => {
  const user = process.env.E2E_USER;
  const password = process.env.E2E_PASSWORD;

  test.beforeEach(() => {
    test.skip(!user || !password, "需要 E2E_USER 与 E2E_PASSWORD");
  });

  test("登出再登录后菜单连点", async ({ page }) => {
    await loginLocal(page, user!, password!);
    await page.waitForLoadState("networkidle").catch(() => {});

    await logout(page);
    await loginLocal(page, user!, password!);
    await page.waitForLoadState("networkidle").catch(() => {});

    const pageDataUrls = await clickMenusAndCountPageData(page);
    console.log("[e2e] page-data after relogin:", pageDataUrls.length, pageDataUrls);

    expect(pageDataUrls.length).toBeLessThanOrEqual(2);
  });
});
