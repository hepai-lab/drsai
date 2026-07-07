# 生产 E2E（本地，不提交 git）

```bash
# 从仓库根 drsai/
bash .cursor/skills/frontend-prod-e2e/scripts/restore-e2e.sh
cd frontend && npm install && npx playwright install chromium
npm run test:e2e:prod:menu
bash .cursor/skills/frontend-prod-e2e/scripts/cleanup-e2e.sh
```
