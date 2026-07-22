Option Explicit

Dim shell, fso, scriptDir, command, exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

command = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden"
command = command & " -File " & Quote(fso.BuildPath(scriptDir, "install-opendrsai.ps1"))
command = command & " -Stage " & Quote(NamedArg("Stage"))
command = command & " -RuntimeUrl " & Quote(NamedArg("RuntimeUrl"))
command = command & " -RuntimeSha256 " & Quote(NamedArg("RuntimeSha256"))
command = command & " -RuntimeSizeBytes " & Quote(NamedArg("RuntimeSizeBytes"))
command = command & " -BootstrapperVersion " & Quote(NamedArg("BootstrapperVersion"))
command = command & " -InstallRoot " & Quote(scriptDir)
command = command & " -Quiet"

Dim argument
For Each argument In WScript.Arguments.Unnamed
    command = command & " " & Quote(argument)
Next

exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function NamedArg(name)
    If Not WScript.Arguments.Named.Exists(name) Then
        WScript.Quit 87
    End If
    NamedArg = WScript.Arguments.Named.Item(name)
End Function

Function Quote(value)
    Quote = Chr(34) & Replace(CStr(value), Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
