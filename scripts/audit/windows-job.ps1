# Verifier-owned process containment. No installer/app files are modified.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
public static class OwnedJob {
  [StructLayout(LayoutKind.Sequential)] public struct Startup {
    public int cb; public IntPtr reserved, desktop, title;
    public int x,y,xSize,ySize,xChars,yChars,fill,flags; public short show,cbReserved;
    public IntPtr reserved2,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] public struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] public struct BasicLimits {
    public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active;
    public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Io { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] public struct Limits { public BasicLimits basic; public Io io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential)] public struct Accounting { public long a,b,c,d; public uint faults,total,active,terminated; }
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern IntPtr CreateJobObject(IntPtr attrs,string name);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool QueryInformationJobObject(IntPtr job,int kind,ref Accounting value,uint size,IntPtr returned);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] public static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateProcess(IntPtr process,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] public static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll")] public static extern uint WaitForSingleObject(IntPtr handle,uint ms);
  [DllImport("kernel32.dll")] public static extern bool GetExitCodeProcess(IntPtr process,out uint code);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int kind);
  public static void Check(bool ok) { if(!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  public static Task<string> ReadCommand() { return Task.Run(() => Console.In.ReadLine()); }
}
'@
$job = [IntPtr]::Zero
$info = New-Object OwnedJob+ProcessInfo
$envBlock = [IntPtr]::Zero
$resumed = $false
try {
  $config = [Console]::In.ReadLine() | ConvertFrom-Json
  if (!$config.executable -or !$config.commandLine -or !$config.cwd) { throw 'Missing owned launch configuration' }
  $job = [OwnedJob]::CreateJobObject([IntPtr]::Zero, $null)
  [OwnedJob]::Check($job -ne [IntPtr]::Zero)
  $limits = New-Object OwnedJob+Limits
  $basic = New-Object OwnedJob+BasicLimits
  $basic.flags = 0x2000 # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
  $limits.basic = $basic
  [OwnedJob]::Check([OwnedJob]::SetInformationJobObject($job,9,[ref]$limits,[Runtime.InteropServices.Marshal]::SizeOf($limits)))
  $entries = @($config.env.PSObject.Properties | Sort-Object Name | ForEach-Object { $_.Name + '=' + [string]$_.Value })
  $envBlock = [Runtime.InteropServices.Marshal]::StringToHGlobalUni(($entries -join [char]0) + [char]0 + [char]0)
  $startup = New-Object OwnedJob+Startup
  $startup.cb = [Runtime.InteropServices.Marshal]::SizeOf($startup)
  $startup.flags = 0x100 # STARTF_USESTDHANDLES
  $startup.output = [OwnedJob]::GetStdHandle(-11); $startup.error = [OwnedJob]::GetStdHandle(-12)
  [OwnedJob]::Check([OwnedJob]::CreateProcess($config.executable,[Text.StringBuilder]::new([string]$config.commandLine),[IntPtr]::Zero,[IntPtr]::Zero,$true,0x604,$envBlock,$config.cwd,[ref]$startup,[ref]$info))
  [OwnedJob]::Check([OwnedJob]::AssignProcessToJobObject($job,$info.process))
  [Console]::Out.WriteLine('[OWNED-JOB] ' + (@{ pid=$info.pid; executable=$config.executable; contained=$true } | ConvertTo-Json -Compress))
  if ([OwnedJob]::ResumeThread($info.thread) -eq [uint32]::MaxValue) { throw 'ResumeThread failed' }
  $resumed = $true
  $inputTask = [OwnedJob]::ReadCommand()
  $rootExited = $false; $exitCode = [uint32]0
  while ($true) {
    if (!$rootExited -and [OwnedJob]::WaitForSingleObject($info.process,0) -eq 0) {
      [OwnedJob]::Check([OwnedJob]::GetExitCodeProcess($info.process,[ref]$exitCode))
      $rootExited = $true
      [Console]::Out.WriteLine('[OWNED-ROOT-EXIT] ' + (@{ pid=$info.pid; code=$exitCode } | ConvertTo-Json -Compress))
    }
    $account = New-Object OwnedJob+Accounting
    [OwnedJob]::Check([OwnedJob]::QueryInformationJobObject($job,1,[ref]$account,[Runtime.InteropServices.Marshal]::SizeOf($account),[IntPtr]::Zero))
    if ($account.active -eq 0) {
      # The root can exit between our first check and the accounting query.
      if (!$rootExited) {
        if ([OwnedJob]::WaitForSingleObject($info.process,5000) -ne 0) { throw 'Empty job without root completion' }
        [OwnedJob]::Check([OwnedJob]::GetExitCodeProcess($info.process,[ref]$exitCode))
        $rootExited = $true
        [Console]::Out.WriteLine('[OWNED-ROOT-EXIT] ' + (@{ pid=$info.pid; code=$exitCode } | ConvertTo-Json -Compress))
      }
      break
    }
    if ($inputTask.IsCompleted) {
      # Only our parent owns this pipe. EOF also closes the job safely.
      [OwnedJob]::Check([OwnedJob]::TerminateJobObject($job,2))
      [Console]::Out.WriteLine('[OWNED-JOB-FORCED]')
      exit 2
    }
    Start-Sleep -Milliseconds 100
  }
  [Console]::Out.WriteLine('[OWNED-JOB-EMPTY]')
  exit $exitCode
} catch {
  [Console]::Error.WriteLine('[OWNED-JOB-ERROR] ' + $_.Exception.Message)
  exit 2
} finally {
  if (!$resumed -and $info.process -ne [IntPtr]::Zero) { [void][OwnedJob]::TerminateProcess($info.process,2) }
  if ($info.thread -ne [IntPtr]::Zero) { [void][OwnedJob]::CloseHandle($info.thread) }
  if ($info.process -ne [IntPtr]::Zero) { [void][OwnedJob]::CloseHandle($info.process) }
  if ($job -ne [IntPtr]::Zero) { [void][OwnedJob]::CloseHandle($job) }
  if ($envBlock -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($envBlock) }
}
