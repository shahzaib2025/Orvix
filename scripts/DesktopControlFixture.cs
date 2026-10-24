using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using PcMonitorTest;

// Owns its test window; never types in or closes an existing user application.
class DesktopControlFixture {
  static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength=16*1024*1024 };
  static readonly ManualResetEvent Ready = new ManualResetEvent(false);
  static Form Window;
  static string Target;
  static long WindowHandle;
  static Dictionary<string,object> Map(object value) { return Json.Deserialize<Dictionary<string,object>>(Json.Serialize(value)); }
  static Dictionary<string,object> Request(params object[] pairs) { var result=new Dictionary<string,object>(); for(int i=0;i<pairs.Length;i+=2) result[(string)pairs[i]]=pairs[i+1]; return result; }
  static void Check(bool condition,string name) { if(!condition) throw new Exception(name); Console.WriteLine("PASS "+name); }
  static System.Collections.IEnumerable Controls(Dictionary<string,object> response) { return (System.Collections.IEnumerable)((Dictionary<string,object>)response["observation"])["controls"]; }
  static Dictionary<string,object> Named(Dictionary<string,object> response,string name) { return Controls(response).Cast<Dictionary<string,object>>().Single(c=>(string)c["name"]==name); }
  [STAThread] static int Main(string[] options) {
    var ui=new Thread(()=> {
      Window=new Form { Text="Orvix isolated desktop fixture",Width=460,Height=250 };
      var edit=new TextBox { AccessibleName="Document",Left=20,Top=20,Width=380 };
      var button=new Button { AccessibleName="Apply",Text="Apply",Left=20,Top=65,Width=100 };
      var label=new Label { AccessibleName="Ready",Text="Ready",Left=20,Top=110,Width=200 };
      var password=new TextBox { AccessibleName="Password",UseSystemPasswordChar=true,Left=20,Top=150,Width=200 };
      var visual=new Panel { AccessibleName="Visual fixture",Left=160,Top=65,Width=160,Height=40,BackColor=System.Drawing.Color.SteelBlue };
      visual.MouseClick+=(s,e)=> { label.Text="Visual clicked"; label.AccessibleName="Visual clicked"; };
      button.Click+=(s,e)=> { label.Text="Invoked"; label.AccessibleName="Invoked"; };
      Window.Controls.AddRange(new Control[] {edit,button,label,password,visual});
      Window.Shown+=(s,e)=> { WindowHandle=Window.Handle.ToInt64(); Ready.Set(); };
      Application.Run(Window);
    });
    ui.SetApartmentState(ApartmentState.STA); ui.Start();
    try {
      if(!Ready.WaitOne(10000)) throw new Exception("Fixture window failed to start");
      Check(WindowController.ExecuteAction("focus",WindowHandle,null,null).ok,"fixture focus");
      var observation=Map(DesktopController.Execute(true,Request("scope","page","target","current")));
      if ((string)observation["status"]!="ok") Console.Error.WriteLine(Json.Serialize(observation));
      Check((string)observation["status"]=="ok","native observation");
      Target=(string)((Dictionary<string,object>)observation["observation"])["windowRef"];
      Check(Target.EndsWith(":"+WindowHandle),"observation belongs to fixture");
      Check(!Controls(observation).Cast<Dictionary<string,object>>().Any(c=>(string)c["name"]=="Password"),"password controls excluded");
      string editRef=(string)Named(observation,"Document")["ref"];
      var typed=Map(DesktopController.Execute(false,Request("action","type","args",Request("ref",editRef,"text","Hello বাংলা","replace",true))));
      Check((string)typed["status"]=="ok","Unicode value entry verified");
      var expect=Request("kind","text","ref",Named(observation,"Ready")["ref"],"value","Invoked");
      var invoked=Map(DesktopController.Execute(false,Request("action","invoke","args",Request("ref",Named(observation,"Apply")["ref"]),"expect",expect)));
      Check((string)invoked["status"]=="ok","invoke and label outcome verified");
      observation=Map(DesktopController.Execute(true,Request("scope","page","target",Target,"screenshot",true)));
      Check((string)observation["status"]=="ok","foreground screenshot");
      var stale=Map(DesktopController.Execute(false,Request("action","type","args",Request("ref",editRef,"text","Wrong"))));
      Check((string)stale["status"]=="stale_target","old generation rejected");
      var data=(Dictionary<string,object>)observation["observation"];
      Target=(string)data["windowRef"];
      var outside=Map(DesktopController.Execute(false,Request("action","click","target",data["windowRef"],"args",Request("generation",data["generation"],"x",-1,"y",10))));
      Check((string)outside["status"]=="invalid_request","outside screenshot click rejected");
      System.Drawing.Point point=default(System.Drawing.Point);
      Window.Invoke(new Action(()=>point=Window.PointToScreen(new System.Drawing.Point(220,85))));
      var geometry=(Dictionary<string,object>)data["rect"];
      var visualResult=Map(DesktopController.Execute(false,Request("action","click","target",Target,"args",Request("generation",data["generation"],"x",point.X-Convert.ToDouble(geometry["x"]),"y",point.Y-Convert.ToDouble(geometry["y"])),"expect",Request("kind","text","ref",Named(observation,"Invoked")["ref"],"value","Visual clicked"))));
      if ((string)visualResult["status"]!="ok") Console.Error.WriteLine(Json.Serialize(visualResult));
      Check((string)visualResult["status"]=="ok","visual fallback state independently verified");
      DesktopController.Cancel("cancelled-fixture-request");
      var cancelled=Map(DesktopController.Execute(false,Request("requestId","cancelled-fixture-request","action","type","args",Request("ref",Named(observation,"Document")["ref"],"text","Wrong"))));
      Check((string)cancelled["status"]=="cancelled","native cancellation blocks queued input");
      var current=Named(observation,"Document");
      Check((string)current["value"]=="Hello বাংলা","fixture state independently observed");
      if(options.Contains("--apps")) foreach(string app in new [] {"Notepad","Calculator","File Explorer"}) {
        var launched=Map(DesktopController.Execute(false,Request("action","launch","appName",app)));
        if ((string)launched["status"]!="ok") Console.Error.WriteLine(Json.Serialize(launched));
        Check((string)launched["status"]=="ok",app+" launch verified");
        var native=Map(DesktopController.Execute(true,Request("scope","page","target",launched["resolvedTarget"])));
        for(int attempt=0;attempt<20 && ((string)native["status"]=="stale_target" || (string)native["status"]=="ok" && !Controls(native).Cast<object>().Any());attempt++) {
          Thread.Sleep(200);
          native=Map(DesktopController.Execute(true,Request("scope","page","target",launched["resolvedTarget"])));
        }
        if ((string)native["status"]!="ok") Console.Error.WriteLine(Json.Serialize(Request("status",native["status"],"message",native.ContainsKey("message")?native["message"]:"")));
        Check((string)native["status"]=="ok" && Controls(native).Cast<object>().Any(),app+" native controls observed");
      }
      return 0;
    } catch(Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    finally { if(Window!=null && Window.IsHandleCreated) Window.BeginInvoke(new Action(()=>Window.Close())); ui.Join(5000); }
  }
}
