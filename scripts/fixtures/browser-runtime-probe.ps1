$node = Get-Command node -ErrorAction SilentlyContinue
if($node){ "node: $(node -v)" } else { "node: MISSING" }
$py = Get-Command python -ErrorAction SilentlyContinue
if($py){ "python: $(python --version 2>&1)" } else { "python: MISSING" }
$chrome = @(
 "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
 "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
 "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
 "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
 "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
foreach($c in $chrome){ if(Test-Path -LiteralPath $c){ "browser: $c" } }
$npm = Get-Command npm -ErrorAction SilentlyContinue
if($npm){ "npm: $(npm -v)" } else { "npm: MISSING" }
