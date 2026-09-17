const feature = (requirement, originalFeatureIds, requiredLevels, testIds) => ({ requirement, originalFeatureIds, requiredLevels, testIds });

export const macosPhase2Modules = [
  { title: "基线、ADR 与范围治理", owner: "desktop-core", features: [
    feature("建立 source、IPC、进程与性能基线", ["F01.1", "F01.3"], ["P2-L0"], ["p2:baseline"]),
    feature("固定 Electron 与 Swift Helper 架构决策", [], ["P2-L0"], ["p2:catalog"]),
    feature("建立 P2 机器清单与原功能映射", ["F01.4"], ["P2-L0"], ["p2:catalog"]),
    feature("建立平台能力决策表", ["F02.5"], ["P2-L0"], ["p2:catalog"]),
    feature("修正文档事实漂移", ["F01.1"], ["P2-L0"], ["p2:catalog"]),
  ]},
  { title: "Main 组合根拆分", owner: "desktop-core", features: [
    feature("抽取窗口创建与导航", ["F03.1", "F03.2", "F03.3"], ["P2-L1", "P2-L2"], ["p2:main-composition"]),
    feature("按领域拆分 IPC 注册器", ["F01.3", "F02.1"], ["P2-L1", "P2-L2"], ["p2:main-composition", "suite:inventory"]),
    feature("建立显式 service container", ["F01.5"], ["P2-L1"], ["p2:main-composition"]),
    feature("拆分启动与退出编排", ["F03.4", "F04.6"], ["P2-L1", "P2-L3"], ["p2:main-composition", "suite:process-lifecycle"]),
    feature("执行组合根行数预算", ["F01.5"], ["P2-L0"], ["p2:main-composition"]),
  ]},
  { title: "原生 Helper 与协议", owner: "desktop-platform", features: [
    feature("建立 Swift Helper 工程", ["F01.2"], ["P2-L1"], ["p2:native-helper"]),
    feature("定义版本化原生协议", ["F02.2"], ["P2-L1"], ["p2:native-protocol"]),
    feature("实现 Helper 进程监督", ["F03.5", "F04.6"], ["P2-L1", "P2-L3"], ["p2:native-helper", "p2:process-lifecycle"]),
    feature("实现能力协商与降级", ["F02.5"], ["P2-L1", "P2-L2"], ["p2:native-protocol"]),
    feature("建立 TypeScript/Swift 协议契约", ["F01.4", "F02.2"], ["P2-L1"], ["p2:native-protocol"]),
  ]},
  { title: "凭据与本机身份", owner: "desktop-platform", features: [
    feature("实现原生 Keychain CRUD", ["F05.3"], ["P2-L1", "P2-L5"], ["p2:native-helper", "suite:credentials"]),
    feature("兼容迁移现有凭据引用", ["F05.3", "F05.4"], ["P2-L1", "P2-L5"], ["suite:credentials"]),
    feature("映射锁定拒绝与不可用错误", ["F05.4"], ["P2-L1", "P2-L5"], ["p2:native-helper", "suite:credentials"]),
    feature("最小化敏感数据暴露", ["F05.6"], ["P2-L1", "P2-L2"], ["p2:native-negative", "suite:secret-redaction"]),
    feature("恢复身份生命周期", ["F05.1", "F05.2"], ["P2-L2", "P2-L5"], ["suite:auth-lifecycle", "suite:codex-backend"]),
  ]},
  { title: "TCC、通知与系统集成", owner: "desktop-platform", features: [
    feature("建立统一 TCC 状态模型", ["F05.5"], ["P2-L1", "P2-L5"], ["p2:native-helper", "suite:system-permissions"]),
    feature("限制权限请求为显式用户操作", ["F05.5"], ["P2-L2", "P2-L5"], ["suite:system-permissions"]),
    feature("实现系统设置精确跳转", ["F05.5"], ["P2-L1", "P2-L5"], ["p2:native-helper", "suite:system-permissions"]),
    feature("实现原生通知闭环", ["F11.6"], ["P2-L1", "P2-L5"], ["p2:native-helper", "suite:completion-notifications"]),
    feature("实现 LaunchServices 系统交接", ["F03.2", "F07.5"], ["P2-L2", "P2-L3"], ["suite:desktop-handoff", "suite:macos-lifecycle"]),
  ]},
  { title: "生命周期与进程治理", owner: "desktop-core", features: [
    feature("建立统一子进程注册表", ["F04.6"], ["P2-L1", "P2-L3"], ["p2:process-lifecycle"]),
    feature("实现有序 shutdown", ["F03.4", "F04.6"], ["P2-L1", "P2-L3"], ["suite:process-lifecycle"]),
    feature("实现崩溃与强杀恢复", ["F03.5", "F06.6"], ["P2-L3", "P2-L4"], ["p2:process-lifecycle", "suite:macos-recovery"]),
    feature("实现睡眠唤醒锁屏恢复", ["F03.6", "F04.5"], ["P2-L3", "P2-L4"], ["suite:macos-recovery"]),
    feature("执行残留与泄漏预算", ["F04.6", "F07.6"], ["P2-L3", "P2-L4"], ["p2:process-lifecycle", "p2:performance-budget"]),
  ]},
  { title: "安全边界与威胁治理", owner: "desktop-security", features: [
    feature("统一 IPC 注册策略", ["F02.1", "F02.2", "F02.3", "F02.4"], ["P2-L1", "P2-L2"], ["p2:security", "suite:secure-ipc"]),
    feature("执行 Helper 操作白名单", ["F02.2"], ["P2-L1"], ["p2:security", "p2:native-negative"]),
    feature("保护开发 URL 与导航", ["F02.6"], ["P2-L1", "P2-L2"], ["p2:security", "p2:secure-ipc"]),
    feature("限制路径与文件授权", ["F02.6", "F07.1"], ["P2-L1", "P2-L2"], ["p2:security", "suite:security-policy", "suite:file-mutations"]),
    feature("建立威胁模型与安全回归", ["F02.4", "F05.6"], ["P2-L0", "P2-L1"], ["p2:security", "p2:native-negative", "suite:secret-redaction"]),
  ]},
  { title: "macOS 体验与无障碍", owner: "desktop-experience", features: [
    feature("验证窗口与菜单行为", ["F03.1", "F03.3"], ["P2-L2", "P2-L3"], ["p2:macos-ux", "suite:renderer-l3"]),
    feature("验证键盘与中文输入法", ["F03.3"], ["P2-L2", "P2-L3"], ["p2:macos-ux", "suite:renderer-l3"]),
    feature("验证 VoiceOver 与键盘导航", ["F02.5"], ["P2-L2", "P2-L3"], ["p2:macos-ux", "suite:renderer-l3"]),
    feature("支持系统外观偏好", ["F02.5"], ["P2-L2"], ["p2:macos-ux"]),
    feature("建立性能预算", [], ["P2-L3", "P2-L4"], ["p2:performance-budget"]),
  ]},
  { title: "构建、无签名开发与发布准备", owner: "desktop-release", features: [
    feature("构建无签名 Debug 与 dir 包", ["F12.1"], ["P2-L3"], ["p2:unsigned-packaged"]),
    feature("打包并校验 Helper 架构", ["F12.1", "F12.2"], ["P2-L3"], ["p2:unsigned-packaged"]),
    feature("隔离开发与 RC 配置", ["F12.4", "F12.5"], ["P2-L1", "P2-L3"], ["p2:release-contract"]),
    feature("建立签名图与脚本预检", ["F12.2", "F12.3"], ["P2-L1", "P2-L5"], ["p2:release-contract", "p2:signed-rc"]),
    feature("强制正式发布阻塞声明", ["F12.3", "F12.5"], ["P2-L0", "P2-L5"], ["p2:release-contract"]),
  ]},
  { title: "自动化、真机和发布验收", owner: "desktop-release", features: [
    feature("建立 PR 静态与单元门禁", ["F01.1", "F01.5"], ["P2-L0", "P2-L1"], ["p2:catalog", "p2:main-composition"]),
    feature("建立 unsigned packaged 门禁", ["F12.1", "F12.4"], ["P2-L3"], ["p2:unsigned-packaged"]),
    feature("建立 Nightly 真机稳定性", ["F03.5", "F03.6", "F04.6"], ["P2-L4"], ["p2:process-lifecycle", "p2:performance-budget"]),
    feature("建立 signed RC 门禁", ["F12.2", "F12.3", "F12.5", "F12.6"], ["P2-L5", "P2-L6"], ["p2:signed-rc", "p2:update-rollback"]),
    feature("聚合证据与发布判定", ["F01.6"], ["P2-L0", "P2-L6"], ["p2:acceptance"]),
  ]},
];

export const macosPhase2FeatureRows = macosPhase2Modules.flatMap((module, moduleIndex) =>
  module.features.map((definition, featureIndex) => ({
    ...definition,
    moduleId: `P2-MOD-${String(moduleIndex + 1).padStart(2, "0")}`,
    featureId: `P2-F${String(moduleIndex + 1).padStart(2, "0")}.${featureIndex + 1}`,
    moduleTitle: module.title,
    owner: module.owner,
  })),
);
