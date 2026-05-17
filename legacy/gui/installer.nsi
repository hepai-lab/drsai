; ==============================================================================
; DrSai Tray - NSIS Installer Script (English)
; ==============================================================================
;
; Output: DrSai-Setup-v{VERSION}.exe
; Usage: makensis installer.nsi
;
; Features:
;   - Standard install wizard (Welcome -> License -> Path -> Install -> Finish)
;   - Desktop shortcut (optional)
;   - Start Menu items
;   - Registry entries (uninstall info)
;   - Complete uninstall (files + shortcuts + registry)
;   - Optional auto-start after install
;   - Version detection (overwrite existing install)
;
; ==============================================================================

; --- Compile-time variables ---
!define APPNAME       "DrSai"
!define APPNAME_LOW   "drsai"
!define EXE_NAME      "drsai-tray.exe"
!define VERSION        "1.2.3"         ; Keep in sync with version.py, or use build.ps1
!define COMPANY        "IHEP CAS"
!define DESCRIPTION    "DrSai AI Agent - Desktop Assistant"
!define COPYRIGHT      "Copyright (c) 2025 Dr. Sai's Team @ IHEP CAS"
!define REGKEY_SUBKEY  "SOFTWARE\${APPNAME}"  ; subkey only, rootkey=HKLM
!define UNINSTALL_SUBKEY "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"  ; subkey only, rootkey=HKLM

; --- PyInstaller onedir output directory ---
; All files in dist/drsai-tray/ will be packed into the installer
!define DIST_DIR       "dist\drsai-tray"

; --- Icon files ---
; !define INSTALLER_ICON "build\icons\drsai_robot.ico"  ; TODO: icon not ready
; !define APP_ICON       "build\icons\drsai_robot.ico"  ; TODO: icon not ready

; --- NSIS configuration ---
Unicode true
SetCompressor /SOLID lzma        ; Best compression ratio
RequestExecutionLevel admin       ; Need admin rights (to write to Program Files)

Name          "${APPNAME} v${VERSION}"
OutFile       "DrSai-Setup-v${VERSION}.exe"
InstallDir    "$PROGRAMFILES\${APPNAME}"
InstallDirRegKey HKLM "SOFTWARE\${APPNAME}" "InstallDir"

CRCCheck      on
WindowIcon    on

; --- Modern UI ---
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "Sections.nsh"

; --- MUI page settings ---
; !define MUI_ICON              ; TODO: icon not ready
; !define MUI_UNICON            ; TODO: icon not ready
; !define MUI_WELCOMEFINISHPAGE_BITMAP  ""  ; TODO: bitmap not ready
; !define MUI_HEADERIMAGE  ; TODO: need bitmap first
; !define MUI_HEADERIMAGE_BITMAP        ""  ; TODO: bitmap not ready
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT         "Are you sure you want to quit the DrSai installation?"

; --- Page sequence ---
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE  "LICENSE.rtf"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES

; --- Finish page settings ---
!define MUI_FINISHPAGE_RUN             "$INSTDIR\${EXE_NAME}"
!define MUI_FINISHPAGE_RUN_TEXT        "Launch DrSai now"
!define MUI_FINISHPAGE_RUN_NOTCHECKED  ; Default unchecked (need API Key first)
; !define MUI_FINISHPAGE_SHOWREADME      ""  ; TODO: no readme file
; !define MUI_FINISHPAGE_SHOWREADME_TEXT ""  ; TODO: no readme file
!define MUI_FINISHPAGE_LINK            "https://github.com/hepaihub/drsai"
!define MUI_FINISHPAGE_LINK_TEXT       "DrSai GitHub"

!insertmacro MUI_PAGE_FINISH

; --- Uninstall pages ---
!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

; --- Language ---
!insertmacro MUI_LANGUAGE "English"

; --- Install components ---
Section "!DrSai Core (required)" SecCore
    SectionIn RO    ; Mandatory, cannot be unchecked

    ; --- Check existing installation -> overwrite ---
    ReadRegStr $0 HKLM ${REGKEY_SUBKEY} "InstallDir"
    StrCmp $0 "" +3
        ; Old version installed, silent uninstall first
        IfFileExists "$0\uninstall.exe" 0 +2
            ExecWait '"$0\uninstall.exe" /S _?=$0'
            Delete "$0\uninstall.exe"
            RMDir "$0"

    ; --- Install core files ---
    SetOutPath "$INSTDIR"

    ; Copy all files from PyInstaller onedir output
    File /r "${DIST_DIR}\*.*"

    ; --- Write registry entries ---
    WriteRegStr   HKLM ${REGKEY_SUBKEY} "InstallDir"   "$INSTDIR"
    WriteRegStr   HKLM ${REGKEY_SUBKEY} "Version"       "${VERSION}"
    WriteRegStr   HKLM ${REGKEY_SUBKEY} "ExePath"       "$INSTDIR\${EXE_NAME}"

    ; --- Uninstall info (shown in Settings -> Apps -> Installed apps) ---
    WriteRegStr   HKLM ${UNINSTALL_SUBKEY} "DisplayName"        "${APPNAME}"
    WriteRegStr   HKLM ${UNINSTALL_SUBKEY} "DisplayVersion"     "${VERSION}"
    WriteRegStr   HKLM ${UNINSTALL_SUBKEY} "Publisher"          "${COMPANY}"
    WriteRegStr   HKLM ${UNINSTALL_SUBKEY} "DisplayIcon"        "$INSTDIR\${EXE_NAME}"
    WriteRegStr   HKLM ${UNINSTALL_SUBKEY} "UninstallString"    "$INSTDIR\uninstall.exe"
    WriteRegStr   HKLM ${UNINSTALL_SUBKEY} "QuietUninstallString" "$INSTDIR\uninstall.exe /S"
    WriteRegStr   HKLM ${UNINSTALL_SUBKEY} "InstallLocation"    "$INSTDIR"
    WriteRegStr   HKLM ${UNINSTALL_SUBKEY} "URLInfoAbout"       "https://github.com/hepaihub/drsai"
    WriteRegDWORD HKLM ${UNINSTALL_SUBKEY} "NoModify"           1
    WriteRegDWORD HKLM ${UNINSTALL_SUBKEY} "NoRepair"           1

    ; --- Calculate install size (write EstimatedSize) ---
    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKLM ${UNINSTALL_SUBKEY} "EstimatedSize" "$0"

    ; --- Create uninstaller ---
    WriteUninstaller "$INSTDIR\uninstall.exe"

SectionEnd

Section "Desktop Shortcut" SecDesktopShortcut
    ; Create desktop .lnk shortcut
    CreateShortCut "$DESKTOP\${APPNAME}.lnk" \
        "$INSTDIR\${EXE_NAME}" \
        "" \
        "" \
        0 \
        "" \
        "" \
        "${DESCRIPTION}"
SectionEnd

Section "Start Menu" SecStartMenu
    ; Create Start Menu program group
    CreateDirectory "$SMPROGRAMS\${APPNAME}"

    CreateShortCut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" \
        "$INSTDIR\${EXE_NAME}" \
        "" \
        "" \
        0 \
        "" \
        "" \
        "${DESCRIPTION}"

    CreateShortCut "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk" \
        "$INSTDIR\uninstall.exe" \
        "" \
        "" \
        0

SectionEnd

; --- Component descriptions ---
LangString DESC_SecCore              ${LANG_ENGLISH}     "DrSai core program (required)"
LangString DESC_SecDesktopShortcut   ${LANG_ENGLISH}     "Create desktop shortcut"
LangString DESC_SecStartMenu         ${LANG_ENGLISH}     "Create Start Menu program group"

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
    !insertmacro MUI_DESCRIPTION_TEXT ${SecCore}             $(DESC_SecCore)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecDesktopShortcut}  $(DESC_SecDesktopShortcut)
    !insertmacro MUI_DESCRIPTION_TEXT ${SecStartMenu}        $(DESC_SecStartMenu)
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; --- Pre-install callback ---
Function .onInit
    ; Check if already running -> prompt user to close first
    FindWindow $0 "" "DrSai Chat"
    StrCmp $0 0 +3
        MessageBox MB_OK|MB_ICONSTOP \
            "DrSai is currently running. Please close it before installing." \
            /SD IDOK
        Abort

    ; Default: check desktop shortcut and start menu
    !insertmacro SetSectionFlag ${SecDesktopShortcut} ${SF_SELECTED}
    !insertmacro SetSectionFlag ${SecStartMenu}        ${SF_SELECTED}
FunctionEnd

; --- Uninstall ---
Section "Uninstall"
    ; Check if currently running
    FindWindow $0 "" "DrSai Chat"
    StrCmp $0 0 +3
        MessageBox MB_OK|MB_ICONSTOP \
            "DrSai is currently running. Please close it before uninstalling." \
            /SD IDOK
        Abort

    ; --- Remove shortcuts ---
    Delete "$DESKTOP\${APPNAME}.lnk"
    Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
    Delete "$SMPROGRAMS\${APPNAME}\Uninstall ${APPNAME}.lnk"
    RMDir  "$SMPROGRAMS\${APPNAME}"

    ; --- Remove registry entries ---
    DeleteRegKey HKLM ${REGKEY_SUBKEY}
    DeleteRegKey HKLM ${UNINSTALL_SUBKEY}

    ; --- Remove install files ---
    ; Note: do NOT delete user data subdirectories (like configs, workspace)
    ; User data is stored in ~/.drsai/ (independent of install dir), so it's safe to delete entire INSTDIR

    RMDir /r "$INSTDIR"

    ; --- If INSTDIR is now empty, remove it ---
    ; (RMDir /r already handled this, but just in case)
    IfFileExists "$INSTDIR" 0 +2
        RMDir "$INSTDIR"

SectionEnd

; --- Uninstall callback ---
Function un.onInit
    MessageBox MB_YESNO|MB_ICONQUESTION \
        "Are you sure you want to uninstall DrSai v${VERSION}?$\n$\n\
        User data (configs, chat history, etc.) is saved in ~/.drsai/ directory.$\n\
        Uninstalling will NOT delete these data." \
        /SD IDYES IDYES +2
        Abort
FunctionEnd

; ==============================================================================
; Usage:
;
;   1. Make sure PyInstaller build is done: dist/drsai-tray/ exists
;   2. Make sure icon file exists: build/icons/drsai_robot.ico
;   3. Prepare LICENSE.rtf (convert MIT LICENSE to RTF format)
;   4. Compile: makensis installer.nsi
;   5. Output: DrSai-Setup-v1.2.3.exe
;
; Or use build.ps1 to do everything automatically:
;   .\build.ps1
;
; ==============================================================================