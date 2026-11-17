; Website-inspired native wizard. electron-builder owns install/upgrade/uninstall.
!include nsDialogs.nsh
!include LogicLib.nsh
!define MUI_BGCOLOR "080b0c"
!define MUI_TEXTCOLOR "f0f6f2"
!define MUI_INSTFILESPAGE_COLORS "adf6d5 12191a"
!define MUI_DIRECTORYPAGE_BGCOLOR "12191a"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_CUSTOMFUNCTION_GUIINIT LokalGUIInit
!define MUI_CUSTOMFUNCTION_UNGUIINIT un.LokalGUIInit
!define MUI_FINISHPAGE_TITLE "You're ready to listen."
!define MUI_FINISHPAGE_TEXT "Lokal is installed.$\r$\n$\r$\nOpen the player, add your music folders, and make yourself at home."
!define MUI_FINISHPAGE_RUN_TEXT "Open Lokal"

Var LokalDialog
Var LokalControl
Var LokalBitmap
Var LokalBitmapHandle
Var LokalTitleFont
Var LokalSerifFont
Var LokalBodyFont
Var LokalSmallFont

!macro LokalChrome PREFIX
Function ${PREFIX}LokalGUIInit
  SetCtlColors $HWNDPARENT "f0f6f2" "080b0c"
  GetDlgItem $0 $HWNDPARENT 1028
  SetCtlColors $0 "9aaba5" "080b0c"
FunctionEnd
!macroend
!insertmacro LokalChrome ""
!insertmacro LokalChrome "un."

!macro customWelcomePage
  !insertmacro MUI_PAGE_INIT
  !insertmacro MUI_PAGE_FUNCTION_FULLWINDOW
  Page custom LokalWelcome
!macroend

!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Before you go."
  !define MUI_WELCOMEPAGE_TEXT "This removes the Lokal application.$\r$\n$\r$\nYour music files and saved library data are kept."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

!ifndef BUILD_UNINSTALLER
Function LokalWelcome
  ; Updater runs must never stop at a welcome page.
  ${If} ${isUpdated}
    Abort
  ${EndIf}
  nsDialogs::Create 1044
  Pop $LokalDialog
  ${If} $LokalDialog == error
    Abort
  ${EndIf}
  nsDialogs::SetRTL $(^RTL)
  SetCtlColors $LokalDialog "f0f6f2" "080b0c"
  InitPluginsDir
  File "/oname=$PLUGINSDIR\lokal-sidebar.bmp" "${BUILD_RESOURCES_DIR}\installer\generated\sidebar.bmp"
  ${NSD_CreateBitmap} 0u 0u 109u 193u ""
  Pop $LokalBitmap
  ${NSD_SetImage} $LokalBitmap "$PLUGINSDIR\lokal-sidebar.bmp" $LokalBitmapHandle
  CreateFont $LokalTitleFont "Segoe UI" 23 700
  CreateFont $LokalSerifFont "Georgia" 23 400 /ITALIC
  CreateFont $LokalBodyFont "Segoe UI" 10
  CreateFont $LokalSmallFont "Consolas" 8
  ${NSD_CreateLabel} 122u 16u 190u 12u "01 / WELCOME"
  Pop $LokalControl
  SetCtlColors $LokalControl "adf6d5" "080b0c"
  SendMessage $LokalControl ${WM_SETFONT} $LokalSmallFont 0
  ${NSD_CreateLabel} 120u 40u 195u 28u "Your music."
  Pop $LokalControl
  SetCtlColors $LokalControl "f0f6f2" "080b0c"
  SendMessage $LokalControl ${WM_SETFONT} $LokalTitleFont 0
  ${NSD_CreateLabel} 120u 70u 195u 28u "Your world."
  Pop $LokalControl
  SetCtlColors $LokalControl "adf6d5" "080b0c"
  SendMessage $LokalControl ${WM_SETFONT} $LokalSerifFont 0
  ${NSD_CreateLabel} 122u 112u 190u 43u "A beautiful home for your collection.$\r$\n$\r$\nChoose where Lokal lives. Then bring your music along."
  Pop $LokalControl
  SetCtlColors $LokalControl "9aaba5" "080b0c"
  SendMessage $LokalControl ${WM_SETFONT} $LokalBodyFont 0
  ${NSD_CreateLabel} 122u 173u 190u 12u "LOCAL-FIRST. OPEN SOURCE."
  Pop $LokalControl
  SetCtlColors $LokalControl "adf6d5" "080b0c"
  SendMessage $LokalControl ${WM_SETFONT} $LokalSmallFont 0
  Call muiPageLoadFullWindow
  nsDialogs::Show
  Call muiPageUnloadFullWindow
  ${NSD_FreeImage} $LokalBitmapHandle
  System::Call 'gdi32::DeleteObject(p $LokalTitleFont)'
  System::Call 'gdi32::DeleteObject(p $LokalSerifFont)'
  System::Call 'gdi32::DeleteObject(p $LokalBodyFont)'
  System::Call 'gdi32::DeleteObject(p $LokalSmallFont)'
FunctionEnd

!endif
