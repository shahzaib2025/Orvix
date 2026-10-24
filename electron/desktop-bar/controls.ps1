param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidateSet('Read', 'Volume', 'Brightness', 'Listen')]
  [string]$Action,

  [Parameter(Position = 1)]
  [int]$Value = 0
)

$ErrorActionPreference = 'Stop'

$audioType = @'
using System;
using System.Runtime.InteropServices;

public static class QuickDeckAudio
{
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    private class MMDeviceEnumeratorComObject { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice endpoint);
        [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice endpoint);
        [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr callback);
        [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr callback);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IMMDevice
    {
        [PreserveSig] int Activate(ref Guid iid, int classContext, IntPtr activationParameters, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(int access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out int state);
    }

    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioEndpointVolume
    {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float levelDb, ref Guid eventContext);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid eventContext);
        [PreserveSig] int GetMasterVolumeLevel(out float levelDb);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid eventContext);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid eventContext);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float levelDb);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool muted, ref Guid eventContext);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool muted);
        [PreserveSig] int GetVolumeStepInfo(out uint step, out uint stepCount);
        [PreserveSig] int VolumeStepUp(ref Guid eventContext);
        [PreserveSig] int VolumeStepDown(ref Guid eventContext);
        [PreserveSig] int QueryHardwareSupport(out uint hardwareSupportMask);
        [PreserveSig] int GetVolumeRange(out float minimumDb, out float maximumDb, out float incrementDb);
    }

    private static IAudioEndpointVolume GetEndpoint()
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        IMMDevice endpoint = null;
        try {
            Marshal.ThrowExceptionForHR(enumerator.GetDefaultAudioEndpoint(0, 1, out endpoint));
            object volume;
            var iid = typeof(IAudioEndpointVolume).GUID;
            Marshal.ThrowExceptionForHR(endpoint.Activate(ref iid, 23, IntPtr.Zero, out volume));
            return (IAudioEndpointVolume)volume;
        } finally {
            if (endpoint != null) Marshal.ReleaseComObject(endpoint);
            Marshal.ReleaseComObject(enumerator);
        }
    }

    public static int GetVolume()
    {
        var endpoint = GetEndpoint();
        try {
            float value;
            Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevelScalar(out value));
            return (int)Math.Round(value * 100.0f);
        } finally { Marshal.ReleaseComObject(endpoint); }
    }

    public static void SetVolume(int value)
    {
        var endpoint = GetEndpoint();
        try {
            var eventContext = Guid.Empty;
            var normalized = Math.Max(0, Math.Min(100, value)) / 100.0f;
            Marshal.ThrowExceptionForHR(endpoint.SetMasterVolumeLevelScalar(normalized, ref eventContext));
        } finally { Marshal.ReleaseComObject(endpoint); }
    }
}
'@

if (-not ('QuickDeckAudio' -as [type])) {
  Add-Type -TypeDefinition $audioType
}

function Invoke-QuickDeckControl([string]$Operation, [int]$Number) {
  switch ($Operation) {
    'Read' {
    $volume = $null
    $brightness = $null
    $brightnessSupported = $false
    try { $volume = [QuickDeckAudio]::GetVolume() } catch { }
    try {
      $monitor = Get-CimInstance -Namespace 'root/WMI' -ClassName 'WmiMonitorBrightness' | Select-Object -First 1
      if ($null -ne $monitor) {
        $brightness = [int]$monitor.CurrentBrightness
        $brightnessSupported = $true
      }
    } catch { }
      return @{ volume = $volume; brightness = $brightness; brightnessSupported = $brightnessSupported }
    }
    'Volume' {
      [QuickDeckAudio]::SetVolume($Number)
      return @{ ok = $true; value = [QuickDeckAudio]::GetVolume() }
    }
    'Brightness' {
      $brightnessMethod = Get-CimInstance -Namespace 'root/WMI' -ClassName 'WmiMonitorBrightnessMethods' | Select-Object -First 1
      if ($null -eq $brightnessMethod) {
        return @{ ok = $false; supported = $false; error = 'This display does not expose brightness control.' }
      }
      $level = [byte][Math]::Max(0, [Math]::Min(100, $Number))
      $result = Invoke-CimMethod -InputObject $brightnessMethod -MethodName 'WmiSetBrightness' -Arguments @{ Timeout = [uint32]1; Brightness = $level }
      if ($result.ReturnValue -eq 0) {
        return @{ ok = $true; value = [int]$level }
      }
      return @{ ok = $false; supported = $true; error = "Windows rejected the brightness change ($($result.ReturnValue))." }
    }
  }
}

if ($Action -eq 'Listen') {
  while ($null -ne ($line = [Console]::In.ReadLine())) {
    try {
      $request = $line | ConvertFrom-Json
      $result = Invoke-QuickDeckControl ([string]$request.action) ([int]$request.value)
      $result['id'] = [int]$request.id
      [Console]::Out.WriteLine(($result | ConvertTo-Json -Compress -Depth 4))
      [Console]::Out.Flush()
    } catch {
      $response = @{ id = [int]$request.id; ok = $false; error = $_.Exception.Message }
      [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 4))
      [Console]::Out.Flush()
    }
  }
  exit 0
}

$singleResult = Invoke-QuickDeckControl $Action $Value
$singleResult | ConvertTo-Json -Compress -Depth 4
