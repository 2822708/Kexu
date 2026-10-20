using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Kexu
{
    // Kept independent of WebView2 so the trust boundary can be exercised without a UI.
    // Read-only protocol bytes from older packages; new output uses Kexu.
    internal static class LegacyIdentifiers
    {
        internal static readonly string DataDirectory = Ascii(84,97,110,103,101,110,116,84,105,109,101,116,97,98,108,101);
        internal static readonly byte[] KeyEntropy = Encoding.ASCII.GetBytes(Ascii(84,97,110,103,101,110,116,84,105,109,101,116,97,98,108,101,46,100,101,115,107,116,111,112,45,107,101,121,46,118,49));
        private static string Ascii(params byte[] bytes) { return Encoding.ASCII.GetString(bytes); }
    }

    internal static class DesktopSecurity
    {
        internal static string DefaultDataDirectory(string applicationDirectory, string localApplicationData)
        {
            string current = Path.Combine(applicationDirectory, "Data");
            string prior = Path.Combine(localApplicationData, LegacyIdentifiers.DataDirectory);
            return !Directory.Exists(current) && Directory.Exists(prior) ? prior : current;
        }

        internal static string Origin(int port) { return "http://127.0.0.1:" + port; }

        internal static bool IsTrustedOrigin(string value, int port)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri)
                && uri.Scheme == Uri.UriSchemeHttp
                && uri.UserInfo.Length == 0
                && uri.Authority == "127.0.0.1:" + port
                && value.StartsWith(Origin(port) + "/", StringComparison.Ordinal);
        }

        internal static bool IsExternalWebUrl(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri)
                && uri.UserInfo.Length == 0
                && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps);
        }

        internal static string ScriptString(string value)
        {
            // Escape every UTF-16 code unit, including quotes, HTML delimiters and line separators.
            StringBuilder result = new StringBuilder("'");
            foreach (char c in value) result.Append("\\u").Append(((int)c).ToString("x4"));
            return result.Append("'").ToString();
        }

        internal static string LoginScript(string key, int port)
        {
            return "try{if(window.top===window&&location.origin===" + ScriptString(Origin(port))
                + "){localStorage.setItem('timetable.apiKey'," + ScriptString(key)
                + ");localStorage.setItem('timetable.apiLabel'," + ScriptString("管理员") + ");}}catch(e){}";
        }

        internal static void EnsurePortAvailable(int port)
        {
            TcpListener probe = new TcpListener(IPAddress.Loopback, port);
            probe.Server.ExclusiveAddressUse = true;
            try { probe.Start(); }
            catch (SocketException ex)
            {
                throw new InvalidOperationException("本机端口 " + port
                    + " 已被其它程序占用。桌面版不会连接未知本机服务，请关闭占用该端口的程序后重试。", ex);
            }
            finally { probe.Stop(); }
        }

        [DllImport("iphlpapi.dll", SetLastError = true)]
        private static extern uint GetExtendedTcpTable(IntPtr table, ref int size,
            bool order, int family, int tableClass, uint reserved);

        // IPv4 OWNER_PID_LISTENER table: state, local address, local port, remote address,
        // remote port, owning PID. A wildcard listener is rejected even when owned by Java.
        internal static bool IsOwnedLoopbackListener(int port, int processId)
        {
            int size = 0;
            const int afInet = 2, ownerPidListener = 3, rowSize = 24;
            uint result = GetExtendedTcpTable(IntPtr.Zero, ref size, false, afInet, ownerPidListener, 0);
            if (result != 122 || size < 4) return false;
            IntPtr table = Marshal.AllocHGlobal(size);
            try
            {
                if (GetExtendedTcpTable(table, ref size, false, afInet, ownerPidListener, 0) != 0) return false;
                int count = Marshal.ReadInt32(table);
                bool found = false;
                for (int i = 0; i < count; i++)
                {
                    int offset = 4 + i * rowSize;
                    if (offset + rowSize > size) return false;
                    int encodedPort = Marshal.ReadInt32(table, offset + 8);
                    int localPort = ((encodedPort & 255) << 8) | ((encodedPort >> 8) & 255);
                    if (localPort != port) continue;
                    byte[] address = BitConverter.GetBytes(Marshal.ReadInt32(table, offset + 4));
                    if (!new IPAddress(address).Equals(IPAddress.Loopback)
                        || Marshal.ReadInt32(table, offset + 20) != processId) return false;
                    found = true;
                }
                return found;
            }
            finally { Marshal.FreeHGlobal(table); }
        }
    }

    internal static class AccountKeyStore
    {
        private const string Prefix = "DPAPI2:";
        private const string LegacyPrefix = "DPAPI1:";
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Kexu.desktop-key.v1");

        internal static string LoadOrCreate(string directory, out bool created)
        {
            created = false;
            string path = Path.Combine(directory, "desktop-key.dpapi");
            string legacy = Path.Combine(directory, "desktop-key.txt");
            string key;
            if (File.Exists(path))
            {
                string value = File.ReadAllText(path).Trim();
                bool legacyProtected = value.StartsWith(LegacyPrefix, StringComparison.Ordinal);
                if (!value.StartsWith(Prefix, StringComparison.Ordinal) && !legacyProtected)
                    throw new InvalidDataException("本机账号凭据格式无法识别。请保留数据目录并联系维护人员。");
                try
                {
                    byte[] plain = ProtectedData.Unprotect(Convert.FromBase64String(value.Substring(legacyProtected ? LegacyPrefix.Length : Prefix.Length)),
                        legacyProtected ? LegacyIdentifiers.KeyEntropy : Entropy, DataProtectionScope.CurrentUser);
                    try { key = Encoding.UTF8.GetString(plain); }
                    finally { Array.Clear(plain, 0, plain.Length); }
                }
                catch (CryptographicException ex)
                {
                    throw new InvalidOperationException("无法解密本机账号凭据，请使用创建该账号的 Windows 用户登录。", ex);
                }
                catch (FormatException ex)
                {
                    throw new InvalidDataException("本机账号凭据格式无法识别，请保留原文件并联系维护人员。", ex);
                }
                Validate(key);
                if (legacyProtected) StoreProtected(path, key, true);
                // Also finish a migration interrupted after the atomic protected-file write.
                if (File.Exists(legacy) && File.ReadAllText(legacy).Trim() == key) File.Delete(legacy);
                return key;
            }
            if (File.Exists(legacy)) key = File.ReadAllText(legacy).Trim();
            else
            {
                byte[] bytes = new byte[32];
                using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) { rng.GetBytes(bytes); }
                key = BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant();
                created = true;
            }
            Validate(key);
            StoreProtected(path, key, false);
            if (File.Exists(legacy)) File.Delete(legacy);
            return key;
        }

        private static void StoreProtected(string path, string key, bool replace)
        {
            byte[] encrypted = ProtectedData.Protect(Encoding.UTF8.GetBytes(key), Entropy, DataProtectionScope.CurrentUser);
            string temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, Prefix + Convert.ToBase64String(encrypted), Encoding.ASCII);
                if (replace) File.Replace(temporary, path, null);
                else File.Move(temporary, path);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }

        private static void Validate(string key)
        {
            if (string.IsNullOrWhiteSpace(key) || key.Length > 255 || key.IndexOfAny(new char[] { '\r', '\n', '\0' }) >= 0)
                throw new InvalidDataException("本机账号凭据无效，请保留原文件并联系维护人员。");
        }
    }
}
