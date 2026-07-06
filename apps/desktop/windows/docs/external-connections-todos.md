# Windows App External Connections TODOs

未来希望把 OpenDrSai Windows App 连接到更多外部能力。这里的“连接”
不是简单打开网页，而是把外部系统变成 Agent 可读取、可操作、可审计的
上下文环境或工具。

## TODOs

- [ ] GitHub 连接：GitHub 是代码仓库、Issue、Pull Request、Actions/CI
  和 Release 的协作平台。接入后，OpenDrSai 可以读取仓库状态、总结 PR
  和 Issue、检查 CI 失败原因、辅助生成分支/提交/PR、跟踪 review comment，
  并把代码变更过程记录回当前任务。
- [ ] Chrome 连接：Chrome 是用户常用浏览器，也可以通过调试协议或自动化
  引擎暴露页面上下文。接入后，OpenDrSai 可以读取当前网页、抓取 DOM/文本/
  截图、辅助网页测试、执行受控点击和输入、复用浏览器登录态，并让 Agent
  在用户授权下完成多步骤网页任务。
- [ ] LaTeX 连接：LaTeX 是论文、报告、公式和排版密集文档的写作与编译
  系统。接入后，OpenDrSai 可以创建和修改 `.tex` 项目、管理参考文献
  `.bib`、编译 PDF、定位编译错误、检查公式/引用/章节结构，并辅助科研
  写作、模板适配和版本对比。
- [ ] 统一连接模型：为 GitHub、Chrome、LaTeX 等能力定义一致的权限、
  凭据管理、上下文快照、操作日志和用户确认流程，避免工具各自实现一套
  不兼容的安全边界。

## Notes

- GitHub 连接偏向代码协作和工程流程自动化。
- Chrome 连接偏向网页上下文、浏览器自动化和可视化验证。
- LaTeX 连接偏向科研写作、公式排版、PDF 编译和文献管理。
- 所有连接都应先定义只读上下文能力，再逐步开放需要用户确认的写入或操作能力。
