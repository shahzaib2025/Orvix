using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading;

namespace PcMonitorTest {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("A95664D2-9614-4F35-A746-DE8DB63617E6")]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);
    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
  }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("D666063F-1587-4E43-81F1-B948E807363F")]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object result);
    [PreserveSig] int OpenPropertyStore(int access, out IntPtr store);
    [PreserveSig] int GetId(out IntPtr id);
    [PreserveSig] int GetState(out int state);
  }
  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("5CDF2C82-841E-4546-9722-0CF74078229A")]
  interface IAudioEndpointVolume {
    [PreserveSig] int RegisterControlChangeNotify(IntPtr callback);
    [PreserveSig] int UnregisterControlChangeNotify(IntPtr callback);
    [PreserveSig] int GetChannelCount(out uint count);
    [PreserveSig] int SetMasterVolumeLevel(float level, IntPtr context);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, IntPtr context);
    [PreserveSig] int GetMasterVolumeLevel(out float level);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, IntPtr context);
    [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr context);
    [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
    [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
  }
  [ComVisible(true), InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("657804FA-D6AD-4496-8A60-352752AF4F89")]
  public interface IAudioEndpointVolumeCallback {
    [PreserveSig] int OnNotify(IntPtr data);
  }
  [ComVisible(true), ClassInterface(ClassInterfaceType.None)]
  public sealed class VolumeChangeCallback : IAudioEndpointVolumeCallback {
    readonly Action<AudioVolumeHeader> changed;
    [StructLayout(LayoutKind.Sequential)]
    public struct AudioVolumeHeader { public Guid Context; public int Muted; public float Scalar; public uint Channels; }
    public VolumeChangeCallback(Action<AudioVolumeHeader> handler) { changed = handler; }
    public int OnNotify(IntPtr data) {
      if (data == IntPtr.Zero) return 0;
      try {
        var value = (AudioVolumeHeader)Marshal.PtrToStructure(data, typeof(AudioVolumeHeader));
        if (!Single.IsNaN(value.Scalar) && value.Scalar >= 0 && value.Scalar <= 1) changed(value);
      } catch { /* A callback must never throw across COM. */ }
      return 0;
    }
  }
  public sealed class SystemMonitor : IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct PowerStatus {
      public byte AcLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag;
      public uint BatteryLifeTime, BatteryFullLifeTime;
    }
    [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out PowerStatus status);
    public int? Volume { get; private set; }
    public double? VolumePrecise { get; private set; }
    public Dictionary<string, double> SignalPollMonotonicMs = new Dictionary<string, double>();
    public bool? Muted { get; private set; }
    public int? Brightness { get; private set; }
    public int? BatteryPercent { get; private set; }
    public bool? OnAcPower { get; private set; }
    public bool? Charging { get; private set; }
    public List<MediaInfo> Media { get; private set; }
    public string AudioDeviceId { get; private set; }
    public string BrightnessDeviceId { get; private set; }
    ManagementEventWatcher brightnessWatcher;
    object audioObject;
    IAudioEndpointVolume audioEndpoint;
    IntPtr audioCallbackPointer;
    VolumeChangeCallback audioCallback;
    public readonly SignalEventStream Events;
    int audioDirty, brightnessDirty;
    public SystemMonitor(string journalRoot = null) {
      Events = new SignalEventStream(journalRoot);
      Media = new List<MediaInfo>();
      try {
        brightnessWatcher = new ManagementEventWatcher(@"root\wmi", "SELECT * FROM WmiMonitorBrightnessEvent");
        brightnessWatcher.EventArrived += (sender, args) => {
          try {
            var ev = args.NewEvent;
            if (Convert.ToBoolean(ev["Active"])) Events.Capture(Convert.ToString(ev["InstanceName"]), "brightness_percent", Convert.ToInt32(ev["Brightness"]), null);
            Interlocked.Exchange(ref brightnessDirty, 1);
          } catch { }
        };
        brightnessWatcher.Start();
      } catch { if (brightnessWatcher != null) brightnessWatcher.Dispose(); brightnessWatcher = null; }
    }
    public bool ConsumeAudioDirty() { return Interlocked.Exchange(ref audioDirty, 0) != 0; }
    public bool ConsumeBrightnessDirty() { return Interlocked.Exchange(ref brightnessDirty, 0) != 0; }
    public Dictionary<string, string> SignalSources {
      get { return new Dictionary<string, string> { { "volume_percent", AudioDeviceId ?? "" }, { "muted", AudioDeviceId ?? "" }, { "brightness_percent", BrightnessDeviceId ?? "" } }; }
    }
    void ReleaseAudio() {
      if (audioEndpoint != null && audioCallbackPointer != IntPtr.Zero) {
        try { audioEndpoint.UnregisterControlChangeNotify(audioCallbackPointer); } catch { }
      }
      if (audioCallbackPointer != IntPtr.Zero) { Marshal.Release(audioCallbackPointer); audioCallbackPointer = IntPtr.Zero; }
      if (audioObject != null && Marshal.IsComObject(audioObject)) Marshal.ReleaseComObject(audioObject);
      audioObject = null; audioEndpoint = null; AudioDeviceId = null; audioCallback = null;
    }
    public void Dispose() {
      if (brightnessWatcher != null) { try { brightnessWatcher.Stop(); } catch { } brightnessWatcher.Dispose(); brightnessWatcher = null; }
      ReleaseAudio(); Events.Dispose();
    }
    public void RefreshPower() {
      BatteryPercent = null; OnAcPower = null; Charging = null;
      try {
        PowerStatus status;
        if (!GetSystemPowerStatus(out status)) return;
        if (status.AcLineStatus != 255) OnAcPower = status.AcLineStatus == 1;
        if (status.BatteryLifePercent <= 100 && (status.BatteryFlag & 128) == 0) BatteryPercent = status.BatteryLifePercent;
        if (status.BatteryFlag != 255 && (status.BatteryFlag & 128) == 0) Charging = (status.BatteryFlag & 8) != 0;
      } catch { /* Power state is unavailable on this device. */ }
    }
    public void RefreshAudio() {
      IMMDeviceEnumerator enumerator = null;
      IMMDevice device = null;
      Volume = null; VolumePrecise = null; Muted = null;
      try {
        enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
        if (enumerator.GetDefaultAudioEndpoint(0, 1, out device) != 0 || device == null) { ReleaseAudio(); return; }
        IntPtr idPointer;
        if (device.GetId(out idPointer) != 0) { ReleaseAudio(); return; }
        string id;
        try { id = Marshal.PtrToStringUni(idPointer); } finally { Marshal.FreeCoTaskMem(idPointer); }
        if (audioEndpoint == null || AudioDeviceId != id) {
          ReleaseAudio();
          Guid guid = typeof(IAudioEndpointVolume).GUID;
          if (device.Activate(ref guid, 23, IntPtr.Zero, out audioObject) != 0) { ReleaseAudio(); return; }
          audioEndpoint = (IAudioEndpointVolume)audioObject; AudioDeviceId = id;
          audioCallback = new VolumeChangeCallback(value => {
            Events.CaptureBatch(id, new string[] { "volume_percent", "muted" }, new object[] { Math.Round(value.Scalar * 100.0, 4), value.Muted != 0 }, value.Context.ToString());
            Interlocked.Exchange(ref audioDirty, 1);
          });
          try {
            audioCallbackPointer = Marshal.GetComInterfaceForObject(audioCallback, typeof(IAudioEndpointVolumeCallback));
            if (audioEndpoint.RegisterControlChangeNotify(audioCallbackPointer) != 0) { Marshal.Release(audioCallbackPointer); audioCallbackPointer = IntPtr.Zero; }
          } catch { if (audioCallbackPointer != IntPtr.Zero) Marshal.Release(audioCallbackPointer); audioCallbackPointer = IntPtr.Zero; }
        }
        float scalar; bool muted;
        double scalarPollAt = Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency;
        if (audioEndpoint.GetMasterVolumeLevelScalar(out scalar) == 0) { Volume = Math.Max(0, Math.Min(100, (int)Math.Round(scalar * 100))); VolumePrecise = Math.Round(scalar * 100.0, 4); SignalPollMonotonicMs["volume_percent"] = scalarPollAt; }
        double mutePollAt = Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency;
        if (audioEndpoint.GetMute(out muted) == 0) { Muted = muted; SignalPollMonotonicMs["muted"] = mutePollAt; }
        if (!Volume.HasValue || !Muted.HasValue) ReleaseAudio();
      } catch { ReleaseAudio(); /* Endpoint may be disconnected or unavailable. */ }
      finally {
        if (device != null && Marshal.IsComObject(device)) Marshal.ReleaseComObject(device);
        if (enumerator != null && Marshal.IsComObject(enumerator)) Marshal.ReleaseComObject(enumerator);
      }
    }
    public void RefreshBrightness() {
      Brightness = null;
      double pollAt = Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency;
      string nextId = null; int? nextBrightness = null;
      try {
        using (var search = new ManagementObjectSearcher(@"root\wmi", "SELECT CurrentBrightness, InstanceName FROM WmiMonitorBrightness WHERE Active = TRUE"))
        using (var monitors = search.Get())
          foreach (ManagementObject monitor in monitors) {
            using (monitor) {
              string id = Convert.ToString(monitor["InstanceName"]);
              if (nextId == null || id == BrightnessDeviceId) { nextId = id; nextBrightness = Convert.ToInt32(monitor["CurrentBrightness"]); }
            }
          }
      } catch { /* External monitors may not expose WMI brightness. */ }
      BrightnessDeviceId = nextId; Brightness = nextBrightness;
      SignalPollMonotonicMs["brightness_percent"] = pollAt;
    }
    public void RefreshMedia() { Media = MediaMonitor.Read(); }
  }
}
