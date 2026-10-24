using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

namespace PcMonitorTest {
  public sealed class HistoryStore {
    readonly object gate = new object();
    readonly Queue<ActivityRecord> pending = new Queue<ActivityRecord>();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    public readonly string Root;
    public readonly string HistoryDirectory;
    public readonly string Token;
    public HistoryStore() {
      Root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PCMonitorTest");
      HistoryDirectory = Path.Combine(Root, "history");
      Directory.CreateDirectory(HistoryDirectory);
      var tokenFile = Path.Combine(Root, "pairing-token.txt");
      if (!File.Exists(tokenFile)) {
        var bytes = new byte[32];
        using (var random = RandomNumberGenerator.Create()) random.GetBytes(bytes);
        File.WriteAllText(tokenFile, BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(), Encoding.ASCII);
      }
      Token = File.ReadAllText(tokenFile).Trim();
      Purge();
    }
    static readonly Encoding Utf8NoBom = new UTF8Encoding(false);
    public void SaveCurrentState(Snapshot snapshot) {
      if (snapshot == null) return;
      try {
        string jsonText = json.Serialize(snapshot);
        string targetFile = Path.Combine(Root, "current-state.json");
        string tempFile = targetFile + ".tmp";
        File.WriteAllText(tempFile, jsonText, Utf8NoBom);
        // Atomic replacement prevents readers observing a truncated JSON document.
        if (File.Exists(targetFile)) File.Replace(tempFile, targetFile, null);
        else File.Move(tempFile, targetFile);
        try { File.Delete(tempFile); } catch { }
      } catch { /* Non-blocking */ }
    }
    public void Enqueue(ActivityRecord item) { lock (gate) pending.Enqueue(item); }
    public void Flush() {
      List<ActivityRecord> batch = new List<ActivityRecord>();
      lock (gate) while (pending.Count > 0) batch.Add(pending.Dequeue());
      if (batch.Count == 0) return;
      var groups = batch.GroupBy(item => item.utc.ToLocalTime().ToString("yyyy-MM-dd"));
      foreach (var group in groups) {
        var file = Path.Combine(HistoryDirectory, group.Key + ".jsonl");
        var lines = group.Select(item => json.Serialize(item));
        File.AppendAllText(file, String.Join(Environment.NewLine, lines) + Environment.NewLine, Encoding.UTF8);
      }
      Purge();
    }
    void Purge() {
      var files = new DirectoryInfo(HistoryDirectory).GetFiles("*.jsonl").OrderBy(f => f.Name).ToList();
      var cutoff = DateTime.Now.Date.AddDays(-6);
      foreach (var file in files.ToList()) {
        DateTime day;
        if (DateTime.TryParseExact(Path.GetFileNameWithoutExtension(file.Name), "yyyy-MM-dd", null,
          System.Globalization.DateTimeStyles.None, out day) && day < cutoff) { file.Delete(); files.Remove(file); }
      }
      long bytes = files.Sum(f => f.Length);
      const long limit = 50L * 1024 * 1024;
      foreach (var file in files) {
        if (bytes <= limit) break;
        bytes -= file.Length;
        file.Delete();
      }
    }
  }
}
