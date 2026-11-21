# Generuje próbkę demo nr 20: pionowy „reels” z fikcyjną reklamą kryptowalut.
# Mowa (syntezator Windows, głos pl-PL) + napisy na ekranie; ostrzeżenie o ryzyku tylko jako
# blady drobny druk na planszy końcowej przez ~1,5 s. Wymaga ffmpeg w PATH.
param([string]$Out = (Join-Path $PSScriptRoot '..\data\samples\20_reels_krypto_wideo.mp4'))
$ErrorActionPreference = 'Stop'
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('iw-video-' + [guid]::NewGuid())
New-Item -ItemType Directory $tmp | Out-Null
try {
  Add-Type -AssemblyName System.Speech
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $voice = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'pl-PL' } | Select-Object -First 1
  if ($voice) { $s.SelectVoice($voice.VoiceInfo.Name) }
  $wav = Join-Path $tmp 'voice.wav'
  $s.SetOutputToWaveFile($wav)
  $s.Speak('Cześć! Z platformą KryptoRakieta Pro zarobisz nawet trzydzieści procent miesięcznie. To gwarantowany zysk i zero ryzyka. Kliknij link w bio i zacznij inwestować już dziś.')
  $s.Dispose()

  $font = 'C\:/Windows/Fonts/arialbd.ttf'
  $fontR = 'C\:/Windows/Fonts/arial.ttf'
  $vf = @(
    "drawtext=fontfile='$font':text='KryptoRakieta Pro':fontsize=64:fontcolor=white:x=(w-tw)/2:y=220:enable='lt(t,4)'",
    "drawtext=fontfile='$font':expansion=none:text='ZYSK 30% MIESIĘCZNIE':fontsize=78:fontcolor=yellow:x=(w-tw)/2:y=820:enable='between(t,1,7)'",
    "drawtext=fontfile='$font':text='Gwarancja zysku – zero ryzyka':fontsize=54:fontcolor=white:x=(w-tw)/2:y=1000:enable='between(t,4,9)'",
    "drawtext=fontfile='$font':text='Link w bio':fontsize=60:fontcolor=white:x=(w-tw)/2:y=1300:enable='gte(t,7)'",
    "drawtext=fontfile='$fontR':text='Inwestowanie wiąże się z ryzykiem utraty kapitału.':fontsize=20:fontcolor=0x9aa3b5:x=(w-tw)/2:y=1840:enable='gte(t,9.3)'"
  ) -join ','
  & ffmpeg -hide_banner -loglevel error -y -f lavfi -i 'color=c=0x1b2340:s=1080x1920:r=25:d=11' -i $wav `
    -vf $vf -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -c:a aac -b:a 96k -af apad -t 11 $Out
  if ($LASTEXITCODE) { throw "ffmpeg exit $LASTEXITCODE" }
  Get-Item $Out | Select-Object Name, Length
} finally { Remove-Item -Recurse -Force $tmp }
