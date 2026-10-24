$paths = @(
 "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
 "C:\Program Files\Microsoft\Edge\Application\msedge.exe",
 "C:\Program Files\Google\Chrome\Application\chrome.exe",
 "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
 "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
foreach ($p in $paths) { "{0}  {1}" -f (Test-Path -LiteralPath $p), $p }
