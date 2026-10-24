using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace PcMonitorTest {
  public sealed class BrowserServer : IDisposable {
    const int Port = 49491;
    readonly StateStore state;
    readonly string token;
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 16 * 1024 * 1024 };
    TcpListener listener;
    Thread thread;
    volatile bool stopping;
    public string Error { get; private set; }
    public BrowserServer(StateStore store, string pairingToken) { state = store; token = pairingToken; }
    public void Start() {
      try {
        listener = new TcpListener(IPAddress.Loopback, Port);
        listener.Start(8);
        thread = new Thread(Accept) { IsBackground = true, Name = "Browser receiver" };
        thread.Start();
      } catch (Exception error) { Error = error.Message; }
    }
    void Accept() {
      while (!stopping) {
        try {
          var client = listener.AcceptTcpClient();
          ThreadPool.QueueUserWorkItem(value => Handle((TcpClient)value), client);
        } catch (SocketException) { if (stopping) return; }
        catch (ObjectDisposedException) { return; }
      }
    }
    void Handle(TcpClient client) {
      using (client) {
        try {
          client.ReceiveTimeout = 2500; client.SendTimeout = 2500;
          var stream = client.GetStream();
          var header = new List<byte>();
          while (header.Count < 16384) {
            int value = stream.ReadByte();
            if (value < 0) return;
            header.Add((byte)value);
            int n = header.Count;
            if (n >= 4 && header[n-4] == 13 && header[n-3] == 10 && header[n-2] == 13 && header[n-1] == 10) break;
          }
          if (header.Count >= 16384) { Reply(stream, 431, "Header too large", null); return; }
          var lines = Encoding.ASCII.GetString(header.ToArray()).Split(new[] { "\r\n" }, StringSplitOptions.None);
          var first = lines[0].Split(' ');
          if (first.Length < 2) { Reply(stream, 400, "Bad request", null); return; }
          var fields = new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase);
          for (int index = 1; index < lines.Length; index++) {
            int split = lines[index].IndexOf(':');
            if (split > 0) fields[lines[index].Substring(0, split).Trim()] = lines[index].Substring(split + 1).Trim();
          }
          string origin;
          fields.TryGetValue("Origin", out origin);
          if (!String.IsNullOrEmpty(origin) &&
              !origin.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase) &&
              !origin.StartsWith("http://localhost", StringComparison.OrdinalIgnoreCase) &&
              !origin.StartsWith("http://127.0.0.1", StringComparison.OrdinalIgnoreCase) &&
              !origin.StartsWith("vscode-webview://", StringComparison.OrdinalIgnoreCase)) {
            Reply(stream, 403, "Origin denied", null); return;
          }
          if (first[0] == "OPTIONS") { Reply(stream, 204, "", origin); return; }
          string supplied;
          fields.TryGetValue("X-PC-Monitor-Token", out supplied);
          if (supplied != token) { Reply(stream, 403, "Pairing token required", origin); return; }
          if (first[0] == "GET" && first[1] == "/health") { Reply(stream, 200, "ok", origin); return; }
          if (first[0] == "GET" && first[1] == "/foreground") {
            Reply(stream, 200, json.Serialize(new { handle = WindowController.ForegroundHandle() }), origin); return;
          }
            if (first[0] == "POST" && first[1] == "/desktop-cancel") {
              var body=ReadBody(stream,fields);
              if (body==null) { Reply(stream,413,"Invalid body size",origin); return; }
              var input=json.Deserialize<Dictionary<string,object>>(Encoding.UTF8.GetString(body));
              object id; if (input!=null && input.TryGetValue("requestId",out id)) DesktopController.Cancel(id as string);
              Reply(stream,200,"{}",origin); return;
            }
            if (first[0] == "POST" && (first[1] == "/desktop-observe" || first[1] == "/desktop-act")) {
            var body = ReadBody(stream, fields);
            if (body == null) { Reply(stream, 413, "Invalid body size", origin); return; }
            var input = json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
            var result = DesktopController.Execute(first[1] == "/desktop-observe", input);
            Reply(stream, 200, json.Serialize(result), origin); return;
          }
          if (first[0] == "POST" && first[1] == "/action") {
            var body = ReadBody(stream, fields);
            if (body == null) { Reply(stream, 413, "Invalid body size", origin); return; }
            var req = json.Deserialize<Dictionary<string, object>>(Encoding.UTF8.GetString(body));
            string action = req != null && req.ContainsKey("action") ? req["action"] as string : null;
            long handle = 0;
            if (req != null && req.ContainsKey("handle") && req["handle"] != null) {
              Int64.TryParse(req["handle"].ToString(), out handle);
            }
            string appName = req != null && req.ContainsKey("appName") ? req["appName"] as string : (req != null && req.ContainsKey("app") ? req["app"] as string : null);
            string title = req != null && req.ContainsKey("title") ? req["title"] as string : null;

            var result = WindowController.ExecuteAction(action, handle, appName, title, state.GetCurrentWindows());
            Reply(stream, result.ok ? 200 : 400, json.Serialize(result), origin);
            return;
          }
          if (first[0] != "POST" || first[1] != "/snapshot") { Reply(stream, 404, "Not found", origin); return; }
          {
            var body = ReadBody(stream, fields);
            if (body == null) { Reply(stream, 413, "Invalid body size", origin); return; }
            var report = json.Deserialize<BrowserReport>(Encoding.UTF8.GetString(body));
            if (report == null || (report.browser != "Chrome" && report.browser != "Edge")) { Reply(stream, 400, "Invalid browser", origin); return; }
            state.SetBrowser(report);
            Reply(stream, 200, "ok", origin);
          }
        } catch (Exception) { /* A malformed local request must not stop monitoring. */ }
      }
    }
    static byte[] ReadBody(NetworkStream stream, Dictionary<string, string> fields) {
      string lengthText;
      int length;
      if (!fields.TryGetValue("Content-Length", out lengthText) || !Int32.TryParse(lengthText, out length) || length < 1 || length > 1024 * 1024)
        return null;
      var body = new byte[length];
      int read = 0;
      while (read < length) {
        int count = stream.Read(body, read, length - read);
        if (count <= 0) return null;
        read += count;
      }
      return body;
    }
    static void Reply(NetworkStream stream, int status, string body, string origin) {
      string reason = status == 200 ? "OK" : status == 204 ? "No Content" : "Error";
      var bytes = Encoding.UTF8.GetBytes(body);
      string cors = String.IsNullOrEmpty(origin) ? "" : "Access-Control-Allow-Origin: " + origin + "\r\nVary: Origin\r\n";
      var header = Encoding.ASCII.GetBytes("HTTP/1.1 " + status + " " + reason + "\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + bytes.Length +
        "\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: X-PC-Monitor-Token, Content-Type\r\n" + cors + "Connection: close\r\n\r\n");
      stream.Write(header, 0, header.Length);
      if (bytes.Length > 0) stream.Write(bytes, 0, bytes.Length);
    }
    public void Dispose() { stopping = true; if (listener != null) listener.Stop(); if (thread != null) thread.Join(1000); }
  }
}
