# The Windows installer (website/install.ps1), end to end, in Windows PowerShell 5.1 on a GitHub
# Windows machine (.github/workflows/windows-installer.yml). Releases are built and signed here
# with a throwaway key and served over https from localhost (a certificate made here, trusted on
# this throwaway machine only). A copy of the installer gets the test key and address, as
# tools/release.sh would write them. It installs and updates into a temporary %LOCALAPPDATA%; each
# kind of bad release must be refused, leaving the installed folder as it was. Last, the hourly
# task: set up, run once, and taken away by uninstall. Exit code 1 if anything failed.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('rf-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $tmp | Out-Null
$script:failures = 0
function Check([bool]$Ok, [string]$What) {
  if ($Ok) { Write-Host "ok    $What" } else { Write-Host "FAIL  $What" -ForegroundColor Red; $script:failures++ }
}
# A program, waited for, its exit code and output
function Run([string]$Exe, [string]$Arguments) {
  $out = Join-Path $tmp ('out-' + [guid]::NewGuid().ToString('N'))
  $p = Start-Process -FilePath $Exe -ArgumentList $Arguments -NoNewWindow -Wait -PassThru -RedirectStandardOutput $out -RedirectStandardError "$out.err"
  $text = ''
  foreach ($f in @($out, "$out.err")) { if (Test-Path $f) { $text += [IO.File]::ReadAllText($f) } }
  return @{ Code = $p.ExitCode; Out = $text }
}
# The installer's choice: Windows' own OpenSSH first
$builtIn = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh-keygen.exe'
$keygen = if (Test-Path $builtIn) { $builtIn } else { (Get-Command ssh-keygen.exe).Source }
Write-Host "ssh-keygen: $keygen"
$ssh = Join-Path (Split-Path $keygen) 'ssh.exe'
Write-Host "PowerShell $($PSVersionTable.PSVersion); Windows $([Environment]::OSVersion.Version); $(if (Test-Path $ssh) { (Run $ssh '-V').Out.Trim() })"

try {
  # A throwaway release key, and another that isn't it
  $key = Join-Path $tmp 'release-key'
  $other = Join-Path $tmp 'other-key'
  foreach ($k in @($key, $other)) {
    $made = Run $keygen "-q -t ed25519 -N `"`" -C read-free -f `"$k`""
    if ($made.Code -ne 0) { throw "ssh-keygen couldn't make a key: $($made.Out)" }
  }
  $pub = (Get-Content "$key.pub").Split(' ')
  $signer = "read-free namespaces=`"read-free-release`" $($pub[0]) $($pub[1])"

  # The site: https on localhost
  $port = 8443
  $url = "https://localhost:$port/"
  $site = Join-Path $tmp 'site'
  New-Item -ItemType Directory -Path $site | Out-Null
  $cert = New-SelfSignedCertificate -DnsName 'localhost' -CertStoreLocation Cert:\LocalMachine\My -NotAfter (Get-Date).AddDays(1)
  $pfx = Join-Path $tmp 'tls.pfx'
  Export-PfxCertificate -Cert $cert -FilePath $pfx -Password (ConvertTo-SecureString 'readfree' -AsPlainText -Force) | Out-Null
  $cer = Join-Path $tmp 'tls.cer'
  Export-Certificate -Cert $cert -FilePath $cer | Out-Null
  Import-Certificate -FilePath $cer -CertStoreLocation Cert:\LocalMachine\Root | Out-Null
  $server = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList "`"$(Join-Path $PSScriptRoot 'serve.js')`" `"$site`" `"$pfx`" $port" -PassThru -NoNewWindow
  Start-Sleep -Seconds 2

  # A release of the extension at $Version, signed with $With (namespace $Namespace), put on the site
  function Publish-Release([string]$Version, [string]$With = $key, [string]$Namespace = 'read-free-release') {
    $build = Join-Path $tmp "build-$Version"
    if (Test-Path $build) { Remove-Item $build -Recurse -Force }
    Copy-Item -Path (Join-Path $root 'extension') -Destination $build -Recurse
    $manifest = Join-Path $build 'manifest.json'
    [IO.File]::WriteAllText($manifest, ([IO.File]::ReadAllText($manifest) -replace '"version": "[0-9.]+"', "`"version`": `"$Version`""))
    $zipName = "read-free-$Version.zip"
    $zip = Join-Path $site $zipName
    Get-ChildItem -Path $site -Filter 'read-free-*.zip' | Remove-Item -Force
    Compress-Archive -Path (Join-Path $build '*') -DestinationPath $zip -Force
    $sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
    $size = (Get-Item -LiteralPath $zip).Length
    $latest = Join-Path $site 'latest.txt'
    [IO.File]::WriteAllText($latest, "read-free-release 1`nversion=$Version`nzip=$zipName`nsha256=$sha`nsize=$size`ndate=$((Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'))`n")
    Remove-Item "$latest.sig" -ErrorAction SilentlyContinue
    $signed = Run $keygen "-q -Y sign -f `"$With`" -n $Namespace `"$latest`""
    if ($signed.Code -ne 0) { throw "couldn't sign: $($signed.Out)" }
  }

  # The installer, with the test key and address written in (as tools/release.sh does)
  function Write-Installer([string]$Allowed, [string]$Path) {
    $text = [IO.File]::ReadAllText((Join-Path $root 'website\install.ps1'))
    # ($$ in a replacement is a literal $)
    $text = $text -replace "(?m)^\`$SIGNER = .*$", "`$`$SIGNER = '$Allowed'" -replace "(?m)^\`$RELEASE_URLS = .*$", "`$`$RELEASE_URLS = '$url'"
    [IO.File]::WriteAllText($Path, $text)
  }
  $installer = Join-Path $tmp 'install.ps1'
  Write-Installer $signer $installer

  # A temporary %LOCALAPPDATA%, for this process and what it starts
  $realLocal = $env:LOCALAPPDATA
  $env:LOCALAPPDATA = Join-Path $tmp 'home'
  New-Item -ItemType Directory -Path $env:LOCALAPPDATA | Out-Null
  $base = Join-Path $env:LOCALAPPDATA 'Read Free'
  $updater = Join-Path $base 'Read Free updater.ps1'
  $installed = { try { [string](([IO.File]::ReadAllText((Join-Path $base 'extension\manifest.json'))) | ConvertFrom-Json).version } catch { '' } }
  $leftovers = { @(Get-ChildItem -Path $base -Force -Filter '.update*' -ErrorAction SilentlyContinue).Count }
  $ps = Join-Path $PSHOME 'powershell.exe'
  function Invoke-Installer([string]$File, [string]$Words) { Run $ps "-NoProfile -ExecutionPolicy Bypass -File `"$File`" $Words" }

  # Install
  Publish-Release '1.0.0'
  $r = Invoke-Installer $installer 'install no-schedule no-window'
  Write-Host $r.Out
  Check ($r.Code -eq 0) 'install: exit 0'
  Check ((& $installed) -eq '1.0.0') 'install: 1.0.0 is in the Read Free folder'
  Check ((Test-Path $updater) -and ([IO.File]::ReadAllText($updater) -eq [IO.File]::ReadAllText($installer))) 'install: the updater is a copy of the installer'
  Check ($r.Out -match 'Load unpacked' -and $r.Out -match 'Read Free updater\.ps1') 'install: says what to do next'
  Check ((& $leftovers) -eq 0) 'install: nothing left behind'

  # Up to date
  $r = Invoke-Installer $updater 'update'
  Check ($r.Code -eq 0 -and $r.Out -match 'up to date') 'update: up to date'

  # A newer release, numerically (1.0.10 after 1.0.0)
  Publish-Release '1.0.10'
  $r = Invoke-Installer $updater 'update'
  Check ($r.Code -eq 0 -and (& $installed) -eq '1.0.10') 'update: 1.0.10 replaces 1.0.0'
  Check ($r.Out -match 'updated: 1\.0\.0 -> 1\.0\.10') 'update: says so'

  # Refused: each leaves 1.0.10 in place, and nothing behind
  function Expect-Refused([string]$What, [string]$Expect = '1.0.10') {
    $r = Invoke-Installer $updater 'update'
    Check ((& $installed) -eq $Expect -and (& $leftovers) -eq 0) "refused: $What"
    return $r
  }
  Publish-Release '1.0.9'
  $r = Expect-Refused 'an older release'
  Check ($r.Code -eq 0 -and $r.Out -match 'up to date') 'an older release: up to date, exit 0'

  Publish-Release '1.0.11'
  Add-Content -Path (Join-Path $site 'latest.txt') -Value 'extra=1' -NoNewline
  $r = Expect-Refused 'latest.txt edited after signing'
  Check ($r.Code -eq 1 -and $r.Out -match "isn't signed with the Read Free key") 'edited: exit 1, and why'

  Publish-Release '1.0.11' -With $other
  [void](Expect-Refused 'signed with another key')

  Publish-Release '1.0.11' -Namespace 'something-else'
  [void](Expect-Refused 'signed for another namespace')

  Publish-Release '1.0.11'
  $zip = Join-Path $site 'read-free-1.0.11.zip'
  $bytes = [IO.File]::ReadAllBytes($zip); $bytes[100] = $bytes[100] -bxor 0xff; [IO.File]::WriteAllBytes($zip, $bytes)
  $r = Expect-Refused 'a zip that isn''t the one signed'
  Check ($r.Out -match "isn't the file that was signed") 'a different zip: why'

  # A zip holding another version than latest.txt says
  Publish-Release '1.0.12'
  $build = Join-Path $tmp 'build-1.0.12'
  $manifest = Join-Path $build 'manifest.json'
  [IO.File]::WriteAllText($manifest, ([IO.File]::ReadAllText($manifest) -replace '"version": "[0-9.]+"', '"version": "9.9.9"'))
  $zip = Join-Path $site 'read-free-1.0.12.zip'
  Compress-Archive -Path (Join-Path $build '*') -DestinationPath $zip -Force
  $sha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
  $latest = Join-Path $site 'latest.txt'
  [IO.File]::WriteAllText($latest, "read-free-release 1`nversion=1.0.12`nzip=read-free-1.0.12.zip`nsha256=$sha`nsize=$((Get-Item $zip).Length)`ndate=2026-11-22T00:00:00Z`n")
  Remove-Item "$latest.sig"; [void](Run $keygen "-q -Y sign -f `"$key`" -n read-free-release `"$latest`"")
  $r = Expect-Refused 'a zip holding another version'
  Check ($r.Out -match "doesn't hold Read Free 1\.0\.12") 'another version: why'

  # A copy without a key refuses to run, before fetching anything
  $nokey = Join-Path $tmp 'nokey.ps1'
  Write-Installer '' $nokey
  $r = Invoke-Installer $nokey 'update'
  Check ($r.Code -eq 1 -and $r.Out -match 'no signing key') 'a copy without a key refuses to run'

  # The site's command, with no words: install, the hourly task, Explorer on the folder and its
  # path copied. The task runs as this user, whose real %LOCALAPPDATA% it uses (this machine is
  # thrown away after the run).
  Publish-Release '1.0.13'
  $r = Invoke-Installer $installer ''
  Write-Host $r.Out
  Check ($r.Code -eq 0 -and $r.Out -match 'Developer mode' -and $r.Out -match 'Load unpacked') 'the site''s command: installs, and says what to do next'
  Check ($r.Out -match 'Drag the folder selected') 'the site''s command: opens Explorer on the folder, to drag'
  Check ($r.Out -match 'These steps, with pictures, just opened in (Chrome|Edge)') 'the site''s command: opens the steps in a browser'
  $copied = try { Get-Clipboard } catch { "($($_.Exception.Message))" }
  Write-Host "clipboard: $copied"
  $task = Get-ScheduledTask -TaskName 'Read Free updater' -ErrorAction SilentlyContinue
  Check ($r.Code -eq 0 -and $null -ne $task) 'schedule: the task "Read Free updater" is set up'
  if ($task) {
    $action = $task.Actions[0]
    Write-Host "task runs: $($action.Execute) $($action.Arguments)"
    Check ($action.Arguments -match 'Read Free updater\.ps1' -and $action.Arguments -match 'update log') 'schedule: it runs the kept copy, logging'
    Check ($action.Execute -match 'conhost\.exe$' -and $action.Arguments -match '^--headless ') 'schedule: without a window (conhost --headless), as on Windows 10 1809 and later'
    Check (@($task.Triggers).Count -eq 2) 'schedule: at logon and every hour'
    foreach ($t in $task.Triggers) { Write-Host "trigger: $($t.CimClass.CimClassName) every '$($t.Repetition.Interval)' for '$($t.Repetition.Duration)'" }
    $hourly = @($task.Triggers | Where-Object { $_.Repetition.Interval -eq 'PT1H' })
    Check ($hourly.Count -eq 1 -and -not $hourly[0].Repetition.Duration) 'schedule: every hour, with no end'
    Check (@($task.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' }).Count -eq 1) 'schedule: at logon'
    Start-ScheduledTask -TaskName 'Read Free updater'
    $realLog = Join-Path $realLocal 'Read Free\update.log'
    $info = $null
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Seconds 2
      $info = Get-ScheduledTaskInfo -TaskName 'Read Free updater'
      if ((Get-ScheduledTask -TaskName 'Read Free updater').State -eq 'Ready' -and (Test-Path $realLog)) { break }
    }
    Write-Host "task result: $($info.LastTaskResult); log: $(if (Test-Path $realLog) { (Get-Content $realLog) -join ' | ' } else { 'none' })"
    Check ($info.LastTaskResult -eq 0) 'schedule: a run of the task succeeds'
    Check ((Test-Path $realLog) -and ((Get-Content $realLog) -join "`n") -match 'updated: nothing -> 1\.0\.13') 'schedule: the run installed the release, and logged it'
  }
  $r = Invoke-Installer $updater 'status'
  Write-Host $r.Out
  Check ($r.Out -match 'version: 1\.0\.13' -and $r.Out -match 'updates: Task Scheduler task') 'status: the version and the task'
  $r = Invoke-Installer $updater 'uninstall'
  Write-Host $r.Out
  Check ($r.Code -eq 0 -and -not (Get-ScheduledTask -TaskName 'Read Free updater' -ErrorAction SilentlyContinue)) 'uninstall: the task is gone'

  # From a normal window: this machine runs everything elevated, so the install runs again as a
  # Basic User (runas /trustlevel), with Administrators turned off in its token. It keeps this
  # environment, so the same temporary %LOCALAPPDATA%: up to date there, it sets up the task.
  $basic = Join-Path $tmp 'basic'
  New-Item -ItemType Directory -Path $basic | Out-Null
  $line = "cmd.exe /c $ps -NoProfile -ExecutionPolicy Bypass -File $installer install no-window > $basic\out.txt 2>&1 & whoami /groups > $basic\groups.txt & echo done> $basic\done.txt"
  $runas = Run 'runas.exe' "/trustlevel:0x20000 `"$line`""
  for ($i = 0; $i -lt 90 -and -not (Test-Path "$basic\done.txt"); $i++) { Start-Sleep -Seconds 1 }
  if (Test-Path "$basic\done.txt") {
    $out = [IO.File]::ReadAllText("$basic\out.txt")
    Write-Host $out
    $admins = @(Get-Content "$basic\groups.txt" | Where-Object { $_ -match 'BUILTIN\\Administrators' })
    Write-Host "as a Basic User: $($admins -join ' ')"
    Check ($admins.Count -eq 1 -and $admins[0] -match 'deny only') 'not elevated: Administrators is off in its token'
    Check ($out -match 'checks for updates at login and every hour' -and (Get-ScheduledTask -TaskName 'Read Free updater' -ErrorAction SilentlyContinue)) 'not elevated: the hourly task is set up'
    $r = Invoke-Installer $updater 'uninstall'
    Check (-not (Get-ScheduledTask -TaskName 'Read Free updater' -ErrorAction SilentlyContinue)) 'not elevated: uninstall takes its task away'
  } else {
    Write-Host "couldn't run as a Basic User here (runas: exit $($runas.Code) $($runas.Out))"
  }
} finally {
  if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
  Get-ChildItem Cert:\LocalMachine\Root, Cert:\LocalMachine\My | Where-Object { $_.Subject -eq 'CN=localhost' } | Remove-Item -ErrorAction SilentlyContinue
}

Write-Host ''
if ($script:failures) { Write-Host "$($script:failures) check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host 'all checks passed'
