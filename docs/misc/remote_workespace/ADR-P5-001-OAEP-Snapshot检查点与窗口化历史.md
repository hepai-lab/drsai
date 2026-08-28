# ADR-P5-001：OAEP Snapshot 检查点与窗口化历史

状态：已接受  
日期：2026-08-04  
对应功能：P5-M06-F02

## 决策

面向 Remote/移动客户端的 OAEP Snapshot 使用“固定检查点 + 最新窗口 + 不透明游标”模型：

- 首次请求固定 Session `snapshot_sequence`，返回最近 `1..500` 个 Item，默认 100 个。
- `checkpoint` 返回固定水位、规范投影 SHA-256 和水位内 Item 总数。
- `window.next_cursor` 是 Runtime 本机密钥加密并认证的不透明游标，绑定 Session、水位、下一页 keyset、哈希与总数。
- 后续页只读取该水位之前的数据；分页期间产生的新 Event 只进入实时流，不混入旧 Snapshot。
- Android 先原子提交首个窗口与 Event cursor，再按需向前合并历史窗口；加载历史不得回退实时 cursor。
- Runtime 内部兼容调用仍可取得完整 Snapshot；Relay/Mobile 公共路径必须使用有界窗口。

## 原因

全量 Snapshot 会使冷启动下载量、Runtime 和 Android 内存、解析时间随会话历史线性增长。仅在 Relay 截断响应不能解决 Runtime 为计算哈希而全量物化的问题，因此检查点哈希也必须通过 SQLite 游标流式计算。

## 不变量

1. 同一游标链所有页的 `snapshot_sequence` 和 `checkpoint` 完全一致。
2. Item 不重不漏；页内按 Run 内稳定 `sequence` 展示，页间由 `(latest_sequence, item_id)` keyset 唯一定位。
3. 游标篡改、跨 Session 复用或无法解密一律返回 `400`，不得降级为全量读取。
4. `has_more=true` 必须有非空 `next_cursor`；`has_more=false` 时游标必须为空。
5. 历史窗口合并不得删除较新 Item、推进或回退实时 Event cursor。
6. OAEP 承载会话语义；Item 内引用文件、Git、PTY 等资源时继续使用 OWOP 引用，不在 Snapshot 中嵌入远端资源正文。

## 接口

```text
GET /v1/sessions/{session_id}/oaep-snapshot?limit=100&cursor={opaque}
```

Relay 对外保持相同查询语义，并只透传 URL 编码后的不透明游标。响应的新增字段是 additive，旧客户端仍可读取基本 Snapshot 字段。

共享合同位于：

- `cores/protocol/oaep/oaep.schema.json`
- `cores/protocol/oaep/snapshot-window.examples.json`
- Python、TypeScript、Kotlin 生成类型

## 验收门禁

- 25 Item 多页测试：无重无漏、固定检查点、新 Event 隔离、游标篡改和跨 Session 复用失败。
- 100,000 Item 冷启动：只返回 100 Item，响应小于 256 KiB，Python 峰值内存小于 32 MiB。
- Python Schema 和 Android JSON 解码器读取同一跨语言 fixture。
- Relay 验证 `limit/cursor` 精确转发；Runtime HTTP 验证非法游标为 400。
- Android Room 验证旧窗口只做合并且不改变已提交实时 cursor。

## 回滚与兼容

新增字段可由旧客户端忽略。服务端可临时保留无 `limit/cursor` 的内部完整 Snapshot，但公共 Remote 路由不得回滚为全量响应。只有在连续两个正式版本确认没有旧客户端依赖后，才考虑移除内部兼容分支。
