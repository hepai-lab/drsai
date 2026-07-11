Option Explicit

Dim shell, fso, scriptDir, installScript, command, exitCode, extraArg
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
installScript = fso.BuildPath(scriptDir, "install-opendrsai.ps1")

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & Quote(installScript)
command = command & " -RuntimeUrl " & Quote(Arg("RuntimeUrl"))
command = command & " -RuntimeSha256 " & Quote(Arg("RuntimeSha256"))
command = command & " -RuntimeSizeBytes " & Arg("RuntimeSizeBytes")
command = command & " -BootstrapperVersion " & Quote(Arg("BootstrapperVersion"))
command = command & " -Quiet"

For Each extraArg In WScript.Arguments.Unnamed
  If Left(extraArg, 1) = "-" Then
    command = command & " " & extraArg
  Else
    command = command & " " & Quote(extraArg)
  End If
Next

If WScript.Arguments.Named.Exists("Debug") Then
  WScript.Echo command
  WScript.Quit 0
End If

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function Arg(name)
  If Not WScript.Arguments.Named.Exists(name) Then
    WScript.Echo "Missing argument: " & name
    WScript.Quit 2
  End If
  Arg = WScript.Arguments.Named(name)
End Function

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
