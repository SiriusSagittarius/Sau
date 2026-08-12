# build-release.ps1
# Baut das signierte AAB fuer den Play Store Upload (Sauerei App).
# Voraussetzung: JDK 21, Android SDK (cmdline-tools) und Gradle sind
# bereits installiert und im PATH (siehe vorherige Schritte).
#
# Vor dem Ausfuehren:
#  1. android.jks und build.json muessen im SauCordova-Ordner liegen
#     (gleiche Ebene wie config.xml)
#  2. config.xml muss bereits die neue Versionsnummer/versionCode enthalten
#
# Aufruf (normales PowerShell-Fenster reicht, kein Admin noetig):
#   .\build-release.ps1

$ErrorActionPreference = "Stop"

$projectDir = "C:\Users\adm\Music\game\FangDieSau\Sau\SauCordova"

Write-Host "=== Wechsle ins Projektverzeichnis ===" -ForegroundColor Cyan
Set-Location $projectDir

Write-Host ""
Write-Host "=== Pruefe benoetigte Dateien ===" -ForegroundColor Cyan
if (-not (Test-Path "$projectDir\android.jks")) {
    Write-Host "FEHLER: android.jks fehlt in $projectDir" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path "$projectDir\build.json")) {
    Write-Host "FEHLER: build.json fehlt in $projectDir" -ForegroundColor Red
    exit 1
}
Write-Host "OK: android.jks und build.json gefunden." -ForegroundColor Green

Write-Host ""
Write-Host "=== Starte Cordova Release-Build (AAB) ===" -ForegroundColor Cyan
cordova build android --release -- --packageType=bundle

$aabPath = "$projectDir\platforms\android\app\build\outputs\bundle\release\app-release.aab"

Write-Host ""
if (Test-Path $aabPath) {
    Write-Host "=== FERTIG! ===" -ForegroundColor Green
    Write-Host "Signiertes AAB liegt hier:"
    Write-Host $aabPath -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Dieses AAB kannst du jetzt in der Play Console als neues Release hochladen."

    # Explorer-Fenster mit der Datei oeffnen zur Kontrolle
    explorer.exe /select,"$aabPath"
} else {
    Write-Host "Der Build ist durchgelaufen, aber die erwartete AAB-Datei wurde nicht gefunden." -ForegroundColor Red
    Write-Host "Pruefe die Build-Ausgabe oben auf Fehler."
}
