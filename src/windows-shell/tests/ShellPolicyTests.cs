using System;
using System.Collections.Generic;
using System.Text;
using Kexu.Windows;

internal static class ShellPolicyTests
{
    private static int assertions;
    private static void Check(bool value, string name) { assertions++; if (!value) throw new Exception(name); }
    private static string Message(string filename, string text) { return ShellPolicy.Json().Serialize(new Dictionary<string, object> { {"type", "save-json"}, {"id", "f1cc9aec-1596-4b27-99d7-828319646828"}, {"filename", filename}, {"text", text} }); }
    private static void Rejected(string source, string json, string name) { bool rejected = false; try { ShellPolicy.ParseSaveRequest(source, ShellPolicy.Origin + "/focus", json); } catch { rejected = true; } Check(rejected, name); }
    public static void Main()
    {
        string origin = ShellPolicy.Origin;
        Check(ShellPolicy.IsAppDocument(origin + "/focus?x=1#y"), "app route");
        Check(ShellPolicy.IsAppDocument(origin + "/settings/"), "route slash");
        Check(!ShellPolicy.IsAppDocument(origin + "/unknown"), "route allowlist");
        Check(!ShellPolicy.IsAppOrigin("http://" + ShellPolicy.Host), "https required");
        Check(!ShellPolicy.IsAppOrigin(origin + ":444/focus"), "port boundary");
        Check(!ShellPolicy.IsAppOrigin("https://" + ShellPolicy.Host + ".evil.test/focus"), "suffix boundary");
        Check(!ShellPolicy.IsAppOrigin("https://evil@" + ShellPolicy.Host + "/focus"), "userinfo boundary");
        Check(!ShellPolicy.IsAppOrigin("https://" + ShellPolicy.Host + "."), "trailing dot boundary");
        Check(!ShellPolicy.IsExternalHttp("javascript:alert(1)"), "javascript blocked");
        Check(!ShellPolicy.IsExternalHttp("file:///E:/secret"), "file blocked");
        Check(!ShellPolicy.IsExternalHttp("ms-settings:privacy"), "custom protocol blocked");
        Check(ShellPolicy.IsExternalHttp("https://example.com/a"), "external https allowed");
        Check(!ShellPolicy.IsExternalHttp(origin), "app not external");
        var request = ShellPolicy.ParseSaveRequest(origin + "/focus", origin + "/focus", Message("课序-备份.json", "{\"schemaVersion\":2}"));
        Check(request.Filename == "课序-备份.json", "Unicode filename");
        Check(request.Text == "{\"schemaVersion\":2}", "exact JSON bytes retained");
        Rejected("https://evil.test", Message("a.json", "{}"), "foreign bridge denied");
        Rejected(origin + "/untrusted.html", Message("a.json", "{}"), "untrusted app path denied");
        foreach (string name in new[] { "../a.json", "x/a.json", "x\\a.json", "CON.json", "a.exe", " a.json", "a..json" }) Rejected(origin, Message(name, "{}"), "unsafe filename " + name);
        Rejected(origin, Message("a.json", "not-json"), "invalid JSON");
        Rejected(origin, Message("a.json", "null"), "null JSON");
        Rejected(origin, Message("a.json", "true"), "scalar JSON");
        Rejected(origin, Message("a.json", "{\"x\":\"" + new string('中', ShellPolicy.MaximumJsonBytes / 3 + 1) + "\"}"), "UTF8 byte bound");
        Rejected(origin, "{\"type\":\"eval\",\"id\":\"f1cc9aec-1596-4b27-99d7-828319646828\",\"filename\":\"a.json\",\"text\":\"{}\"}", "command allowlist");
        Rejected(origin, "{\"type\":\"save-json\",\"id\":\"bad\",\"filename\":\"a.json\",\"text\":\"{}\"}", "UUID required");
        Check(ShellPolicy.ParseSaveRequest(origin, origin, Message("a.json", "[]")) != null, "JSON array accepted");
        Console.WriteLine("PASS: " + assertions + " Windows shell policy assertions.");
    }
}
