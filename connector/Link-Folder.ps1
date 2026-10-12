param([string]$StateDir = '')
$ErrorActionPreference = 'Stop'
if (-not $StateDir) {
  $StateDir = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'connection.json')) { $PSScriptRoot } else { Join-Path $env:USERPROFILE '.opensi' }
}
Add-Type -AssemblyName System.Windows.Forms
$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = 'Mavjud loyiha papkasini OpenSI ga ulash (fayllar shu yerda qoladi)'
if ($picker.ShowDialog() -ne 'OK') { exit }
$folderPath = (Resolve-Path -LiteralPath $picker.SelectedPath).Path
$configPath = Join-Path $StateDir 'folders.json'
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
$items = @()
if (Test-Path -LiteralPath $configPath) { $items = @(Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json) }
if (-not ($items | Where-Object { $_.path -eq $folderPath })) {
  $items += [pscustomobject]@{ id = [Guid]::NewGuid().ToString(); label = (Split-Path -Leaf $folderPath); path = $folderPath }
  $json = ConvertTo-Json -InputObject @($items) -Depth 4
  [IO.File]::WriteAllText($configPath, $json, (New-Object Text.UTF8Encoding($false)))
}
[System.Windows.Forms.MessageBox]::Show('Papka ulandi. OpenSI → Loyihalar → Mavjud papkani ulash bo‘limini oching.','OpenSI') | Out-Null
