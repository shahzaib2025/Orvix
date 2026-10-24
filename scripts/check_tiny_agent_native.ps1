$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$checkDirectory = Join-Path $projectRoot 'scratch\tiny-agent-native-check'
New-Item -ItemType Directory -Force -Path $checkDirectory | Out-Null
$harnessPath = Join-Path $checkDirectory 'MonitorChangeCheck.cs'
@'
using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.IO;
using System.Threading;
using PcMonitorTest;
public static class MonitorChangeCheck {
  static void Check(bool ok, string message) { if (!ok) throw new Exception(message); }
  public static int Main(string[] args) {
    try {
      var monitor = new SystemMonitor(args[0]);
      try {
        monitor.RefreshAudio(); monitor.RefreshBrightness();
        var flags = BindingFlags.NonPublic | BindingFlags.Instance;
        var pointer = typeof(SystemMonitor).GetField("audioCallbackPointer", flags);
        var callback = (VolumeChangeCallback)typeof(SystemMonitor).GetField("audioCallback", flags).GetValue(monitor);
        if (callback != null) {
          monitor.ConsumeAudioDirty();
          IntPtr payload = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(VolumeChangeCallback.AudioVolumeHeader)));
          Guid context = Guid.NewGuid();
          try {
            var first = new VolumeChangeCallback.AudioVolumeHeader { Context = context, Muted = 1, Scalar = .512345f, Channels = 1 };
            Marshal.StructureToPtr(first, payload, false); callback.OnNotify(payload);
            var second = new VolumeChangeCallback.AudioVolumeHeader { Context = context, Muted = 0, Scalar = .812345f, Channels = 1 };
            Marshal.StructureToPtr(second, payload, false); callback.OnNotify(payload);
          } finally { Marshal.FreeHGlobal(payload); }
          Check(monitor.ConsumeAudioDirty(), "Native callback did not signal a refresh.");
          Check(!monitor.ConsumeAudioDirty(), "Native callback dirty flag was not consumed once.");
          var deadline = DateTime.UtcNow.AddSeconds(5);
          while (monitor.Events.Read().LastSequence < 4 && DateTime.UtcNow < deadline) Thread.Sleep(25);
          var events = monitor.Events.Read();
          Check(events.Events.Count >= 4, "Native payloads were not journaled.");
          Check(Math.Abs(Convert.ToDouble(events.Events[0].Value) - 51.2345) < .001, "First audio scalar was not copied before pointer reuse.");
          Check((bool)events.Events[1].Value && !(bool)events.Events[3].Value, "Mute transitions were lost.");
          Check(events.Events[0].Context == context.ToString(), "Audio context GUID was lost.");
          Check(events.Events[0].Device == monitor.AudioDeviceId, "Callback was not bound to its endpoint.");
          Check(events.Events[0].Sequence < events.Events[2].Sequence, "Rapid callbacks were reordered.");
          Console.WriteLine("PASS: copied fractional audio values, mute, context, device and order before native pointer reuse/free.");
        }
        monitor.Events.Capture(monitor.BrightnessDeviceId ?? "fixture-screen", "brightness_percent", 51, null);
        Thread.Sleep(200);
        Check(File.Exists(Path.Combine(args[0], "signals", "events.jsonl")), "Signal journal was not persisted.");
        Console.WriteLine("PASS: callback worker published a durable event batch.");
        if (monitor.Volume.HasValue) {
          Check(!String.IsNullOrEmpty(monitor.AudioDeviceId), "Audio reading has no source identity.");
          Check((IntPtr)pointer.GetValue(monitor) != IntPtr.Zero, "Core Audio event registration failed on an available endpoint.");
        }
        if (monitor.Brightness.HasValue) {
          Check(!String.IsNullOrEmpty(monitor.BrightnessDeviceId), "Brightness reading has no source identity.");
          Check(typeof(SystemMonitor).GetField("brightnessWatcher", flags).GetValue(monitor) != null, "Brightness event subscription failed on a supported display.");
        }
        for (int i = 0; i < 10; i++) { monitor.RefreshAudio(); Thread.Sleep(50); }
        Console.WriteLine("PASS: native callback, live audio registration=" + monitor.Volume.HasValue + ", brightness subscription=" + monitor.Brightness.HasValue + ", source identities, repeated reads.");
        monitor.Dispose();
        Check((IntPtr)pointer.GetValue(monitor) == IntPtr.Zero, "Native callback pointer leaked after disposal.");
        Check(typeof(SystemMonitor).GetField("brightnessWatcher", flags).GetValue(monitor) == null, "Brightness subscription leaked after disposal.");
        Console.WriteLine("PASS: native subscriptions released without changing device settings.");
      } finally { monitor.Dispose(); }
      string blockedRoot = args[0] + ".blocked";
      File.WriteAllText(blockedRoot, "fixture");
      using (var failure = new SignalEventStream(blockedRoot, 16)) {
        failure.Capture("screen", "brightness_percent", 60, null);
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (failure.Read().Error == null && DateTime.UtcNow < deadline) Thread.Sleep(25);
        Check(failure.Read().Error != null && failure.Read().Dropped > 0, "Journal IO failure was not exposed as a gap.");
        File.Delete(blockedRoot);
        failure.Capture("screen", "brightness_percent", 61, null);
        deadline = DateTime.UtcNow.AddSeconds(5);
        while (failure.Read().Events.Count == 0 && DateTime.UtcNow < deadline) Thread.Sleep(25);
        Check(failure.Read().Events.Count == 1 && failure.Read().Error == null, "Journal worker did not recover after IO resumed.");
        for (int i = 0; i < 20000; i++) failure.Capture("screen", "brightness_percent", i % 100, null);
        deadline = DateTime.UtcNow.AddSeconds(5);
        while (failure.Read().Dropped <= 1 && DateTime.UtcNow < deadline) Thread.Sleep(25);
        Check(failure.Read().Dropped > 1, "Buffer overflow was not reported.");
        Check(failure.Read().Events.Count <= 16, "Published event buffer exceeded its bound.");
      }
      string rotationRoot = args[0] + ".rotation";
      string rotationDirectory = Path.Combine(rotationRoot, "signals"); Directory.CreateDirectory(rotationDirectory);
      string journal = Path.Combine(rotationDirectory, "events.jsonl");
      using (var file = new FileStream(journal, FileMode.Create)) file.SetLength(8 * 1024 * 1024);
      using (var rotation = new SignalEventStream(rotationRoot)) {
        rotation.Capture("screen", "brightness_percent", 62, null);
        var deadline = DateTime.UtcNow.AddSeconds(5);
        while (rotation.Read().Events.Count == 0 && DateTime.UtcNow < deadline) Thread.Sleep(25);
        Check(File.Exists(journal + ".previous") && new FileInfo(journal).Length < 4096, "Journal retention did not rotate the full segment.");
      }
      Console.WriteLine("PASS: journal IO failure/recovery, explicit overflow, bounded event buffer and file rotation.");
      return 0;
    } catch (Exception error) { Console.Error.WriteLine(error); return 1; }
  }
}
'@ | Set-Content -LiteralPath $harnessPath -Encoding utf8
$compilerPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$frameworkPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$outputPath = Join-Path $checkDirectory 'MonitorChangeCheck.exe'
$sources = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'PC-Monitor-Test\src') -Filter '*.cs' | ForEach-Object FullName)
& $compilerPath /nologo /optimize+ /platform:x64 /target:exe /codepage:65001 /main:MonitorChangeCheck "/out:$outputPath" /r:System.Core.dll /r:System.Runtime.dll /r:System.Management.dll /r:System.Web.Extensions.dll /r:System.Runtime.WindowsRuntime.dll /r:System.Drawing.dll "/r:$frameworkPath\WPF\UIAutomationClient.dll" "/r:$frameworkPath\WPF\UIAutomationTypes.dll" "/r:$frameworkPath\WPF\WindowsBase.dll" $sources $harnessPath
if ($LASTEXITCODE -ne 0) { throw 'Native harness compilation failed.' }
& $outputPath (Join-Path $checkDirectory ([Guid]::NewGuid().ToString("N")))
if ($LASTEXITCODE -ne 0) { throw 'Native change-monitor checks failed.' }
