param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-zA-Z0-9_][a-zA-Z0-9_.-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$')]
  [string]$Destination,
  [ValidateRange(1, 65535)]
  [int]$Port = 22,
  [string]$IdentityFile,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$connectionOptions = @('-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes')
if ($IdentityFile) {
  $identityPath = (Resolve-Path -LiteralPath $IdentityFile).Path
  $connectionOptions += @('-i', $identityPath, '-o', 'IdentitiesOnly=yes')
}
$repoRoot = Split-Path $PSScriptRoot -Parent
$entries = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'videos.sha256') | ForEach-Object {
  if ($_ -notmatch '^([a-f0-9]{64})  ([a-zA-Z0-9][a-zA-Z0-9._-]*)$') {
    throw "Invalid video manifest entry"
  }
  $digest = $Matches[1]
  $fileName = $Matches[2]
  $localPath = Join-Path $repoRoot "app/public/videos/$fileName"
  if ((Get-FileHash -LiteralPath $localPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $digest) {
    throw "Checksum mismatch for $fileName; update and review the manifest before uploading"
  }
  [pscustomobject]@{ Name = $fileName; Path = $localPath; Hash = $digest }
}

if ($DryRun) {
  $entries | ForEach-Object { Write-Output "Verified $($_.Name) -> ${Destination}:/opt/oren/media/videos/$($_.Name)" }
  return
}

& ssh @connectionOptions -p $Port $Destination 'install -d -m 755 /opt/oren/media/videos'
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare remote video directory' }
foreach ($entry in $entries) {
  $remotePath = "/opt/oren/media/videos/$($entry.Name)"
  & scp @connectionOptions -P $Port $entry.Path "${Destination}:${remotePath}.upload"
  if ($LASTEXITCODE -ne 0) { throw "Upload failed for $($entry.Name)" }
  # Check the temporary file before atomically replacing the public asset.
  $verify = "printf '%s  %s\n' '$($entry.Hash)' '${remotePath}.upload' | sha256sum -c - && chmod 644 '${remotePath}.upload' && mv '${remotePath}.upload' '$remotePath'"
  & ssh @connectionOptions -p $Port $Destination $verify
  if ($LASTEXITCODE -ne 0) { throw "Remote verification failed for $($entry.Name)" }
}
Write-Output 'Videos uploaded and verified. No application release was activated.'
