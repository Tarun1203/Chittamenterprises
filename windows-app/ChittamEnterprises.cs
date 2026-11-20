// Chittam Enterprises - Windows app (2.0).
//
// The Chittam app in its own window, using Microsoft's WebView2 (the Edge
// engine built into Windows). Sign-in and offline data are kept between runs.
// WhatsApp and other outside links open in the normal browser / app.
//
// Sharp at any display scaling: the app tells Windows it handles 125% / 150%
// itself (app.manifest + the call in Main). Without that Windows stretched
// the window, which made the page blurry and showed a second mouse cursor.
//
// Tally sync is built in and keeps running in the tray (near the clock):
//  - balances: each company's Sundry Debtors closing balances, so Payment
//    Updated / Payment Reminder / Balance Confirmation fill them in;
//  - stock: each stock item's closing quantity (both companies; the app adds
//    them up, since goods bought in one book are often sold in the other);
//  - open invoices: bill-wise outstanding with due dates, for Payment
//    Reminder;
//  - customers and products: new Tally debtors are added as customers (with
//    their mobile), new stock items as products (group + price); a customer
//    without a mobile gets Tally's; a product's price follows Tally only
//    when Tally has a selling price for it (its rate is the purchase cost);
//  - new financial year: when Tally has a newer company of the same name open
//    ("… - 2027" next to "… - 2026") that already has customer balances,
//    the sync moves to it by itself;
//  - transactions: the last N days of vouchers that involve a customer
//    (receipts, sales, credit notes, journals), so the app's Tally Match page
//    can match payments with Tally and point out possible duplicates.
// Each is uploaded only when it changed, and each upload is written to the
// app's History. The app page talks to this window (status, Sync now, Sync
// settings) through WebView2's message channel.
//
// Updates itself: checks desktop/version.json on the site at start-up and every
// 6 hours, downloads changed files (SHA-256 checked) into
// %LOCALAPPDATA%\ChittamEnterprises\update, and installs them when the app next
// starts or from the tray (Restart to update).
//
// Posting receipts: from Tally Match, a payment recorded in the app can be
// posted to Tally as a Receipt voucher - only from this window, and only
// after a confirmation here showing the whole voucher.
//
// Settings live in %APPDATA%\ChittamEnterprises\settings.json; the sync
// password is encrypted with Windows DPAPI for the current Windows user.
//
// Build with build.ps1 (uses the C# compiler that ships with Windows).
// Written for C# 5 / .NET Framework 4.x, which that compiler supports.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Xml;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8")]
[assembly: System.Reflection.AssemblyTitle("Chittam Enterprises")]
[assembly: System.Reflection.AssemblyProduct("Chittam Enterprises")]
[assembly: System.Reflection.AssemblyCompany("Chittam Enterprises")]
// keep in step with Program.DesktopVersion (build.ps1 checks)
[assembly: System.Reflection.AssemblyVersion("3.4.0.0")]
[assembly: System.Reflection.AssemblyFileVersion("3.4")]

namespace ChittamEnterprises
{
    static class Program
    {
        public const string AppUrl = "https://tarun1203.github.io/Chittamenterprises/next/";
        public const string ClassicUrl = "https://tarun1203.github.io/Chittamenterprises/";
        // where new versions of this program are published (desktop/ folder of the site)
        public const string UpdateUrl = "https://tarun1203.github.io/Chittamenterprises/desktop/version.json";
        public const string DesktopVersion = "3.4";

        [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main(string[] args)
        {
            // per-monitor DPI awareness (the manifest says the same; this covers
            // a copy started without it)
            try { if (!SetProcessDpiAwarenessContext(new IntPtr(-4))) SetProcessDPIAware(); } catch { try { SetProcessDPIAware(); } catch { } }

            bool created;
            using (var mutex = new Mutex(true, "ChittamEnterprises_SingleInstance", out created))
            {
                if (!created)
                {
                    // already running: ask that copy to show its window
                    NativeShow.Signal();
                    return;
                }
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                bool startHidden = args.Any(a => a.Equals("/tray", StringComparison.OrdinalIgnoreCase));
                // a downloaded update waiting? install it and start the new version instead
                if (Updater.ApplyIfReady(startHidden)) return;
                Application.Run(new MainForm(startHidden));
            }
        }
    }

    // a second launch tells the running copy to come to the front
    static class NativeShow
    {
        static readonly string EventName = "ChittamEnterprises_Show";
        public static void Signal()
        {
            try { using (var e = EventWaitHandle.OpenExisting(EventName)) e.Set(); } catch { }
        }
        public static EventWaitHandle Create()
        {
            return new EventWaitHandle(false, EventResetMode.AutoReset, EventName);
        }
    }

    // Windows 11 title bar colour / rounded corners
    static class Dwm
    {
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);
        static int Rgb(Color c) { return c.R | (c.G << 8) | (c.B << 16); }
        public static void Style(IntPtr hwnd, Color caption, Color text)
        {
            try
            {
                int v = Rgb(caption); DwmSetWindowAttribute(hwnd, 35, ref v, 4);   // caption colour
                v = Rgb(text); DwmSetWindowAttribute(hwnd, 36, ref v, 4);          // caption text
                v = Rgb(caption); DwmSetWindowAttribute(hwnd, 34, ref v, 4);       // border
                v = 2; DwmSetWindowAttribute(hwnd, 33, ref v, 4);                  // round corners
            }
            catch { }
        }
    }

    // ------------------------------------------------------------------ updates
    static class Updater
    {
        public static string Folder { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChittamEnterprises", "update"); } }
        static string ReadyFile { get { return Path.Combine(Folder, "ready.txt"); } }
        public static string Status = "";   // shown in the tray and in the app

        static bool Newer(string v)
        {
            Version a, b;
            return Version.TryParse(v, out a) && Version.TryParse(Program.DesktopVersion, out b) && a > b;
        }

        public static string ReadyVersion()
        {
            try { if (File.Exists(ReadyFile)) { var v = File.ReadAllText(ReadyFile).Trim(); if (Newer(v)) return v; } } catch { }
            return null;
        }

        static string Sha256(string path)
        {
            using (var sha = SHA256.Create()) using (var f = File.OpenRead(path))
                return BitConverter.ToString(sha.ComputeHash(f)).Replace("-", "").ToLowerInvariant();
        }

        // downloads a newer version's changed files, checks them, and marks them ready
        public static void Check(Action<string> log)
        {
            try
            {
                string json;
                using (var wc = new WebClient()) { wc.Headers[HttpRequestHeader.CacheControl] = "no-cache"; json = wc.DownloadString(Program.UpdateUrl + "?t=" + DateTime.UtcNow.Ticks); }
                var info = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(json);
                var version = Convert.ToString(info["version"]);
                if (!Newer(version)) { Status = ""; return; }
                if (ReadyVersion() == version) { Status = "Version " + version + " is ready — restart to update"; return; }
                var appDir = Path.GetDirectoryName(Application.ExecutablePath);
                var dir = Path.Combine(Folder, version);
                if (Directory.Exists(dir)) Directory.Delete(dir, true);
                Directory.CreateDirectory(dir);
                var baseUrl = Program.UpdateUrl.Substring(0, Program.UpdateUrl.LastIndexOf('/') + 1);
                int n = 0;
                foreach (Dictionary<string, object> f in (System.Collections.ArrayList)info["files"])
                {
                    var name = Convert.ToString(f["name"]); var sha = Convert.ToString(f["sha256"]).ToLowerInvariant();
                    if (name.IndexOfAny(new[] { '/', '\\', ':' }) >= 0 || name.Contains("..")) throw new Exception("bad file name in version.json: " + name);
                    var local = Path.Combine(appDir, name);
                    if (File.Exists(local) && Sha256(local) == sha) continue;   // unchanged
                    var target = Path.Combine(dir, name);
                    using (var wc = new WebClient()) wc.DownloadFile(baseUrl + Uri.EscapeDataString(name) + "?v=" + version, target);
                    if (Sha256(target) != sha) throw new Exception(name + " did not match its checksum");
                    n++;
                }
                File.WriteAllText(Path.Combine(Folder, "ready.txt"), version);
                Status = "Version " + version + " is ready — restart to update";
                log("Update " + version + " downloaded (" + n + " file" + (n == 1 ? "" : "s") + ", checked). It installs when the app restarts.");
            }
            catch (Exception ex) { log("Update check: " + ex.Message); }
        }

        // copies the waiting files over this program once it has closed, then starts it again
        public static bool ApplyIfReady(bool startHidden)
        {
            var v = ReadyVersion();
            if (v == null) return false;
            try
            {
                var dir = Path.Combine(Folder, v);
                if (!Directory.Exists(dir)) { File.Delete(ReadyFile); return false; }
                var exe = Application.ExecutablePath;
                var appDir = Path.GetDirectoryName(exe);
                var script = Path.Combine(Folder, "install.ps1");
                Func<string, string> q = x => "'" + x.Replace("'", "''") + "'";
                File.WriteAllText(script,
                    "$ErrorActionPreference = 'SilentlyContinue'\r\n" +
                    "Wait-Process -Id " + Process.GetCurrentProcess().Id + " -Timeout 30\r\n" +
                    "Start-Sleep -Milliseconds 700\r\n" +
                    "Copy-Item -Path (Join-Path " + q(dir) + " '*') -Destination " + q(appDir) + " -Force\r\n" +
                    "Remove-Item -LiteralPath " + q(Path.Combine(Folder, "ready.txt")) + " -Force\r\n" +
                    "Remove-Item -LiteralPath " + q(dir) + " -Recurse -Force\r\n" +
                    "Start-Process -FilePath " + q(exe) + (startHidden ? " -ArgumentList '/tray'" : "") + "\r\n", Encoding.UTF8);
                Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + script + "\"")
                    { CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = false });
                return true;
            }
            catch { return false; }
        }
    }

    // ------------------------------------------------------------------ settings
    class ExtraCompany { public string Key = ""; public string Label = ""; public string Company = ""; public string SyncFrom = ""; }

    class Settings
    {
        public string Email = "";
        public string PasswordProtected = "";      // DPAPI, base64
        // encryption key (from the company passphrase), DPAPI-protected, and the salt it belongs to
        public string EncKeyProtected = "";
        public string EncSalt = "";
        [ScriptIgnore]
        public byte[] EncKey
        {
            get
            {
                if (string.IsNullOrEmpty(EncKeyProtected)) return null;
                try { return ProtectedData.Unprotect(Convert.FromBase64String(EncKeyProtected), null, DataProtectionScope.CurrentUser); }
                catch { return null; }
            }
            set { EncKeyProtected = value == null ? "" : Convert.ToBase64String(ProtectedData.Protect(value, null, DataProtectionScope.CurrentUser)); }
        }
        public string BusinessCompany = "Chittam Enterprises - 2026";
        public string BusinessLabel = "Chittam Enterprises";
        public string CashCompany = "Cash";
        public string CashLabel = "Cash Bill";
        // more Tally companies, handled like the two above: Key is permanent (payments refer to it),
        // Label is the name the app shows, Company is the company's name in Tally
        public List<ExtraCompany> ExtraCompanies = new List<ExtraCompany>();
        // transactions are sent from this date (yyyy-MM-dd); blank = from 1 April, or the last N days
        public string BusinessSyncFrom = "";
        public string CashSyncFrom = "";
        public string SyncFromFor(string key)
        {
            if (key == "business") return BusinessSyncFrom ?? "";
            if (key == "cash") return CashSyncFrom ?? "";
            var x = (ExtraCompanies ?? new List<ExtraCompany>()).FirstOrDefault(e => e.Key == key);
            return x == null ? "" : x.SyncFrom ?? "";
        }

        // every company the app knows: [key, Tally company, name shown in the app]
        public List<string[]> AllCompanies()
        {
            var list = new List<string[]> { new[] { "business", BusinessCompany, BusinessLabel }, new[] { "cash", CashCompany, CashLabel } };
            foreach (var x in ExtraCompanies ?? new List<ExtraCompany>())
                if (!string.IsNullOrEmpty(x.Key) && !string.IsNullOrEmpty(x.Company)) list.Add(new[] { x.Key, x.Company, string.IsNullOrEmpty(x.Label) ? x.Company : x.Label });
            return list;
        }
        public string CompanyFor(string key) { var c = AllCompanies().FirstOrDefault(x => x[0] == key); return c == null ? "" : c[1]; }
        public string LabelFor(string key) { var c = AllCompanies().FirstOrDefault(x => x[0] == key); return c == null ? key : c[2]; }
        public void SetCompany(string key, string company)
        {
            if (key == "business") BusinessCompany = company;
            else if (key == "cash") CashCompany = company;
            else { var x = (ExtraCompanies ?? new List<ExtraCompany>()).FirstOrDefault(e => e.Key == key); if (x != null) x.Company = company; }
        }
        public int IntervalMinutes = 30;
        public bool SyncVouchers = true;
        public int VoucherDays = 90;
        public bool SyncStock = true;
        public bool SyncBills = true;
        public bool SyncMasters = true;   // customers + products
        public string TallyUrl = "http://localhost:9000";
        public string ProjectId = "chittam-enterprises";
        public string ApiKey = "AIzaSyCEk9hKMJzA05DdB0axSJ4k76-Jl9acmjc";
        public Dictionary<string, string> LastHash = new Dictionary<string, string>();
        public Dictionary<string, string> LastStatus = new Dictionary<string, string>();

        public static string Folder
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ChittamEnterprises"); }
        }
        static string FilePath { get { return Path.Combine(Folder, "settings.json"); } }
        // settings saved by the earlier "Chittam Tally Sync" program
        static string OldFilePath
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ChittamTallySync", "settings.json"); }
        }

        [ScriptIgnore]   // only the encrypted form is ever written to disk
        public string Password
        {
            get
            {
                if (string.IsNullOrEmpty(PasswordProtected)) return "";
                try
                {
                    var raw = ProtectedData.Unprotect(Convert.FromBase64String(PasswordProtected), null, DataProtectionScope.CurrentUser);
                    return Encoding.UTF8.GetString(raw);
                }
                catch { return ""; }
            }
            set
            {
                PasswordProtected = string.IsNullOrEmpty(value) ? "" :
                    Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(value), null, DataProtectionScope.CurrentUser));
            }
        }

        [ScriptIgnore]
        public bool Configured { get { return Email.Length > 0 && Password.Length > 0; } }

        public static Settings Load()
        {
            foreach (var path in new[] { FilePath, OldFilePath })
            {
                try
                {
                    if (File.Exists(path))
                    {
                        var text = File.ReadAllText(path, Encoding.UTF8);
                        var s = new JavaScriptSerializer().Deserialize<Settings>(text);
                        if (s.LastHash == null) s.LastHash = new Dictionary<string, string>();
                        if (s.LastStatus == null) s.LastStatus = new Dictionary<string, string>();
                        // settings saved by version 1.0 have no transaction options: turn them on
                        if (!text.Contains("\"SyncVouchers\"")) { s.SyncVouchers = true; s.VoucherDays = 90; }
                        if (s.VoucherDays < 7) s.VoucherDays = 90;
                        // settings saved before 2.2 have no stock / invoice options: turn them on
                        if (!text.Contains("\"SyncStock\"")) { s.SyncStock = true; s.SyncBills = true; }
                        if (!text.Contains("\"SyncMasters\"")) s.SyncMasters = true;
                        return s;
                    }
                }
                catch { }
            }
            return new Settings();
        }

        public void Save()
        {
            Directory.CreateDirectory(Folder);
            File.WriteAllText(FilePath, new JavaScriptSerializer().Serialize(this), Encoding.UTF8);
        }
    }

    // ------------------------------------------------------------------ Tally
    class Voucher
    {
        public string Date, Type, Number, Party, Narration, Id;
        public string Via = "";   // the other ledger(s): Cash, a bank, Sales… (how it was booked)
        public double Amount;
        public bool Debit;   // the customer's ledger was debited (sale) rather than credited (receipt)
    }

    class StockLine { public string Name, Unit, Group = ""; public double Qty, Rate, SellingPrice; }
    class Debtor { public string Name, Mobile; }
    class Creditor { public string Name, Parent; public double Closing; }
    class Bill { public string Party, Ref, Date, Due; public double Amount; public int Overdue; }

    static class Tally
    {
        static string Post(string url, string xml)
        {
            using (var wc = new WebClient())
            {
                wc.Headers[HttpRequestHeader.ContentType] = "text/xml; charset=utf-8";
                byte[] bytes;
                try { bytes = wc.UploadData(url, "POST", Encoding.UTF8.GetBytes(xml)); }
                catch (Exception) { throw new Exception("Tally is not reachable at " + url + " - is Tally open?"); }
                return Clean(bytes);
            }
        }

        // Tally replies in UTF-16 or UTF-8 and sometimes with characters XML does not allow
        public static string Clean(byte[] bytes)
        {
            string text = (bytes.Length >= 2 && ((bytes[0] == 0xFF && bytes[1] == 0xFE) || bytes[1] == 0))
                ? Encoding.Unicode.GetString(bytes) : Encoding.UTF8.GetString(bytes);
            text = text.TrimStart('﻿');
            text = Regex.Replace(text, "&#(0*[0-8]|0*1[1-2]|0*1[4-9]|0*2[0-9]|0*3[01]);", "");
            text = Regex.Replace(text, "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "");
            // custom (UDF) fields come with a namespace prefix that isn't declared: keep them as plain names
            text = Regex.Replace(text, "(</?)([A-Za-z]\\w*):(?=[A-Za-z_])", "$1$2_");
            var err = Regex.Match(text, "<LINEERROR>(.*?)</LINEERROR>");
            if (err.Success) throw new Exception("Tally: " + WebUtility.HtmlDecode(err.Groups[1].Value));
            return text;
        }

        public static List<string> Companies(string url)
        {
            var xml = Post(url, "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE>" +
                "<ID>List of Companies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                "</STATICVARIABLES></DESC></BODY></ENVELOPE>");
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            var list = new List<string>();
            foreach (XmlElement e in doc.SelectNodes("//COMPANY"))
            {
                var n = e.GetAttribute("NAME");
                if (!string.IsNullOrEmpty(n) && !list.Contains(n)) list.Add(n);
            }
            return list;
        }

        static double Num(string s)
        {
            if (string.IsNullOrEmpty(s)) return 0;
            var m = Regex.Match(s.Replace(",", ""), "-?\\d+(\\.\\d+)?");
            return m.Success ? double.Parse(m.Value, CultureInfo.InvariantCulture) : 0;
        }

        // same rule as the app's normalizeName(): trim, lower case, single spaces
        public static string Normalize(string s)
        {
            return Regex.Replace((s ?? "").Trim().ToLowerInvariant(), "\\s+", " ");
        }

        // normalized name -> receivable, plus normalized name -> name as in Tally
        public static void Balances(string url, string company, out Dictionary<string, double> balances, out Dictionary<string, string> names)
        {
            var xml = Post(url, "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC>" +
                "<REPORTNAME>Group Summary</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                "<SVCURRENTCOMPANY>" + System.Security.SecurityElement.Escape(company) + "</SVCURRENTCOMPANY>" +
                "<GROUPNAME>Sundry Debtors</GROUPNAME><EXPLODEFLAG>Yes</EXPLODEFLAG>" +
                "</STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>");
            ParseBalances(xml, out balances, out names);
        }

        public static void ParseBalances(string xml, out Dictionary<string, double> balances, out Dictionary<string, string> names)
        {
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            balances = new Dictionary<string, double>();
            names = new Dictionary<string, string>();
            foreach (XmlNode n in doc.SelectNodes("//DSPACCNAME"))
            {
                XmlNode info = n.NextSibling;
                while (info != null && info.Name != "DSPACCINFO" && info.Name != "DSPACCNAME") info = info.NextSibling;
                if (info == null || info.Name != "DSPACCINFO") continue;
                var nameNode = n.SelectSingleNode("DSPDISPNAME");
                if (nameNode == null) continue;
                var name = nameNode.InnerText.Trim();
                if (name.Length == 0) continue;
                var dr = info.SelectSingleNode("DSPCLDRAMT/DSPCLDRAMTA");
                var cr = info.SelectSingleNode("DSPCLCRAMT/DSPCLCRAMTA");
                // Tally shows debit as negative: receivable = -(debit) - credit
                double amount = Math.Round(-Num(dr == null ? "" : dr.InnerText) - Num(cr == null ? "" : cr.InnerText), 2);
                var k = Normalize(name);
                balances[k] = amount;
                names[k] = name;
            }
        }

        // every stock item's closing quantity
        public static List<StockLine> Stock(string url, string company)
        {
            var xml = Post(url, "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ChittamStock</ID></HEADER>" +
                "<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                "<SVCURRENTCOMPANY>" + System.Security.SecurityElement.Escape(company) + "</SVCURRENTCOMPANY></STATICVARIABLES>" +
                "<TDL><TDLMESSAGE><COLLECTION NAME=\"ChittamStock\" ISMODIFY=\"No\"><TYPE>StockItem</TYPE>" +
                "<FETCH>Name, Parent, BaseUnits, ClosingBalance, ClosingRate, StandardPriceList</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>");
            return ParseStock(xml);
        }

        public static List<StockLine> ParseStock(string xml)
        {
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            var list = new List<StockLine>();
            foreach (XmlElement e in doc.SelectNodes("//STOCKITEM"))
            {
                var name = e.GetAttribute("NAME").Trim();
                if (name.Length == 0) continue;
                var unit = Text(e, "BASEUNITS");
                var cb = Text(e, "CLOSINGBALANCE");
                // selling price: the latest standard price entry with a rate
                double sp = 0;
                foreach (XmlNode pl in e.SelectNodes("STANDARDPRICELIST.LIST"))
                {
                    var r = Num(Text(pl, "RATE").Split('/')[0]);
                    if (r > 0) sp = r;
                }
                list.Add(new StockLine { Name = name, Unit = unit, Qty = Num(cb), Group = Text(e, "PARENT"),
                    Rate = Num(Text(e, "CLOSINGRATE").Split('/')[0]), SellingPrice = sp });
            }
            return list;
        }

        // the ledgers money can be received into: Cash-in-Hand and Bank Accounts
        public static List<string> CashBankLedgers(string url, string company) { return CashBank(url, company).Select(x => x[0]).ToList(); }

        // [name, "cash" | "bank"] for every Cash-in-Hand / Bank Accounts ledger
        public static List<string[]> CashBank(string url, string company)
        {
            var list = new List<string[]>();
            foreach (var grp in new[] { "$$GroupCash", "$$GroupBank" })
            {
                var xml = Post(url, "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ChittamCashBank</ID></HEADER>" +
                    "<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                    "<SVCURRENTCOMPANY>" + System.Security.SecurityElement.Escape(company) + "</SVCURRENTCOMPANY></STATICVARIABLES>" +
                    "<TDL><TDLMESSAGE><COLLECTION NAME=\"ChittamCashBank\" ISMODIFY=\"No\"><TYPE>Ledger</TYPE>" +
                    "<CHILDOF>" + grp + "</CHILDOF><BELONGSTO>Yes</BELONGSTO><FETCH>Name</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>");
                var doc = new XmlDocument();
                doc.LoadXml(xml);
                foreach (XmlElement e in doc.SelectNodes("//LEDGER"))
                {
                    var n = e.GetAttribute("NAME").Trim();
                    if (n.Length > 0 && !list.Any(x => x[0] == n)) list.Add(new[] { n, grp == "$$GroupBank" ? "bank" : "cash" });
                }
            }
            return list;
        }

        // creates one Receipt voucher (customer credited, cash / bank debited), "On Account"
        // against the customer's bills; returns null when Tally created it, else Tally's reason
        public class BillPart { public string Ref; public double Amount; }
        public class BankDetails { public string Type, Number, Bank; public DateTime Date; }

        public static string PostReceipt(string url, string company, DateTime date, string party, string intoLedger, double amount, string narration)
        { return PostReceipt(url, company, date, party, intoLedger, amount, narration, null, null, null, null); }

        // bills: amounts against the customer's invoices (Agst Ref); the rest goes On Account.
        // bank: instrument details for a bank ledger (Tally's bank allocation)
        // receipts posted from the app use this voucher type (under Receipt), so they stand out in the Day Book
        public const string AppReceiptType = "App Receipt";

        // numbering method of a voucher type, or null if the company doesn't have it
        public static string VoucherTypeNumbering(string url, string company, string name)
        {
            Func<string, string> x = t0 => System.Security.SecurityElement.Escape(t0 ?? "");
            var xml = Post(url, "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ChittamVchTypes</ID></HEADER>" +
                "<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVCURRENTCOMPANY>" + x(company) + "</SVCURRENTCOMPANY></STATICVARIABLES>" +
                "<TDL><TDLMESSAGE><COLLECTION NAME=\"ChittamVchTypes\" ISMODIFY=\"No\"><TYPE>VoucherType</TYPE><FETCH>Name, NumberingMethod</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>");
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            foreach (XmlElement e in doc.SelectNodes("//VOUCHERTYPE"))
                if (string.Equals(e.GetAttribute("NAME").Trim(), name, StringComparison.OrdinalIgnoreCase)) return Text(e, "NUMBERINGMETHOD");
            return null;
        }

        // create the "App Receipt" voucher type once, numbered like the company's own Receipt type
        public static string CreateAppReceiptType(string url, string company)
        {
            Func<string, string> x = t0 => System.Security.SecurityElement.Escape(t0 ?? "");
            string numbering = VoucherTypeNumbering(url, company, "Receipt");
            if (string.IsNullOrEmpty(numbering)) numbering = "Automatic";
            var xml = "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>" +
                "<STATICVARIABLES><SVCURRENTCOMPANY>" + x(company) + "</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" +
                "<TALLYMESSAGE xmlns:UDF=\"TallyUDF\"><VOUCHERTYPE NAME=\"" + AppReceiptType + "\" ACTION=\"Create\">" +
                "<NAME.LIST><NAME>" + AppReceiptType + "</NAME></NAME.LIST><PARENT>Receipt</PARENT>" +
                "<NUMBERINGMETHOD>" + x(numbering) + "</NUMBERINGMETHOD><ISACTIVE>Yes</ISACTIVE>" +
                "</VOUCHERTYPE></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>";
            string res;
            try { res = Post(url, xml); } catch (Exception ex) { return ex.Message; }
            var created = Regex.Match(res, "<CREATED>\\s*(\\d+)\\s*</CREATED>");
            if (created.Success && created.Groups[1].Value != "0") return null;
            var err = Regex.Match(res, "<LINEERROR>(.*?)</LINEERROR>");
            return err.Success ? WebUtility.HtmlDecode(err.Groups[1].Value) : "Tally did not create the voucher type.";
        }

        public static string PostReceipt(string url, string company, DateTime date, string party, string intoLedger, double amount, string narration,
            List<BillPart> bills, BankDetails bank, string restType, string restRef)
        { return PostReceipt(url, company, date, party, intoLedger, amount, narration, bills, bank, restType, restRef, "Receipt"); }

        public static string PostReceipt(string url, string company, DateTime date, string party, string intoLedger, double amount, string narration,
            List<BillPart> bills, BankDetails bank, string restType, string restRef, string vchType)
        {
            if (string.IsNullOrEmpty(vchType)) vchType = "Receipt";
            // the amount beyond the bills: On Account, or a New Ref / Advance under its own reference
            if (restType != "New Ref" && restType != "Advance") restType = "On Account";
            if (restType != "On Account" && string.IsNullOrEmpty(restRef)) restType = "On Account";
            Func<string, string> x = v => System.Security.SecurityElement.Escape(v ?? "");
            Func<double, string> f2 = v => v.ToString("0.00", CultureInfo.InvariantCulture);
            string amt = f2(amount);
            var allocs = new StringBuilder();
            double against = 0;
            foreach (var b in (bills ?? new List<BillPart>()).Where(b => b.Amount > 0 && !string.IsNullOrEmpty(b.Ref)))
            {
                allocs.Append("<BILLALLOCATIONS.LIST><NAME>" + x(b.Ref) + "</NAME><BILLTYPE>Agst Ref</BILLTYPE><AMOUNT>" + f2(b.Amount) + "</AMOUNT></BILLALLOCATIONS.LIST>");
                against += b.Amount;
            }
            double rest = Math.Round(amount - against, 2);
            if (rest > 0.004) allocs.Append("<BILLALLOCATIONS.LIST><NAME>" + x(restType == "On Account" ? "On Account" : restRef) + "</NAME><BILLTYPE>" + restType + "</BILLTYPE><AMOUNT>" + f2(rest) + "</AMOUNT></BILLALLOCATIONS.LIST>");
            var bankXml = bank == null ? "" :
                "<BANKALLOCATIONS.LIST><DATE>" + date.ToString("yyyyMMdd") + "</DATE><INSTRUMENTDATE>" + bank.Date.ToString("yyyyMMdd") + "</INSTRUMENTDATE>" +
                "<TRANSACTIONTYPE>" + x(bank.Type) + "</TRANSACTIONTYPE><PAYMENTFAVOURING>" + x(party) + "</PAYMENTFAVOURING>" +
                "<INSTRUMENTNUMBER>" + x(bank.Number) + "</INSTRUMENTNUMBER><BANKNAME>" + x(bank.Bank) + "</BANKNAME><BANKPARTYNAME>" + x(party) + "</BANKPARTYNAME>" +
                "<AMOUNT>-" + amt + "</AMOUNT></BANKALLOCATIONS.LIST>";
            var xml = "<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>" +
                "<STATICVARIABLES><SVCURRENTCOMPANY>" + x(company) + "</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC><REQUESTDATA>" +
                "<TALLYMESSAGE xmlns:UDF=\"TallyUDF\"><VOUCHER VCHTYPE=\"" + x(vchType) + "\" ACTION=\"Create\">" +
                "<DATE>" + date.ToString("yyyyMMdd") + "</DATE><EFFECTIVEDATE>" + date.ToString("yyyyMMdd") + "</EFFECTIVEDATE>" +
                "<VOUCHERTYPENAME>" + x(vchType) + "</VOUCHERTYPENAME><PARTYLEDGERNAME>" + x(party) + "</PARTYLEDGERNAME>" +
                "<NARRATION>" + x(narration) + "</NARRATION>" +
                "<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + x(party) + "</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISPARTYLEDGER>Yes</ISPARTYLEDGER><AMOUNT>" + amt + "</AMOUNT>" +
                allocs + "</ALLLEDGERENTRIES.LIST>" +
                "<ALLLEDGERENTRIES.LIST><LEDGERNAME>" + x(intoLedger) + "</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-" + amt + "</AMOUNT>" + bankXml + "</ALLLEDGERENTRIES.LIST>" +
                "</VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>";
            string res;
            try { res = Post(url, xml); } catch (Exception ex) { return ex.Message; }
            var created = Regex.Match(res, "<CREATED>\\s*(\\d+)\\s*</CREATED>");
            if (created.Success && created.Groups[1].Value != "0") return null;
            var errs = Regex.Matches(res, "<LINEERROR>(.*?)</LINEERROR>").Cast<Match>().Select(m => WebUtility.HtmlDecode(m.Groups[1].Value)).ToList();
            return errs.Count > 0 ? string.Join("; ", errs) : "Tally did not create the voucher (" + Regex.Replace(res, "\\s+", " ").Trim().Substring(0, Math.Min(200, Regex.Replace(res, "\\s+", " ").Trim().Length)) + ")";
        }

        // customer ledgers (everything under Sundry Debtors) with their mobile numbers
        public static List<Debtor> Debtors(string url, string company)
        {
            var xml = Post(url, "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ChittamDebtors</ID></HEADER>" +
                "<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                "<SVCURRENTCOMPANY>" + System.Security.SecurityElement.Escape(company) + "</SVCURRENTCOMPANY></STATICVARIABLES>" +
                "<TDL><TDLMESSAGE><COLLECTION NAME=\"ChittamDebtors\" ISMODIFY=\"No\"><TYPE>Ledger</TYPE>" +
                "<CHILDOF>$$GroupSundryDebtors</CHILDOF><BELONGSTO>Yes</BELONGSTO>" +
                "<FETCH>Name, LedgerMobile, LedgerPhone</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>");
            return ParseDebtors(xml);
        }

        // ledgers under Sundry Creditors (and its sub-groups), with their closing balance (Tally: negative = Dr)
        public static List<Creditor> Creditors(string url, string company)
        {
            var xml = Post(url, "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ChittamCreditors</ID></HEADER>" +
                "<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                "<SVCURRENTCOMPANY>" + System.Security.SecurityElement.Escape(company) + "</SVCURRENTCOMPANY></STATICVARIABLES>" +
                "<TDL><TDLMESSAGE><COLLECTION NAME=\"ChittamCreditors\" ISMODIFY=\"No\"><TYPE>Ledger</TYPE>" +
                "<CHILDOF>$$GroupSundryCreditors</CHILDOF><BELONGSTO>Yes</BELONGSTO>" +
                "<FETCH>Name, Parent, ClosingBalance</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>");
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            var list = new List<Creditor>();
            foreach (XmlElement e in doc.SelectNodes("//LEDGER"))
            {
                var name = e.GetAttribute("NAME").Trim();
                if (name.Length > 0) list.Add(new Creditor { Name = name, Parent = Text(e, "PARENT"), Closing = Num(Text(e, "CLOSINGBALANCE")) });
            }
            return list;
        }

        public static List<Debtor> ParseDebtors(string xml)
        {
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            var list = new List<Debtor>();
            foreach (XmlElement e in doc.SelectNodes("//LEDGER"))
            {
                var name = e.GetAttribute("NAME").Trim();
                if (name.Length == 0 || Regex.IsMatch(name, "bank a/c", RegexOptions.IgnoreCase)) continue;
                list.Add(new Debtor { Name = name, Mobile = CleanMobile(Text(e, "LEDGERMOBILE")) ?? CleanMobile(Text(e, "LEDGERPHONE")) ?? "" });
            }
            return list;
        }

        // a 10-digit Indian mobile, or null (same rules as the app's Tally import)
        static string CleanMobile(string s)
        {
            var d = Regex.Replace(s ?? "", "\\D", "");
            if (d.Length == 12 && d.StartsWith("91")) d = d.Substring(2);
            if (d.Length == 11 && d.StartsWith("0")) d = d.Substring(1);
            return d.Length == 10 ? d : null;
        }

        // Tally's dates in reports look like 1-Apr-25 or 01-Apr-2025
        static string IsoDate(string s)
        {
            DateTime d;
            if (DateTime.TryParseExact((s ?? "").Trim(), new[] { "d-MMM-yy", "d-MMM-yyyy", "dd-MMM-yy", "dd-MMM-yyyy", "yyyyMMdd" },
                CultureInfo.InvariantCulture, DateTimeStyles.None, out d)) return d.ToString("yyyy-MM-dd");
            return "";
        }

        // open invoices (bill-wise outstanding) of all customers, as on a date
        public static List<Bill> Bills(string url, string company, DateTime asOn)
        {
            var xml = Post(url, "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC>" +
                "<REPORTNAME>Bills Receivable</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                "<SVCURRENTCOMPANY>" + System.Security.SecurityElement.Escape(company) + "</SVCURRENTCOMPANY>" +
                "<SVTODATE>" + asOn.ToString("yyyyMMdd") + "</SVTODATE></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>");
            return ParseBills(xml);
        }

        public static List<Bill> ParseBills(string xml)
        {
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            var list = new List<Bill>();
            foreach (XmlNode f in doc.SelectNodes("//BILLFIXED"))
            {
                var b = new Bill { Party = Text(f, "BILLPARTY"), Ref = Text(f, "BILLREF"), Date = IsoDate(Text(f, "BILLDATE")) };
                // the amounts follow BILLFIXED as siblings, up to the next BILLFIXED
                for (var n = f.NextSibling; n != null && n.Name != "BILLFIXED"; n = n.NextSibling)
                {
                    if (n.Name == "BILLCL") b.Amount = Math.Round(-Num(n.InnerText), 2);   // debit (owed to us) is negative
                    else if (n.Name == "BILLDUE") b.Due = IsoDate(n.InnerText);
                    else if (n.Name == "BILLOVERDUE") b.Overdue = (int)Num(n.InnerText);
                }
                if (b.Party.Length > 0 && b.Amount != 0) list.Add(b);
            }
            return list;
        }

        // vouchers between two dates that involve one of the given customer
        // ledgers (debtors), from Tally's Day Book
        public static List<Voucher> Vouchers(string url, string company, DateTime from, DateTime to, ICollection<string> debtorKeys)
        {
            // read straight from the vouchers, filtered by date: the Day Book report
            // follows whatever period / view is open on Tally's screen, so it can come back empty
            string f = from.ToString("d-MMM-yyyy", CultureInfo.InvariantCulture), t = to.ToString("d-MMM-yyyy", CultureInfo.InvariantCulture);
            var xml = Post(url, "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ChittamVouchers</ID></HEADER>" +
                "<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                "<SVCURRENTCOMPANY>" + System.Security.SecurityElement.Escape(company) + "</SVCURRENTCOMPANY>" +
                "<SVFROMDATE>" + from.ToString("yyyyMMdd") + "</SVFROMDATE><SVTODATE>" + to.ToString("yyyyMMdd") + "</SVTODATE></STATICVARIABLES>" +
                "<TDL><TDLMESSAGE><COLLECTION NAME=\"ChittamVouchers\" ISMODIFY=\"No\"><TYPE>Voucher</TYPE>" +
                "<FETCH>Date, VoucherTypeName, VoucherNumber, PartyLedgerName, Narration, GUID, MasterID, IsCancelled, IsOptional, " +
                "AllLedgerEntries.LedgerName, AllLedgerEntries.Amount, LedgerEntries.LedgerName, LedgerEntries.Amount</FETCH>" +
                "<FILTER>ChittamInRange</FILTER></COLLECTION>" +
                "<SYSTEM TYPE=\"Formulae\" NAME=\"ChittamInRange\">$Date &gt;= $$Date:\"" + f + "\" AND $Date &lt;= $$Date:\"" + t + "\"</SYSTEM>" +
                "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>");
            return ParseVouchers(xml, debtorKeys);
        }

        // one voucher in full (items, taxes, addresses, bills, bank details), to print it like Tally
        public static Dictionary<string, object> VoucherDetail(string url, string company, string guid, DateTime date)
        {
            Func<string, string> x = t0 => System.Security.SecurityElement.Escape(t0 ?? "");
            var xml = Post(url, "<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>ChittamVoucher</ID></HEADER>" +
                "<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                "<SVCURRENTCOMPANY>" + x(company) + "</SVCURRENTCOMPANY>" +
                "<SVFROMDATE>" + date.ToString("yyyyMMdd") + "</SVFROMDATE><SVTODATE>" + date.ToString("yyyyMMdd") + "</SVTODATE></STATICVARIABLES>" +
                "<TDL><TDLMESSAGE><COLLECTION NAME=\"ChittamVoucher\" ISMODIFY=\"No\"><TYPE>Voucher</TYPE>" +
                "<FETCH>*, AllInventoryEntries.*, AllLedgerEntries.*, LedgerEntries.*</FETCH><FILTER>ChittamThisVoucher</FILTER></COLLECTION>" +
                "<SYSTEM TYPE=\"Formulae\" NAME=\"ChittamThisVoucher\">$GUID = \"" + x(guid).Replace("\"", "") + "\"</SYSTEM>" +
                "</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>");
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            XmlNode v = doc.SelectSingleNode("//VOUCHER[ALLINVENTORYENTRIES.LIST or ALLLEDGERENTRIES.LIST or LEDGERENTRIES.LIST]");
            if (v == null) throw new Exception("Voucher not found in Tally (" + company + ").");
            Func<XmlNode, string, List<string>> lines = (n, path) => { var l = new List<string>(); foreach (XmlNode a in n.SelectNodes(path)) if (a.InnerText.Trim().Length > 0) l.Add(a.InnerText.Trim()); return l; };
            Func<string, string> iso = d => d.Length == 8 ? d.Substring(0, 4) + "-" + d.Substring(4, 2) + "-" + d.Substring(6, 2) : "";
            var r = new Dictionary<string, object>();
            string vtype = Text(v, "VOUCHERTYPENAME");
            if (vtype.Length == 0 && v.Attributes["VCHTYPE"] != null) vtype = v.Attributes["VCHTYPE"].Value;
            r["type"] = vtype; r["number"] = Text(v, "VOUCHERNUMBER"); r["date"] = iso(Text(v, "DATE"));
            r["party"] = Text(v, "PARTYLEDGERNAME");
            r["buyer"] = Text(v, "BASICBUYERNAME").Length > 0 ? Text(v, "BASICBUYERNAME") : Text(v, "PARTYMAILINGNAME");
            r["address"] = lines(v, "BASICBUYERADDRESS.LIST/BASICBUYERADDRESS").Count > 0 ? lines(v, "BASICBUYERADDRESS.LIST/BASICBUYERADDRESS") : lines(v, "ADDRESS.LIST/ADDRESS");
            r["gstin"] = Text(v, "PARTYGSTIN"); r["state"] = Text(v, "STATENAME"); r["pincode"] = Text(v, "PARTYPINCODE");
            r["placeOfSupply"] = Text(v, "PLACEOFSUPPLY");
            r["consignee"] = Text(v, "CONSIGNEEMAILINGNAME"); r["consigneeGstin"] = Text(v, "CONSIGNEEGSTIN"); r["consigneeState"] = Text(v, "CONSIGNEESTATENAME");
            r["consigneeAddress"] = lines(v, "BASICCONSIGNEEADDRESS.LIST/BASICCONSIGNEEADDRESS");
            r["cmpGstin"] = Text(v, "CMPGSTIN"); r["cmpState"] = Text(v, "CMPGSTSTATE");
            r["reference"] = Text(v, "REFERENCE"); r["referenceDate"] = iso(Text(v, "REFERENCEDATE"));
            r["orderRef"] = Text(v, "BASICORDERREF"); r["terms"] = Text(v, "BASICDUEDATEOFPYMT");
            r["dispatchDoc"] = Text(v, "BASICSHIPDOCUMENTNO"); r["dispatchedThrough"] = Text(v, "BASICSHIPPEDBY");
            r["destination"] = Text(v, "BASICFINALDESTINATION"); r["vehicle"] = Text(v, "BASICSHIPVESSELNO");
            r["ewayBill"] = Text(v, "EWAYBILLNO"); r["irn"] = Text(v, "IRN");
            r["narration"] = Text(v, "NARRATION");
            // items
            var items = new List<object>(); var itemLedgers = new HashSet<string>();
            foreach (XmlNode i in v.SelectNodes("ALLINVENTORYENTRIES.LIST[STOCKITEMNAME!='']"))
            {
                string qty = Text(i, "BILLEDQTY").Length > 0 ? Text(i, "BILLEDQTY") : Text(i, "ACTUALQTY");
                var qm = Regex.Match(qty, "(-?[\\d.,]+)\\s*(.*)");
                string rate = Text(i, "RATE"); var rm = Regex.Match(rate, "(-?[\\d.,]+)\\s*/?\\s*(.*)");
                double gst = 0;
                foreach (XmlNode d in i.SelectNodes(".//RATEDETAILS.LIST"))
                    if (Text(d, "GSTRATEDUTYHEAD") == "IGST") gst = Num(Text(d, "GSTRATE"));
                foreach (XmlNode a in i.SelectNodes("ACCOUNTINGALLOCATIONS.LIST")) itemLedgers.Add(Normalize(Text(a, "LEDGERNAME")));
                var desc = lines(i, "BASICUSERDESCRIPTION.LIST/BASICUSERDESCRIPTION");
                items.Add(new Dictionary<string, object> {
                    { "name", Text(i, "STOCKITEMNAME") }, { "desc", desc }, { "hsn", Text(i, "GSTHSNNAME") },
                    { "qty", qm.Success ? Math.Abs(Num(qm.Groups[1].Value)) : 0 }, { "unit", qm.Success ? qm.Groups[2].Value.Trim() : "" },
                    { "rate", rm.Success ? Num(rm.Groups[1].Value) : 0 }, { "per", rm.Success ? rm.Groups[2].Value.Trim() : "" },
                    { "discount", Num(Text(i, "DISCOUNT")) }, { "amount", Math.Abs(Num(Text(i, "AMOUNT"))) }, { "gst", gst } });
            }
            r["items"] = items;
            // ledger lines (the party's own line marked); bills and bank details where present
            var entries = v.SelectNodes("ALLLEDGERENTRIES.LIST[LEDGERNAME!='']");
            if (entries.Count == 0) entries = v.SelectNodes("LEDGERENTRIES.LIST[LEDGERNAME!='']");
            var ledgers = new List<object>();
            foreach (XmlNode e in entries)
            {
                string ln = Text(e, "LEDGERNAME");
                var bills = new List<object>();
                foreach (XmlNode b in e.SelectNodes("BILLALLOCATIONS.LIST[NAME!='']"))
                    bills.Add(new Dictionary<string, object> { { "name", Text(b, "NAME") }, { "type", Text(b, "BILLTYPE") }, { "amount", Num(Text(b, "AMOUNT")) } });
                var banks = new List<object>();
                foreach (XmlNode b in e.SelectNodes("BANKALLOCATIONS.LIST"))
                    if (Text(b, "TRANSACTIONTYPE").Length + Text(b, "INSTRUMENTNUMBER").Length + Text(b, "BANKNAME").Length > 0)
                    banks.Add(new Dictionary<string, object> { { "type", Text(b, "TRANSACTIONTYPE") }, { "number", Text(b, "INSTRUMENTNUMBER") },
                        { "date", iso(Text(b, "INSTRUMENTDATE")) }, { "bank", Text(b, "BANKNAME") } });
                ledgers.Add(new Dictionary<string, object> {
                    { "name", ln }, { "amount", Num(Text(e, "AMOUNT")) }, { "party", Text(v, "PARTYLEDGERNAME").Length > 0 ? Normalize(ln) == Normalize(Text(v, "PARTYLEDGERNAME")) : Text(e, "ISPARTYLEDGER") == "Yes" },
                    { "itemLedger", itemLedgers.Contains(Normalize(ln)) }, { "bills", bills }, { "bank", banks } });
            }
            r["ledgers"] = ledgers;
            return r;
        }

        static string Text(XmlNode v, string tag)
        {
            var n = v.SelectSingleNode(tag);
            return n == null ? "" : n.InnerText.Trim();
        }

        public static List<Voucher> ParseVouchers(string xml, ICollection<string> debtorKeys)
        {
            var doc = new XmlDocument();
            doc.LoadXml(xml);
            var list = new List<Voucher>();
            foreach (XmlNode v in doc.SelectNodes("//VOUCHER"))
            {
                if (Text(v, "ISCANCELLED") == "Yes" || Text(v, "ISOPTIONAL") == "Yes" || Text(v, "ISDELETED") == "Yes") continue;
                // ALLLEDGERENTRIES and LEDGERENTRIES can both list the same lines: use one of them
                var entries = v.SelectNodes("ALLLEDGERENTRIES.LIST[LEDGERNAME!='']");
                if (entries.Count == 0) entries = v.SelectNodes("LEDGERENTRIES.LIST[LEDGERNAME!='']");
                // the customer: the voucher's party if it is a debtor, otherwise
                // the first debtor ledger in the entries (journals)
                string party = Text(v, "PARTYLEDGERNAME");
                if (party.Length == 0 || !debtorKeys.Contains(Normalize(party)))
                {
                    party = "";
                    foreach (XmlNode e in entries)
                    {
                        var ln = Text(e, "LEDGERNAME");
                        if (debtorKeys.Contains(Normalize(ln))) { party = ln; break; }
                    }
                }
                if (party.Length == 0) continue;
                double amount = 0;
                foreach (XmlNode e in entries)
                    if (Normalize(Text(e, "LEDGERNAME")) == Normalize(party)) amount += Num(Text(e, "AMOUNT"));
                if (amount == 0) continue;
                var vtype = Text(v, "VOUCHERTYPENAME");
                if (vtype.Length == 0 && v.Attributes["VCHTYPE"] != null) vtype = v.Attributes["VCHTYPE"].Value;
                var date = Text(v, "DATE");
                if (date.Length != 8) continue;
                var nar = Text(v, "NARRATION");
                var others = new List<string>();
                foreach (XmlNode e in entries)
                {
                    var ln = Text(e, "LEDGERNAME");
                    if (ln.Length > 0 && Normalize(ln) != Normalize(party) && !others.Contains(ln)) others.Add(ln);
                }
                var via = string.Join(", ", others);
                list.Add(new Voucher {
                    Date = date.Substring(0, 4) + "-" + date.Substring(4, 2) + "-" + date.Substring(6, 2),
                    Type = vtype, Number = Text(v, "VOUCHERNUMBER"), Party = party,
                    Narration = nar.Length > 80 ? nar.Substring(0, 80) : nar,
                    Via = via.Length > 60 ? via.Substring(0, 60) : via,
                    Id = Text(v, "GUID").Length > 0 ? Text(v, "GUID") : Text(v, "MASTERID"),
                    // Tally shows debit as negative
                    Amount = Math.Round(Math.Abs(amount), 2), Debit = amount < 0
                });
            }
            return list;
        }
    }

    // ------------------------------------------------------------------ encryption
    // Same format as the web app (react-app/src/lib/crypto.ts) and the old app (js/00-crypto.js):
    //   key = PBKDF2-SHA256(passphrase, salt, iter) -> 64 bytes: AES key | HMAC key
    //   enc = base64( iv(16) | AES-256-CBC(deflate(JSON)) | HMAC-SHA256(iv|ct) )
    // When settings/crypto is on, every record this app writes keeps only the
    // bookkeeping fields readable; the rest is in "enc".
    static class Crypto
    {
        public static string Salt = "";      // "" = encryption off
        public static int Iter = 310000;
        public static string Check = "";
        public static string SetBy = "";
        public static bool On { get { return Salt.Length > 0; } }
        public static bool Locked(Settings s) { return On && (s.EncKey == null || s.EncSalt != Salt); }

        public static byte[] Derive(string pass, string salt, int iter)
        {
            using (var kdf = new Rfc2898DeriveBytes(Encoding.UTF8.GetBytes(pass), Convert.FromBase64String(salt), iter, HashAlgorithmName.SHA256))
                return kdf.GetBytes(64);
        }

        public static string Seal(byte[] key, string json)
        {
            byte[] z;
            using (var ms = new MemoryStream())
            {
                using (var d = new DeflateStream(ms, CompressionMode.Compress, true)) { var b = Encoding.UTF8.GetBytes(json); d.Write(b, 0, b.Length); }
                z = ms.ToArray();
            }
            var iv = new byte[16];
            using (var rng = RandomNumberGenerator.Create()) rng.GetBytes(iv);
            byte[] ct;
            using (var aes = new AesCryptoServiceProvider { Mode = CipherMode.CBC, Padding = PaddingMode.PKCS7, Key = key.Take(32).ToArray(), IV = iv })
            using (var enc = aes.CreateEncryptor()) ct = enc.TransformFinalBlock(z, 0, z.Length);
            var body = iv.Concat(ct).ToArray();
            byte[] mac;
            using (var h = new HMACSHA256(key.Skip(32).Take(32).ToArray())) mac = h.ComputeHash(body);
            return Convert.ToBase64String(body.Concat(mac).ToArray());
        }

        public static string Open(byte[] key, string sealedText)
        {
            var all = Convert.FromBase64String(sealedText);
            if (all.Length < 64) throw new Exception("Damaged encrypted record.");
            var body = all.Take(all.Length - 32).ToArray();
            var mac = all.Skip(all.Length - 32).ToArray();
            byte[] want;
            using (var h = new HMACSHA256(key.Skip(32).Take(32).ToArray())) want = h.ComputeHash(body);
            int diff = 0;
            for (int i = 0; i < 32; i++) diff |= want[i] ^ mac[i];
            if (diff != 0) throw new Exception("Encrypted with a different passphrase, or changed.");
            byte[] z;
            using (var aes = new AesCryptoServiceProvider { Mode = CipherMode.CBC, Padding = PaddingMode.PKCS7, Key = key.Take(32).ToArray(), IV = body.Take(16).ToArray() })
            using (var dec = aes.CreateDecryptor()) z = dec.TransformFinalBlock(body, 16, body.Length - 16);
            using (var ms = new MemoryStream(z))
            using (var d = new DeflateStream(ms, CompressionMode.Decompress))
            using (var r = new StreamReader(d, Encoding.UTF8)) return r.ReadToEnd();
        }

        // the passphrase is right when it opens the check value
        public static bool Unlock(Settings s, string pass)
        {
            if (!On) return false;
            var key = Derive(pass, Salt, Iter);
            try
            {
                var v = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(Open(key, Check));
                if (v == null || !v.ContainsKey("ok") || Convert.ToString(v["ok"]) != "chittam") return false;
            }
            catch { return false; }
            s.EncKey = key; s.EncSalt = Salt; s.Save();
            return true;
        }
    }

    // ------------------------------------------------------------------ Firebase
    static class Firebase
    {
        static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };

        static string Send(string method, string url, string token, object body)
        {
            var req = (HttpWebRequest)WebRequest.Create(url);
            req.Method = method;
            req.ContentType = "application/json; charset=utf-8";
            if (token != null) req.Headers["Authorization"] = "Bearer " + token;
            var data = Encoding.UTF8.GetBytes(Json.Serialize(body));
            using (var s = req.GetRequestStream()) s.Write(data, 0, data.Length);
            try
            {
                using (var res = (HttpWebResponse)req.GetResponse())
                using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                    return r.ReadToEnd();
            }
            catch (WebException ex)
            {
                string detail = "";
                if (ex.Response != null)
                    using (var r = new StreamReader(ex.Response.GetResponseStream(), Encoding.UTF8)) detail = r.ReadToEnd();
                var m = Regex.Match(detail, "\"message\"\\s*:\\s*\"([^\"]+)\"");
                throw new Exception(m.Success ? m.Groups[1].Value : ex.Message);
            }
        }

        public static string SignIn(Settings s)
        {
            try
            {
                var res = Send("POST", "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + s.ApiKey, null,
                    new Dictionary<string, object> { { "email", s.Email }, { "password", s.Password }, { "returnSecureToken", true } });
                var obj = Json.Deserialize<Dictionary<string, object>>(res);
                return (string)obj["idToken"];
            }
            catch (Exception ex)
            {
                if (Regex.IsMatch(ex.Message, "INVALID|EMAIL_NOT_FOUND|PASSWORD")) throw new Exception("Wrong email or password for the sync login.");
                throw new Exception("Sign-in failed: " + ex.Message);
            }
        }

        static Dictionary<string, object> Str(string v) { return new Dictionary<string, object> { { "stringValue", v ?? "" } }; }
        static Dictionary<string, object> Int(int v) { return new Dictionary<string, object> { { "integerValue", v.ToString() } }; }
        static Dictionary<string, object> Dbl(double v) { return new Dictionary<string, object> { { "doubleValue", v } }; }
        static Dictionary<string, object> Bool(bool v) { return new Dictionary<string, object> { { "booleanValue", v } }; }
        static Dictionary<string, object> Ts(string iso) { return new Dictionary<string, object> { { "timestampValue", iso } }; }
        static Dictionary<string, object> Map(Dictionary<string, object> fields)
        {
            return new Dictionary<string, object> { { "mapValue", new Dictionary<string, object> { { "fields", fields } } } };
        }
        static string BaseUrl(Settings s) { return "https://firestore.googleapis.com/v1/projects/" + s.ProjectId + "/databases/(default)/documents/"; }

        // a Firestore REST value -> plain value (string, number, bool, map, list)
        static object Plain(object typed)
        {
            var v = typed as Dictionary<string, object>;
            if (v == null) return null;
            object x;
            if (v.TryGetValue("stringValue", out x)) return x;
            if (v.TryGetValue("doubleValue", out x)) return Convert.ToDouble(x, CultureInfo.InvariantCulture);
            if (v.TryGetValue("integerValue", out x)) return Convert.ToInt64(x, CultureInfo.InvariantCulture);
            if (v.TryGetValue("booleanValue", out x)) return x;
            if (v.TryGetValue("timestampValue", out x)) return x;
            if (v.TryGetValue("mapValue", out x))
            {
                var o = new Dictionary<string, object>();
                object f;
                if (((Dictionary<string, object>)x).TryGetValue("fields", out f) && f != null)
                    foreach (var kv in (Dictionary<string, object>)f) o[kv.Key] = Plain(kv.Value);
                return o;
            }
            if (v.TryGetValue("arrayValue", out x))
            {
                object vals;
                if (((Dictionary<string, object>)x).TryGetValue("values", out vals) && vals != null)
                    return ((System.Collections.IEnumerable)vals).Cast<object>().Select(Plain).ToArray();
                return new object[0];
            }
            return null;
        }

        static readonly string[] Meta = { "createdAt", "createdBy", "updatedAt", "updatedBy", "at", "by" };
        static string[] PlainFields(string coll)
        {
            if (coll == "activity") return Meta.Concat(new[] { "collection", "docId", "action", "source" }).ToArray();
            if (coll == "messages") return Meta.Concat(new[] { "type" }).ToArray();
            return Meta;
        }

        // the fields of a record ready to send: when encryption is on, all but the readable ones go into "enc"
        static Dictionary<string, object> Seal(Settings s, string coll, Dictionary<string, object> fields)
        {
            if (!Crypto.On) return fields;
            if (Crypto.Locked(s)) throw new Exception("The data is encrypted: enter the passphrase in Tally Sync first.");
            var keep = PlainFields(coll);
            var outF = new Dictionary<string, object>();
            var secret = new Dictionary<string, object>();
            foreach (var kv in fields)
            {
                if (keep.Contains(kv.Key)) outF[kv.Key] = kv.Value;
                else secret[kv.Key] = Plain(kv.Value);
            }
            outF["enc"] = Str(Crypto.Seal(s.EncKey, Json.Serialize(secret)));
            outF["encV"] = Int(1);
            return outF;
        }

        // reads settings/crypto: is the data encrypted, and the check for the passphrase
        public static void RefreshCrypto(Settings s, string token)
        {
            var d = GetDoc(s, token, "settings/crypto");
            if (d == null || !(d.ContainsKey("on") && d["on"] is bool && (bool)d["on"])) { Crypto.Salt = ""; return; }
            Crypto.Salt = Convert.ToString(d.ContainsKey("salt") ? d["salt"] : "");
            Crypto.Iter = d.ContainsKey("iter") ? Convert.ToInt32(d["iter"]) : 310000;
            Crypto.Check = Convert.ToString(d.ContainsKey("check") ? d["check"] : "");
            Crypto.SetBy = Convert.ToString(d.ContainsKey("setBy") ? d["setBy"] : "");
        }

        // one document as plain values (opened if encrypted); null when it doesn't exist
        public static Dictionary<string, object> GetDoc(Settings s, string token, string path)
        {
            var req = (HttpWebRequest)WebRequest.Create(BaseUrl(s) + path);
            req.Headers["Authorization"] = "Bearer " + token;
            string body;
            try { using (var res = (HttpWebResponse)req.GetResponse()) using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) body = r.ReadToEnd(); }
            catch (WebException ex)
            {
                var res = ex.Response as HttpWebResponse;
                if (res != null && res.StatusCode == HttpStatusCode.NotFound) return null;
                throw new Exception("Could not read " + path + ": " + ex.Message);
            }
            var obj = Json.Deserialize<Dictionary<string, object>>(body);
            var row = new Dictionary<string, object>();
            object fv;
            if (obj != null && obj.TryGetValue("fields", out fv) && fv != null)
                foreach (var kv in (Dictionary<string, object>)fv) row[kv.Key] = Plain(kv.Value);
            return OpenRow(s, row);
        }

        // a record read from the database, with its encrypted part opened
        static Dictionary<string, object> OpenRow(Settings s, Dictionary<string, object> row)
        {
            object enc;
            if (!row.TryGetValue("enc", out enc) || !(enc is string)) return row;
            if (Crypto.Locked(s)) throw new Exception("The data is encrypted: enter the passphrase in Tally Sync first.");
            var secret = Json.Deserialize<Dictionary<string, object>>(Crypto.Open(s.EncKey, (string)enc));
            row.Remove("enc"); row.Remove("encV");
            foreach (var kv in secret) row[kv.Key] = kv.Value;
            return row;
        }
        static string Now() { return DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"); }

        static void Log(Settings s, string token, string action, string label, Dictionary<string, object> details)
        {
            var log = new Dictionary<string, object> {
                { "collection", Str("app") }, { "action", Str(action) }, { "name", Str(label) },
                { "details", Map(details) }, { "at", Ts(Now()) }, { "by", Str(s.Email) }
            };
            Send("POST", BaseUrl(s) + "activity", token, new Dictionary<string, object> { { "fields", Seal(s, "activity", log) } });
        }

        public static void SaveBalances(Settings s, string token, string key, string label, string company,
            Dictionary<string, double> balances, Dictionary<string, string> names)
        {
            string now = Now();
            var bal = new Dictionary<string, object>();
            foreach (var kv in balances) bal[kv.Key] = Dbl(kv.Value);
            var nm = new Dictionary<string, object>();
            foreach (var kv in names) nm[kv.Key] = Str(kv.Value);

            var fields = new Dictionary<string, object> {
                { "company", Str(key) }, { "label", Str(label) }, { "file", Str("Auto from Tally: " + company) },
                { "importedAt", Str(now) }, { "importedBy", Str(s.Email) }, { "matched", Int(balances.Count) },
                { "unmatched", new Dictionary<string, object> { { "arrayValue", new Dictionary<string, object> { { "values", new object[0] } } } } },
                { "balances", Map(bal) }, { "names", Map(nm) }, { "at", Ts(now) }, { "by", Str(s.Email) }
            };
            Send("PATCH", BaseUrl(s) + "balances/" + key, token, new Dictionary<string, object> { { "fields", Seal(s, "balances", fields) } });
            Log(s, token, "balances-synced", label, new Dictionary<string, object> { { "name", Str(label) }, { "company", Str(company) }, { "names", Int(balances.Count) } });
        }

        // name (and a few fields) of every document in a collection
        public static List<Dictionary<string, object>> List(Settings s, string token, string coll, params string[] fields)
        {
            var all = new List<Dictionary<string, object>>();
            string pageToken = "";
            do
            {
                var url = BaseUrl(s) + coll + "?pageSize=1000" + string.Concat(fields.Concat(new[] { "enc" }).Select(f => "&mask.fieldPaths=" + f)) +
                    (pageToken.Length > 0 ? "&pageToken=" + Uri.EscapeDataString(pageToken) : "");
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Headers["Authorization"] = "Bearer " + token;
                string body;
                try { using (var res = (HttpWebResponse)req.GetResponse()) using (var r = new StreamReader(res.GetResponseStream(), Encoding.UTF8)) body = r.ReadToEnd(); }
                catch (WebException ex) { throw new Exception("Could not read " + coll + ": " + ex.Message); }
                var obj = Json.Deserialize<Dictionary<string, object>>(body);
                object docs;
                if (obj != null && obj.TryGetValue("documents", out docs))
                    foreach (Dictionary<string, object> d in (System.Collections.ArrayList)docs)
                    {
                        var row = new Dictionary<string, object>();
                        var path = (string)d["name"];
                        row["_id"] = path.Substring(path.LastIndexOf('/') + 1);
                        object fv;
                        if (d.TryGetValue("fields", out fv))
                            foreach (var kv in (Dictionary<string, object>)fv)
                            {
                                var v = (Dictionary<string, object>)kv.Value;
                                object x;
                                if (v.TryGetValue("stringValue", out x)) row[kv.Key] = x;
                                else if (v.TryGetValue("doubleValue", out x)) row[kv.Key] = Convert.ToDouble(x, CultureInfo.InvariantCulture);
                                else if (v.TryGetValue("integerValue", out x)) row[kv.Key] = Convert.ToDouble(x, CultureInfo.InvariantCulture);
                            }
                        all.Add(OpenRow(s, row));
                    }
                object nt;
                pageToken = obj != null && obj.TryGetValue("nextPageToken", out nt) ? (string)nt : "";
            } while (pageToken.Length > 0);
            return all;
        }

        static readonly Random Rnd = new Random();
        static string RandomId(int n)
        {
            const string abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            lock (Rnd) return new string(Enumerable.Range(0, n).Select(_ => abc[Rnd.Next(abc.Length)]).ToArray());
        }
        // same id style as the app: prefix + time in base 36 + 5 random letters
        public static string AppId(string prefix)
        {
            long t = (long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds;
            const string b36 = "0123456789abcdefghijklmnopqrstuvwxyz";
            var sb = new StringBuilder();
            do { sb.Insert(0, b36[(int)(t % 36)]); t /= 36; } while (t > 0);
            return prefix + sb + RandomId(5).ToLowerInvariant();
        }

        static object Value(object v)
        {
            if (v == null) return new Dictionary<string, object> { { "nullValue", null } };
            if (v is double || v is int) return Dbl(Convert.ToDouble(v));
            return Str(Convert.ToString(v, CultureInfo.InvariantCulture));
        }
        static Dictionary<string, object> Fields(Dictionary<string, object> rec)
        {
            var f = new Dictionary<string, object>();
            foreach (var kv in rec) f[kv.Key] = Value(kv.Value);
            return f;
        }

        // adds / updates records the way the app does: the record (with created/updated
        // stamps) plus one activity entry each, so History shows every change
        public static void SaveRecords(Settings s, string token, string coll, List<Tuple<string, Dictionary<string, object>, Dictionary<string, object>>> recs)
        {
            if (Crypto.On) { SaveRecordsSealed(s, token, coll, recs); return; }
            string root = "projects/" + s.ProjectId + "/databases/(default)/documents/";
            for (int i = 0; i < recs.Count; i += 150)
            {
                string now = Now();
                var writes = new List<object>();
                foreach (var r in recs.Skip(i).Take(150))
                {
                    string id = r.Item1; var after = r.Item2; var before = r.Item3;
                    var fields = Fields(after);
                    fields["updatedAt"] = Ts(now); fields["updatedBy"] = Str(s.Email);
                    var w = new Dictionary<string, object> { { "update", new Dictionary<string, object> { { "name", root + coll + "/" + id }, { "fields", fields } } } };
                    if (before == null) { fields["createdAt"] = Ts(now); fields["createdBy"] = Str(s.Email); }
                    else w["updateMask"] = new Dictionary<string, object> { { "fieldPaths", fields.Keys.ToArray() } };
                    writes.Add(w);
                    var full = new Dictionary<string, object>(before ?? new Dictionary<string, object>());
                    foreach (var kv in after) full[kv.Key] = kv.Value;
                    string label = Convert.ToString(full.ContainsKey("name") ? full["name"] : "");
                    writes.Add(new Dictionary<string, object> { { "update", new Dictionary<string, object> { { "name", root + "activity/" + RandomId(20) }, { "fields", new Dictionary<string, object> {
                        { "collection", Str(coll) }, { "docId", Str(id) }, { "action", Str(before == null ? "create" : "update") }, { "name", Str(label) },
                        { "before", before == null ? (object)new Dictionary<string, object> { { "nullValue", null } } : Map(Fields(before)) },
                        { "after", Map(Fields(full)) }, { "at", Ts(now) }, { "by", Str(s.Email) }, { "source", Str("Tally sync") }
                    } } } } });
                }
                Send("POST", BaseUrl(s).TrimEnd('/') + ":commit", token, new Dictionary<string, object> { { "writes", writes } });
            }
        }

        // encryption on: each change is applied to the whole current record, which is
        // sent encrypted (created stamps kept); History gets the whole before / after
        static void SaveRecordsSealed(Settings s, string token, string coll, List<Tuple<string, Dictionary<string, object>, Dictionary<string, object>>> recs)
        {
            if (Crypto.Locked(s)) throw new Exception("The data is encrypted: enter the passphrase in Tally Sync first.");
            string root = "projects/" + s.ProjectId + "/databases/(default)/documents/";
            for (int i = 0; i < recs.Count; i += 150)
            {
                string now = Now();
                var writes = new List<object>();
                foreach (var r in recs.Skip(i).Take(150))
                {
                    string id = r.Item1; var after = r.Item2;
                    Dictionary<string, object> before = null;
                    if (r.Item3 != null)
                    {
                        before = GetDoc(s, token, coll + "/" + id) ?? new Dictionary<string, object>(r.Item3);
                        foreach (var m in Meta) before.Remove(m);
                    }
                    var full = new Dictionary<string, object>(before ?? new Dictionary<string, object>());
                    foreach (var kv in after) full[kv.Key] = kv.Value;
                    var fields = new Dictionary<string, object> {
                        { "enc", Str(Crypto.Seal(s.EncKey, Json.Serialize(full))) }, { "encV", Int(1) },
                        { "updatedAt", Ts(now) }, { "updatedBy", Str(s.Email) }
                    };
                    var w = new Dictionary<string, object> { { "update", new Dictionary<string, object> { { "name", root + coll + "/" + id }, { "fields", fields } } } };
                    if (before == null) { fields["createdAt"] = Ts(now); fields["createdBy"] = Str(s.Email); }
                    else w["updateMask"] = new Dictionary<string, object> { { "fieldPaths", fields.Keys.ToArray() } };
                    writes.Add(w);
                    var secret = new Dictionary<string, object> {
                        { "name", Convert.ToString(full.ContainsKey("name") ? full["name"] : "") }, { "before", before }, { "after", full }
                    };
                    writes.Add(new Dictionary<string, object> { { "update", new Dictionary<string, object> { { "name", root + "activity/" + RandomId(20) }, { "fields", new Dictionary<string, object> {
                        { "collection", Str(coll) }, { "docId", Str(id) }, { "action", Str(before == null ? "create" : "update") },
                        { "enc", Str(Crypto.Seal(s.EncKey, Json.Serialize(secret))) }, { "encV", Int(1) },
                        { "at", Ts(now) }, { "by", Str(s.Email) }, { "source", Str("Tally sync") }
                    } } } } });
                }
                Send("POST", BaseUrl(s).TrimEnd('/') + ":commit", token, new Dictionary<string, object> { { "writes", writes } });
            }
        }

        public static void LogMasters(Settings s, string token, int custAdded, int custUpdated, int prodAdded, int prodUpdated)
        {
            Log(s, token, "tally-masters-synced", "Customers and products", new Dictionary<string, object> {
                { "customersAdded", Int(custAdded) }, { "customersUpdated", Int(custUpdated) }, { "productsAdded", Int(prodAdded) }, { "productsUpdated", Int(prodUpdated) } });
        }

        // a tiny "last checked" note, written on every sync even when nothing changed
        public static void LogVoucherPosted(Settings s, string token, string company, string party, double amount, string into, string date, string receiptId)
        {
            Log(s, token, "tally-voucher-posted", party, new Dictionary<string, object> {
                { "name", Str(party) }, { "company", Str(company) }, { "amount", Dbl(amount) }, { "into", Str(into) }, { "date", Str(date) }, { "receiptId", Str(receiptId) } });
        }

        public static void LogCompanySwitch(Settings s, string token, string label, string from, string to)
        {
            Log(s, token, "tally-company-switched", label, new Dictionary<string, object> { { "name", Str(label) }, { "from", Str(from) }, { "to", Str(to) } });
        }

        public static void SaveStatus(Settings s, string token, bool ok, string error, List<string> companies, List<string[]> accounts)
        {
            string now = Now();
            var acc = (accounts ?? new List<string[]>()).Select(a => (object)Map(new Dictionary<string, object> { { "key", Str(a[0]) }, { "company", Str(a[1]) }, { "label", Str(a[2]) } })).ToArray();
            var fields = new Dictionary<string, object> {
                { "accounts", new Dictionary<string, object> { { "arrayValue", new Dictionary<string, object> { { "values", acc } } } } },
                { "checkedAt", Str(now) }, { "ok", Bool(ok) }, { "error", Str(error ?? "") }, { "pcVersion", Str(Program.DesktopVersion) },
                { "companies", new Dictionary<string, object> { { "arrayValue", new Dictionary<string, object> { { "values", companies.Select(c => (object)Str(c)).ToArray() } } } } },
                { "at", Ts(now) }, { "by", Str(s.Email) }
            };
            Send("PATCH", BaseUrl(s) + "balances/status", token, new Dictionary<string, object> { { "fields", Seal(s, "balances", fields) } });
        }

        public static void SaveStock(Settings s, string token, string key, string label, string company, List<StockLine> items)
        {
            string now = Now();
            var map = new Dictionary<string, object>();
            foreach (var it in items)
                map[Tally.Normalize(it.Name)] = Map(new Dictionary<string, object> { { "n", Str(it.Name) }, { "q", Dbl(it.Qty) }, { "u", Str(it.Unit) } });
            var fields = new Dictionary<string, object> {
                { "company", Str(key) }, { "label", Str(label) }, { "tallyCompany", Str(company) }, { "syncedAt", Str(now) },
                { "count", Int(items.Count) }, { "items", Map(map) }, { "at", Ts(now) }, { "by", Str(s.Email) }
            };
            Send("PATCH", BaseUrl(s) + "tallyStock/" + key, token, new Dictionary<string, object> { { "fields", Seal(s, "tallyStock", fields) } });
            Log(s, token, "tally-stock-synced", label, new Dictionary<string, object> { { "name", Str(label) }, { "company", Str(company) }, { "count", Int(items.Count) } });
        }

        public static void SaveBills(Settings s, string token, string key, string label, string company, List<Bill> bills)
        {
            string now = Now();
            var values = bills.Select(b => (object)Map(new Dictionary<string, object> {
                { "p", Str(b.Party) }, { "n", Str(b.Ref) }, { "d", Str(b.Date) }, { "due", Str(b.Due) }, { "a", Dbl(b.Amount) }, { "od", Int(b.Overdue) }
            })).ToArray();
            var fields = new Dictionary<string, object> {
                { "company", Str(key) }, { "label", Str(label) }, { "tallyCompany", Str(company) }, { "syncedAt", Str(now) },
                { "asOn", Str(DateTime.Today.ToString("yyyy-MM-dd")) }, { "count", Int(bills.Count) },
                { "bills", new Dictionary<string, object> { { "arrayValue", new Dictionary<string, object> { { "values", values } } } } },
                { "at", Ts(now) }, { "by", Str(s.Email) }
            };
            Send("PATCH", BaseUrl(s) + "tallyBills/" + key, token, new Dictionary<string, object> { { "fields", Seal(s, "tallyBills", fields) } });
            Log(s, token, "tally-bills-synced", label, new Dictionary<string, object> { { "name", Str(label) }, { "company", Str(company) }, { "count", Int(bills.Count) } });
        }

        public static void SaveVouchers(Settings s, string token, string key, string label, string company, DateTime from, DateTime to, List<Voucher> vouchers)
        {
            string now = Now();
            var values = vouchers.Select(v => (object)Map(new Dictionary<string, object> {
                { "d", Str(v.Date) }, { "t", Str(v.Type) }, { "n", Str(v.Number) }, { "p", Str(v.Party) },
                { "a", Dbl(v.Amount) }, { "dr", Bool(v.Debit) }, { "nar", Str(v.Narration) }, { "via", Str(v.Via) }, { "id", Str(v.Id) }
            })).ToArray();
            var fields = new Dictionary<string, object> {
                { "company", Str(key) }, { "label", Str(label) }, { "tallyCompany", Str(company) },
                { "from", Str(from.ToString("yyyy-MM-dd")) }, { "to", Str(to.ToString("yyyy-MM-dd")) },
                { "syncedAt", Str(now) }, { "count", Int(vouchers.Count) },
                { "vouchers", new Dictionary<string, object> { { "arrayValue", new Dictionary<string, object> { { "values", values } } } } },
                { "at", Ts(now) }, { "by", Str(s.Email) }
            };
            Send("PATCH", BaseUrl(s) + "tallyVouchers/" + key, token, new Dictionary<string, object> { { "fields", Seal(s, "tallyVouchers", fields) } });
            Log(s, token, "tally-vouchers-synced", label, new Dictionary<string, object> {
                { "name", Str(label) }, { "company", Str(company) }, { "count", Int(vouchers.Count) },
                { "from", Str(from.ToString("yyyy-MM-dd")) }, { "to", Str(to.ToString("yyyy-MM-dd")) } });
        }
    }

    // ------------------------------------------------------------------ sync engine
    class SyncEngine
    {
        public readonly Settings Settings;
        public event Action<string> Logged;
        public event Action Changed;
        public bool Busy { get; private set; }
        public DateTime NextSync = DateTime.Now.AddSeconds(15);
        public string LastError = "";
        public bool DryRun;   // report what customers / products would change, write nothing
        readonly List<string> recent = new List<string>();

        public SyncEngine(Settings s)
        {
            Settings = s;
            try { if (File.Exists(LogPath)) { var lines = File.ReadAllLines(LogPath); recent.AddRange(lines.Skip(Math.Max(0, lines.Length - 60))); } } catch { }
        }

        public void Log(string msg)
        {
            string line = DateTime.Now.ToString("dd MMM HH:mm:ss") + "  " + msg;
            try
            {
                Directory.CreateDirectory(Settings.Folder);
                var path = LogPath;
                if (File.Exists(path) && new FileInfo(path).Length > 1024 * 1024) File.Delete(path);
                File.AppendAllText(path, line + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
            lock (recent) { recent.Add(line); if (recent.Count > 60) recent.RemoveAt(0); }
            var h = Logged; if (h != null) h(line);
        }

        public List<string> RecentLog() { lock (recent) return recent.ToList(); }

        public static string LogPath { get { return Path.Combine(Settings.Folder, "sync.log"); } }

        public string LastText(string key)
        {
            string v;
            return Settings.LastStatus.TryGetValue(key, out v) ? v : "";
        }

        // runs on a worker thread; Changed fires when done
        public void Start(bool force)
        {
            if (Busy || !Settings.Configured) return;
            Busy = true;
            var h0 = Changed; if (h0 != null) h0();
            ThreadPool.QueueUserWorkItem(delegate {
                try { LastError = ""; Run(force); }
                catch (Exception ex) { LastError = ex.Message; Log("ERROR: " + ex.Message); }
                finally
                {
                    Busy = false;
                    NextSync = DateTime.Now.AddMinutes(Math.Max(5, Settings.IntervalMinutes));
                    var h = Changed; if (h != null) h();
                }
            });
        }

        static string Hash(string text)
        {
            using (var sha = SHA256.Create()) return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text))).Replace("-", "");
        }

        public event Action<string> CompanySwitched;

        // "Chittam Enterprises - 2026" -> a newer "Chittam Enterprises - 2027" open in Tally
        // that already has customer balances (so it's really in use)
        string NewerYearCompany(string current, List<string> open)
        {
            var m = Regex.Match(current ?? "", "^(.*\\S)\\s*-\\s*(\\d{4})$");
            if (!m.Success) return null;
            string baseName = m.Groups[1].Value; int year = int.Parse(m.Groups[2].Value);
            var newer = open.Select(n => Regex.Match(n, "^(.*\\S)\\s*-\\s*(\\d{4})$"))
                .Where(x => x.Success && string.Equals(x.Groups[1].Value, baseName, StringComparison.OrdinalIgnoreCase) && int.Parse(x.Groups[2].Value) > year)
                .OrderByDescending(x => int.Parse(x.Groups[2].Value)).Select(x => x.Value).FirstOrDefault();
            if (newer == null) return null;
            try
            {
                Dictionary<string, double> bal; Dictionary<string, string> names;
                Tally.Balances(Settings.TallyUrl, newer, out bal, out names);
                return bal.Count > 0 ? newer : null;
            }
            catch { return null; }
        }

        void SwitchYearIfNeeded(ref string token)
        {
            List<string> open;
            try { open = Tally.Companies(Settings.TallyUrl); } catch { return; }
            foreach (var co in Settings.AllCompanies())
            {
                var key = co[0];
                var current = co[1];
                var newer = NewerYearCompany(current, open);
                if (newer == null) continue;
                Settings.SetCompany(key, newer);
                foreach (var k in Settings.LastHash.Keys.Where(k => k == key || k.EndsWith("-" + key)).ToList()) Settings.LastHash.Remove(k);
                Settings.Save();
                var msg = "New financial year: syncing " + newer + " instead of " + current + ".";
                Log(msg);
                try
                {
                    if (token == null) token = Firebase.SignIn(Settings);
                    Firebase.LogCompanySwitch(Settings, token, Settings.LabelFor(key), current, newer);
                }
                catch { }
                var h = CompanySwitched; if (h != null) h(msg);
            }
        }

        void Run(bool force)
        {
            string token = Firebase.SignIn(Settings);
            Firebase.RefreshCrypto(Settings, token);
            if (Crypto.Locked(Settings))
            {
                LastError = "The data is encrypted: enter the passphrase (Tally Sync → Passphrase…).";
                Log("Not synced: " + LastError);
                return;
            }
            SwitchYearIfNeeded(ref token);
            var allDebtors = new List<Debtor>();
            var failed = new List<string>();
            var allStock = new List<StockLine>();
            HashSet<string> appCustomers = null;   // the app's customer names, to pick them out of Sundry Creditors
            var jobs = Settings.AllCompanies();
            foreach (var j in jobs)
            {
                string key = j[0], company = j[1], label = j[2];
                if (string.IsNullOrEmpty(company)) continue;
                Dictionary<string, double> bal; Dictionary<string, string> names;
                try { Tally.Balances(Settings.TallyUrl, company, out bal, out names); }
                catch (Exception ex) { Log("[" + company + "] skipped: " + ex.Message); LastError = ex.Message; failed.Add(company); continue; }

                // ---- parties you both buy from and sell to sit under Sundry Creditors:
                // when such a ledger is a customer in the app, take its balance too ----
                try
                {
                    var creditors = Tally.Creditors(Settings.TallyUrl, company);
                    if (creditors.Count > 0)
                    {
                        if (appCustomers == null)
                        {
                            if (token == null) token = Firebase.SignIn(Settings);
                            appCustomers = new HashSet<string>(Firebase.List(Settings, token, "customers", "name")
                                .Select(r => Tally.Normalize(r.ContainsKey("name") ? Convert.ToString(r["name"]) : "")).Where(n => n.Length > 0));
                        }
                        int added = 0;
                        foreach (var c in creditors)
                        {
                            var k = Tally.Normalize(c.Name);
                            if (!appCustomers.Contains(k) || bal.ContainsKey(k)) continue;
                            bal[k] = Math.Round(-c.Closing, 2);   // Tally: negative = Dr = owed to us
                            names[k] = c.Name;
                            added++;
                        }
                        if (added > 0) Log("[" + company + "] " + added + " customers under Sundry Creditors (buy and sell) included");
                    }
                }
                catch (Exception ex) { Log("[" + company + "] Sundry Creditors customers skipped: " + ex.Message); }

                // ---- balances ----
                var sig = string.Join("|", bal.Keys.OrderBy(k => k, StringComparer.Ordinal).Select(k => k + "=" + bal[k].ToString(CultureInfo.InvariantCulture)));
                string hash = Hash(sig), last;
                if (!force && Settings.LastHash.TryGetValue(key, out last) && last == hash) Log("[" + company + "] balances: no change");
                else
                {
                    if (token == null) token = Firebase.SignIn(Settings);
                    Firebase.SaveBalances(Settings, token, key, label, company, bal, names);
                    Settings.LastHash[key] = hash;
                    Settings.LastStatus[key] = DateTime.Now.ToString("dd MMM yyyy, h:mm tt") + " · " + bal.Count + " names";
                    Settings.Save();
                    Log("[" + company + "] uploaded " + bal.Count + " balances");
                }

                // ---- stock ----
                if (Settings.SyncStock)
                {
                    try
                    {
                        var stock = Tally.Stock(Settings.TallyUrl, company);
                        // business company first, so its group / rate wins over Cash's
                        if (key == "business") allStock.InsertRange(0, stock); else allStock.AddRange(stock);
                        var ssig = string.Join("|", stock.OrderBy(x => x.Name, StringComparer.Ordinal).Select(x => x.Name + "=" + x.Qty.ToString(CultureInfo.InvariantCulture) + x.Unit));
                        string shash = Hash(ssig), skey = "s-" + key, slast;
                        if (!force && Settings.LastHash.TryGetValue(skey, out slast) && slast == shash) Log("[" + company + "] stock: no change");
                        else
                        {
                            if (token == null) token = Firebase.SignIn(Settings);
                            Firebase.SaveStock(Settings, token, key, label, company, stock);
                            Settings.LastHash[skey] = shash;
                            Settings.LastStatus[skey] = DateTime.Now.ToString("dd MMM yyyy, h:mm tt") + " · " + stock.Count + " stock items";
                            Settings.Save();
                            Log("[" + company + "] uploaded stock of " + stock.Count + " items");
                        }
                    }
                    catch (Exception ex) { Log("[" + company + "] stock skipped: " + ex.Message); }
                }

                // ---- customer ledgers (for adding customers) ----
                if (Settings.SyncMasters)
                {
                    try { allDebtors.AddRange(Tally.Debtors(Settings.TallyUrl, company)); }
                    catch (Exception ex) { Log("[" + company + "] customer list skipped: " + ex.Message); }
                }

                // ---- open invoices (bill-wise) ----
                if (Settings.SyncBills)
                {
                    try
                    {
                        var bills = Tally.Bills(Settings.TallyUrl, company, DateTime.Today);
                        var bsig = string.Join("|", bills.Select(b => b.Party + ";" + b.Ref + ";" + b.Date + ";" + b.Due + ";" + b.Amount.ToString(CultureInfo.InvariantCulture)));
                        // the overdue days change every day, so the day is part of what counts as a change
                        string bhash = Hash(DateTime.Today.ToString("yyyyMMdd") + bsig), bkey = "b-" + key, blast;
                        if (!force && Settings.LastHash.TryGetValue(bkey, out blast) && blast == bhash) Log("[" + company + "] invoices: no change");
                        else
                        {
                            if (token == null) token = Firebase.SignIn(Settings);
                            Firebase.SaveBills(Settings, token, key, label, company, bills);
                            Settings.LastHash[bkey] = bhash;
                            Settings.LastStatus[bkey] = DateTime.Now.ToString("dd MMM yyyy, h:mm tt") + " · " + bills.Count + " open invoices";
                            Settings.Save();
                            Log("[" + company + "] uploaded " + bills.Count + " open invoices");
                        }
                    }
                    catch (Exception ex) { Log("[" + company + "] invoices skipped: " + ex.Message); }
                }

                // ---- transactions ----
                if (!Settings.SyncVouchers) continue;
                var to = DateTime.Today;
                // at least from 1 April (the financial year), further back if asked
                var fyStart = new DateTime(to.Month >= 4 ? to.Year : to.Year - 1, 4, 1);
                var from = to.AddDays(-Math.Max(7, Math.Min(366, Settings.VoucherDays)));
                if (fyStart < from) from = fyStart;
                // this company's own "sync from" date, when one is set
                DateTime own;
                if (DateTime.TryParseExact(Settings.SyncFromFor(key), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out own) && own <= to) from = own;
                List<Voucher> vouchers;
                try { vouchers = Tally.Vouchers(Settings.TallyUrl, company, from, to, new HashSet<string>(bal.Keys)); }
                catch (Exception ex) { Log("[" + company + "] transactions skipped: " + ex.Message); continue; }
                // newest first; keep the upload well inside Firestore's 1 MB limit
                vouchers = vouchers.OrderByDescending(v => v.Date).Take(3000).ToList();
                var vsig = string.Join("\n", vouchers.Select(v => v.Date + "|" + v.Type + "|" + v.Number + "|" + v.Party + "|" +
                    v.Amount.ToString(CultureInfo.InvariantCulture) + "|" + v.Debit + "|" + v.Id + "|" + v.Narration + "|" + v.Via));
                string vhash = Hash(from.ToString("yyyyMMdd") + vsig), vkey = "v-" + key, vlast;
                if (!force && Settings.LastHash.TryGetValue(vkey, out vlast) && vlast == vhash) { Log("[" + company + "] transactions: no change"); continue; }
                if (token == null) token = Firebase.SignIn(Settings);
                Firebase.SaveVouchers(Settings, token, key, label, company, from, to, vouchers);
                Settings.LastHash[vkey] = vhash;
                Settings.LastStatus[vkey] = DateTime.Now.ToString("dd MMM yyyy, h:mm tt") + " · " + vouchers.Count + " transactions";
                Settings.Save();
                Log("[" + company + "] uploaded " + vouchers.Count + " transactions (" + from.ToString("dd MMM") + " – " + to.ToString("dd MMM") + ")");
            }

            // tell the app when Tally was last reached (so phones can warn about old figures)
            try
            {
                if (token == null) token = Firebase.SignIn(Settings);
                var reached = new List<string>();
                foreach (var j in jobs) if (!string.IsNullOrEmpty(j[1]) && !failed.Contains(j[1])) reached.Add(j[1]);
                Firebase.SaveStatus(Settings, token, failed.Count == 0, failed.Count == 0 ? "" : "Tally not reached for: " + string.Join(", ", failed), reached, Settings.AllCompanies());
            }
            catch (Exception ex) { Log("Status note not saved: " + ex.Message); }

            if (Settings.SyncMasters && (allDebtors.Count > 0 || allStock.Count > 0))
            {
                try { SyncMasters(ref token, force, allDebtors, allStock); }
                catch (Exception ex) { Log("Customers / products skipped: " + ex.Message); }
            }
        }

        // new Tally customers and products into the app; mobiles and selling prices kept up to date
        internal void SyncMasters(ref string token, bool force, List<Debtor> debtors, List<StockLine> stock)
        {
            var sig = string.Join("|", debtors.Select(d => d.Name + "=" + d.Mobile)) + "#" +
                string.Join("|", stock.Select(x => x.Name + "=" + x.Group + "=" + x.Rate.ToString(CultureInfo.InvariantCulture) + "=" + x.SellingPrice.ToString(CultureInfo.InvariantCulture)));
            string hash = Hash(sig), last;
            if (!force && Settings.LastHash.TryGetValue("masters", out last) && last == hash) { Log("Customers / products: no change in Tally"); return; }
            if (token == null) token = Firebase.SignIn(Settings);

            // ---- customers
            var existingC = Firebase.List(Settings, token, "customers", "name", "mobile");
            // matched by name ignoring case, spaces and punctuation; a near-identical
            // spelling (1-2 letters different) counts as the same customer, so no duplicate is added
            var byName = new Dictionary<string, Dictionary<string, object>>();
            foreach (var c in existingC) { var k = Key(Convert.ToString(c.ContainsKey("name") ? c["name"] : "")); if (k.Length > 0 && !byName.ContainsKey(k)) byName[k] = c; }
            var similar = new List<string>();
            var cWrites = new List<Tuple<string, Dictionary<string, object>, Dictionary<string, object>>>();
            int cAdded = 0, cUpdated = 0;
            var seen = new HashSet<string>();
            foreach (var d in debtors)
            {
                var k = Key(d.Name);
                if (k.Length == 0 || !seen.Add(k)) continue;
                Dictionary<string, object> c;
                if (!byName.TryGetValue(k, out c))
                {
                    var near = byName.Keys.FirstOrDefault(x => k.Length > 8 && Math.Abs(x.Length - k.Length) <= 2 && Distance(x, k) <= 2);
                    if (near != null) { similar.Add(d.Name + " ≈ " + byName[near]["name"]); continue; }
                }
                if (c != null)
                {
                    var mob = Convert.ToString(c.ContainsKey("mobile") ? c["mobile"] : "");
                    var tallyMob = d.Mobile.Length > 0 ? d.Mobile : debtors.Where(x => Key(x.Name) == k).Select(x => x.Mobile).FirstOrDefault(m => m.Length > 0) ?? "";
                    if (mob.Length == 0 && tallyMob.Length > 0)
                    {
                        cWrites.Add(Tuple.Create((string)c["_id"], new Dictionary<string, object> { { "mobile", tallyMob } },
                            new Dictionary<string, object> { { "id", c["_id"] }, { "name", c["name"] }, { "mobile", "" } }));
                        cUpdated++;
                    }
                }
                else
                {
                    var id = Firebase.AppId("c_");
                    var mob = d.Mobile.Length > 0 ? d.Mobile : debtors.Where(x => Key(x.Name) == k).Select(x => x.Mobile).FirstOrDefault(m => m.Length > 0) ?? "";
                    cWrites.Add(Tuple.Create(id, new Dictionary<string, object> { { "id", id }, { "name", d.Name }, { "mobile", mob } }, (Dictionary<string, object>)null));
                    cAdded++;
                }
            }

            // ---- products
            var existingP = Firebase.List(Settings, token, "products", "name", "price", "category");
            var pByName = new Dictionary<string, Dictionary<string, object>>();
            foreach (var p in existingP) { var k = Key(Convert.ToString(p.ContainsKey("name") ? p["name"] : "")); if (k.Length > 0 && !pByName.ContainsKey(k)) pByName[k] = p; }
            var pWrites = new List<Tuple<string, Dictionary<string, object>, Dictionary<string, object>>>();
            int pAdded = 0, pUpdated = 0;
            var pSeen = new HashSet<string>();
            // stock of each item across both companies
            var totalQty = new Dictionary<string, double>();
            foreach (var x in stock) { var k = Key(x.Name); double q; totalQty.TryGetValue(k, out q); totalQty[k] = q + x.Qty; }
            // Tally groups that aren't things for sale
            Func<string, bool> notForSale = g => Regex.IsMatch(g ?? "", "ass?ets?|assest|dummy", RegexOptions.IgnoreCase);
            foreach (var x in stock)
            {
                var k = Key(x.Name);
                if (k.Length == 0 || !pSeen.Add(k)) continue;
                double tallyPrice = x.SellingPrice > 0 ? x.SellingPrice : x.Rate;
                Dictionary<string, object> p;
                if (pByName.TryGetValue(k, out p))
                {
                    double cur = p.ContainsKey("price") ? Convert.ToDouble(p["price"]) : 0;
                    var cat = Convert.ToString(p.ContainsKey("category") ? p["category"] : "");
                    var change = new Dictionary<string, object>();
                    // the price follows Tally only for a selling price, or when the app has none
                    if (x.SellingPrice > 0 && Math.Abs(cur - x.SellingPrice) > 0.009) change["price"] = Math.Round(x.SellingPrice, 2);
                    else if (cur <= 0 && tallyPrice > 0) change["price"] = Math.Round(tallyPrice, 2);
                    if (cat.Length == 0 && x.Group.Length > 0 && !notForSale(x.Group)) change["category"] = x.Group;
                    if (change.Count > 0)
                    {
                        pWrites.Add(Tuple.Create((string)p["_id"], change,
                            new Dictionary<string, object> { { "id", p["_id"] }, { "name", p["name"] }, { "price", cur }, { "category", cat } }));
                        pUpdated++;
                    }
                }
                else
                {
                    // only items you sell: in stock in either company, or with a selling price; never assets / dummy items
                    double tq; totalQty.TryGetValue(k, out tq);
                    if (notForSale(x.Group) || (tq <= 0 && x.SellingPrice <= 0)) continue;
                    var id = Firebase.AppId("p_");
                    pWrites.Add(Tuple.Create(id, new Dictionary<string, object> { { "id", id }, { "name", x.Name }, { "category", x.Group }, { "price", Math.Round(tallyPrice, 2) } }, (Dictionary<string, object>)null));
                    pAdded++;
                }
            }

            if (DryRun)
            {
                Log("[dry run] would add " + cAdded + " customers, fill " + cUpdated + " mobiles, add " + pAdded + " products, update " + pUpdated + " products");
                if (cAdded > 0) Log("[dry run] new customers: " + string.Join(", ", cWrites.Where(w => w.Item3 == null).Select(w => w.Item2["name"])));
                if (cUpdated > 0) Log("[dry run] mobiles filled: " + string.Join(", ", cWrites.Where(w => w.Item3 != null).Select(w => w.Item3["name"] + " " + w.Item2["mobile"])));
                if (pUpdated > 0) Log("[dry run] products updated: " + string.Join(", ", pWrites.Where(w => w.Item3 != null).Select(w => w.Item3["name"] + " " + string.Join("/", w.Item2.Select(kv => kv.Key + "=" + kv.Value)))));
                if (similar.Count > 0) Log("[dry run] not added, almost the same name: " + string.Join("; ", similar));
                return;
            }
            if (cWrites.Count > 0) Firebase.SaveRecords(Settings, token, "customers", cWrites);
            if (pWrites.Count > 0) Firebase.SaveRecords(Settings, token, "products", pWrites);
            if (cWrites.Count > 0 || pWrites.Count > 0) Firebase.LogMasters(Settings, token, cAdded, cUpdated, pAdded, pUpdated);
            Settings.LastHash["masters"] = hash;
            Settings.LastStatus["masters"] = DateTime.Now.ToString("dd MMM yyyy, h:mm tt") + " · " + cAdded + " customers added, " + cUpdated + " mobiles filled, " + pAdded + " products added, " + pUpdated + " updated";
            Settings.Save();
            Log("Customers: " + cAdded + " added, " + cUpdated + " mobiles filled · Products: " + pAdded + " added, " + pUpdated + " updated");
            if (cAdded > 0) Log("  New customers: " + string.Join(", ", cWrites.Where(w => w.Item3 == null).Select(w => w.Item2["name"])));
            if (pAdded > 0) Log("  New products: " + string.Join(", ", pWrites.Where(w => w.Item3 == null).Take(40).Select(w => w.Item2["name"])) + (pAdded > 40 ? " …" : ""));
            if (similar.Count > 0) Log("  Not added, spelled almost like an existing customer (rename one to match): " + string.Join("; ", similar));
        }

        // name key: lower case, letters and digits only
        static string Key(string s) { return Regex.Replace((s ?? "").ToLowerInvariant(), "[^a-z0-9]", ""); }

        // how many single-letter edits turn one into the other
        static int Distance(string a, string b)
        {
            var d = new int[a.Length + 1, b.Length + 1];
            for (int i = 0; i <= a.Length; i++) d[i, 0] = i;
            for (int j = 0; j <= b.Length; j++) d[0, j] = j;
            for (int i = 1; i <= a.Length; i++)
                for (int j = 1; j <= b.Length; j++)
                    d[i, j] = Math.Min(Math.Min(d[i - 1, j] + 1, d[i, j - 1] + 1), d[i - 1, j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1));
            return d[a.Length, b.Length];
        }

        // what the app page shows about the sync
        public string StatusJson()
        {
            var s = Settings;
            var o = new Dictionary<string, object> {
                { "type", "tally-status" }, { "desktopVersion", Program.DesktopVersion },
                { "configured", s.Configured }, { "busy", Busy }, { "error", LastError },
                { "nextSync", NextSync.ToString("h:mm tt") }, { "intervalMinutes", s.IntervalMinutes },
                { "syncVouchers", s.SyncVouchers }, { "voucherDays", s.VoucherDays }, { "syncStock", s.SyncStock }, { "syncBills", s.SyncBills }, { "syncMasters", s.SyncMasters }, { "masters", LastText("masters") },
                { "companies", s.AllCompanies().Select(c => (object)new Dictionary<string, object> {
                    { "key", c[0] }, { "company", c[1] }, { "label", c[2] }, { "balances", LastText(c[0]) }, { "vouchers", LastText("v-" + c[0]) }, { "stock", LastText("s-" + c[0]) }, { "bills", LastText("b-" + c[0]) } }).ToArray() },
                { "update", Updater.Status },
                { "log", RecentLog().Skip(Math.Max(0, RecentLog().Count - 30)).ToArray() }
            };
            return new JavaScriptSerializer().Serialize(o);
        }
    }

    // ------------------------------------------------------------------ look
    static class Look
    {
        public static readonly Color Brand = Color.FromArgb(36, 99, 235);
        public static readonly Color BrandDark = Color.FromArgb(29, 79, 209);
        public static readonly Color Page = Color.FromArgb(245, 245, 247);
        public static readonly Color Ink = Color.FromArgb(23, 23, 23);
        public static readonly Color Soft = Color.FromArgb(115, 115, 115);
        public static readonly Color Line = Color.FromArgb(229, 229, 229);
        public static readonly Color Good = Color.FromArgb(5, 150, 105);

        public static Font UI(float size, FontStyle style = FontStyle.Regular)
        {
            foreach (var name in new[] { "Segoe UI Variable Text", "Segoe UI" })
            {
                var f = new Font(name, size, style);
                if (f.Name == name) return f;
            }
            return new Font(FontFamily.GenericSansSerif, size, style);
        }

        public static Button Primary(string text)
        {
            var b = new Button { Text = text, FlatStyle = FlatStyle.Flat, BackColor = Brand, ForeColor = Color.White, Font = UI(9.75f, FontStyle.Bold), Cursor = Cursors.Hand, Height = 36 };
            b.FlatAppearance.BorderSize = 0;
            b.FlatAppearance.MouseOverBackColor = BrandDark;
            return b;
        }
        public static Button Secondary(string text)
        {
            var b = new Button { Text = text, FlatStyle = FlatStyle.Flat, BackColor = Color.White, ForeColor = Ink, Font = UI(9.75f, FontStyle.Bold), Cursor = Cursors.Hand, Height = 36 };
            b.FlatAppearance.BorderColor = Line;
            b.FlatAppearance.MouseOverBackColor = Color.FromArgb(244, 247, 255);
            return b;
        }

        // white card with a soft rounded border
        public static Panel Card(int left, int top, int width, int height, string title)
        {
            var p = new Panel { Left = left, Top = top, Width = width, Height = height, BackColor = Page };
            p.Paint += (s, e) => {
                e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
                var r = new Rectangle(0, 0, p.Width - 1, p.Height - 1);
                using (var path = Rounded(r, 12))
                using (var fill = new SolidBrush(Color.White))
                using (var pen = new Pen(Line))
                { e.Graphics.FillPath(fill, path); e.Graphics.DrawPath(pen, path); }
            };
            if (title != null)
                p.Controls.Add(new Label { Text = title.ToUpperInvariant(), Left = 16, Top = 12, AutoSize = true, Font = UI(8f, FontStyle.Bold), ForeColor = Soft, BackColor = Color.White });
            return p;
        }

        public static GraphicsPath Rounded(Rectangle r, int radius)
        {
            var d = radius * 2;
            var path = new GraphicsPath();
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static Label FieldLabel(string text, int left, int top)
        {
            return new Label { Text = text, Left = left, Top = top, AutoSize = true, Font = UI(9f, FontStyle.Bold), ForeColor = Color.FromArgb(82, 82, 82), BackColor = Color.White };
        }
    }

    // ------------------------------------------------------------------ Tally Sync window
    // more Tally companies: a name the app shows (its identity) and which Tally company it is
    class ExtraCompaniesForm : Form
    {
        readonly Settings settings;
        readonly DataGridView grid;

        public ExtraCompaniesForm(Settings s, List<string> tallyNames)
        {
            settings = s;
            Text = "Companies — Chittam Enterprises";
            Font = Look.UI(9.5f);
            BackColor = Color.White;
            StartPosition = FormStartPosition.CenterParent;
            FormBorderStyle = FormBorderStyle.FixedDialog; MaximizeBox = false; MinimizeBox = false;
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(720, 440);
            Controls.Add(new Label { Text = "Companies", Left = 20, Top = 16, AutoSize = true, Font = Look.UI(14f, FontStyle.Bold) });
            Controls.Add(new Label { Text = "Add more Tally companies: each is synced like Chittam Enterprises and Cash (balances, bills, transactions, stock)\r\nand gets its own amount in payments. “Name” is how the app shows it. “Sync from” (dd-mm-yyyy): send transactions from that\r\ndate — blank means from 1 April. Earlier dates take Tally longer.",
                Left = 20, Top = 50, Width = 680, Height = 54, ForeColor = Look.Soft });
            grid = new DataGridView {
                Left = 20, Top = 110, Width = 680, Height = 250, AllowUserToAddRows = true, AllowUserToDeleteRows = true, RowHeadersVisible = false,
                AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill, BackgroundColor = Color.White, BorderStyle = BorderStyle.FixedSingle,
                SelectionMode = DataGridViewSelectionMode.CellSelect, EditMode = DataGridViewEditMode.EditOnEnter
            };
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Key", Visible = false });
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "Label", HeaderText = "Name (shown in the app)", FillWeight = 38 });
            var co = new DataGridViewComboBoxColumn { Name = "Company", HeaderText = "Tally company", FillWeight = 42, FlatStyle = FlatStyle.Flat };
            var options = new List<string>(tallyNames.Where(n => n != s.BusinessCompany && n != s.CashCompany));
            foreach (var x in s.ExtraCompanies ?? new List<ExtraCompany>()) if (!options.Contains(x.Company)) options.Add(x.Company);
            co.Items.AddRange(options.Cast<object>().ToArray());
            if (!options.Contains(s.BusinessCompany)) options.Insert(0, s.BusinessCompany);
            if (!options.Contains(s.CashCompany)) options.Insert(1, s.CashCompany);
            co.Items.Clear();
            co.Items.AddRange(options.Cast<object>().ToArray());
            grid.Columns.Add(co);
            grid.Columns.Add(new DataGridViewTextBoxColumn { Name = "From", HeaderText = "Sync from", FillWeight = 20 });
            Func<string, string> show = v => { DateTime d; return DateTime.TryParseExact(v ?? "", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d) ? d.ToString("dd-MM-yyyy") : ""; };
            // Chittam Enterprises and Cash first: their name and Tally company are set in the main window
            foreach (var fixedRow in new[] { new[] { "business", s.BusinessLabel, s.BusinessCompany, s.BusinessSyncFrom }, new[] { "cash", s.CashLabel, s.CashCompany, s.CashSyncFrom } })
            {
                int i = grid.Rows.Add(fixedRow[0], fixedRow[1], fixedRow[2], show(fixedRow[3]));
                grid.Rows[i].Cells["Label"].ReadOnly = true; grid.Rows[i].Cells["Company"].ReadOnly = true;
                grid.Rows[i].Cells["Label"].Style.ForeColor = Color.Gray; grid.Rows[i].Cells["Company"].Style.ForeColor = Color.Gray;
            }
            foreach (var x in s.ExtraCompanies ?? new List<ExtraCompany>()) grid.Rows.Add(x.Key, x.Label, x.Company, show(x.SyncFrom));
            // the two main companies can't be removed here
            grid.UserDeletingRow += delegate (object o, DataGridViewRowCancelEventArgs e) { var k = Convert.ToString(e.Row.Cells["Key"].Value ?? ""); if (k == "business" || k == "cash") e.Cancel = true; };
            grid.DataError += delegate (object o, DataGridViewDataErrorEventArgs e) { e.ThrowException = false; };
            Controls.Add(grid);
            Controls.Add(new Label { Text = "Not in the list? Open it in Tally and press “Load names from Tally” first. To remove an added company, select its row and press Delete (its figures and payments are kept).",
                Left = 20, Top = 364, Width = 680, Height = 34, ForeColor = Look.Soft });
            var ok = new Button { Text = "Save", Left = 500, Top = 400, Width = 96, Height = 32, DialogResult = DialogResult.None };
            var cancel = new Button { Text = "Cancel", Left = 604, Top = 400, Width = 96, Height = 32, DialogResult = DialogResult.Cancel };
            ok.Click += delegate { if (SaveRows()) { DialogResult = DialogResult.OK; Close(); } };
            Controls.Add(ok); Controls.Add(cancel);
            AcceptButton = ok; CancelButton = cancel;
        }

        bool SaveRows()
        {
            grid.EndEdit();
            var list = new List<ExtraCompany>();
            string bizFrom = "", cashFrom = "";
            foreach (DataGridViewRow r in grid.Rows)
            {
                if (r.IsNewRow) continue;
                string key = Convert.ToString(r.Cells["Key"].Value ?? ""), label = Convert.ToString(r.Cells["Label"].Value ?? "").Trim(), company = Convert.ToString(r.Cells["Company"].Value ?? "").Trim();
                // "sync from": dd-mm-yyyy (or blank)
                string fromText = Convert.ToString(r.Cells["From"].Value ?? "").Trim(), from = "";
                if (fromText.Length > 0)
                {
                    DateTime d;
                    if (!DateTime.TryParseExact(fromText, new[] { "dd-MM-yyyy", "d-M-yyyy", "dd/MM/yyyy", "d/M/yyyy", "dd.MM.yyyy", "yyyy-MM-dd" }, CultureInfo.InvariantCulture, DateTimeStyles.None, out d) || d > DateTime.Today)
                    { MessageBox.Show(this, "“" + fromText + "” isn't a date. Use dd-mm-yyyy, e.g. 01-04-2026.", "Companies"); return false; }
                    from = d.ToString("yyyy-MM-dd");
                }
                if (key == "business") { bizFrom = from; continue; }
                if (key == "cash") { cashFrom = from; continue; }
                if (label.Length == 0 && company.Length == 0) continue;
                if (label.Length == 0 || company.Length == 0) { MessageBox.Show(this, "Give every company both a name and its Tally company.", "More companies"); return false; }
                if (company == settings.BusinessCompany || company == settings.CashCompany || list.Any(x => x.Company == company)) { MessageBox.Show(this, company + " is already in the list.", "More companies"); return false; }
                if (label.Equals(settings.BusinessLabel, StringComparison.OrdinalIgnoreCase) || label.Equals("Cash", StringComparison.OrdinalIgnoreCase) || list.Any(x => x.Label.Equals(label, StringComparison.OrdinalIgnoreCase)))
                { MessageBox.Show(this, "The name “" + label + "” is already used. Pick another.", "More companies"); return false; }
                // a permanent key: payments and synced figures refer to it, so renaming never breaks them
                if (key.Length == 0) key = "co" + Guid.NewGuid().ToString("N").Substring(0, 6);
                list.Add(new ExtraCompany { Key = key, Label = label, Company = company, SyncFrom = from });
            }
            // a changed start date: send that company's transactions again
            Action<string, string, string> changed = (k, before, after) => { if ((before ?? "") != after) settings.LastHash.Remove("v-" + k); };
            changed("business", settings.BusinessSyncFrom, bizFrom);
            changed("cash", settings.CashSyncFrom, cashFrom);
            foreach (var x in list) changed(x.Key, settings.SyncFromFor(x.Key), x.SyncFrom);
            settings.BusinessSyncFrom = bizFrom;
            settings.CashSyncFrom = cashFrom;
            settings.ExtraCompanies = list;
            settings.Save();
            return true;
        }
    }

    class SyncSettingsForm : Form
    {
        readonly SyncEngine sync;
        TextBox txtEmail, txtPassword, txtLog;
        ComboBox cboBusiness, cboCash;
        LinkLabel lnkExtra;
        static string ExtraText(Settings s) { int n = (s.ExtraCompanies ?? new List<ExtraCompany>()).Count; return n == 0 ? "Companies…" : "Companies (" + (n + 2) + ")…"; }
        NumericUpDown numInterval, numDays;
        CheckBox chkStartup, chkVouchers, chkStock, chkBills, chkMasters;
        Label lblBusiness, lblCash, lblNext, lblDot;
        Button btnSave, btnSync;
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string RunName = "ChittamEnterprises";

        // the company passphrase (when the data is encrypted from the app's Settings)
        public static void AskPassphrase(IWin32Window owner, SyncEngine sync)
        {
            var s = sync.Settings;
            try { Firebase.RefreshCrypto(s, Firebase.SignIn(s)); }
            catch (Exception ex) { MessageBox.Show(owner, "Could not check: " + ex.Message, "Passphrase", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            if (!Crypto.On)
            {
                MessageBox.Show(owner, "Encryption is off. It is turned on from the app: Settings → Encryption.", "Passphrase", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            using (var f = new Form { Text = "Passphrase", FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false,
                StartPosition = FormStartPosition.CenterParent, AutoScaleDimensions = new SizeF(96F, 96F), AutoScaleMode = AutoScaleMode.Dpi,
                ClientSize = new Size(440, 190), BackColor = Color.White, Font = Look.UI(9.75f) })
            {
                f.Controls.Add(new Label { Text = Crypto.Locked(s)
                    ? "The app's data is encrypted. Enter the company passphrase" + (Crypto.SetBy.Length > 0 ? " (set by " + Crypto.SetBy + ")" : "") + " so Tally sync can read and write it."
                    : "This PC already has the passphrase. Enter it again only if it was changed.",
                    Left = 18, Top = 16, Width = 404, Height = 56 });
                var txt = new TextBox { Left = 18, Top = 80, Width = 404, UseSystemPasswordChar = true };
                f.Controls.Add(txt);
                var err = new Label { Left = 18, Top = 110, Width = 404, Height = 22, ForeColor = Color.Firebrick };
                f.Controls.Add(err);
                var ok = new Button { Text = "Unlock", Left = 246, Top = 142, Width = 84, Height = 32 };
                var cancel = new Button { Text = "Cancel", Left = 338, Top = 142, Width = 84, Height = 32, DialogResult = DialogResult.Cancel };
                ok.Click += delegate {
                    f.Cursor = Cursors.WaitCursor;
                    bool good = Crypto.Unlock(s, txt.Text);
                    f.Cursor = Cursors.Default;
                    if (good) { f.DialogResult = DialogResult.OK; f.Close(); }
                    else err.Text = "That is not the passphrase.";
                };
                f.Controls.Add(ok); f.Controls.Add(cancel);
                f.AcceptButton = ok; f.CancelButton = cancel;
                if (f.ShowDialog(owner) == DialogResult.OK)
                {
                    sync.Log("Passphrase entered: encrypted data can be read and written.");
                    sync.Start(true);
                }
            }
        }

        public SyncSettingsForm(SyncEngine sync, Icon icon)
        {
            this.sync = sync;
            var s = sync.Settings;
            SuspendLayout();
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = "Tally Sync — Chittam Enterprises";
            Icon = icon;
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(900, 702);
            BackColor = Look.Page;
            Font = Look.UI(9.75f);

            // ---- header ----
            Controls.Add(new Label { Text = "Tally Sync", Left = 24, Top = 18, AutoSize = true, Font = Look.UI(17f, FontStyle.Bold), ForeColor = Look.Ink });
            Controls.Add(new Label { Text = "Sends customer balances and transactions from Tally to the app, so phones fill balances in and Tally Match can check payments.",
                Left = 26, Top = 56, Width = 850, Height = 22, ForeColor = Look.Soft });

            // ---- left column ----
            int L = 24, W = 420;
            var cLogin = Look.Card(L, 92, W, 150, "Sync login (Firebase user for this PC)");
            cLogin.Controls.Add(Look.FieldLabel("Email", 16, 44));
            txtEmail = new TextBox { Left = 110, Top = 40, Width = 290, Text = s.Email };
            cLogin.Controls.Add(txtEmail);
            cLogin.Controls.Add(Look.FieldLabel("Password", 16, 84));
            txtPassword = new TextBox { Left = 110, Top = 80, Width = 290, UseSystemPasswordChar = true, Text = s.Password };
            cLogin.Controls.Add(txtPassword);
            cLogin.Controls.Add(new Label { Text = "Stored encrypted for your Windows account.", Left = 110, Top = 112, AutoSize = true, ForeColor = Look.Soft, Font = Look.UI(8.5f), BackColor = Color.White });
            var lnkPass = new LinkLabel { Text = "Passphrase…", Left = 16, Top = 112, AutoSize = true, LinkColor = Look.Brand, BackColor = Color.White, Font = Look.UI(8.5f) };
            lnkPass.LinkClicked += delegate { AskPassphrase(this, sync); };
            cLogin.Controls.Add(lnkPass);
            Controls.Add(cLogin);

            var cCo = Look.Card(L, 254, W, 150, "Tally companies");
            cCo.Controls.Add(Look.FieldLabel("Business", 16, 44));
            cboBusiness = new ComboBox { Left = 110, Top = 40, Width = 290, DropDownStyle = ComboBoxStyle.DropDown, Text = s.BusinessCompany };
            cCo.Controls.Add(cboBusiness);
            cCo.Controls.Add(Look.FieldLabel("Cash", 16, 84));
            cboCash = new ComboBox { Left = 110, Top = 80, Width = 290, DropDownStyle = ComboBoxStyle.DropDown, Text = s.CashCompany };
            cCo.Controls.Add(cboCash);
            var lnkLoad = new LinkLabel { Text = "Load names from Tally", Left = 110, Top = 116, AutoSize = true, LinkColor = Look.Brand, BackColor = Color.White };
            lnkLoad.LinkClicked += delegate { LoadCompanies(true); };
            cCo.Controls.Add(lnkLoad);
            lnkExtra = new LinkLabel { Text = ExtraText(s), Left = 262, Top = 116, AutoSize = true, LinkColor = Look.Brand, BackColor = Color.White };
            lnkExtra.LinkClicked += delegate {
                var names = cboBusiness.Items.Cast<object>().Select(o => o.ToString()).ToList();
                using (var f = new ExtraCompaniesForm(sync.Settings, names))
                    if (f.ShowDialog(this) == DialogResult.OK)
                    {
                        lnkExtra.Text = ExtraText(sync.Settings);
                        sync.Log("Companies: " + string.Join(", ", sync.Settings.AllCompanies().Select(c => c[2] + " = " + c[1])));
                        sync.Start(true);
                    }
            };
            cCo.Controls.Add(lnkExtra);
            Controls.Add(cCo);

            var cSch = Look.Card(L, 416, W, 222, "Schedule and what to send");
            cSch.Controls.Add(Look.FieldLabel("Every", 16, 44));
            numInterval = new NumericUpDown { Left = 110, Top = 40, Width = 64, Minimum = 5, Maximum = 240, Value = Math.Max(5, Math.Min(240, s.IntervalMinutes)) };
            cSch.Controls.Add(numInterval);
            cSch.Controls.Add(new Label { Text = "minutes", Left = 180, Top = 44, AutoSize = true, BackColor = Color.White });
            chkStartup = new CheckBox { Text = "Start with Windows", Left = 260, Top = 42, AutoSize = true, Checked = IsStartupEnabled(), BackColor = Color.White };
            cSch.Controls.Add(chkStartup);
            chkVouchers = new CheckBox { Text = "Also send transactions (from 1 April, or the last", Left = 16, Top = 80, AutoSize = true, Checked = s.SyncVouchers, BackColor = Color.White };
            cSch.Controls.Add(chkVouchers);
            numDays = new NumericUpDown { Left = 330, Top = 77, Width = 64, Minimum = 7, Maximum = 366, Value = Math.Max(7, Math.Min(366, s.VoucherDays)) };
            cSch.Controls.Add(numDays);
            cSch.Controls.Add(new Label { Text = "days)", Left = 400, Top = 81, AutoSize = true, BackColor = Color.White });
            chkVouchers.CheckedChanged += delegate { numDays.Enabled = chkVouchers.Checked; };
            numDays.Enabled = chkVouchers.Checked;
            chkStock = new CheckBox { Text = "Also send stock quantities (fills in orders)", Left = 16, Top = 114, AutoSize = true, Checked = s.SyncStock, BackColor = Color.White };
            cSch.Controls.Add(chkStock);
            chkBills = new CheckBox { Text = "Also send open invoices with due dates (Payment Reminder)", Left = 16, Top = 146, AutoSize = true, Checked = s.SyncBills, BackColor = Color.White };
            cSch.Controls.Add(chkBills);
            chkMasters = new CheckBox { Text = "Add new customers and products from Tally", Left = 16, Top = 178, AutoSize = true, Checked = s.SyncMasters, BackColor = Color.White };
            cSch.Controls.Add(chkMasters);
            Controls.Add(cSch);

            btnSave = Look.Primary("Save");
            btnSave.SetBounds(L, 650, 130, 36);
            btnSave.Click += delegate { Save(true); };
            Controls.Add(btnSave);
            var btnClose = Look.Secondary("Close");
            btnClose.SetBounds(L + 140, 650, 110, 36);
            btnClose.Click += delegate { Close(); };
            Controls.Add(btnClose);

            // ---- right column ----
            int R = 460, RW = 416;
            var cStatus = Look.Card(R, 92, RW, 150, "Status");
            lblDot = new Label { Left = 16, Top = 44, Width = 10, Height = 10, BackColor = Look.Good };
            cStatus.Controls.Add(lblDot);
            lblNext = new Label { Left = 34, Top = 39, Width = 230, Height = 22, Font = Look.UI(10f, FontStyle.Bold), BackColor = Color.White, ForeColor = Look.Ink };
            cStatus.Controls.Add(lblNext);
            btnSync = Look.Primary("Sync now");
            btnSync.SetBounds(RW - 136, 34, 120, 34);
            btnSync.Click += delegate { if (Save(false)) sync.Start(true); };
            cStatus.Controls.Add(btnSync);
            lblBusiness = new Label { Left = 16, Top = 80, Width = RW - 32, Height = 26, BackColor = Color.White, ForeColor = Look.Soft, Font = Look.UI(9f) };
            cStatus.Controls.Add(lblBusiness);
            lblCash = new Label { Left = 16, Top = 108, Width = RW - 32, Height = 26, BackColor = Color.White, ForeColor = Look.Soft, Font = Look.UI(9f) };
            cStatus.Controls.Add(lblCash);
            Controls.Add(cStatus);

            var cLog = Look.Card(R, 254, RW, 432, "Activity");
            txtLog = new TextBox { Left = 14, Top = 38, Width = RW - 28, Height = 354, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical,
                BorderStyle = BorderStyle.None, BackColor = Color.FromArgb(250, 250, 250), Font = new Font("Consolas", 8.75f), ForeColor = Color.FromArgb(64, 64, 64) };
            txtLog.Text = string.Join(Environment.NewLine, sync.RecentLog()) + Environment.NewLine;
            cLog.Controls.Add(txtLog);
            var lnkLog = new LinkLabel { Text = "Open the full log", Left = 14, Top = 402, AutoSize = true, LinkColor = Look.Brand, BackColor = Color.White };
            lnkLog.LinkClicked += delegate { try { Process.Start("notepad.exe", "\"" + SyncEngine.LogPath + "\""); } catch { } };
            cLog.Controls.Add(lnkLog);
            Controls.Add(cLog);

            ResumeLayout(false);
            sync.Logged += OnLogged;
            sync.Changed += OnChanged;
            FormClosed += delegate { sync.Logged -= OnLogged; sync.Changed -= OnChanged; };
            Refresh2();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Dwm.Style(Handle, Look.Page, Look.Ink);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (!sync.Settings.Configured) txtEmail.Focus();
            LoadCompanies(false);
            txtLog.SelectionStart = txtLog.TextLength; txtLog.ScrollToCaret();
        }

        void OnLogged(string line)
        {
            if (IsDisposed) return;
            if (InvokeRequired) { BeginInvoke((Action)delegate { OnLogged(line); }); return; }
            txtLog.AppendText(line + Environment.NewLine);
        }
        void OnChanged()
        {
            if (IsDisposed) return;
            if (InvokeRequired) { BeginInvoke((Action)OnChanged); return; }
            Refresh2();
        }

        void Refresh2()
        {
            var s = sync.Settings;
            Func<string, string, string> line = (label, key) => {
                var b = sync.LastText(key); var v = sync.LastText("v-" + key);
                return label + ":  " + (b.Length > 0 ? b : "balances not sent yet") + (s.SyncVouchers ? (v.Length > 0 ? "  ·  " + Regex.Replace(v, "^.*· ", "") : "") : "");
            };
            lblBusiness.Text = line(s.BusinessLabel, "business");
            lblCash.Text = line(s.CashLabel, "cash");
            btnSync.Enabled = !sync.Busy;
            btnSync.Text = sync.Busy ? "Syncing…" : "Sync now";
            lblNext.Text = !s.Configured ? "Not set up yet" : sync.Busy ? "Syncing…" : sync.LastError.Length > 0 ? "Last try failed" : "Next check " + sync.NextSync.ToString("h:mm tt");
            lblDot.BackColor = !s.Configured || sync.LastError.Length > 0 ? Color.FromArgb(245, 158, 11) : Look.Good;
        }

        void LoadCompanies(bool showErrors)
        {
            try
            {
                var list = Tally.Companies(sync.Settings.TallyUrl);
                foreach (var cbo in new[] { cboBusiness, cboCash })
                {
                    var current = cbo.Text;
                    cbo.Items.Clear();
                    foreach (var n in list) cbo.Items.Add(n);
                    cbo.Text = current;
                }
                if (showErrors) sync.Log("Companies open in Tally: " + string.Join(", ", list));
            }
            catch (Exception ex)
            {
                if (showErrors) MessageBox.Show(this, ex.Message, "Tally Sync");
            }
        }

        bool Save(bool announce)
        {
            var s = sync.Settings;
            if (txtEmail.Text.Trim().Length == 0 || txtPassword.Text.Length == 0)
            {
                MessageBox.Show(this, "Enter the sync login email and password first.", "Tally Sync");
                return false;
            }
            bool loginChanged = s.Email != txtEmail.Text.Trim() || s.Password != txtPassword.Text;
            bool companiesChanged = s.BusinessCompany != cboBusiness.Text.Trim() || s.CashCompany != cboCash.Text.Trim();
            bool vouchersChanged = s.SyncVouchers != chkVouchers.Checked || s.VoucherDays != (int)numDays.Value ||
                (!s.SyncStock && chkStock.Checked) || (!s.SyncBills && chkBills.Checked) || (!s.SyncMasters && chkMasters.Checked);
            s.Email = txtEmail.Text.Trim();
            s.Password = txtPassword.Text;
            s.BusinessCompany = cboBusiness.Text.Trim();
            s.CashCompany = cboCash.Text.Trim();
            s.IntervalMinutes = (int)numInterval.Value;
            s.SyncVouchers = chkVouchers.Checked;
            s.VoucherDays = (int)numDays.Value;
            s.SyncStock = chkStock.Checked;
            s.SyncBills = chkBills.Checked;
            s.SyncMasters = chkMasters.Checked;
            if (companiesChanged) s.LastHash.Clear();   // upload fresh figures for the new companies
            s.Save();
            SetStartup(chkStartup.Checked);
            sync.NextSync = DateTime.Now.AddMinutes(s.IntervalMinutes);
            Refresh2();
            if (announce)
            {
                sync.Log("Settings saved.");
                if (loginChanged || companiesChanged || vouchersChanged) sync.Start(true);
            }
            return true;
        }

        static bool IsStartupEnabled()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue(RunName) != null;
        }

        static void SetStartup(bool on)
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            {
                if (k == null) return;
                if (on) k.SetValue(RunName, "\"" + Application.ExecutablePath + "\" /tray");
                else if (k.GetValue(RunName) != null) k.DeleteValue(RunName);
                // the earlier "Chittam Tally Sync" program is replaced by this one
                if (k.GetValue("ChittamTallySync") != null) k.DeleteValue("ChittamTallySync");
            }
        }
    }

    // ------------------------------------------------------------------ main window
    class MainForm : Form
    {
        readonly SyncEngine sync;
        WebView2 web;
        Panel splash;
        Label splashText;
        NotifyIcon tray;
        ToolStripMenuItem miStatus;
        System.Windows.Forms.Timer timer;
        EventWaitHandle showSignal;
        bool reallyExit, startHidden, toldAboutTray;
        SyncSettingsForm settingsForm;
        ToolStripMenuItem miUpdate;
        DateTime nextUpdateCheck = DateTime.Now.AddMinutes(1);

        void CheckForUpdate()
        {
            ThreadPool.QueueUserWorkItem(delegate {
                var before = Updater.ReadyVersion();
                Updater.Check(line => sync.Log(line));
                var ready = Updater.ReadyVersion();
                if (IsHandleCreated) BeginInvoke((Action)delegate {
                    miUpdate.Visible = ready != null;
                    if (ready != null) miUpdate.Text = "Restart to update to " + ready;
                    if (ready != null && ready != before)
                        tray.ShowBalloonTip(8000, "Update ready", "Chittam Enterprises " + ready + " is downloaded. It installs when the app restarts — or right-click the tray icon → Restart to update.", ToolTipIcon.Info);
                    PostStatus();
                });
            });
        }

        void RestartToUpdate()
        {
            if (Updater.ApplyIfReady(!Visible)) ExitApp();
            else MessageBox.Show(this, "The update isn't ready yet. Try again in a minute.", "Chittam Enterprises");
        }

        public MainForm(bool startHidden)
        {
            this.startHidden = startHidden;
            sync = new SyncEngine(Settings.Load());
            SuspendLayout();
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = "Chittam Enterprises";
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1360, 880);
            MinimumSize = new Size(420, 520);
            Font = Look.UI(9f);
            BackColor = Color.FromArgb(250, 250, 250);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // ---- the app fills the whole window ----
            web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(250, 250, 250) };
            Controls.Add(web);

            // ---- loading screen until the page is ready ----
            splash = new Panel { Dock = DockStyle.Fill, BackColor = Color.FromArgb(250, 250, 250) };
            var badge = new Label { Text = "CE", Width = 64, Height = 64, TextAlign = ContentAlignment.MiddleCenter, Font = Look.UI(18f, FontStyle.Bold), ForeColor = Color.White, BackColor = Look.Brand };
            var name = new Label { Text = "Chittam Enterprises", AutoSize = true, Font = Look.UI(16f, FontStyle.Bold), ForeColor = Look.Ink };
            splashText = new Label { Text = "Opening…", AutoSize = true, Font = Look.UI(10f), ForeColor = Look.Soft };
            splash.Controls.Add(badge); splash.Controls.Add(name); splash.Controls.Add(splashText);
            splash.Resize += delegate {
                int cx = splash.Width / 2, cy = splash.Height / 2;
                badge.Location = new Point(cx - badge.Width / 2, cy - 90);
                name.Location = new Point(cx - name.Width / 2, cy - 10);
                splashText.Location = new Point(cx - splashText.Width / 2, cy + 30);
                using (var path = Look.Rounded(new Rectangle(0, 0, badge.Width, badge.Height), badge.Width / 4)) badge.Region = new Region(path);
            };
            Controls.Add(splash);
            splash.BringToFront();
            ResumeLayout(false);

            // ---- tray ----
            tray = new NotifyIcon { Text = "Chittam Enterprises", Visible = true };
            tray.Icon = Icon ?? SystemIcons.Application;
            var trayMenu = new ContextMenuStrip { Font = Look.UI(9.5f), ShowImageMargin = false };
            trayMenu.Items.Add(new ToolStripMenuItem("Open Chittam Enterprises", null, delegate { ShowWindow(); }) { Font = Look.UI(9.5f, FontStyle.Bold) });
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("Tally sync now", null, delegate { SyncNow(); });
            trayMenu.Items.Add("Tally Sync settings…", null, delegate { ShowWindow(); OpenSyncSettings(); });
            miStatus = new ToolStripMenuItem("") { Enabled = false };
            trayMenu.Items.Add(miStatus);
            trayMenu.Items.Add(new ToolStripSeparator());
            miUpdate = new ToolStripMenuItem("Restart to update", null, delegate { RestartToUpdate(); }) { Visible = false, Font = Look.UI(9.5f, FontStyle.Bold) };
            trayMenu.Items.Add(miUpdate);
            trayMenu.Items.Add("Reload app", null, delegate { ShowWindow(); if (web.CoreWebView2 != null) web.CoreWebView2.Reload(); });
            trayMenu.Items.Add("Open the old version in the browser", null, delegate { OpenExternal(Program.ClassicUrl); });
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("Exit", null, delegate { ExitApp(); });
            tray.ContextMenuStrip = trayMenu;
            tray.DoubleClick += delegate { ShowWindow(); };

            // ---- sync timer ----
            sync.Changed += delegate { if (IsHandleCreated) BeginInvoke((Action)delegate { UpdateStatus(); PostStatus(); }); };
            sync.Logged += delegate { if (IsHandleCreated) BeginInvoke((Action)PostStatus); };
            sync.CompanySwitched += msg => { if (IsHandleCreated) BeginInvoke((Action)delegate { tray.ShowBalloonTip(8000, "Tally Sync", msg, ToolTipIcon.Info); }); };
            timer = new System.Windows.Forms.Timer { Interval = 15000 };
            timer.Tick += delegate {
                if (!sync.Busy && sync.Settings.Configured && DateTime.Now >= sync.NextSync) sync.Start(false);
                // new version of this program: a minute after start, then every 6 hours
                if (DateTime.Now >= nextUpdateCheck) { nextUpdateCheck = DateTime.Now.AddHours(6); CheckForUpdate(); }
                UpdateStatus();
            };
            timer.Start();
            UpdateStatus();
            sync.Log("Chittam Enterprises " + Program.DesktopVersion + " started." + (sync.Settings.Configured ? "" : " Tally sync is not set up yet."));

            // a second launch brings this window forward
            showSignal = NativeShow.Create();
            var t = new Thread(delegate () {
                while (true) { showSignal.WaitOne(); try { BeginInvoke((Action)ShowWindow); } catch { return; } }
            }) { IsBackground = true };
            t.Start();

            InitWeb();
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            // title bar in the app's own light grey
            Dwm.Style(Handle, Color.FromArgb(244, 244, 245), Look.Ink);
        }

        async void InitWeb()
        {
            try
            {
                var dataFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChittamEnterprises", "WebView2");
                var env = await CoreWebView2Environment.CreateAsync(null, dataFolder);
                await web.EnsureCoreWebView2Async(env);
                var core = web.CoreWebView2;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = true;
                core.Settings.AreDefaultContextMenusEnabled = true;
                core.Settings.IsGeneralAutofillEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;
                // the app page knows it is inside this window
                await core.AddScriptToExecuteOnDocumentCreatedAsync("window.chittamDesktop = { version: '" + Program.DesktopVersion + "' };");
                // WhatsApp and other outside links open in the normal browser / WhatsApp app
                core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
                core.NavigationStarting += (s, e) => { if (!IsAppUrl(e.Uri)) { e.Cancel = true; OpenExternal(e.Uri); } };
                core.NavigationCompleted += (s, e) => {
                    if (e.IsSuccess) splash.Visible = false;
                    else splashText.Text = "Could not open the app. Check the internet connection — retrying…";
                    if (!e.IsSuccess) RetrySoon();
                };
                core.WebMessageReceived += OnWebMessage;
                core.Navigate(Program.AppUrl);
            }
            catch (Exception ex)
            {
                var msg = "The app window needs Microsoft Edge WebView2, which is part of Windows 11.\n\n" + ex.Message +
                    "\n\nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start the app again.";
                MessageBox.Show(this, msg, "Chittam Enterprises");
            }
        }

        void RetrySoon()
        {
            var t = new System.Windows.Forms.Timer { Interval = 8000 };
            t.Tick += delegate { t.Stop(); t.Dispose(); if (web.CoreWebView2 != null && splash.Visible) web.CoreWebView2.Navigate(Program.AppUrl); };
            t.Start();
        }

        // messages from the app page: status, Sync now, settings, log
        void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!e.Source.StartsWith("https://tarun1203.github.io/", StringComparison.OrdinalIgnoreCase) &&
                !e.Source.StartsWith("http://localhost:", StringComparison.OrdinalIgnoreCase)) return;
            string type = "";
            Dictionary<string, object> obj;
            try
            {
                obj = new JavaScriptSerializer { MaxJsonLength = int.MaxValue }.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                object v; if (obj != null && obj.TryGetValue("type", out v) && v != null) type = v.ToString();
            }
            catch { return; }
            if (obj == null) return;
            switch (type)
            {
                case "tally-status": PostStatus(); break;
                case "tally-sync-now": SyncNow(); break;
                case "tally-settings": OpenSyncSettings(); break;
                case "tally-log": try { Process.Start("notepad.exe", "\"" + SyncEngine.LogPath + "\""); } catch { } break;
                case "tally-cashbank": SendCashBank(Str(obj, "key")); break;
                case "tally-post-receipt": PostReceipt(obj); break;
                case "share-file": ShareFile(obj); break;
                case "tally-voucher": SendVoucher(obj); break;
            }
        }

        // A PDF from the page (ledger / receipt): saved in Documents\Chittam Enterprises\<folder>,
        // put on the clipboard as a file, and the customer's WhatsApp chat opened, so Ctrl+V
        // in the chat attaches it.
        void SendVoucher(Dictionary<string, object> o)
        {
            string key = Str(o, "key"), id = Str(o, "id"), reqId = Str(o, "reqId");
            var company = CompanyFor(key);
            var reply = new Dictionary<string, object> { { "type", "tally-voucher" }, { "reqId", reqId }, { "ok", false } };
            DateTime d;
            if (!DateTime.TryParseExact(Str(o, "date"), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out d)) d = DateTime.Today;
            if (company.Length == 0 || id.Length == 0) { reply["error"] = "Company or voucher missing."; Reply(reply); return; }
            ThreadPool.QueueUserWorkItem(delegate
            {
                try { reply["voucher"] = Tally.VoucherDetail(sync.Settings.TallyUrl, company, id, d); reply["ok"] = true; reply["company"] = company; }
                catch (Exception ex) { reply["error"] = ex.Message; }
                try { BeginInvoke((Action)(() => Reply(reply))); } catch { }
            });
        }

        void ShareFile(Dictionary<string, object> o)
        {
            var reply = new Dictionary<string, object> { { "type", "share-file-result" }, { "ok", false } };
            try
            {
                var folder = Str(o, "folder") == "Ledgers" ? "Ledgers" : Str(o, "folder") == "Vouchers" ? "Vouchers" : "Receipts";
                var name = Regex.Replace(Str(o, "name"), @"[\\/:*?""<>|\x00-\x1f]+", " ").Trim();
                if (name.Length == 0) name = "Document";
                if (!name.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) name += ".pdf";
                byte[] bytes = Convert.FromBase64String(Str(o, "data"));
                if (bytes.Length < 5 || Encoding.ASCII.GetString(bytes, 0, 5) != "%PDF-") throw new Exception("That isn't a PDF.");
                var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "Chittam Enterprises", folder);
                Directory.CreateDirectory(dir);
                var path = Path.Combine(dir, name);
                // never overwrite an earlier file: add (2), (3)…
                for (int i = 2; File.Exists(path); i++) path = Path.Combine(dir, Path.GetFileNameWithoutExtension(name) + " (" + i + ").pdf");
                File.WriteAllBytes(path, bytes);
                var files = new System.Collections.Specialized.StringCollection(); files.Add(path);
                Clipboard.SetFileDropList(files);
                var phone = Regex.Replace(Str(o, "phone"), "[^0-9]", "");
                bool app = false;
                try { using (var k = Registry.ClassesRoot.OpenSubKey("whatsapp")) app = k != null; } catch { }
                try
                {
                    if (app) Process.Start(phone.Length > 0 ? "whatsapp://send?phone=" + phone : "whatsapp://");
                    else Process.Start(phone.Length > 0 ? "https://web.whatsapp.com/send?phone=" + phone : "https://web.whatsapp.com/");
                }
                catch { }
                reply["ok"] = true; reply["path"] = path; reply["whatsapp"] = true;
                sync.Log("Saved " + folder.ToLower().TrimEnd('s') + " PDF " + path + " and opened WhatsApp" + (phone.Length > 0 ? " for " + phone : ""));
            }
            catch (Exception ex) { reply["error"] = ex.Message; }
            Reply(reply);
        }

        static string Str(Dictionary<string, object> o, string k) { object v; return o.TryGetValue(k, out v) && v != null ? Convert.ToString(v, CultureInfo.InvariantCulture) : ""; }
        string CompanyFor(string key) { return sync.Settings.CompanyFor(key); }
        void Reply(Dictionary<string, object> o) { try { if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(new JavaScriptSerializer().Serialize(o)); } catch { } }

        void SendCashBank(string key)
        {
            var company = CompanyFor(key);
            ThreadPool.QueueUserWorkItem(delegate {
                var reply = new Dictionary<string, object> { { "type", "tally-cashbank" }, { "key", key }, { "company", company } };
                try
                {
                    var cb = Tally.CashBank(sync.Settings.TallyUrl, company);
                    reply["ledgers"] = cb.Select(x => x[0]).ToArray();
                    reply["banks"] = cb.Where(x => x[1] == "bank").Select(x => x[0]).ToArray();
                }
                catch (Exception ex) { reply["error"] = ex.Message; reply["ledgers"] = new string[0]; reply["banks"] = new string[0]; }
                BeginInvoke((Action)delegate { Reply(reply); });
            });
        }

        // a payment from the app -> a Receipt voucher in Tally, after a confirmation here
        void PostReceipt(Dictionary<string, object> o)
        {
            string key = Str(o, "key"), party = Str(o, "party"), into = Str(o, "into"), narration = Str(o, "narration"), receiptId = Str(o, "receiptId"), dateIso = Str(o, "date");
            double amount; double.TryParse(Str(o, "amount"), NumberStyles.Any, CultureInfo.InvariantCulture, out amount);
            DateTime date;
            var company = CompanyFor(key);
            Action<string> done = err => Reply(new Dictionary<string, object> { { "type", "tally-post-result" }, { "receiptId", receiptId }, { "ok", err == null }, { "error", err ?? "" } });
            if (!DateTime.TryParseExact(dateIso, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date) || amount <= 0 || party.Length == 0 || into.Length == 0)
            { done("Some details are missing."); return; }
            // bills to adjust and the instrument details, if the page sent them
            var bills = new List<Tally.BillPart>();
            object bo;
            if (o.TryGetValue("bills", out bo) && bo is System.Collections.ArrayList)
                foreach (var item in (System.Collections.ArrayList)bo)
                {
                    var d = item as Dictionary<string, object>; if (d == null) continue;
                    double ba; double.TryParse(Str(d, "amount"), NumberStyles.Any, CultureInfo.InvariantCulture, out ba);
                    if (ba > 0 && Str(d, "ref").Length > 0) bills.Add(new Tally.BillPart { Ref = Str(d, "ref"), Amount = Math.Round(ba, 2) });
                }
            if (bills.Sum(b => b.Amount) > amount + 0.004) { done("The bill amounts add up to more than the payment."); return; }
            Tally.BankDetails bank = null;
            object bk;
            if (o.TryGetValue("bank", out bk) && bk is Dictionary<string, object>)
            {
                var d = (Dictionary<string, object>)bk; DateTime idt;
                if (!DateTime.TryParseExact(Str(d, "date"), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out idt)) idt = date;
                bank = new Tally.BankDetails { Type = Str(d, "type").Length > 0 ? Str(d, "type") : "Others", Number = Str(d, "number"), Bank = Str(d, "bank"), Date = idt };
            }
            string restType = "On Account", restRef = "";
            object ro;
            if (o.TryGetValue("rest", out ro) && ro is Dictionary<string, object>)
            {
                var d = (Dictionary<string, object>)ro;
                if (Str(d, "type") == "New Ref" || Str(d, "type") == "Advance") { restType = Str(d, "type"); restRef = Str(d, "ref"); }
                if (restRef.Length == 0) restType = "On Account";
            }
            var inr = CultureInfo.GetCultureInfo("en-IN");
            double onAccount = Math.Round(amount - bills.Sum(b => b.Amount), 2);
            var billText = string.Concat(bills.Select(b => "   Against " + b.Ref + ":  ₹" + b.Amount.ToString("N2", inr) + "\n")) +
                (onAccount > 0.004 ? "   " + (restType == "On Account" ? "On Account" : restType + " " + restRef) + ":  ₹" + onAccount.ToString("N2", inr) + "\n" : "");
            var bankText = bank == null ? "" : "Transaction:  " + bank.Type + (bank.Number.Length > 0 ? " · No. " + bank.Number : "") +
                " · " + bank.Date.ToString("dd MMM yyyy") + (bank.Bank.Length > 0 ? " · " + bank.Bank : "") + "\n";
            // app entries go under "App Receipt" so they show in the Day Book; the narration is marked too
            if (!narration.StartsWith("[Chittam App]")) narration = ("[Chittam App] " + narration).Trim();
            bool typeExists;
            try { typeExists = Tally.VoucherTypeNumbering(sync.Settings.TallyUrl, company, Tally.AppReceiptType) != null; }
            catch (Exception ex) { done("Couldn't read Tally's voucher types: " + ex.Message); return; }
            var msg = "Create this voucher in Tally?\n\n" +
                "Company:  " + company + "\n" +
                "Voucher:  " + Tally.AppReceiptType + " (under Receipt)\n" +
                "Date:  " + date.ToString("dd MMM yyyy") + "\n" +
                "Received from:  " + party + "\n" +
                "Received into:  " + into + "\n" +
                "Amount:  ₹" + amount.ToString("N2", CultureInfo.GetCultureInfo("en-IN")) + "\n" +
                bankText +
                (narration.Length > 0 ? "Narration:  " + narration + "\n" : "") +
                "\nAdjusted against:\n" + billText +
                (typeExists ? "" : "\nFirst time in this company: the voucher type \"" + Tally.AppReceiptType + "\" (under Receipt) will be created, so receipts from the app show separately in the Day Book.\n");
            ShowWindow();
            if (MessageBox.Show(this, msg, "Post to Tally", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes)
            { done("Not posted."); return; }
            ThreadPool.QueueUserWorkItem(delegate {
                string err = null;
                if (!typeExists)
                {
                    var terr = Tally.CreateAppReceiptType(sync.Settings.TallyUrl, company);
                    if (terr != null) err = "Couldn't create the voucher type \"" + Tally.AppReceiptType + "\" in Tally: " + terr + ". Nothing was posted.";
                    else sync.Log("Created voucher type \"" + Tally.AppReceiptType + "\" in " + company);
                }
                if (err == null) err = Tally.PostReceipt(sync.Settings.TallyUrl, company, date, party, into, amount, narration, bills, bank, restType, restRef, Tally.AppReceiptType);
                sync.Log(err == null ? "Posted to Tally: " + Tally.AppReceiptType + " " + party + " ₹" + amount.ToString("0.##", CultureInfo.InvariantCulture) + " into " + into + " (" + company + ")" : "Posting to Tally failed: " + err);
                if (err == null)
                {
                    try { var token = Firebase.SignIn(sync.Settings); Firebase.LogVoucherPosted(sync.Settings, token, company, party, amount, into, dateIso, receiptId); } catch { }
                    sync.Start(true);   // bring the new voucher back so Tally Match shows it matched
                }
                BeginInvoke((Action)delegate { done(err); });
            });
        }

        void PostStatus()
        {
            try { if (web.CoreWebView2 != null) web.CoreWebView2.PostWebMessageAsJson(sync.StatusJson()); } catch { }
        }

        void SyncNow()
        {
            if (sync.Settings.Configured) sync.Start(true);
            else { ShowWindow(); OpenSyncSettings(); }
        }

        static bool IsAppUrl(string uri)
        {
            return uri.StartsWith("https://tarun1203.github.io/", StringComparison.OrdinalIgnoreCase) ||
                uri.StartsWith("blob:", StringComparison.OrdinalIgnoreCase) ||
                uri.StartsWith("data:", StringComparison.OrdinalIgnoreCase) ||
                uri.StartsWith("about:", StringComparison.OrdinalIgnoreCase);
        }

        static void OpenExternal(string uri)
        {
            if (!(uri.StartsWith("https://") || uri.StartsWith("http://") || uri.StartsWith("mailto:") || uri.StartsWith("tel:") || uri.StartsWith("whatsapp:"))) return;
            try { Process.Start(new ProcessStartInfo(uri) { UseShellExecute = true }); } catch { }
        }

        void UpdateStatus()
        {
            var s = sync.Settings;
            string text;
            if (!s.Configured) text = "Tally sync not set up";
            else if (sync.Busy) text = "Syncing with Tally…";
            else if (sync.LastError.Length > 0) text = "Tally sync: last try failed";
            else text = "Tally sync · next " + sync.NextSync.ToString("h:mm tt");
            miStatus.Text = text;
            var tip = "Chittam Enterprises — " + text;
            tray.Text = tip.Length > 63 ? "Chittam Enterprises" : tip;
        }

        void OpenSyncSettings()
        {
            if (settingsForm != null && !settingsForm.IsDisposed) { settingsForm.Activate(); return; }
            settingsForm = new SyncSettingsForm(sync, Icon);
            settingsForm.Show(this);
        }

        protected override void SetVisibleCore(bool value)
        {
            // started with Windows (/tray): stay in the tray, keep syncing, until opened
            if (startHidden && !IsHandleCreated) { CreateHandle(); value = false; }
            base.SetVisibleCore(value);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (!sync.Settings.Configured) BeginInvoke((Action)delegate {
                tray.ShowBalloonTip(5000, "Tally sync not set up", "Right-click the tray icon → Tally Sync settings… to send Tally balances to the app.", ToolTipIcon.Info);
            });
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!reallyExit && e.CloseReason == CloseReason.UserClosing)
            {
                // closing the window keeps Tally sync running in the tray
                e.Cancel = true;
                Hide();
                if (!toldAboutTray)
                {
                    tray.ShowBalloonTip(4000, "Still running", "Chittam Enterprises keeps syncing Tally here. Right-click the icon → Exit to close it fully.", ToolTipIcon.Info);
                    toldAboutTray = true;
                }
                return;
            }
            tray.Visible = false;
            base.OnFormClosing(e);
        }

        void ShowWindow()
        {
            startHidden = false;
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Activate();
        }

        void ExitApp()
        {
            reallyExit = true;
            Close();
        }
    }
}
