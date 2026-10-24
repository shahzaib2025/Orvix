using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace PcMonitorTest {
  public sealed class SignalEvent {
    [ScriptIgnore] public long CaptureOrder { get; set; }
    [ScriptIgnore] public int CaptureIndex { get; set; }
    public long Sequence { get; set; }
    public string Device { get; set; }
    public string Signal { get; set; }
    public object Value { get; set; }
    public string Context { get; set; }
    public double ReceiptUtcMs { get; set; }
    public double MonotonicMs { get; set; }
    public string Origin { get; set; }
  }
  public sealed class SignalEventBatch {
    public string Session { get; set; }
    public long FirstSequence { get; set; }
    public long LastSequence { get; set; }
    public long Dropped { get; set; }
    public string Error { get; set; }
    public double ObservedMonotonicMs { get; set; }
    public List<SignalEvent> Events { get; set; }
  }
  // Native callbacks only copy managed values and enqueue. File IO and publication
  // happen on this worker. Both callback backlog and published replay are bounded.
  public sealed class SignalEventStream : IDisposable {
    readonly int capacity;
    readonly ConcurrentQueue<SignalEvent[]> pending = new ConcurrentQueue<SignalEvent[]>();
    readonly Queue<SignalEvent> replay = new Queue<SignalEvent>();
    readonly object gate = new object();
    readonly object lifecycleGate = new object();
    readonly AutoResetEvent pendingSignal = new AutoResetEvent(false);
    readonly string session = Guid.NewGuid().ToString("N"), directory;
    readonly Thread worker;
    int pendingCount, stopping, signalDisposed;
    long sequence, publishedSequence, dropped, captureOrder;
    string error;
    static readonly DateTime Epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    public SignalEventStream(string root, int bufferCapacity = 4096) {
      capacity = Math.Max(1, Math.Min(4096, bufferCapacity));
      directory = root == null ? null : Path.Combine(root, "signals");
      worker = new Thread(Work); worker.IsBackground = true; worker.Name = "Orvix signal journal"; worker.Start();
    }
    public void Capture(string device, string signal, object value, string context) {
      CaptureBatch(device, new string[] { signal }, new object[] { value }, context);
    }
    public void CaptureBatch(string device, string[] signals, object[] values, string context) {
      lock (lifecycleGate) {
        if (Volatile.Read(ref stopping) != 0) return;
        double utc = (DateTime.UtcNow - Epoch).TotalMilliseconds;
        double monotonic = Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency;
        long order = Interlocked.Increment(ref captureOrder);
        var events = new SignalEvent[signals.Length];
        for (int i = 0; i < events.Length; i++) events[i] = new SignalEvent { CaptureOrder = order, CaptureIndex = i, Device = device, Signal = signals[i], Value = values[i], Context = context, ReceiptUtcMs = utc, MonotonicMs = monotonic, Origin = "native" };
        if (Interlocked.Increment(ref pendingCount) > capacity) { Interlocked.Decrement(ref pendingCount); Interlocked.Add(ref dropped, events.Length); return; }
        pending.Enqueue(events);
        pendingSignal.Set();
      }
    }
    void Work() {
      var json = new JavaScriptSerializer();
      while (true) {
        var batch = new List<SignalEvent>(); SignalEvent[] next;
        while (batch.Count < capacity && pending.TryDequeue(out next)) { Interlocked.Decrement(ref pendingCount); batch.AddRange(next); }
        if (batch.Count == 0) {
          pendingSignal.WaitOne();
          if (Volatile.Read(ref stopping) != 0 && pending.IsEmpty) break;
          continue;
        }
        // Receipt ordering also covers concurrent native callback threads.
        batch.Sort((a, b) => { int order = a.MonotonicMs.CompareTo(b.MonotonicMs); if (order == 0) order = a.CaptureOrder.CompareTo(b.CaptureOrder); return order == 0 ? a.CaptureIndex.CompareTo(b.CaptureIndex) : order; });
        foreach (var item in batch) item.Sequence = ++sequence;
        try {
          if (directory != null) {
            Directory.CreateDirectory(directory);
            string file = Path.Combine(directory, "events.jsonl");
            if (File.Exists(file) && new FileInfo(file).Length >= 8 * 1024 * 1024) {
              string previous = file + ".previous"; if (File.Exists(previous)) File.Delete(previous); File.Move(file, previous);
            }
            using (var stream = new FileStream(file, FileMode.Append, FileAccess.Write, FileShare.Read)) {
              foreach (var item in batch) {
                byte[] bytes = Encoding.UTF8.GetBytes(json.Serialize(new { Session = session, Event = item }) + "\n");
                stream.Write(bytes, 0, bytes.Length);
              }
              stream.Flush(true);
            }
          }
          lock (gate) { foreach (var item in batch) { replay.Enqueue(item); while (replay.Count > capacity) replay.Dequeue(); } error = null; publishedSequence = sequence; }
        } catch (Exception failure) {
          Interlocked.Add(ref dropped, batch.Count);
          lock (gate) { error = "Signal journal failed: " + failure.Message; publishedSequence = sequence; }
        }
      }
    }
    public SignalEventBatch Read() {
      lock (gate) {
        return new SignalEventBatch { Session = session, FirstSequence = replay.Count == 0 ? publishedSequence + 1 : replay.Peek().Sequence,
          LastSequence = publishedSequence, ObservedMonotonicMs = Stopwatch.GetTimestamp() * 1000.0 / Stopwatch.Frequency,
          Dropped = Interlocked.Read(ref dropped), Error = error, Events = new List<SignalEvent>(replay) };
      }
    }
    public void Dispose() {
      lock (lifecycleGate) {
        if (Interlocked.Exchange(ref stopping, 1) == 0) pendingSignal.Set();
      }
      if (worker.Join(2000) && Interlocked.Exchange(ref signalDisposed, 1) == 0) pendingSignal.Dispose();
    }
  }
}
