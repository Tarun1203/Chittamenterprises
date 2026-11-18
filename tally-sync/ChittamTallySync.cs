// Chittam Tally Sync - Windows tray app.
//
// Reads each company's Sundry Debtors closing balances from Tally
// (http://localhost:9000) and saves them to the Chittam app's Firebase
// database, so Payment Updated / Payment Reminder / Balance Confirmation fill
// balances in on every phone. Business company -> business balance, cash
// company -> cash balance. Uploads only when balances changed; each upload is
// written to the app's History.
//
// Settings live in %APPDATA%\ChittamTallySync\settings.json; the password is
// encrypted with Windows DPAPI for the current Windows user.
//
// Build with build.ps1 (uses the C# compiler that ships with Windows).
// Written for C# 5 / .NET Framework 4.x, which that compiler supports.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Xml;
using Microsoft.Win32;

namespace ChittamTallySync
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, "ChittamTallySync_SingleInstance", out created))
            {
                if (!created)
                {
                    MessageBox.Show("Chittam Tally Sync is already running - look for its icon near the clock.", "Chittam Tally Sync");
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
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ChittamTallySync"); }
        }
        static string FilePath { get { return Path.Combine(Folder, "settings.json"); } }

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

        public static Settings Load()
        {
            try
            {
                if (File.Exists(FilePath))
                {
                    var s = new JavaScriptSerializer().Deserialize<Settings>(File.ReadAllText(FilePath, Encoding.UTF8));
                    if (s.LastHash == null) s.LastHash = new Dictionary<string, string>();
                    if (s.LastStatus == null) s.LastStatus = new Dictionary<string, string>();
                    return s;
                }
            }
            catch { }
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
                "<SVCURRENTCOMPANY>" + SecurityElementEscape(company) + "</SVCURRENTCOMPANY>" +
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

        static string SecurityElementEscape(string s)
        {
            return System.Security.SecurityElement.Escape(s);
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

    // ------------------------------------------------------------------ window
    class MainForm : Form
    {
        Settings settings;
        TextBox txtEmail, txtPassword, txtLog;
        ComboBox cboBusiness, cboCash;
        NumericUpDown numInterval;
        CheckBox chkStartup;
        Label lblBusiness, lblCash, lblNext;
        Button btnSave, btnSync, btnLoadCompanies;
        NotifyIcon tray;
        System.Windows.Forms.Timer timer;
        DateTime nextSync;
        bool syncing, reallyExit, startHidden, toldAboutTray;
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        public MainForm(bool startHidden)
        {
            this.startHidden = startHidden;
            settings = Settings.Load();
            Text = "Chittam Tally Sync";
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(560, 600);
            Font = new Font("Segoe UI", 9.5f);
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            int y = 12;
            var title = new Label { Text = "Sends customer balances from Tally to the Chittam app every few minutes.", Left = 14, Top = y, Width = 530, Height = 20 };
            Controls.Add(title);
            y += 28;

            var gLogin = new GroupBox { Text = "Sync login (Firebase user for this PC)", Left = 12, Top = y, Width = 536, Height = 92 };
            gLogin.Controls.Add(new Label { Text = "Email", Left = 12, Top = 27, Width = 80 });
            txtEmail = new TextBox { Left = 100, Top = 24, Width = 420, Text = settings.Email };
            gLogin.Controls.Add(txtEmail);
            gLogin.Controls.Add(new Label { Text = "Password", Left = 12, Top = 59, Width = 80 });
            txtPassword = new TextBox { Left = 100, Top = 56, Width = 420, UseSystemPasswordChar = true, Text = settings.Password };
            gLogin.Controls.Add(txtPassword);
            Controls.Add(gLogin);
            y += 100;

            var gCo = new GroupBox { Text = "Tally companies", Left = 12, Top = y, Width = 536, Height = 128 };
            gCo.Controls.Add(new Label { Text = "Business", Left = 12, Top = 27, Width = 80 });
            cboBusiness = new ComboBox { Left = 100, Top = 24, Width = 300, DropDownStyle = ComboBoxStyle.DropDown, Text = settings.BusinessCompany };
            gCo.Controls.Add(cboBusiness);
            gCo.Controls.Add(new Label { Text = "→ " + settings.BusinessLabel, Left = 406, Top = 27, Width = 125, ForeColor = Color.DimGray });
            gCo.Controls.Add(new Label { Text = "Cash", Left = 12, Top = 59, Width = 80 });
            cboCash = new ComboBox { Left = 100, Top = 56, Width = 300, DropDownStyle = ComboBoxStyle.DropDown, Text = settings.CashCompany };
            gCo.Controls.Add(cboCash);
            gCo.Controls.Add(new Label { Text = "→ " + settings.CashLabel, Left = 406, Top = 59, Width = 125, ForeColor = Color.DimGray });
            btnLoadCompanies = new Button { Text = "Load company names from Tally", Left = 100, Top = 88, Width = 230, Height = 28 };
            btnLoadCompanies.Click += delegate { LoadCompanies(true); };
            gCo.Controls.Add(btnLoadCompanies);
            Controls.Add(gCo);
            y += 136;

            var gSync = new GroupBox { Text = "Sync", Left = 12, Top = y, Width = 536, Height = 62 };
            gSync.Controls.Add(new Label { Text = "Every", Left = 12, Top = 27, Width = 45 });
            numInterval = new NumericUpDown { Left = 60, Top = 24, Width = 60, Minimum = 5, Maximum = 240, Value = Math.Max(5, Math.Min(240, settings.IntervalMinutes)) };
            gSync.Controls.Add(numInterval);
            gSync.Controls.Add(new Label { Text = "minutes", Left = 126, Top = 27, Width = 60 });
            chkStartup = new CheckBox { Text = "Start with Windows", Left = 220, Top = 25, Width = 200, Checked = IsStartupEnabled() };
            gSync.Controls.Add(chkStartup);
            Controls.Add(gSync);
            y += 70;

            btnSave = new Button { Text = "Save", Left = 12, Top = y, Width = 120, Height = 32 };
            btnSave.Click += delegate { SaveSettings(true); };
            Controls.Add(btnSave);
            btnSync = new Button { Text = "Sync now", Left = 140, Top = y, Width = 120, Height = 32 };
            btnSync.Click += delegate { if (SaveSettings(false)) StartSync(true); };
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
            Controls.Add(txtLog);

            // tray icon
            tray = new NotifyIcon { Text = "Chittam Tally Sync", Visible = true };
            try { tray.Icon = Icon ?? SystemIcons.Application; } catch { tray.Icon = SystemIcons.Application; }
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open", null, delegate { ShowWindow(); });
            menu.Items.Add("Sync now", null, delegate { StartSync(true); });
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit", null, delegate { reallyExit = true; Close(); });
            tray.ContextMenuStrip = menu;
            tray.DoubleClick += delegate { ShowWindow(); };

            RefreshStatus();

            timer = new System.Windows.Forms.Timer { Interval = 15000 };
            timer.Tick += delegate {
                if (!syncing && DateTime.Now >= nextSync && Configured()) StartSync(false);
                UpdateNextLabel();
            };
            nextSync = DateTime.Now.AddSeconds(10);
            timer.Start();
            UpdateNextLabel();
            Log("Started. " + (Configured() ? "First sync in a few seconds." : "Enter the sync login and click Save."));
        }

        protected override void SetVisibleCore(bool value)
        {
            // when started with Windows (/tray), stay in the tray until opened
            if (startHidden && !IsHandleCreated) { CreateHandle(); value = false; }
            base.SetVisibleCore(value);
        }

        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            if (!Configured()) txtEmail.Focus();
            if (cboBusiness.Items.Count == 0) LoadCompanies(false);
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (!reallyExit && e.CloseReason == CloseReason.UserClosing)
            {
                // closing the window keeps syncing in the tray
                e.Cancel = true;
                Hide();
                if (!toldAboutTray)
                {
                    tray.ShowBalloonTip(4000, "Still syncing", "Chittam Tally Sync keeps running here. Right-click the icon to exit.", ToolTipIcon.Info);
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
            WindowState = FormWindowState.Normal;
            Activate();
        }

        bool Configured() { return settings.Email.Length > 0 && settings.Password.Length > 0; }

        void LoadCompanies(bool showErrors)
        {
            try
            {
                var list = Tally.Companies(settings.TallyUrl);
                foreach (var cbo in new[] { cboBusiness, cboCash })
                {
                    var current = cbo.Text;
                    cbo.Items.Clear();
                    foreach (var n in list) cbo.Items.Add(n);
                    cbo.Text = current;
                }
                if (showErrors) Log("Companies open in Tally: " + string.Join(", ", list));
            }
            catch (Exception ex)
            {
                if (showErrors) MessageBox.Show(ex.Message, "Chittam Tally Sync");
            }
        }

        bool SaveSettings(bool announce)
        {
            if (txtEmail.Text.Trim().Length == 0 || txtPassword.Text.Length == 0)
            {
                MessageBox.Show("Enter the sync login email and password first.", "Chittam Tally Sync");
                return false;
            }
            bool loginChanged = settings.Email != txtEmail.Text.Trim() || settings.Password != txtPassword.Text;
            bool companiesChanged = settings.BusinessCompany != cboBusiness.Text.Trim() || settings.CashCompany != cboCash.Text.Trim();
            settings.Email = txtEmail.Text.Trim();
            settings.Password = txtPassword.Text;
            settings.BusinessCompany = cboBusiness.Text.Trim();
            settings.CashCompany = cboCash.Text.Trim();
            settings.IntervalMinutes = (int)numInterval.Value;
            if (companiesChanged) settings.LastHash.Clear();   // upload fresh figures for the new companies
            settings.Save();
            SetStartup(chkStartup.Checked);
            nextSync = DateTime.Now.AddMinutes(settings.IntervalMinutes);
            UpdateNextLabel();
            if (announce)
            {
                Log("Settings saved.");
                if (loginChanged || companiesChanged) StartSync(true);
            }
            return true;
        }

        // ---------------- sync ----------------
        void StartSync(bool manual)
        {
            if (syncing) return;
            if (!Configured()) { if (manual) MessageBox.Show("Enter the sync login and click Save first.", "Chittam Tally Sync"); return; }
            syncing = true;
            btnSync.Enabled = false;
            btnSync.Text = "Syncing…";
            bool force = manual;
            ThreadPool.QueueUserWorkItem(delegate {
                try { RunSync(force); }
                catch (Exception ex) { Log("ERROR: " + ex.Message); }
                finally
                {
                    BeginInvoke((Action)delegate {
                        syncing = false;
                        btnSync.Enabled = true;
                        btnSync.Text = "Sync now";
                        nextSync = DateTime.Now.AddMinutes(settings.IntervalMinutes);
                        RefreshStatus();
                        UpdateNextLabel();
                    });
                }
            });
        }

        void RunSync(bool force)
        {
            string token = null;
            var jobs = new[] {
                new[] { "business", settings.BusinessCompany, settings.BusinessLabel },
                new[] { "cash", settings.CashCompany, settings.CashLabel }
            };
            foreach (var j in jobs)
            {
                string key = j[0], company = j[1], label = j[2];
                if (string.IsNullOrEmpty(company)) continue;
                Dictionary<string, double> bal; Dictionary<string, string> names;
                try { Tally.Balances(settings.TallyUrl, company, out bal, out names); }
                catch (Exception ex) { Log("[" + company + "] skipped: " + ex.Message); continue; }

                var sig = string.Join("|", bal.Keys.OrderBy(k => k, StringComparer.Ordinal).Select(k => k + "=" + bal[k].ToString(System.Globalization.CultureInfo.InvariantCulture)));
                string hash;
                using (var sha = SHA256.Create()) hash = BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(sig))).Replace("-", "");
                string last;
                if (!force && settings.LastHash.TryGetValue(key, out last) && last == hash)
                {
                    Log("[" + company + "] no change");
                    continue;
                }
                if (token == null) token = Firebase.SignIn(settings);
                Firebase.SaveBalances(settings, token, key, label, company, bal, names);
                settings.LastHash[key] = hash;
                settings.LastStatus[key] = DateTime.Now.ToString("dd MMM yyyy, h:mm tt") + " · " + bal.Count + " names";
                settings.Save();
                Log("[" + company + "] uploaded " + bal.Count + " balances");
            }
        }

        // ---------------- helpers ----------------
        void RefreshStatus()
        {
            string b, c;
            lblBusiness.Text = settings.BusinessLabel + ": " + (settings.LastStatus.TryGetValue("business", out b) ? "last uploaded " + b : "not uploaded yet");
            lblCash.Text = settings.CashLabel + ": " + (settings.LastStatus.TryGetValue("cash", out c) ? "last uploaded " + c : "not uploaded yet");
        }

        void UpdateNextLabel()
        {
            if (!Configured()) { lblNext.Text = "Not set up yet"; return; }
            lblNext.Text = syncing ? "Syncing…" : "Next check: " + nextSync.ToString("h:mm tt");
        }

        void Log(string msg)
        {
            string line = DateTime.Now.ToString("dd MMM HH:mm:ss") + "  " + msg;
            try
            {
                Directory.CreateDirectory(Settings.Folder);
                var path = Path.Combine(Settings.Folder, "sync.log");
                if (File.Exists(path) && new FileInfo(path).Length > 1024 * 1024) File.Delete(path);
                File.AppendAllText(path, line + Environment.NewLine, Encoding.UTF8);
            }
            catch { }
            if (IsHandleCreated && InvokeRequired) { BeginInvoke((Action)delegate { AppendLog(line); }); }
            else AppendLog(line);
        }

        void AppendLog(string line)
        {
            txtLog.AppendText(line + Environment.NewLine);
        }

        bool IsStartupEnabled()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue("ChittamTallySync") != null;
        }

        void SetStartup(bool on)
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey, true))
            {
                if (k == null) return;
                if (on) k.SetValue("ChittamTallySync", "\"" + Application.ExecutablePath + "\" /tray");
                else if (k.GetValue("ChittamTallySync") != null) k.DeleteValue("ChittamTallySync");
            }
        }
    }
}
