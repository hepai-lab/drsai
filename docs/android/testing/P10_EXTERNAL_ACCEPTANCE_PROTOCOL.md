# Android P10 外部验收执行协议

本协议用于 P10 M10-F04 真机矩阵和 M10-F05 可用性验收。模拟器结果、开发者自测或缺少原始记录的汇总不能替代正式证据。

## M10-F04 真机矩阵

至少连接一台 ARM64 手机和一台 ARM64 平板，系统 API 不低于 30。每台设备现场完成登录、首次成功、工具调用、审批、后台执行、进程恢复和无障碍关键路径，并为每台设备保留至少一个截图或视频文件引用。

观察记录格式：

```json
{
  "devices": [
    {
      "serial": "ADB_SERIAL",
      "journeys": {
        "login": true,
        "first_success": true,
        "tools": true,
        "approval": true,
        "background": true,
        "recovery": true,
        "accessibility": true
      },
      "evidence": ["absolute-or-repository-relative-video-or-screenshot-path"]
    }
  ]
}
```

运行：

```powershell
python scripts/accept_android_p10_physical_device_matrix.py --serial PHONE_SERIAL --serial TABLET_SERIAL --observations OBSERVATIONS.json
```

脚本会拒绝 Emulator、非 ARM64、缺少手机或平板、API 低于 30、观察项不完整、媒体证据为空以及任一自动化测试失败。

## M10-F05 五人可用性验收

参与者必须恰好五名且均不是开发人员。每人依次执行首次配置、检索、文件任务和错误恢复；记录首次成功耗时、协助次数和关键误授权。所有发现的问题必须标记为 `closed` 或 `accepted_non_blocking`。

输入中的每位参与者必须包含以下字段：匿名 `participant_id`、`is_developer: false`、四项完整任务结果、正数 `first_success_seconds`、`assistance_count` 和 `critical_misauthorizations`。任务结果只能是 `completed` 或 `failed`。

运行：

```powershell
python scripts/accept_android_p10_usability.py --input USABILITY_SESSIONS.json
```

通过条件为至少 4/5 全程无协助完成、首次成功中位数不超过 180 秒、关键误授权为零且问题全部闭环。正式报告只保存匿名参与者 ID 和聚合指标，不保存姓名、联系方式或模型凭据。
