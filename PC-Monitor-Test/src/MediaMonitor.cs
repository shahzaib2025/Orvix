using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Threading.Tasks;

namespace PcMonitorTest {
  public static class MediaMonitor {
    static object Call(object target, string method) {
      return target.GetType().GetRuntimeMethod(method, Type.EmptyTypes).Invoke(target, null);
    }
    static object AwaitOperation(object operation) {
      var interfaceType = operation.GetType().GetInterfaces().FirstOrDefault(t =>
        t.IsGenericType && t.Name.StartsWith("IAsyncOperation`", StringComparison.Ordinal));
      if (interfaceType == null) return null;
      var asTask = typeof(WindowsRuntimeSystemExtensions).GetMethods(BindingFlags.Public | BindingFlags.Static)
        .First(m => m.Name == "AsTask" && m.IsGenericMethodDefinition && m.GetParameters().Length == 1);
      var task = (Task)asTask.MakeGenericMethod(interfaceType.GetGenericArguments()[0]).Invoke(null, new[] { operation });
      task.GetAwaiter().GetResult();
      return task.GetType().GetProperty("Result").GetValue(task, null);
    }
    static object Property(object target, string name) {
      return target == null ? null : target.GetType().GetRuntimeProperty(name).GetValue(target, null);
    }
    public static List<MediaInfo> Read() {
      var result = new List<MediaInfo>();
      try {
        var type = Type.GetType("Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime");
        if (type == null) return result;
        var manager = AwaitOperation(type.GetRuntimeMethod("RequestAsync", Type.EmptyTypes).Invoke(null, null));
        foreach (var session in (IEnumerable)Call(manager, "GetSessions")) {
          try {
            var playback = Call(session, "GetPlaybackInfo");
            if (Property(playback, "PlaybackStatus").ToString() != "Playing") continue;
            var media = AwaitOperation(Call(session, "TryGetMediaPropertiesAsync"));
            result.Add(new MediaInfo {
              Source = Convert.ToString(Property(session, "SourceAppUserModelId")) ?? "Unknown app",
              Title = Convert.ToString(Property(media, "Title")) ?? "Title unavailable",
              Artist = Convert.ToString(Property(media, "Artist")) ?? ""
            });
          } catch { /* A session may disappear while it is read. */ }
        }
      } catch { /* This Windows build or media player may not expose sessions. */ }
      return result;
    }
  }
}
