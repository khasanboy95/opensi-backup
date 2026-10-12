param([string]$Server, [string]$Code, [string]$Profile = 'default')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (!$Server) { $Server = Read-Host 'OpenSI server manzili (https://...)' }
if (!$Code) { $Code = Read-Host 'OpenSI ulash kodi' }
if ($Profile -notmatch '^[a-zA-Z0-9_-]{1,80}$') { throw 'Profile notogri.' }
$uri = [Uri]$Server
if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) { throw 'HTTPS server manzili kerak.' }
Add-Type -AssemblyName System.Windows.Forms
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = 'OpenSI loyihalari uchun kompyuterdagi papkani tanlang'
if ($picker.ShowDialog() -ne 'OK') { exit }
$workspace = $picker.SelectedPath
$base = Join-Path $env:LOCALAPPDATA "OpenSI\$Profile"
$runtime = Join-Path $base 'runtime'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
$node = Join-Path $runtime 'node.exe'
$launcherPath = Join-Path $base 'Start-OpenSI.ps1'
$taskName = "OpenSI-$Profile"
$expected = '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de'
if (!(Test-Path -LiteralPath $node) -or (Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLower() -ne $expected) {
 Write-Host 'OpenSI uchun Node.js tayyorlanmoqda...'
 Invoke-WebRequest 'https://nodejs.org/dist/v24.18.0/win-x64/node.exe' -OutFile $node -UseBasicParsing
 if ((Get-FileHash -LiteralPath $node -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'Node.js nazorat summasi mos kelmadi.' }
}
# Stop only a previous instance of this exact installation before updating it.
$entry = Join-Path $runtime 'opensi-connector.mjs'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process -Filter "Name='powershell.exe' OR Name='pwsh.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($launcherPath) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.ExecutablePath -eq $node -and $_.CommandLine.Contains($entry) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
$archive = Join-Path $base 'connector.zip'
Invoke-WebRequest ($Server.TrimEnd('/') + '/downloads/opensi-connector.zip') -OutFile $archive -UseBasicParsing
Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
& $node $entry --server $Server --code $Code --workspace $workspace --state-dir $base --pair-only true
if ($LASTEXITCODE -ne 0) { throw 'Hisobga ulanish bajarilmadi. OpenSIdan yangi ornatish faylini oling.' }
$settings = @{ server = $Server; workspace = $workspace; stateDir = $base }
$settings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $base 'launch.json') -Encoding UTF8
Copy-Item -LiteralPath (Join-Path $runtime 'Start-OpenSI.ps1') -Destination $launcherPath -Force
Copy-Item -LiteralPath (Join-Path $runtime 'Link-Folder.ps1') -Destination (Join-Path $base 'Link-Folder.ps1') -Force
$arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $launcherPath + '"'
$auto = [System.Windows.Forms.MessageBox]::Show('Windows ochilganda OpenSI connector avtomatik ishga tushsinmi?', 'OpenSI', 'YesNo')
$started = $false
if ($auto -eq 'Yes') {
 try {
  $identity = "$env:USERDOMAIN\$env:USERNAME"
  $action = New-ScheduledTaskAction -Execute (Get-Command powershell.exe).Source -Argument $arguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $taskName
  $started = $true
  $oldShortcut = Join-Path ([Environment]::GetFolderPath('Startup')) "$taskName.lnk"
  if (Test-Path -LiteralPath $oldShortcut) {
   $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($oldShortcut)
   if ($shortcut.Arguments.Contains($launcherPath)) {
    $shortcut.TargetPath = (Get-Command powershell.exe).Source
    $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -Command "Start-ScheduledTask -TaskName ' + "'$taskName'" + '"'
    $shortcut.WindowStyle = 7
    $shortcut.Save()
   }
  }
 } catch {
  $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) "$taskName.lnk"))
  $shortcut.TargetPath = (Get-Command powershell.exe).Source
  $shortcut.Arguments = $arguments
  $shortcut.WindowStyle = 7
  $shortcut.Save()
 }
}
if (!$started) { Start-Process powershell.exe -ArgumentList $arguments -WindowStyle Hidden }
Write-Host 'Ulandi. OpenSI sahifasida Lokal muhitni tanlang. Connector fonda ishlaydi.'
Start-Process ($Server.TrimEnd('/') + '/#/connections') -WindowStyle Hidden
