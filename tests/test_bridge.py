"""运行：python3 -m unittest discover -s tests -p "test_*.py" """
import sys, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "bridge"))
import scout_codex_bridge as b


class BridgeTest(unittest.TestCase):
    def test_site_with_path(self):
        self.assertEqual(b.parse_site("https://me.github.io/creator-scout/"),
                         ("https://me.github.io", "https://me.github.io/creator-scout/"))
        self.assertEqual(b.parse_site("https://me.github.io/creator-scout"),
                         ("https://me.github.io", "https://me.github.io/creator-scout/"))
        self.assertEqual(b.parse_site("http://localhost:8000"), ("http://localhost:8000", "http://localhost:8000/"))

    def test_rejects_unsafe_site(self):
        for bad in ["http://example.com/", "https://me.github.io/?x=1", "ftp://x", "https://u:p@x.com/"]:
            with self.assertRaises(Exception):
                b.parse_site(bad)

    def test_only_strict_command(self):
        c = b.codex_command("codex", True, "/tmp/d", "/tmp/o")
        for flag in ["read-only", "--ignore-user-config", "shell_tool", "apps", "plugins", "--search"]:
            self.assertIn(flag, c)
        self.assertFalse(hasattr(b, "command_variants"))

    def test_observed_urls_only_from_search_events(self):
        lines = ['{"item":{"type":"web_search","results":[{"url":"https://a.com"}]}}',
                 '{"item":{"type":"message","url":"https://ignored.com"}}', 'not json']
        self.assertEqual(b.observed_urls(lines), ["https://a.com"])


    def test_token_persists_and_resets(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            old = b.TOKEN_FILE
            b.TOKEN_FILE = Path(d) / ".scout" / "codex_bridge_token"
            try:
                t1, created1 = b.load_or_create_token()
                t2, created2 = b.load_or_create_token()
                t3, created3 = b.load_or_create_token(reset=True)
                self.assertTrue(created1 and not created2 and created3)
                self.assertEqual(t1, t2)
                self.assertNotEqual(t1, t3)
            finally:
                b.TOKEN_FILE = old


    def _fake_install(self, system):
        import tempfile, plistlib, subprocess as sp
        d = tempfile.mkdtemp()
        saved = (b.platform.system, b._run, b.SCOUT_DIR, b.CONFIG_FILE, b.LOG_FILE, b.Path.home, b.os.environ.get("APPDATA"))
        calls = []
        b.platform.system = lambda: system
        b._run = lambda cmd: calls.append(cmd) or sp.CompletedProcess(cmd, 0, "", "")
        b.Path.home = classmethod(lambda cls: b.Path(d))
        b.SCOUT_DIR = b.Path(d) / ".scout"; b.CONFIG_FILE = b.SCOUT_DIR / "bridge.json"; b.LOG_FILE = b.SCOUT_DIR / "bridge.log"
        b.os.environ["APPDATA"] = d
        if system == "Darwin" and not hasattr(b.os, "getuid"):
            b.os.getuid = lambda: 501
        try:
            service = b.install_service("https://me.github.io/creator-scout/", "/usr/local/bin/codex")
            content = service.read_bytes()
            self.assertTrue((b.SCOUT_DIR / "scout_codex_bridge.py").is_file())
            return service, content, calls
        finally:
            (b.platform.system, b._run, b.SCOUT_DIR, b.CONFIG_FILE, b.LOG_FILE, b.Path.home, appdata) = saved

    def test_install_mac(self):
        import plistlib
        service, content, calls = self._fake_install("Darwin")
        plist = plistlib.loads(content)
        self.assertTrue(plist["RunAtLoad"] and plist["KeepAlive"])
        self.assertIn("--site", plist["ProgramArguments"]); self.assertIn("/usr/local/bin/codex", plist["ProgramArguments"])
        self.assertTrue(any(c[:2] == ["launchctl", "bootstrap"] for c in calls))

    def test_install_linux(self):
        service, content, calls = self._fake_install("Linux")
        text = content.decode()
        self.assertIn("Restart=always", text); self.assertIn('"--site" "https://me.github.io/creator-scout/"', text)
        self.assertTrue(any("enable" in c for c in calls))

    def test_install_windows(self):
        service, content, calls = self._fake_install("Windows")
        text = content.decode()
        self.assertTrue(service.name.endswith(".vbs"))
        self.assertIn('""--site"" ""https://me.github.io/creator-scout/""', text)
        self.assertIn(", 0, False", text)


    def test_check_accounts_uses_profile_and_sources(self):
        seen = {}
        old_pm = b.page_mentions
        def fake(url, u):
            seen.setdefault(u, []).append(url)
            return (u == "real.one" and "instagram.com/real.one" in url) or (u == "listed" and "collabstr" in url)
        b.page_mentions = fake
        try:
            got = b.check_accounts([{"username": "real.one", "urls": []},
                                    {"username": "listed", "urls": ["https://collabstr.com/x"]},
                                    {"username": "made.up", "urls": ["https://example.com/a"]},
                                    {"username": "bad name!", "urls": []}])
        finally:
            b.page_mentions = old_pm
        self.assertEqual(sorted(got), ["listed", "real.one"])
        self.assertNotIn("bad name!", seen)

    def test_page_mentions_blocks_local_and_http(self):
        self.assertFalse(b.page_mentions("http://example.com/", "x"))
        self.assertFalse(b.page_mentions("https://127.0.0.1/", "x"))
        self.assertFalse(b.page_mentions("https://localhost/", "x"))
        self.assertFalse(b.is_public_host("10.0.0.5"))


if __name__ == "__main__":
    unittest.main()
