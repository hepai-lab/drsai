## 4 System Prompt 层级架构

OpenDrSai CLI 的 System Prompt 由 6 个层级组成，从上到下排列。**越靠后的层级，LLM 越重视**：

```
① Prefix (session级)       ← /plan_mode、/inject prefix 设置
② Developer msg (硬编码)   ← 初始化时的 system_message 参数
③ AGENTS.md (全局用户级)   ← workspace/configs/AGENTS.md
④ Project instructions     ← DRSAI.md / CLAUDE.md（cwd 向上遍历）
⑤ Session_ID (固定行)      ← "Current Session_ID is <thread_id>"
⑥ Suffix (session级)       ← /inject suffix 设置
⑦ Tools prompt (追加)      ← 工具配置描述（在 ⑥ 之后追加）
```

**层级设计原则**：
- ①② 是系统/框架级约束，优先级最低但覆盖面最广
- ③④ 是用户/项目级指令，提供了具体的上下文
- ⑤⑥⑦ 是 session 级动态控制，最靠近 LLM 的输入末尾，影响力最强

**查看层级状态**：使用 `/memory status` 命令可以看到每一层的字符数和预览。

---

---

