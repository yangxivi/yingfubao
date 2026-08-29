; customInit 在 electron-builder 生成的 .onInit 中于 initMultiUser 之后执行，
; 这里再强制覆盖 $INSTDIR 可以真正覆盖注册表/历史安装路径，把安装目录锁死在 D 盘。
!macro customInit
  StrCpy $INSTDIR "D:\Program Files\yingfubao"
!macroend

; 目录选择页显示后，即使用户点了“浏览”改路径，离开该页时也会强制还原为固定路径，
; 实现“让用户看到安装路径页并点下一步，但路径真正不可改”。
Function .onVerifyInstDir
  StrCpy $INSTDIR "D:\Program Files\yingfubao"
FunctionEnd
