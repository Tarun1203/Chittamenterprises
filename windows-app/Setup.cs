// Chittam Enterprises - Setup.
//
// One file that installs the Windows app for the current Windows user (no
// administrator needed): copies the program into
// %LOCALAPPDATA%\Programs\Chittam Enterprises, adds Start menu (and, if
// ticked, Desktop) shortcuts, optionally starts it with Windows, and lists it
// in Settings -> Apps with an Uninstall button. The program files are packed
// inside this setup (build.ps1 adds them as resources).
//
//   ChittamEnterprisesSetup.exe             install / repair (with a window)
//   ChittamEnterprisesSetup.exe /S          install silently
//   Uninstall.exe /uninstall                remove (Settings -> Apps uses this)
//
// Settings, the sync login and the app's sign-in (in %APPDATA% and
// %LOCALAPPDATA%\ChittamEnterprises) are kept on uninstall unless asked.

using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace ChittamSetup
{
    static class Program
    {
        public const string AppName = "Chittam Enterprises";
        public const string ExeName = "Chittam Enterprises.exe";
        public static readonly string[] Files = { "Chittam Enterprises.exe", "Chittam Enterprises.exe.config",
            "Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll" };
        public static string InstallDir { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", AppName); } }
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ChittamEnterprises";
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";

        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        [STAThread]
        static int Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool silent = args.Any(a => a.Equals("/S", StringComparison.OrdinalIgnoreCase));
            if (args.Any(a => a.Equals("/uninstall", StringComparison.OrdinalIgnoreCase))) return Uninstall(silent) ? 0 : 1;
            // silent install keeps "Start with Windows" as it was
            if (silent) { try { Install(true, StartsWithWindows()); return 0; } catch { return 1; } }
            Application.Run(new SetupForm());
            return 0;
        }

        public static bool StartsWithWindows()
        {
            using (var k = Registry.CurrentUser.OpenSubKey(RunKey)) return k != null && k.GetValue("ChittamEnterprises") != null;
        }

        public static string PackedVersion()
        {
            try
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream(ExeName))
                {
                    var tmp = Path.Combine(Path.GetTempPath(), "chittam-setup-ver.exe");
                    using (var f = File.Create(tmp)) s.CopyTo(f);
                    var v = FileVersionInfo.GetVersionInfo(tmp).FileVersion;
                    File.Delete(tmp);
                    return string.IsNullOrEmpty(v) ? "" : v;
                }
            }
            catch { return ""; }
        }

        static void CloseRunningApp()
        {
            foreach (var p in Process.GetProcessesByName("Chittam Enterprises"))
            {
                try { p.CloseMainWindow(); if (!p.WaitForExit(3000)) { p.Kill(); p.WaitForExit(3000); } } catch { }
            }
        }

        // a .lnk via the Windows Script Host (no extra libraries needed)
        static void Shortcut(string lnk, string target, string description)
        {
            var t = Type.GetTypeFromProgID("WScript.Shell");
            object shell = Activator.CreateInstance(t);
            object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
            var st = sc.GetType();
            st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { target });
            st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { Path.GetDirectoryName(target) });
            st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { target + ",0" });
            st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { description });
            st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
        }

        static string StartMenuLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), AppName + ".lnk"); } }
        static string DesktopLink { get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), AppName + ".lnk"); } }

        public static void Install(bool desktopShortcut, bool startWithWindows)
        {
            CloseRunningApp();
            var dir = InstallDir;
            Directory.CreateDirectory(dir);
            var asm = Assembly.GetExecutingAssembly();
            foreach (var name in Files)
                using (var s = asm.GetManifestResourceStream(name))
                {
                    if (s == null) throw new Exception(name + " is missing from this setup");
                    using (var f = File.Create(Path.Combine(dir, name))) s.CopyTo(f);
                }
            // this setup doubles as the uninstaller
            File.Copy(Application.ExecutablePath, Path.Combine(dir, "Uninstall.exe"), true);
            // anything the app's own update step left waiting is now out of date
            try { var upd = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChittamEnterprises", "update"); if (Directory.Exists(upd)) Directory.Delete(upd, true); } catch { }

            var exe = Path.Combine(dir, ExeName);
            Shortcut(StartMenuLink, exe, "Chittam Enterprises - orders, messages and Tally sync");
            if (desktopShortcut) Shortcut(DesktopLink, exe, "Chittam Enterprises - orders, messages and Tally sync");
            using (var k = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (startWithWindows) k.SetValue("ChittamEnterprises", "\"" + exe + "\" /tray");
                else if (k.GetValue("ChittamEnterprises") != null && !File.Exists(exe)) k.DeleteValue("ChittamEnterprises");
            }
            var version = FileVersionInfo.GetVersionInfo(exe).FileVersion ?? "";
            long size = Files.Sum(n => new FileInfo(Path.Combine(dir, n)).Length) / 1024;
            using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", AppName);
                k.SetValue("DisplayVersion", version);
                k.SetValue("Publisher", "Chittam Enterprises");
                k.SetValue("DisplayIcon", exe + ",0");
                k.SetValue("InstallLocation", dir);
                k.SetValue("UninstallString", "\"" + Path.Combine(dir, "Uninstall.exe") + "\" /uninstall");
                k.SetValue("QuietUninstallString", "\"" + Path.Combine(dir, "Uninstall.exe") + "\" /uninstall /S");
                k.SetValue("EstimatedSize", (int)size, RegistryValueKind.DWord);
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Today.ToString("yyyyMMdd"));
            }
        }

        static bool Uninstall(bool silent)
        {
            bool removeData = false;
            if (!silent)
            {
                var r = MessageBox.Show("Remove Chittam Enterprises from this PC?\n\nYour data stays safe in the online database. " +
                    "Click Yes to keep this PC's Tally Sync settings and sign-in (for a later reinstall), or No to remove those too.",
                    "Uninstall Chittam Enterprises", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
                if (r == DialogResult.Cancel) return false;
                removeData = r == DialogResult.No;
            }
            CloseRunningApp();
            foreach (var l in new[] { StartMenuLink, DesktopLink }) try { if (File.Exists(l)) File.Delete(l); } catch { }
            try { using (var k = Registry.CurrentUser.OpenSubKey(RunKey, true)) if (k != null && k.GetValue("ChittamEnterprises") != null) k.DeleteValue("ChittamEnterprises"); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch { }
            var dir = InstallDir;
            foreach (var n in Files) try { File.Delete(Path.Combine(dir, n)); } catch { }
            var extra = removeData ? new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ChittamEnterprises"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ChittamEnterprises") } : new string[0];
            // this program is running from the folder: remove it a moment after it closes
            var cmd = "/c ping 127.0.0.1 -n 3 > nul & rmdir /s /q \"" + dir + "\"" + string.Concat(extra.Select(x => " & rmdir /s /q \"" + x + "\""));
            Process.Start(new ProcessStartInfo("cmd.exe", cmd) { CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, UseShellExecute = false });
            if (!silent) MessageBox.Show("Chittam Enterprises has been removed.", "Uninstall", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return true;
        }
    }

    class SetupForm : Form
    {
        CheckBox chkDesktop, chkStartup;
        Button btnInstall, btnOpen;
        Label lblStatus;

        public SetupForm()
        {
            SuspendLayout();
            AutoScaleDimensions = new SizeF(96F, 96F);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = "Chittam Enterprises Setup";
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            FormBorderStyle = FormBorderStyle.FixedSingle;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(520, 330);
            BackColor = Color.White;
            Font = new Font("Segoe UI", 9.75f);
            var brand = Color.FromArgb(36, 99, 235);

            var badge = new Label { Text = "CE", Left = 28, Top = 26, Width = 52, Height = 52, TextAlign = ContentAlignment.MiddleCenter,
                Font = new Font("Segoe UI", 15f, FontStyle.Bold), ForeColor = Color.White, BackColor = brand };
            Controls.Add(badge);
            var v = Program.PackedVersion();
            Controls.Add(new Label { Text = "Chittam Enterprises", Left = 96, Top = 26, AutoSize = true, Font = new Font("Segoe UI", 16f, FontStyle.Bold) });
            Controls.Add(new Label { Text = "Windows app" + (v.Length > 0 ? " · version " + v : "") + " — orders, messages and Tally sync", Left = 98, Top = 60, AutoSize = true, ForeColor = Color.DimGray });
            Controls.Add(new Label { Text = "Installs for this Windows user (no administrator needed) in:\n" + Program.InstallDir, Left = 28, Top = 100, Width = 470, Height = 44, ForeColor = Color.FromArgb(64, 64, 64) });

            chkDesktop = new CheckBox { Text = "Add a Desktop shortcut", Left = 28, Top = 156, AutoSize = true, Checked = true };
            Controls.Add(chkDesktop);
            chkStartup = new CheckBox { Text = "Start with Windows (keeps Tally Sync running in the tray)", Left = 28, Top = 186, AutoSize = true, Checked = true };
            Controls.Add(chkStartup);
            lblStatus = new Label { Left = 28, Top = 222, Width = 470, Height = 40, ForeColor = Color.DimGray };
            Controls.Add(lblStatus);

            btnInstall = new Button { Text = File.Exists(Path.Combine(Program.InstallDir, Program.ExeName)) ? "Update" : "Install", Left = 28, Top = 270, Width = 140, Height = 38,
                FlatStyle = FlatStyle.Flat, BackColor = brand, ForeColor = Color.White, Font = new Font("Segoe UI", 10f, FontStyle.Bold) };
            btnInstall.FlatAppearance.BorderSize = 0;
            btnInstall.Click += delegate { DoInstall(); };
            Controls.Add(btnInstall);
            btnOpen = new Button { Text = "Open Chittam Enterprises", Left = 178, Top = 270, Width = 210, Height = 38, Visible = false, FlatStyle = FlatStyle.Flat };
            btnOpen.Click += delegate { try { Process.Start(Path.Combine(Program.InstallDir, Program.ExeName)); } catch { } Close(); };
            Controls.Add(btnOpen);
            var btnClose = new Button { Text = "Close", Left = 398, Top = 270, Width = 94, Height = 38, FlatStyle = FlatStyle.Flat };
            btnClose.Click += delegate { Close(); };
            Controls.Add(btnClose);
            ResumeLayout(false);
        }

        void DoInstall()
        {
            btnInstall.Enabled = false;
            lblStatus.Text = "Installing… (closing the app if it's open)";
            Refresh();
            try
            {
                Program.Install(chkDesktop.Checked, chkStartup.Checked);
                lblStatus.ForeColor = Color.FromArgb(5, 150, 105);
                lblStatus.Text = "Installed. It's in the Start menu" + (chkDesktop.Checked ? " and on the Desktop" : "") + ", and in Settings → Apps (to uninstall).";
                btnInstall.Visible = false;
                btnOpen.Visible = true;
            }
            catch (Exception ex)
            {
                lblStatus.ForeColor = Color.Firebrick;
                lblStatus.Text = "Could not install: " + ex.Message;
                btnInstall.Enabled = true;
            }
        }
    }
}
