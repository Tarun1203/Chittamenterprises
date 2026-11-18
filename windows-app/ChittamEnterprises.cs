// Chittam Enterprises - Windows app.
//
// The whole Chittam app (orders, service jobs, messages, payments, history…)
// in its own window, like the Android app, using Microsoft's WebView2 (the
// Edge engine built into Windows). Sign-in and offline data are kept between
// runs. WhatsApp and other outside links open in the normal browser / app.
//
// Tally sync is built in: it reads each company's Sundry Debtors closing
// balances from Tally (http://localhost:9000) and saves them to the app's
// Firebase database, so Payment Updated / Payment Reminder / Balance
// Confirmation fill balances in on every phone. Business company -> business
// balance, cash company -> cash balance. Uploads only when balances changed;
// each upload is written to the app's History. Closing the window keeps the
// sync running in the tray (near the clock).
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
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Xml;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Win32;

namespace ChittamEnterprises
{
    static class Program
    {
        public const string AppUrl = "https://tarun1203.github.io/Chittamenterprises/";
        public const string DesktopVersion = "1.0";

        [STAThread]
        static void Main(string[] args)
        {
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

    // ------------------------------------------------------------------ settings
    class Settings
    {
        public string Email = "";
        public string PasswordProtected = "";      // DPAPI, base64
        public string BusinessCompany = "Chittam Enterprises - 2026";
        public string BusinessLabel = "Chittam Enterprises";
        public string CashCompany = "Cash";
        public string CashLabel = "Cash Bill";
        public int IntervalMinutes = 30;
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
                        var s = new JavaScriptSerializer().Deserialize<Settings>(File.ReadAllText(path, Encoding.UTF8));
                        if (s.LastHash == null) s.LastHash = new Dictionary<string, string>();
                        if (s.LastStatus == null) s.LastStatus = new Dictionary<string, string>();
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
                string text = (bytes.Length >= 2 && ((bytes[0] == 0xFF && bytes[1] == 0xFE) || bytes[1] == 0))
                    ? Encoding.Unicode.GetString(bytes) : Encoding.UTF8.GetString(bytes);
                text = text.TrimStart('﻿');
                // Tally sometimes sends control characters that are not allowed in XML
                text = Regex.Replace(text, "&#(0*[0-8]|0*1[1-2]|0*1[4-9]|0*2[0-9]|0*3[01]);", "");
                text = Regex.Replace(text, "[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F]", "");
                var err = Regex.Match(text, "<LINEERROR>(.*?)</LINEERROR>");
                if (err.Success) throw new Exception("Tally: " + WebUtility.HtmlDecode(err.Groups[1].Value));
                return text;
            }
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
            return m.Success ? double.Parse(m.Value, System.Globalization.CultureInfo.InvariantCulture) : 0;
        }

        // same rule as the app's normalizeName(): trim, lower case, single spaces
        public static string Normalize(string s)
        {
            return Regex.Replace(s.Trim().ToLowerInvariant(), "\\s+", " ");
        }

        // normalized name -> receivable, plus normalized name -> name as in Tally
        public static void Balances(string url, string company, out Dictionary<string, double> balances, out Dictionary<string, string> names)
        {
            var xml = Post(url, "<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC>" +
                "<REPORTNAME>Group Summary</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>" +
                "<SVCURRENTCOMPANY>" + System.Security.SecurityElement.Escape(company) + "</SVCURRENTCOMPANY>" +
                "<GROUPNAME>Sundry Debtors</GROUPNAME><EXPLODEFLAG>Yes</EXPLODEFLAG>" +
                "</STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>");
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
        static Dictionary<string, object> Ts(string iso) { return new Dictionary<string, object> { { "timestampValue", iso } }; }
        static Dictionary<string, object> Map(Dictionary<string, object> fields)
        {
            return new Dictionary<string, object> { { "mapValue", new Dictionary<string, object> { { "fields", fields } } } };
        }

        public static void SaveBalances(Settings s, string token, string key, string label, string company,
            Dictionary<string, double> balances, Dictionary<string, string> names)
        {
            string now = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ");
            var bal = new Dictionary<string, object>();
            foreach (var kv in balances) bal[kv.Key] = new Dictionary<string, object> { { "doubleValue", kv.Value } };
            var nm = new Dictionary<string, object>();
            foreach (var kv in names) nm[kv.Key] = Str(kv.Value);

            var fields = new Dictionary<string, object> {
                { "company", Str(key) }, { "label", Str(label) }, { "file", Str("Auto from Tally: " + company) },
                { "importedAt", Str(now) }, { "importedBy", Str(s.Email) }, { "matched", Int(balances.Count) },
                { "unmatched", new Dictionary<string, object> { { "arrayValue", new Dictionary<string, object> { { "values", new object[0] } } } } },
                { "balances", Map(bal) }, { "names", Map(nm) }, { "at", Ts(now) }, { "by", Str(s.Email) }
            };
            string baseUrl = "https://firestore.googleapis.com/v1/projects/" + s.ProjectId + "/databases/(default)/documents/";
            Send("PATCH", baseUrl + "balances/" + key, token, new Dictionary<string, object> { { "fields", fields } });

            // one line in the app's History for each upload
            var log = new Dictionary<string, object> {
                { "collection", Str("app") }, { "action", Str("balances-synced") }, { "name", Str(label) },
                { "details", Map(new Dictionary<string, object> { { "name", Str(label) }, { "company", Str(company) }, { "names", Int(balances.Count) } }) },
                { "at", Ts(now) }, { "by", Str(s.Email) }
            };
            Send("POST", baseUrl + "activity", token, new Dictionary<string, object> { { "fields", log } });
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

        public SyncEngine(Settings s) { Settings = s; }

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
            var h = Logged; if (h != null) h(line);
        }

        public static string LogPath { get { return Path.Combine(Settings.Folder, "sync.log"); } }

        public string StatusText(string key)
        {
            string v;
            string label = key == "business" ? Settings.BusinessLabel : Settings.CashLabel;
            return label + ": " + (Settings.LastStatus.TryGetValue(key, out v) ? "last uploaded " + v : "not uploaded yet");
        }

        // runs on a worker thread; Changed fires when done
        public void Start(bool force)
        {
            if (Busy || !Settings.Configured) return;
            Busy = true;
            var h0 = Changed; if (h0 != null) h0();
            ThreadPool.QueueUserWorkItem(delegate {
                try { Run(force); }
                catch (Exception ex) { Log("ERROR: " + ex.Message); }
                finally
                {
                    Busy = false;
                    NextSync = DateTime.Now.AddMinutes(Math.Max(5, Settings.IntervalMinutes));
                    var h = Changed; if (h != null) h();
                }
            });
        }

        void Run(bool force)
        {
            string token = null;
            var jobs = new[] {
                new[] { "business", Settings.BusinessCompany, Settings.BusinessLabel },
                new[] { "cash", Settings.CashCompany, Settings.CashLabel }
            };
            foreach (var j in jobs)
            {
                string key = j[0], company = j[1], label = j[2];
                if (string.IsNullOrEmpty(company)) continue;
                Dictionary<string, double> bal; Dictionary<string, string> names;
                try { Tally.Balances(Settings.TallyUrl, company, out bal, out names); }
                catch (Exception ex) { Log("[" + company + "] skipped: " + ex.Message); continue; }

                var sig = string.Join("|", bal.Keys.OrderBy(k => k, StringComparer.Ordinal).Select(k => k + "=" + bal[k].ToString(System.Globalization.CultureInfo.InvariantCulture)));
                string hash;
                using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(sig))).Replace("-", "");
                string last;
                if (!force && Settings.LastHash.TryGetValue(key, out last) && last == hash)
                {
                    Log("[" + company + "] no change");
                    continue;
                }
                if (token == null) token = Firebase.SignIn(Settings);
                Firebase.SaveBalances(Settings, token, key, label, company, bal, names);
                Settings.LastHash[key] = hash;
                Settings.LastStatus[key] = DateTime.Now.ToString("dd MMM yyyy, h:mm tt") + " · " + bal.Count + " names";
                Settings.Save();
                Log("[" + company + "] uploaded " + bal.Count + " balances");
            }
        }
    }

    // ------------------------------------------------------------------ sync settings window
    class SyncSettingsForm : Form
    {
        readonly SyncEngine sync;
        TextBox txtEmail, txtPassword, txtLog;
        ComboBox cboBusiness, cboCash;
        NumericUpDown numInterval;
        CheckBox chkStartup;
        Label lblBusiness, lblCash, lblNext;
        Button btnSave, btnSync;
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string RunName = "ChittamEnterprises";

        public SyncSettingsForm(SyncEngine sync, Icon icon)
        {
            this.sync = sync;
            var s = sync.Settings;
            Text = "Tally Sync — Chittam Enterprises";
            Icon = icon;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false; MinimizeBox = false;
            StartPosition = FormStartPosition.CenterParent;
            ClientSize = new Size(560, 590);
            Font = new Font("Segoe UI", 9.5f);

            int y = 12;
            Controls.Add(new Label { Text = "Sends customer balances from Tally to the app so phones fill them in.", Left = 14, Top = y, Width = 530, Height = 20 });
            y += 28;

            var gLogin = new GroupBox { Text = "Sync login (Firebase user for this PC)", Left = 12, Top = y, Width = 536, Height = 92 };
            gLogin.Controls.Add(new Label { Text = "Email", Left = 12, Top = 27, Width = 80 });
            txtEmail = new TextBox { Left = 100, Top = 24, Width = 420, Text = s.Email };
            gLogin.Controls.Add(txtEmail);
            gLogin.Controls.Add(new Label { Text = "Password", Left = 12, Top = 59, Width = 80 });
            txtPassword = new TextBox { Left = 100, Top = 56, Width = 420, UseSystemPasswordChar = true, Text = s.Password };
            gLogin.Controls.Add(txtPassword);
            Controls.Add(gLogin);
            y += 100;

            var gCo = new GroupBox { Text = "Tally companies", Left = 12, Top = y, Width = 536, Height = 128 };
            gCo.Controls.Add(new Label { Text = "Business", Left = 12, Top = 27, Width = 80 });
            cboBusiness = new ComboBox { Left = 100, Top = 24, Width = 300, DropDownStyle = ComboBoxStyle.DropDown, Text = s.BusinessCompany };
            gCo.Controls.Add(cboBusiness);
            gCo.Controls.Add(new Label { Text = "→ " + s.BusinessLabel, Left = 406, Top = 27, Width = 125, ForeColor = Color.DimGray });
            gCo.Controls.Add(new Label { Text = "Cash", Left = 12, Top = 59, Width = 80 });
            cboCash = new ComboBox { Left = 100, Top = 56, Width = 300, DropDownStyle = ComboBoxStyle.DropDown, Text = s.CashCompany };
            gCo.Controls.Add(cboCash);
            gCo.Controls.Add(new Label { Text = "→ " + s.CashLabel, Left = 406, Top = 59, Width = 125, ForeColor = Color.DimGray });
            var btnLoad = new Button { Text = "Load company names from Tally", Left = 100, Top = 88, Width = 230, Height = 28 };
            btnLoad.Click += delegate { LoadCompanies(true); };
            gCo.Controls.Add(btnLoad);
            Controls.Add(gCo);
            y += 136;

            var gSync = new GroupBox { Text = "Sync", Left = 12, Top = y, Width = 536, Height = 62 };
            gSync.Controls.Add(new Label { Text = "Every", Left = 12, Top = 27, Width = 45 });
            numInterval = new NumericUpDown { Left = 60, Top = 24, Width = 60, Minimum = 5, Maximum = 240, Value = Math.Max(5, Math.Min(240, s.IntervalMinutes)) };
            gSync.Controls.Add(numInterval);
            gSync.Controls.Add(new Label { Text = "minutes", Left = 126, Top = 27, Width = 60 });
            chkStartup = new CheckBox { Text = "Start with Windows (in the tray)", Left = 220, Top = 25, Width = 260, Checked = IsStartupEnabled() };
            gSync.Controls.Add(chkStartup);
            Controls.Add(gSync);
            y += 70;

            btnSave = new Button { Text = "Save", Left = 12, Top = y, Width = 120, Height = 32 };
            btnSave.Click += delegate { Save(true); };
            Controls.Add(btnSave);
            btnSync = new Button { Text = "Sync now", Left = 140, Top = y, Width = 120, Height = 32 };
            btnSync.Click += delegate { if (Save(false)) sync.Start(true); };
            Controls.Add(btnSync);
            lblNext = new Label { Left = 272, Top = y + 8, Width = 276, Height = 20, ForeColor = Color.DimGray };
            Controls.Add(lblNext);
            y += 42;

            lblBusiness = new Label { Left = 14, Top = y, Width = 534, Height = 20 };
            Controls.Add(lblBusiness);
            lblCash = new Label { Left = 14, Top = y + 22, Width = 534, Height = 20 };
            Controls.Add(lblCash);
            y += 50;

            txtLog = new TextBox { Left = 12, Top = y, Width = 536, Height = ClientSize.Height - y - 12, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, BackColor = Color.White };
            try { if (File.Exists(SyncEngine.LogPath)) { var lines = File.ReadAllLines(SyncEngine.LogPath); txtLog.Text = string.Join(Environment.NewLine, lines.Skip(Math.Max(0, lines.Length - 60))) + Environment.NewLine; } } catch { }
            Controls.Add(txtLog);

            sync.Logged += OnLogged;
            sync.Changed += OnChanged;
            FormClosed += delegate { sync.Logged -= OnLogged; sync.Changed -= OnChanged; };
            Refresh2();
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
            lblBusiness.Text = sync.StatusText("business");
            lblCash.Text = sync.StatusText("cash");
            btnSync.Enabled = !sync.Busy;
            btnSync.Text = sync.Busy ? "Syncing…" : "Sync now";
            lblNext.Text = !sync.Settings.Configured ? "Not set up yet" : sync.Busy ? "Syncing…" : "Next check: " + sync.NextSync.ToString("h:mm tt");
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
            s.Email = txtEmail.Text.Trim();
            s.Password = txtPassword.Text;
            s.BusinessCompany = cboBusiness.Text.Trim();
            s.CashCompany = cboCash.Text.Trim();
            s.IntervalMinutes = (int)numInterval.Value;
            if (companiesChanged) s.LastHash.Clear();   // upload fresh figures for the new companies
            s.Save();
            SetStartup(chkStartup.Checked);
            sync.NextSync = DateTime.Now.AddMinutes(s.IntervalMinutes);
            Refresh2();
            if (announce)
            {
                sync.Log("Settings saved.");
                if (loginChanged || companiesChanged) sync.Start(true);
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
        NotifyIcon tray;
        ToolStripMenuItem miStatus;
        System.Windows.Forms.Timer timer;
        EventWaitHandle showSignal;
        bool reallyExit, startHidden, toldAboutTray;
        SyncSettingsForm settingsForm;

        public MainForm(bool startHidden)
        {
            this.startHidden = startHidden;
            sync = new SyncEngine(Settings.Load());
            Text = "Chittam Enterprises";
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(1320, 860);
            MinimumSize = new Size(420, 500);
            Font = new Font("Segoe UI", 9f);
            BackColor = Color.FromArgb(250, 250, 250);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // ---- menu ----
            var menu = new MenuStrip { BackColor = Color.White, Padding = new Padding(4, 2, 0, 2) };
            var mApp = new ToolStripMenuItem("App");
            mApp.DropDownItems.Add(new ToolStripMenuItem("Reload", null, delegate { if (web.CoreWebView2 != null) web.CoreWebView2.Reload(); }) { ShortcutKeys = Keys.F5 });
            mApp.DropDownItems.Add(new ToolStripMenuItem("Zoom in", null, delegate { web.ZoomFactor = Math.Min(3, web.ZoomFactor + 0.1); }) { ShortcutKeyDisplayString = "Ctrl++" });
            mApp.DropDownItems.Add(new ToolStripMenuItem("Zoom out", null, delegate { web.ZoomFactor = Math.Max(0.5, web.ZoomFactor - 0.1); }) { ShortcutKeyDisplayString = "Ctrl+-" });
            mApp.DropDownItems.Add(new ToolStripMenuItem("Actual size", null, delegate { web.ZoomFactor = 1; }) { ShortcutKeyDisplayString = "Ctrl+0" });
            mApp.DropDownItems.Add(new ToolStripSeparator());
            mApp.DropDownItems.Add(new ToolStripMenuItem("Open in browser", null, delegate { OpenExternal(Program.AppUrl); }));
            mApp.DropDownItems.Add(new ToolStripMenuItem("Exit", null, delegate { ExitApp(); }));
            var mSync = new ToolStripMenuItem("Tally Sync");
            mSync.DropDownItems.Add(new ToolStripMenuItem("Sync now", null, delegate { if (sync.Settings.Configured) sync.Start(true); else OpenSyncSettings(); }));
            mSync.DropDownItems.Add(new ToolStripMenuItem("Sync settings…", null, delegate { OpenSyncSettings(); }));
            miStatus = new ToolStripMenuItem("") { Enabled = false };
            mSync.DropDownItems.Add(new ToolStripSeparator());
            mSync.DropDownItems.Add(miStatus);
            var mHelp = new ToolStripMenuItem("Help");
            mHelp.DropDownItems.Add(new ToolStripMenuItem("About", null, delegate {
                MessageBox.Show(this, "Chittam Enterprises for Windows " + Program.DesktopVersion + "\n\nThe app itself updates automatically from:\n" + Program.AppUrl +
                    "\n\nTally Sync settings and log:\n" + Settings.Folder, "About");
            }));
            menu.Items.Add(mApp); menu.Items.Add(mSync); menu.Items.Add(mHelp);
            MainMenuStrip = menu;

            // ---- the app ----
            web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(250, 250, 250) };
            Controls.Add(web);
            Controls.Add(menu);

            // ---- tray ----
            tray = new NotifyIcon { Text = "Chittam Enterprises", Visible = true };
            tray.Icon = Icon ?? SystemIcons.Application;
            var trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("Open Chittam Enterprises", null, delegate { ShowWindow(); });
            trayMenu.Items.Add("Tally sync now", null, delegate { if (sync.Settings.Configured) sync.Start(true); else { ShowWindow(); OpenSyncSettings(); } });
            trayMenu.Items.Add("Tally sync settings…", null, delegate { ShowWindow(); OpenSyncSettings(); });
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("Exit", null, delegate { ExitApp(); });
            tray.ContextMenuStrip = trayMenu;
            tray.DoubleClick += delegate { ShowWindow(); };

            // ---- sync timer ----
            sync.Changed += delegate { if (IsHandleCreated) BeginInvoke((Action)UpdateStatus); };
            timer = new System.Windows.Forms.Timer { Interval = 15000 };
            timer.Tick += delegate {
                if (!sync.Busy && sync.Settings.Configured && DateTime.Now >= sync.NextSync) sync.Start(false);
                UpdateStatus();
            };
            timer.Start();
            UpdateStatus();
            sync.Log("Chittam Enterprises started." + (sync.Settings.Configured ? "" : " Tally sync is not set up yet."));

            // a second launch brings this window forward
            showSignal = NativeShow.Create();
            var t = new Thread(delegate () {
                while (true) { showSignal.WaitOne(); try { BeginInvoke((Action)ShowWindow); } catch { return; } }
            }) { IsBackground = true };
            t.Start();

            InitWeb();
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
                // WhatsApp and other outside links open in the normal browser / WhatsApp app
                core.NewWindowRequested += (s, e) => { e.Handled = true; OpenExternal(e.Uri); };
                core.NavigationStarting += (s, e) => { if (!IsAppUrl(e.Uri)) { e.Cancel = true; OpenExternal(e.Uri); } };
                core.Navigate(Program.AppUrl);
            }
            catch (Exception ex)
            {
                var msg = "The app window needs Microsoft Edge WebView2, which is part of Windows 11.\n\n" + ex.Message +
                    "\n\nInstall it from https://go.microsoft.com/fwlink/p/?LinkId=2124703 and start the app again.";
                MessageBox.Show(this, msg, "Chittam Enterprises");
            }
        }

        static bool IsAppUrl(string uri)
        {
            return uri.StartsWith(Program.AppUrl, StringComparison.OrdinalIgnoreCase) ||
                uri.StartsWith("https://tarun1203.github.io/", StringComparison.OrdinalIgnoreCase) ||
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
            if (!s.Configured) text = "Not set up — open Sync settings";
            else if (sync.Busy) text = "Syncing…";
            else
            {
                string b, c;
                s.LastStatus.TryGetValue("business", out b);
                s.LastStatus.TryGetValue("cash", out c);
                text = "Last: " + (b ?? c ?? "not yet") + " · next " + sync.NextSync.ToString("h:mm tt");
            }
            miStatus.Text = text;
            tray.Text = ("Chittam Enterprises — " + text).Length > 63 ? "Chittam Enterprises" : "Chittam Enterprises — " + text;
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
                tray.ShowBalloonTip(5000, "Tally sync not set up", "Open Tally Sync → Sync settings… to send Tally balances to the app.", ToolTipIcon.Info);
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
