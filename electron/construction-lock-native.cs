using System;
using System.IO;
using System.Collections.Generic;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.ComponentModel;
using System.Xml;
using System.Text;

public class OrvixDeniedAttempt { public string id, at, path, process, access; }
public class OrvixAccessProbe { public string path, identity; public int identityError, readError, writeError; }

public static class OrvixConstruction {
    // OPEN_EXISTING only: requesting access does not read, write, create or delete data.
    static int AccessError(string target, uint access) {
        using (var handle=CreateFile(target,access,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
            return handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
        }
    }
    public static OrvixAccessProbe AccessProbe(string target) {
        var result=new OrvixAccessProbe {path=target};
        using (var handle=CreateFile(target,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
            FileInformation value;
            if (handle.IsInvalid) result.identityError=Marshal.GetLastWin32Error();
            else if (!GetFileInformationByHandle(handle,out value)) result.identityError=Marshal.GetLastWin32Error();
            else result.identity=value.Volume.ToString("X8")+":"+value.IndexHigh.ToString("X8")+value.IndexLow.ToString("X8");
        }
        result.readError=AccessError(target,1);
        result.writeError=AccessError(target,2|4|0x100|0x10000);
        return result;
    }
    public static void ReplaceJournal(string source, string destination) {
        // PowerShell converts an untyped $null string argument to an empty path.
        // Call File.Replace here so its optional backup path is a genuine CLR null.
        File.Replace(source,destination,null);
    }
    [StructLayout(LayoutKind.Sequential)] struct Luid { public uint Low; public int High; }
    [StructLayout(LayoutKind.Sequential)] struct TokenPrivileges { public uint Count; public Luid Id; public uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] struct AuditPolicy { public Guid Subcategory; public uint Flags; public Guid Category; }
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr value);
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool LookupPrivilegeValue(string system, string name, out Luid id);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool AdjustTokenPrivileges(IntPtr token, bool disable, ref TokenPrivileges privileges, uint length, IntPtr previous, IntPtr returned);
    [DllImport("advapi32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.U1)] static extern bool AuditQuerySystemPolicy(ref Guid id, uint count, out IntPtr policy);
    [DllImport("advapi32.dll", SetLastError=true)] [return:MarshalAs(UnmanagedType.U1)] static extern bool AuditSetSystemPolicy(ref AuditPolicy policy, uint count);
    [DllImport("advapi32.dll")] static extern void AuditFree(IntPtr value);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [StructLayout(LayoutKind.Sequential)] struct FileInformation { public uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh, WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow; }
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation information);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder name, uint size, uint flags);
    static Guid FileSystemAudit = new Guid("0cce921d-69ae-11d9-bed3-505054503030");
    public static void EnableAuditPrivilege() {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), 0x28, out token)) throw new Win32Exception();
        try {
            Luid id; if (!LookupPrivilegeValue(null, "SeSecurityPrivilege", out id)) throw new Win32Exception();
            var p = new TokenPrivileges { Count=1, Id=id, Attributes=2 };
            if (!AdjustTokenPrivileges(token, false, ref p, 0, IntPtr.Zero, IntPtr.Zero) || Marshal.GetLastWin32Error()!=0) throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally { CloseHandle(token); }
    }
    public static uint AuditFlags() {
        IntPtr ptr;
        if (!AuditQuerySystemPolicy(ref FileSystemAudit, 1, out ptr)) throw new Win32Exception();
        try { return ((AuditPolicy)Marshal.PtrToStructure(ptr, typeof(AuditPolicy))).Flags; } finally { AuditFree(ptr); }
    }
    public static void SetAuditFlags(uint flags) {
        var p = new AuditPolicy { Subcategory=FileSystemAudit, Flags=flags==0 ? 4u : flags };
        if (!AuditSetSystemPolicy(ref p, 1)) throw new Win32Exception();
    }
    public static bool Within(string candidate, string root) {
        candidate=Path.GetFullPath(candidate).TrimEnd('\\'); root=Path.GetFullPath(root).TrimEnd('\\');
        return candidate.Equals(root,StringComparison.OrdinalIgnoreCase) || candidate.StartsWith(root+"\\",StringComparison.OrdinalIgnoreCase);
    }
    public static void ValidateTarget(string target, string[] forbidden) {
        if (String.IsNullOrWhiteSpace(target) || target.StartsWith("\\") || target.Length>240 || !Path.IsPathRooted(target) || target.Substring(2).Contains(":")) throw new Exception("Choose a normal absolute local path (no network, device or alternate stream paths).");
        target=Path.GetFullPath(target);
        if (target.TrimEnd('\\').Equals(Path.GetPathRoot(target).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase)) throw new Exception("A drive root cannot be restricted.");
        var drive=new DriveInfo(Path.GetPathRoot(target));
        if (drive.DriveType!=DriveType.Fixed || !drive.DriveFormat.Equals("NTFS",StringComparison.OrdinalIgnoreCase)) throw new Exception("Construction Lock requires a local NTFS drive.");
        foreach (string root in forbidden) if (!String.IsNullOrWhiteSpace(root) && (Within(target,root) || Within(root,target))) throw new Exception("Choose a work file or folder outside Windows, application, profile and recovery locations.");
        string ancestor=target;
        while (!String.IsNullOrEmpty(ancestor)) {
            if ((File.GetAttributes(ancestor)&FileAttributes.ReparsePoint)!=0) throw new Exception("Links, junctions and their descendants cannot be restricted.");
            ancestor=Path.GetDirectoryName(ancestor);
        }
        using (var handle=CreateFile(target,0,7,IntPtr.Zero,3,0x02000000,IntPtr.Zero)) {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            var name=new StringBuilder(1024); uint count=GetFinalPathNameByHandle(handle,name,1024,0);
            if (count==0 || count>=1024) throw new Win32Exception(Marshal.GetLastWin32Error());
            string canonical=name.ToString(); if (canonical.StartsWith("\\\\?\\")) canonical=canonical.Substring(4);
            if (!canonical.Equals(target,StringComparison.OrdinalIgnoreCase)) throw new Exception("Choose the canonical path, without short names, links or aliases.");
        }
    }
    public static string[] Entries(string[] targets) {
        var result=new List<string>();
        foreach (string target in targets) Walk(target,result);
        return result.ToArray();
    }
    static void Walk(string target, List<string> result) {
        var attr=File.GetAttributes(target);
        if ((attr&FileAttributes.ReparsePoint)!=0) throw new Exception("Remove links or junctions from the selected folder before locking it.");
        result.Add(target); if (result.Count>2000) throw new Exception("Select at most 2,000 files and folders in one lock.");
        if ((attr&FileAttributes.Directory)!=0) foreach (string child in Directory.GetFileSystemEntries(target)) Walk(child,result);
    }
    public static FileSystemSecurity Security(string target, bool audit) {
        var sections=AccessControlSections.Access | (audit ? AccessControlSections.Audit : 0);
        return Directory.Exists(target) ? (FileSystemSecurity)Directory.GetAccessControl(target,sections) : File.GetAccessControl(target,sections);
    }
    public static string Snapshot(string target, bool audit) {
        return Security(target,audit).GetSecurityDescriptorSddlForm(AccessControlSections.Access | (audit ? AccessControlSections.Audit : 0));
    }
    static void Save(string target, FileSystemSecurity acl) {
        if (acl is DirectorySecurity) Directory.SetAccessControl(target,(DirectorySecurity)acl); else File.SetAccessControl(target,(FileSecurity)acl);
    }
    public static FileSystemRights Rights(string mode) {
        if (mode!="read_write" && mode!="write") throw new Exception("Choose read/write or write protection.");
        var rights=FileSystemRights.WriteData | FileSystemRights.AppendData | FileSystemRights.WriteExtendedAttributes | FileSystemRights.WriteAttributes | FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles;
        if (mode=="read_write") rights |= FileSystemRights.ReadData | FileSystemRights.ReadExtendedAttributes | FileSystemRights.ExecuteFile;
        return rights;
    }
    public static void Restrict(string target, string sid, string mode, bool audit) {
        var acl=Security(target,audit); var identity=new SecurityIdentifier(sid);
        var inherit=acl is DirectorySecurity ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None;
        acl.AddAccessRule(new FileSystemAccessRule(identity,Rights(mode),inherit,PropagationFlags.None,AccessControlType.Deny));
        if (audit) acl.AddAuditRule(new FileSystemAuditRule(identity,Rights(mode),inherit,PropagationFlags.None,System.Security.AccessControl.AuditFlags.Failure));
        Save(target,acl);
    }
    public static void Restore(string target, string sddl, bool audit) {
        // Construct a descriptor without reading file contents or changing its owner.
        FileSystemSecurity acl=Directory.Exists(target) ? (FileSystemSecurity)new DirectorySecurity() : new FileSecurity();
        acl.SetSecurityDescriptorSddlForm(sddl,AccessControlSections.Access | (audit ? AccessControlSections.Audit : 0));
        Save(target,acl);
    }
    public static void Probe(string target) {
        if (!Directory.Exists(target)) using (var file=new FileStream(target,FileMode.Open,FileAccess.Read,FileShare.None)) { }
    }
    public static SafeFileHandle Guard(string target) {
        // Keep delete/rename sharing closed, including delete allowed by the parent directory.
        var handle=CreateFile(target,0,3,IntPtr.Zero,3,0x02000000,IntPtr.Zero);
        if (handle.IsInvalid) { int error=Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
        FileInformation information;
        if (!GetFileInformationByHandle(handle,out information)) { int error=Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
        if (information.Links>1) { handle.Dispose(); throw new Exception("Files with multiple hard links cannot be restricted."); }
        return handle;
    }
    static string Text(XmlDocument doc, string name) { var nodes=doc.GetElementsByTagName(name); return nodes.Count==0 ? "" : nodes[0].InnerText; }
    public static OrvixDeniedAttempt AttemptFromXml(string payload, string sid, string[] targets, string id) {
        var doc=new XmlDocument(); doc.XmlResolver=null; doc.LoadXml(payload);
        if (Text(doc,"EventID")!="4656" || (Convert.ToUInt64(Text(doc,"Keywords"),16)&0x0010000000000000UL)==0) return null;
        var fields=new Dictionary<string,string>();
        foreach (XmlNode node in doc.GetElementsByTagName("Data")) if (node.Attributes["Name"]!=null) fields[node.Attributes["Name"].Value]=node.InnerText;
        string account, target;
        if (!fields.TryGetValue("SubjectUserSid",out account) || account!=sid || !fields.TryGetValue("ObjectName",out target) || target.Length<3 || target[1]!=':' || target[2]!='\\') return null;
        bool matched=false; foreach (string root in targets) if (Within(target,root)) { matched=true; break; }
        if (!matched) return null;
        string process, access; fields.TryGetValue("ProcessName",out process); fields.TryGetValue("AccessMask",out access);
        var times=doc.GetElementsByTagName("TimeCreated");
        return new OrvixDeniedAttempt { id=id+"-"+Text(doc,"EventRecordID"), at=times.Count==0 ? DateTime.UtcNow.ToString("o") : times[0].Attributes["SystemTime"].Value, path=target, process=process, access=access };
    }
}
