Unicode true
Name "OpenDrSai Setup"
!ifndef OUTPUT_DIR
  !define OUTPUT_DIR "..\..\windows\release\bootstrapper"
!endif
OutFile "${OUTPUT_DIR}\OpenDrSaiSetup.exe"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\OpenDrSai\Bootstrapper"
ShowInstDetails show

!ifndef MANIFEST_URL
  !define MANIFEST_URL "https://github.com/hepai-lab/drsai/releases/latest/download/desktop-installer-windows.json"
!endif
!ifndef BOOTSTRAPPER_VERSION
  !define BOOTSTRAPPER_VERSION "0.1.0"
!endif
!ifndef EXTRA_INSTALL_ARGS
  !define EXTRA_INSTALL_ARGS ""
!endif

PageEx directory
  DirText "Choose where the OpenDrSai bootstrapper should store its temporary installer files. OpenDrSai itself will be installed for the current user."
PageExEnd
Page instfiles

Section "Install OpenDrSai"
  SetOutPath "$INSTDIR"
  File "install-opendrsai.ps1"
  File "..\..\..\..\scripts\install.ps1"

  DetailPrint "Installing OpenDrSai desktop..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\install-opendrsai.ps1" -ManifestUrl "${MANIFEST_URL}" -BootstrapperVersion "${BOOTSTRAPPER_VERSION}" -EmbeddedInstallScript "$INSTDIR\install.ps1" -InstallPrerequisites ${EXTRA_INSTALL_ARGS}'
  Pop $0
  StrCmp $0 "0" done
    MessageBox MB_ICONSTOP "OpenDrSai installation failed. See installer details and bootstrapper logs for more information."
    Abort
  done:
SectionEnd
