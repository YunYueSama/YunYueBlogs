#ifndef AppVersion
  #define AppVersion "2.1.0"
#endif
[Setup]
AppId={{421BB853-35C6-4DD4-87E5-66125A13689D}
AppName=星辉云端博客管理端
AppVersion={#AppVersion}
AppPublisher=YunYueBlogs
AppPublisherURL=https://github.com/YunYueSama/YunYueBlogs
DefaultDirName={localappdata}\Programs\YunYueManager
DefaultGroupName=星辉云端博客管理端
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#OutputDir}
OutputBaseFilename=YunYueManager-{#AppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\YunYueManager.exe
SetupLogging=yes
CloseApplications=yes
[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Default.isl,windows-chinese.isl"
[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "快捷方式："
[Files]
Source: "{#PackageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\星辉云端博客管理端"; Filename: "{app}\YunYueManager.exe"
Name: "{autodesktop}\星辉云端博客管理端"; Filename: "{app}\YunYueManager.exe"; Tasks: desktopicon
[Run]
Filename: "{app}\_internal\runtime\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; Flags: runhidden waituntilterminated
Filename: "{app}\YunYueManager.exe"; Description: "打开管理端，连接你的博客"; Flags: nowait postinstall skipifsilent
; 卸载仅移除程序；{localappdata}\YunYueManager 中的文章、草稿与凭据保留。
