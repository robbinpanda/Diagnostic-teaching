!macro customInstall
  IfFileExists "$APPDATA\DiagnosticTeaching\.data-reset-v0.5.0" dataResetDone

  DetailPrint "正在清理 0.5.0 之前的本地数据..."
  RMDir /r "$APPDATA\DiagnosticTeaching"
  IfFileExists "$APPDATA\DiagnosticTeaching\*" 0 dataResetCreateMarker

  MessageBox MB_ICONSTOP|MB_OK "无法完全清理旧版数据。请关闭诊断式数学答疑及相关进程后重试。安装已中止，避免新旧数据库混用。"
  Abort

dataResetCreateMarker:
  CreateDirectory "$APPDATA\DiagnosticTeaching"
  ClearErrors
  FileOpen $0 "$APPDATA\DiagnosticTeaching\.data-reset-v0.5.0" w
  IfErrors dataResetMarkerFailed
  FileWrite $0 "0.5.0$\r$\n"
  FileClose $0
  Goto dataResetDone

dataResetMarkerFailed:
  MessageBox MB_ICONSTOP|MB_OK "旧版数据已清理，但无法写入 0.5.0 重置标记。安装已中止，请检查用户目录权限后重试。"
  Abort

dataResetDone:
!macroend
