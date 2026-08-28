; customInit 在 electron-builder 生成的 .onInit 中于 initMultiUser 之后执行，
; 这里再强制覆盖 $INSTDIR 可以真正覆盖注册表/历史安装路径，把安装目录锁死在 D 盘。
!macro customInit
  StrCpy $INSTDIR "D:\Program Files\yingfubao"
!macroend
