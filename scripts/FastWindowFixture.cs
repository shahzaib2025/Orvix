using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using PcMonitorTest;

class FastWindowFixture {
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr handle);
  [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr handle);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [STAThread] static int Main() {
    Form window=null; IntPtr handle=IntPtr.Zero; var ready=new ManualResetEvent(false);
    var ui=new Thread(()=>{window=new Form {Text="Orvix quick window test",Width=360,Height=180};window.Shown+=(s,e)=>{handle=window.Handle;ready.Set();};Application.Run(window);});
    ui.SetApartmentState(ApartmentState.STA);ui.Start();
    try {
      if(!ready.WaitOne(10000))throw new Exception("Fixture did not open");
      foreach(var action in new[]{"minimize","maximize","focus"}) {
        var watch=Stopwatch.StartNew();var result=WindowController.ExecuteAction(action,handle.ToInt64(),null,null);watch.Stop();
        bool observed=action=="minimize"?IsIconic(handle):action=="maximize"?IsZoomed(handle):GetForegroundWindow()==handle;
        Console.WriteLine("{\"action\":\""+action+"\",\"elapsedMs\":"+watch.ElapsedMilliseconds+",\"nativeVerified\":"+result.verified.ToString().ToLowerInvariant()+",\"independentlyObserved\":"+observed.ToString().ToLowerInvariant()+"}");
        if(!result.verified||!observed||watch.ElapsedMilliseconds>1000)throw new Exception(action+" did not verify within one second");
      }
      return 0;
    } catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}
    finally {if(window!=null&&window.IsHandleCreated)window.BeginInvoke(new Action(()=>window.Close()));ui.Join(5000);}
  }
}
