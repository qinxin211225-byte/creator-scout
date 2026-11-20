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

    def test_command_variants_get_simpler(self):
        v = b.command_variants("codex", True, "/tmp/d", "/tmp/o")
        self.assertEqual([n for n, _ in v], ["strict", "medium", "simple"])
        self.assertTrue(all("read-only" in c for _, c in v))
        self.assertTrue(all("--search" in c for _, c in v))
        self.assertLess(len(v[2][1]), len(v[0][1]))

    def test_observed_urls_only_from_search_events(self):
        lines = ['{"item":{"type":"web_search","results":[{"url":"https://a.com"}]}}',
                 '{"item":{"type":"message","url":"https://ignored.com"}}', 'not json']
        self.assertEqual(b.observed_urls(lines), ["https://a.com"])


if __name__ == "__main__":
    unittest.main()
