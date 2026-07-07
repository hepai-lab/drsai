import { test } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

const AUTH_DIR = "e2e/.auth";
const AUTH_FILE = path.join(AUTH_DIR, "prod.json");

test("手动 SSO 登录并保存 storageState", async ({ page, context }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  await page.goto("/login/");
  await page.getByRole("button", { name: /IHEP-SSO|SSO/i }).click();

  console.log(
    "\n[e2e] 请在打开的浏览器中完成 IHEP-SSO 登录，进入 Open Dr.Sai 首页后，在终端按 Resume\n"
  );

  await page.pause();

  await page.waitForURL(/opendrsai\.ihep\.ac\.cn/, { timeout: 300_000 }).catch(() => {});
  await context.storageState({ path: AUTH_FILE });
  console.log(`[e2e] 已保存会话: ${AUTH_FILE}`);
});
