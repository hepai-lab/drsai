Unicode true
Name "OpenDrSai Installer"
!ifndef OUTPUT_DIR
  !define OUTPUT_DIR "..\release\bootstrapper"
!endif
OutFile "${OUTPUT_DIR}\OpenDrSai Installer.exe"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\OpenDrSai\Installer"
ShowInstDetails show

!ifndef MANIFEST_URL
  !define MANIFEST_URL "https://github.com/hepai-lab/drsai/releases/latest/download/latest-windows.json"
!endif
!ifndef BOOTSTRAPPER_VERSION
  !define BOOTSTRAPPER_VERSION "0.1.0"
!endif
!ifndef EXPECTED_SIGNER_THUMBPRINT
  !define EXPECTED_SIGNER_THUMBPRINT ""
!endif
!ifndef EXPECTED_SIGNER_SUBJECT
  !define EXPECTED_SIGNER_SUBJECT ""
!endif

Section "Install OpenDrSai"
  SetOutPath "$INSTDIR"
  File "install-full-app.ps1"
  DetailPrint "Downloading and launching the full OpenDrSai installer..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\install-full-app.ps1" -ManifestUrl "${MANIFEST_URL}" -BootstrapperVersion "${BOOTSTRAPPER_VERSION}" -ExpectedSignerThumbprint "${EXPECTED_SIGNER_THUMBPRINT}" -ExpectedSignerSubject "${EXPECTED_SIGNER_SUBJECT}"'
  Pop $0
  StrCmp $0 "0" done
    MessageBox MB_ICONSTOP "OpenDrSai installation failed. See installer details for logs."
    Abort
  done:
SectionEnd
