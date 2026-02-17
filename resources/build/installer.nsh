; Custom NSIS installer script for Bfloat IDE
; - Registers the bfloat:// protocol handler
; - Installs Git for Windows if not present
; - Installs Claude Code CLI if not present

!include "LogicLib.nsh"

; Git for Windows download URL (64-bit)
!define GIT_INSTALLER_URL "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.2/Git-2.47.1.2-64-bit.exe"
!define GIT_INSTALLER_NAME "Git-2.47.1.2-64-bit.exe"

; Claude Code CLI installation script URL (official PowerShell installer)
!define CLAUDE_INSTALL_SCRIPT_URL "https://claude.ai/install.ps1"

; ============================================================================
; Custom Install Macro - Called during installation
; ============================================================================
!macro customInstall
  ; Register bfloat:// URL protocol handler
  DetailPrint "Registering bfloat:// protocol handler..."
  WriteRegStr SHELL_CONTEXT "Software\Classes\bfloat" "" "URL:bfloat"
  WriteRegStr SHELL_CONTEXT "Software\Classes\bfloat" "URL Protocol" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\bfloat\DefaultIcon" "" "$appExe,1"
  WriteRegStr SHELL_CONTEXT "Software\Classes\bfloat\shell" "" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\bfloat\shell\open" "" ""
  WriteRegStr SHELL_CONTEXT "Software\Classes\bfloat\shell\open\command" "" '"$appExe" "%1"'
  DetailPrint "bfloat:// protocol handler registered."

  ; ========================================
  ; Check and Install Git for Windows
  ; ========================================
  Var /GLOBAL GitInstalled
  StrCpy $GitInstalled "0"

  ; Check registry for Git installation (64-bit)
  ReadRegStr $0 HKLM "SOFTWARE\GitForWindows" "InstallPath"
  ${If} $0 != ""
    StrCpy $GitInstalled "1"
  ${EndIf}

  ; Check common installation path if not found in registry
  ${If} $GitInstalled == "0"
    ${If} ${FileExists} "$PROGRAMFILES64\Git\bin\git.exe"
      StrCpy $GitInstalled "1"
    ${EndIf}
  ${EndIf}

  ${If} $GitInstalled == "0"
    ${If} ${FileExists} "$PROGRAMFILES\Git\bin\git.exe"
      StrCpy $GitInstalled "1"
    ${EndIf}
  ${EndIf}

  ; Install Git if not found
  ${If} $GitInstalled == "0"
    MessageBox MB_YESNO|MB_ICONQUESTION "Git for Windows is required for Bfloat to work properly (includes Git Bash).$\n$\nWould you like to install it now? (~60MB download)" IDNO skipGit

    DetailPrint "Downloading Git for Windows..."
    CreateDirectory "$TEMP\BfloatSetup"

    NSISdl::download /TIMEOUT=300000 "${GIT_INSTALLER_URL}" "$TEMP\BfloatSetup\${GIT_INSTALLER_NAME}"
    Pop $0

    ${If} $0 == "success"
      DetailPrint "Installing Git for Windows (this may take a few minutes)..."
      ExecWait '"$TEMP\BfloatSetup\${GIT_INSTALLER_NAME}" /VERYSILENT /NORESTART /NOCANCEL /COMPONENTS="icons,ext\reg\shellhere,assoc,assoc_sh"' $0
      ${If} $0 == 0
        DetailPrint "Git for Windows installed successfully!"
      ${Else}
        DetailPrint "Git installation completed with exit code: $0"
      ${EndIf}
      Delete "$TEMP\BfloatSetup\${GIT_INSTALLER_NAME}"
    ${Else}
      DetailPrint "Failed to download Git for Windows: $0"
      MessageBox MB_OK|MB_ICONEXCLAMATION "Failed to download Git for Windows.$\n$\nPlease install it manually from https://git-scm.com/download/win"
    ${EndIf}

    skipGit:
  ${EndIf}

  ; ========================================
  ; Check and Install Claude Code CLI
  ; ========================================
  Var /GLOBAL ClaudeInstalled
  StrCpy $ClaudeInstalled "0"

  ; Check official installation path (~/.claude/bin/claude)
  ${If} ${FileExists} "$PROFILE\.claude\bin\claude.exe"
    StrCpy $ClaudeInstalled "1"
  ${EndIf}

  ; Check alternative paths
  ${If} $ClaudeInstalled == "0"
    ${If} ${FileExists} "$PROFILE\.local\bin\claude.exe"
      StrCpy $ClaudeInstalled "1"
    ${EndIf}
  ${EndIf}

  ${If} $ClaudeInstalled == "0"
    ${If} ${FileExists} "$APPDATA\npm\claude.cmd"
      StrCpy $ClaudeInstalled "1"
    ${EndIf}
  ${EndIf}

  ${If} $ClaudeInstalled == "0"
    ${If} ${FileExists} "$LOCALAPPDATA\Programs\claude-code\claude.exe"
      StrCpy $ClaudeInstalled "1"
    ${EndIf}
  ${EndIf}

  ; Install Claude Code (REQUIRED for Bfloat to work on Windows)
  ${If} $ClaudeInstalled == "0"
    DetailPrint "Claude Code CLI is required. Installing..."

    ; Create log file for debugging
    Var /GLOBAL ClaudeLogFile
    StrCpy $ClaudeLogFile "$TEMP\BfloatSetup\claude-install.log"
    CreateDirectory "$TEMP\BfloatSetup"

    ; Log environment info using cmd echo (more reliable)
    nsExec::ExecToLog 'cmd /c echo Claude Code Installation Log > "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo ============================ >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo PROFILE: %USERPROFILE% >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo LOCALAPPDATA: %LOCALAPPDATA% >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo APPDATA: %APPDATA% >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo. >> "$TEMP\BfloatSetup\claude-install.log"'

    ; Use the official PowerShell installer (primary method)
    Var /GLOBAL PowerShellExitCode
    DetailPrint "Installing Claude Code CLI via official installer..."
    nsExec::ExecToLog 'cmd /c echo Attempting PowerShell installation (official)... >> "$TEMP\BfloatSetup\claude-install.log"'

    ; Run official PowerShell installer: irm https://claude.ai/install.ps1 | iex
    nsExec::ExecToLog 'cmd /c powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "irm https://claude.ai/install.ps1 | iex" >> "$TEMP\BfloatSetup\claude-install.log" 2>&1'
    Pop $PowerShellExitCode

    nsExec::ExecToLog 'cmd /c echo PowerShell Exit Code: $PowerShellExitCode >> "$TEMP\BfloatSetup\claude-install.log"'
    DetailPrint "PowerShell exit code: $PowerShellExitCode"

    ; Try winget as fallback if PowerShell failed
    Var /GLOBAL WingetExitCode
    StrCpy $WingetExitCode "skipped"
    ${If} $PowerShellExitCode != 0
      DetailPrint "PowerShell installer failed, trying Windows Package Manager..."
      nsExec::ExecToLog 'cmd /c echo. >> "$TEMP\BfloatSetup\claude-install.log"'
      nsExec::ExecToLog 'cmd /c echo Attempting WinGet installation (fallback)... >> "$TEMP\BfloatSetup\claude-install.log"'

      ; Run winget and capture output to log
      nsExec::ExecToLog 'cmd /c winget install --id Anthropic.ClaudeCode --silent --accept-package-agreements --accept-source-agreements >> "$TEMP\BfloatSetup\claude-install.log" 2>&1'
      Pop $WingetExitCode

      nsExec::ExecToLog 'cmd /c echo WinGet Exit Code: $WingetExitCode >> "$TEMP\BfloatSetup\claude-install.log"'
      DetailPrint "Winget exit code: $WingetExitCode"
    ${EndIf}

    ; Also try npm as a third fallback (if Node.js is installed)
    ${If} $PowerShellExitCode != 0
    ${AndIf} $WingetExitCode != 0
      DetailPrint "Trying npm installation as fallback..."
      nsExec::ExecToLog 'cmd /c echo. >> "$TEMP\BfloatSetup\claude-install.log"'
      nsExec::ExecToLog 'cmd /c echo Attempting npm installation... >> "$TEMP\BfloatSetup\claude-install.log"'
      nsExec::ExecToLog 'cmd /c npm install -g @anthropic-ai/claude-code >> "$TEMP\BfloatSetup\claude-install.log" 2>&1'
      Pop $0
      nsExec::ExecToLog 'cmd /c echo npm Exit Code: $0 >> "$TEMP\BfloatSetup\claude-install.log"'
      DetailPrint "npm exit code: $0"
    ${EndIf}

    ; Verify Claude Code was actually installed
    nsExec::ExecToLog 'cmd /c echo. >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo Verifying installation... >> "$TEMP\BfloatSetup\claude-install.log"'

    Var /GLOBAL ClaudeVerified
    StrCpy $ClaudeVerified "0"
    Var /GLOBAL ClaudeFoundPath
    StrCpy $ClaudeFoundPath "not found"

    ; Check all known installation paths
    ${If} ${FileExists} "$PROFILE\.claude\bin\claude.exe"
      StrCpy $ClaudeVerified "1"
      StrCpy $ClaudeFoundPath "$PROFILE\.claude\bin\claude.exe"
    ${ElseIf} ${FileExists} "$LOCALAPPDATA\Programs\claude-code\claude.exe"
      StrCpy $ClaudeVerified "1"
      StrCpy $ClaudeFoundPath "$LOCALAPPDATA\Programs\claude-code\claude.exe"
    ${ElseIf} ${FileExists} "$APPDATA\npm\claude.cmd"
      StrCpy $ClaudeVerified "1"
      StrCpy $ClaudeFoundPath "$APPDATA\npm\claude.cmd"
    ${ElseIf} ${FileExists} "$PROFILE\.local\bin\claude.exe"
      StrCpy $ClaudeVerified "1"
      StrCpy $ClaudeFoundPath "$PROFILE\.local\bin\claude.exe"
    ${EndIf}

    ; Log verification result
    nsExec::ExecToLog 'cmd /c echo Verification Result: $ClaudeVerified >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo Found Path: $ClaudeFoundPath >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo. >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo Checked paths: >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo   - %USERPROFILE%\.claude\bin\claude.exe >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo   - %LOCALAPPDATA%\Programs\claude-code\claude.exe >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo   - %APPDATA%\npm\claude.cmd >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo   - %USERPROFILE%\.local\bin\claude.exe >> "$TEMP\BfloatSetup\claude-install.log"'

    ; Also check what files actually exist for debugging
    nsExec::ExecToLog 'cmd /c echo. >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c echo Directory listings for debugging: >> "$TEMP\BfloatSetup\claude-install.log"'
    nsExec::ExecToLog 'cmd /c if exist "%USERPROFILE%\.claude\bin" (dir "%USERPROFILE%\.claude\bin" >> "$TEMP\BfloatSetup\claude-install.log" 2>&1) else (echo .claude\bin does not exist >> "$TEMP\BfloatSetup\claude-install.log")'
    nsExec::ExecToLog 'cmd /c if exist "%USERPROFILE%\.local\bin" (dir "%USERPROFILE%\.local\bin" >> "$TEMP\BfloatSetup\claude-install.log" 2>&1) else (echo .local\bin does not exist >> "$TEMP\BfloatSetup\claude-install.log")'
    nsExec::ExecToLog 'cmd /c if exist "%LOCALAPPDATA%\Programs\claude-code" (dir "%LOCALAPPDATA%\Programs\claude-code" >> "$TEMP\BfloatSetup\claude-install.log" 2>&1) else (echo Programs\claude-code does not exist >> "$TEMP\BfloatSetup\claude-install.log")'

    ${If} $ClaudeVerified == "1"
      DetailPrint "Claude Code CLI installed successfully at: $ClaudeFoundPath"
      Delete $ClaudeLogFile
    ${Else}
      ; Claude Code installation failed - show detailed error and keep log
      DetailPrint "Claude Code verification failed. Log saved to: $ClaudeLogFile"
      MessageBox MB_OK|MB_ICONSTOP "Claude Code CLI is required for Bfloat to work on Windows.$\n$\nAutomatic installation failed:$\n- PowerShell exit code: $PowerShellExitCode$\n- Winget exit code: $WingetExitCode$\n$\nDebug log saved to:$\n$ClaudeLogFile$\n$\nPlease install Claude Code manually:$\n1. Open PowerShell as Administrator$\n2. Run: irm https://claude.ai/install.ps1 | iex$\n$\nThen run the Bfloat installer again."
      Abort "Claude Code CLI installation failed. Bfloat requires Claude Code to run on Windows."
    ${EndIf}
  ${EndIf}

  ; Cleanup temp directory
  RMDir "$TEMP\BfloatSetup"
!macroend

; ============================================================================
; Custom Uninstall Macro
; ============================================================================
!macro customUnInstall
  ; Remove bfloat:// URL protocol handler
  DetailPrint "Removing bfloat:// protocol handler..."
  DeleteRegKey SHELL_CONTEXT "Software\Classes\bfloat"
  DetailPrint "bfloat:// protocol handler removed."

  ; Note: We don't uninstall Git or Claude Code as other apps may depend on them
!macroend
