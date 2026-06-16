' CorvoVault — Quick Launch Script
' Double-click this file to start the application.
' Requires Node.js to be installed.

Dim objShell, objFSO, strPath
Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Get the directory where this script is located
strPath = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Check if node_modules exists, if not run npm install first
If Not objFSO.FolderExists(strPath & "\node_modules") Then
    MsgBox "First-time setup: Installing dependencies..." & vbCrLf & vbCrLf & "This may take a few minutes. A command window will appear.", vbInformation, "CorvoVault Setup"
    objShell.Run "cmd /c cd /d """ & strPath & """ && npm install && pause", 1, True
End If

' Launch the application in development mode using the project configuration
objShell.Run "cmd /c cd /d """ & strPath & """ && npm run electron:dev", 0, False

Set objShell = Nothing
Set objFSO = Nothing
