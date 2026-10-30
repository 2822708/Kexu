using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace Kexu.Windows
{
    internal static class ShellPolicy
    {
        internal const string Host = "appassets.androidplatform.net";
        internal const string Origin = "https://" + Host;
        internal const int MaximumJsonBytes = 11 * 1024 * 1024;
        private static readonly HashSet<string> Routes = new HashSet<string>(StringComparer.Ordinal) {
            "/", "/index.html", "/focus", "/tasks", "/timetable", "/todos", "/ai", "/settings", "/manual", "/import"
        };

        internal static bool IsAppOrigin(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri)
                && uri.Scheme == Uri.UriSchemeHttps && uri.IdnHost == Host
                && uri.Port == 443 && uri.UserInfo.Length == 0;
        }

        internal static bool IsAppDocument(string value)
        {
            Uri uri;
            return IsAppOrigin(value) && Uri.TryCreate(value, UriKind.Absolute, out uri)
                && Routes.Contains(uri.AbsolutePath.TrimEnd('/').Length == 0 ? "/" : uri.AbsolutePath.TrimEnd('/'));
        }

        internal static bool IsExternalHttp(string value)
        {
            Uri uri;
            return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.UserInfo.Length == 0
                && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
                && !IsAppOrigin(value);
        }

        internal static JavaScriptSerializer Json()
        {
            return new JavaScriptSerializer { MaxJsonLength = MaximumJsonBytes * 2, RecursionLimit = 100 };
        }

        internal static SaveRequest ParseSaveRequest(string source, string currentSource, string json)
        {
            if (!IsAppDocument(source) || !IsAppDocument(currentSource)) throw new InvalidDataException("Untrusted document.");
            if (json == null || json.Length > MaximumJsonBytes * 2 || Encoding.UTF8.GetByteCount(json) > MaximumJsonBytes * 2)
                throw new InvalidDataException("Message too large.");
            Dictionary<string, object> value = Json().DeserializeObject(json) as Dictionary<string, object>;
            if (value == null || value.Count != 4) throw new InvalidDataException("Invalid message.");
            string type = ReadString(value, "type"), id = ReadString(value, "id");
            string filename = ReadString(value, "filename"), text = ReadString(value, "text");
            Guid guid;
            if (type != "save-json" || !Guid.TryParseExact(id, "D", out guid)) throw new InvalidDataException("Invalid request.");
            if (filename.Length < 6 || filename.Length > 120 || !filename.EndsWith(".json", StringComparison.OrdinalIgnoreCase)
                || filename.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || filename.IndexOf('/') >= 0 || filename.IndexOf('\\') >= 0
                || filename.IndexOf("..", StringComparison.Ordinal) >= 0 || filename.Trim() != filename
                || Regex.IsMatch(filename, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)", RegexOptions.IgnoreCase))
                throw new InvalidDataException("Invalid JSON filename.");
            if (Encoding.UTF8.GetByteCount(text) > MaximumJsonBytes) throw new InvalidDataException("JSON exceeds 11 MiB.");
            object document = Json().DeserializeObject(text);
            if (!(document is Dictionary<string, object>) && !(document is object[])) throw new InvalidDataException("JSON object or array required.");
            return new SaveRequest { Id = id, Filename = filename, Text = text };
        }

        private static string ReadString(Dictionary<string, object> value, string key)
        {
            object result;
            if (!value.TryGetValue(key, out result) || !(result is string)) throw new InvalidDataException("Missing field.");
            return (string)result;
        }
    }

    internal sealed class SaveRequest
    {
        internal string Id;
        internal string Filename;
        internal string Text;
    }
}
