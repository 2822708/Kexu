using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using TangentTimetable;

internal static class DesktopSecurityTests
{
    private static int assertions;
    private static void Check(bool passed, string message)
    {
        assertions++;
        if (!passed) throw new Exception(message);
    }

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--listener")
        {
            TcpListener childListener = new TcpListener(IPAddress.Loopback, 0);
            childListener.Start();
            Console.WriteLine(((IPEndPoint)childListener.LocalEndpoint).Port);
            Console.Out.Flush();
            Console.ReadLine();
            childListener.Stop();
            return 0;
        }
        if (args.Length != 1) throw new ArgumentException("Pass an isolated test output directory");
        string directory = Path.GetFullPath(args[0]);
        Directory.CreateDirectory(directory);
        try
        {
            Check(DesktopSecurity.IsTrustedOrigin("http://127.0.0.1:17817/", 17817), "Expected loopback origin rejected");
            Check(DesktopSecurity.IsTrustedOrigin("http://127.0.0.1:17817/courses?week=3#today", 17817), "Application path rejected");
            string[] forbidden = { "https://127.0.0.1:17817/", "http://localhost:17817/", "http://127.0.0.1:17818/",
                "http://127.0.0.1:17817.evil.invalid/", "http://127.0.0.1:17817@evil.invalid/", "http://user@127.0.0.1:17817/",
                "http://127.1:17817/", "http://2130706433:17817/", "http://[::1]:17817/", "file:///index.html", "javascript:alert(1)", "about:blank", "data:text/html,test" };
            foreach (string value in forbidden) Check(!DesktopSecurity.IsTrustedOrigin(value, 17817), "Untrusted origin accepted: " + value);
            Check(!DesktopSecurity.IsExternalWebUrl("file:///secret"), "Native URI can escape browser policy");
            Check(!DesktopSecurity.IsExternalWebUrl("https://user:password@example.test"), "Credentials in external URI accepted");
            Check(DesktopSecurity.IsExternalWebUrl("https://example.test/path"), "HTTPS link rejected");
            string hostileKey = "test');throw new Error('injection');//\u2028</script>";
            string script = DesktopSecurity.LoginScript(hostileKey, 17817);
            File.WriteAllText(Path.Combine(directory, "login-script.js"), script);
            File.WriteAllText(Path.Combine(directory, "expected-key.txt"), hostileKey);
            Check(!script.Contains(hostileKey), "Legacy key embedded without escaping");

            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            Check(DesktopSecurity.IsOwnedLoopbackListener(port, Process.GetCurrentProcess().Id), "Actual current-process loopback listener not recognized");
            Check(!DesktopSecurity.IsOwnedLoopbackListener(port, 0), "Wrong PID accepted");
            bool conflict = false;
            try { DesktopSecurity.EnsurePortAvailable(port); } catch (InvalidOperationException) { conflict = true; }
            Check(conflict, "Occupied port accepted");
            listener.Stop();
            Check(!DesktopSecurity.IsOwnedLoopbackListener(port, Process.GetCurrentProcess().Id), "Closed listener still trusted");
            DesktopSecurity.EnsurePortAvailable(port);

            listener = new TcpListener(IPAddress.Any, 0);
            listener.Start();
            port = ((IPEndPoint)listener.LocalEndpoint).Port;
            Check(!DesktopSecurity.IsOwnedLoopbackListener(port, Process.GetCurrentProcess().Id), "Wildcard bind accepted");
            listener.Stop();

            ProcessStartInfo psi = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName, "--listener");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardInput = true;
            psi.RedirectStandardOutput = true;
            using (Process child = Process.Start(psi))
            {
                try
                {
                    port = int.Parse(child.StandardOutput.ReadLine());
                    Check(DesktopSecurity.IsOwnedLoopbackListener(port, child.Id), "Spawned process listener not recognized");
                    Check(!DesktopSecurity.IsOwnedLoopbackListener(port, Process.GetCurrentProcess().Id), "Foreign server reused");
                    child.StandardInput.WriteLine("quit");
                    Check(child.WaitForExit(5000), "Listener child did not stop");
                    Check(!DesktopSecurity.IsOwnedLoopbackListener(port, child.Id), "Exited process still trusted");
                }
                finally { if (!child.HasExited) child.Kill(); }
            }

            string keyDir = Path.Combine(directory, Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(keyDir);
            bool created;
            string key = AccountKeyStore.LoadOrCreate(keyDir, out created);
            Check(created && key.Length == 64, "First-run account not generated");
            Check(!File.ReadAllText(Path.Combine(keyDir, "desktop-key.dpapi")).Contains(key), "Account persisted in plaintext");
            Check(AccountKeyStore.LoadOrCreate(keyDir, out created) == key && !created, "DPAPI round-trip changed account");
            string legacyDir = Path.Combine(directory, Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(legacyDir);
            File.WriteAllText(Path.Combine(legacyDir, "desktop-key.txt"), hostileKey);
            Check(AccountKeyStore.LoadOrCreate(legacyDir, out created) == hostileKey && !created, "Legacy migration changed key");
            Check(!File.Exists(Path.Combine(legacyDir, "desktop-key.txt")), "Legacy plaintext left behind");
            File.WriteAllText(Path.Combine(legacyDir, "desktop-key.txt"), hostileKey);
            Check(AccountKeyStore.LoadOrCreate(legacyDir, out created) == hostileKey && !File.Exists(Path.Combine(legacyDir, "desktop-key.txt")), "Interrupted migration not completed");
            File.WriteAllText(Path.Combine(legacyDir, "desktop-key.dpapi"), "invalid");
            bool rejected = false;
            try { AccountKeyStore.LoadOrCreate(legacyDir, out created); } catch (InvalidDataException) { rejected = true; }
            Check(rejected, "Corrupt stored credential silently replaced");
            Console.WriteLine("PASS: " + assertions + " desktop security assertions");
            return 0;
        }
        catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
}
