; ==============================================================================
; DrSai Tray — NSIS 安装器脚本
; ==============================================================================
;
; 生成: DrSai-Setup-v{VERSION}.exe
; 使用: makensis installer.nsi
;
; 功能:
;   - 标准安装向导 (欢迎 → 许可 → 路径 → 安装 → 完成)
;   - 桌面快捷方式 (可选)
;   - 开始菜单项
;   - 注册表写入 (卸载信息)
;   - 完整卸载 (文件 + 快捷方式 + 注册表)
;   - 安装完成可选启动
;   - 版本检测 (覆盖安装)
;
; ==============================================================================

; ── 编译时变量 ────────────────────────────────────────────────────────────
!define APPNAME       "DrSai"
!define APPNAME_LOW   "drsai"
!define EXE_NAME      "drsai-tray.exe"
!define VERSION        "1.2.3"         ; ← 与 version.py 保持同步，或用 build.ps1 自动替换
!define COMPANY        "IHEP CAS"
!define DESCRIPTION    "DrSai AI Agent - Desktop Assistant"
!define COPYRIGHT      "Copyright (c) 2025 Dr. Sai's Team @ IHEP CAS"
!define REGKEY         "HKLM\SOFTWARE\${APPNAME}"
!define UNINSTALL_KEY "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

; ── PyInstaller onedir 输出目录 ──────────────────────────────────────────
; 打包后 dist/drsai-tray/ 目录中的所有文件将被打入安装包
!define DIST_DIR       "dist\drsai-tray"

; ── 图标文件 ──────────────────────────────────────────────────────────────
!define INSTALLER_ICON "build\icons\drsai_robot.ico"
!define APP_ICON       "build\icons\drsai_robot.ico"

; ── NSIS 配置 ────────────────────────────────────────────────────────────
Unicode true
SetCompressor /SOLID lzma        ; 最佳压缩率
RequestExecutionLevel admin       ; 需要管理员权限 (写入 Program Files)

Name          "${APPNAME} v${VERSION}"
OutFile       "DrSai-Setup-v${VERSION}.exe"
InstallDir    "$PROGRAMFILES\${APPNAME}"
InstallDirRegKey ${REGKEY} "InstallDir"

CRCCheck      on
WindowIcon    on

; ── 现代 UI ────────────────────────────────────────────────────────────────
!include "MUI2.nsh"

; ── MUI 页面设置 ──────────────────────────────────────────────────────────
!define MUI_ICON              ${INSTALLER_ICON}
!define MUI_UNICON            ${INSTALLER_ICON}
!define MUI_WELCOMEFINISHPAGE_BITMAP  ""   ; 可替换为自定义欢迎页位图
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP        ""   ; 可替换为自定义头部位图
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT         "您确定要退出 DrSai 安装吗？"

; ── 页面顺序 ──────────────────────────────────────────────────────────────
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE  "LICENSE.rtf"    ; ← 需要准备 LICENSE.rtf 文件
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES

; ── 安装完成页面 ──────────────────────────────────────────────────────────
!define MUI_FINISHPAGE_RUN             "$INSTDIR\${EXE_NAME}"
!define MUI_FINISHPAGE_RUN_TEXT        "立即启动 DrSai"
!define MUI_FINISHPAGE_RUN_NOTCHECKED  ; 默认不勾选（首次需配置 API Key）
!define MUI_FINISHPAGE_SHOWREADME      ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "查看使用说明"
!define MUI_FINISHPAGE_LINK            "https://github.com/hepaihub/drsai"
!define MUI_FINISHPAGE_LINK_TEXT       "DrSai 项目主页"

!insertmacro MUI_PAGE_FINISH

; ── 卸载页面 ──────────────────────────────────────────────────────────────
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; ── 语言 ──────────────────────────────────────────────────────────────────
!insertmacro MUI_LANGUAGE "SimpChinese"   ; 默认简体中文
!insertmacro MUI_LANGUAGE "English"       ; 同时支持英文

; ── 安装组件 ──────────────────────────────────────────────────────────────
Section "!DrSai 核心程序" SecCore
    SectionIn RO    ; 必选，不可取消

    ; ── 检查已有安装 → 覆盖安装 ──────────────────────────────────────────
    ReadRegStr $0 ${REGKEY} "InstallDir"
    StrCmp $0 "" +3
        ; 旧版本已安装，先卸载旧版本（静默）
        IfFileExists "$0\uninstall.exe" 0 +2
            ExecWait '"$0\uninstall.exe" /S _?=$0'
            Delete "$0\uninstall.exe"
            RMDir "$0"

    ; ── 安装核心文件 ────────────────────────────────────────────────────
    SetOutPath "$INSTDIR"

    ; 复制 PyInstaller onedir 输出的所有文件
    File /r "${DIST_DIR}\*.*"

    ; ── 写注册表 ──────────────────────────────────────────────────────────
    WriteRegStr   ${REGKEY} "InstallDir"   "$INSTDIR"
    WriteRegStr   ${REGKEY} "Version"       "${VERSION}"
    WriteRegStr   ${REGKEY} "ExePath"       "$INSTDIR\${EXE_NAME}"

    ; ── 卸载信息 (显示在「设置→应用→已安装的应用」中) ──────────────────────
    WriteRegStr   ${UNINSTALL_KEY} "DisplayName"   "${APPNAME}"
    WriteRegStr   ${UNINSTALL_KEY} "DisplayVersion" "${VERSION}"
    WriteRegStr   ${UNINSTALL_KEY} "Publisher"      "${COMPANY}"
    WriteRegStr   ${UNINSTALL_KEY} "DisplayIcon"    "$INSTDIR\${EXE_NAME}"
    WriteRegStr   ${UNINSTALL_KEY} "UninstallString" "$INSTDIR\uninstall.exe"
    WriteRegStr   ${UNINSTALL_KEY} "QuietUninstallString" "$INSTDIR\uninstall.exe /S"
    WriteRegStr   ${UNINSTALL_KEY} "InstallLocation" "$INSTDIR"
    WriteRegStr   ${UNINSTALL_KEY} "URLInfoAbout"    "https://github.com/hepaihub/drsai"
    WriteRegDWORD ${UNINSTALL_KEY} "NoModify"        1
    WriteRegDWORD ${UNINSTALL_KEY} "NoRepair"        1

    ; ── 计算安装大小 (写入 EstimatedSize) ──────────────────────────────────
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD ${UNINSTALL_KEY} "EstimatedSize" "$0"

    ; ── 创建卸载程序 ──────────────────────────────────────────────────────
    WriteUninstaller "$INSTDIR\uninstall.exe"

SectionEnd

Section "桌面快捷方式" SecDesktopShortcut
    ; 创建桌面 .lnk 快捷方式
    CreateShortCut "$DESKTOP\${APPNAME}.lnk" \
        "$INSTDIR\${EXE_NAME}" \
        "" \
        "${APP_ICON}" \
        0 \
        "" \
        "" \
        "${DESCRIPTION}"
SectionEnd

Section "开始菜单项" SecStartMenu
    ; 创建开始菜单程序组
    CreateDirectory "$SMPROGRAMS\${APPNAME}"

    CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" \
        "$INSTDIR\${EXE_NAME}" \
        "" \
        "${APP_ICON}" \
        0 \
        "" \
        "" \
        "${DESCRIPTION}"

    CreateShortCut "$SMPROGRAMS\${APPNAME}\卸载 ${APPNAME}.lnk" \
        "$INSTDIR\uninstall.exe" \
        "" \
        "${INSTALLER_ICON}" \
        0

SectionEnd

; ── 组件描述 ──────────────────────────────────────────────────────────────
LangString DESC_SecCore              ${LANG_SIMPCHINESE} "DrSai 核心程序（必选）"
LangString DESC_SecDesktopShortcut   ${LANG_SIMPCHINESE} "在桌面创建快捷方式"
LangString DESC_SecStartMenu         ${LANG_SIMPCHINESE} "在开始菜单创建程序组"

LangString DESC_SecCore              ${LANG_ENGLISH}     "DrSai core program (required)"
LangString DESC_SecDesktopShortcut   ${LANG_ENGLISH}     "Create desktop shortcut"
LangString DESC_SecStartMenu         ${LANG_ENGLISH}     "Create Start Menu program group"

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecCore}             $(DESC_SecCore)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktopShortcut}  $(DESC_SecDesktopShortcut)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecStartMenu}        $(DESC_SecStartMenu)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ── 安装前回调 ────────────────────────────────────────────────────────────
Function .onInit
    ; 检查是否已在运行 → 提示用户先关闭
    FindWindow $0 "" "DrSai Chat"
    StrCmp $0 0 +3
        MessageBox MB_OK|MB_ICONSTOP \
            "DrSai 正在运行中，请先关闭后再安装。" \
            /SD IDOK
        Abort

    ; 默认勾选桌面快捷方式和开始菜单
    !insertmacro SetSectionFlag ${SecDesktopShortcut} ${SF_SELECTED}
    !insertmacro SetSectionFlag ${SecStartMenu}        ${SF_SELECTED}
FunctionEnd

; ── 卸载 ──────────────────────────────────────────────────────────────────
Section "Uninstall"
    ; ── 检查是否正在运行 ──────────────────────────────────────────────────
    FindWindow $0 "" "DrSai Chat"
    StrCmp $0 0 +3
        MessageBox MB_OK|MB_ICONSTOP \
            "DrSai 正在运行中，请先关闭后再卸载。" \
            /SD IDOK
        Abort

    ; ── 删除快捷方式 ──────────────────────────────────────────────────────
    Delete "$DESKTOP\${APPNAME}.lnk"
    Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
    Delete "$SMPROGRAMS\${APPNAME}\卸载 ${APPNAME}.lnk"
    RMDir  "$SMPROGRAMS\${APPNAME}"

    ; ── 删除注册表 ──────────────────────────────────────────────────────
    DeleteRegKey ${REGKEY}
    DeleteRegKey ${UNINSTALL_KEY}

    ; ── 删除安装文件 ──────────────────────────────────────────────────────
    ; 注意: 不要删除 $INSTDIR 下的用户数据子目录（如 configs, workspace）
    ; 用户数据存储在 ~/.drsai/ (独立于安装目录)，所以可以安全删除整个 INSTDIR

    RMDir /r "$INSTDIR"

    ; ── 如果 INSTDIR 为空则删除 ──────────────────────────────────────────
    ; (RMDir /r 已经处理了，但保险起见)
    IfFileExists "$INSTDIR" 0 +2
        RMDir "$INSTDIR"

SectionEnd

; ── 卸载回调 ──────────────────────────────────────────────────────────────
Function un.onInit
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "您确定要卸载 DrSai v${VERSION} 吗？\n\n$\n\
        用户数据（配置、对话历史等）保存在 ~/.drsai/ 目录中，\n\
        卸载不会删除这些数据。" \
        /SD IDYES IDYES +2
        Abort
FunctionEnd

; ==============================================================================
; 使用说明:
;
;   1. 确保已执行 PyInstaller 打包，dist/drsai-tray/ 目录存在
;   2. 确保已生成图标文件到 build/icons/drsai_robot.ico
;   3. 准备 LICENSE.rtf (将 MIT LICENSE 转为 RTF 格式)
;   4. 编译: makensis installer.nsi
;   5. 输出: DrSai-Setup-v1.2.3.exe
;
; 也可以使用 build.ps1 一键完成所有步骤:
;   .\build.ps1
;
; ==============================================================================