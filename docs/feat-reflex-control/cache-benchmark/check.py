"""Keyless negative controls for benchmark evidence; never imports or starts the SDK."""

import runpy
import tempfile
import unittest
from pathlib import Path

subject = runpy.run_path(str(Path(__file__).with_name("run.py")))


class EvidenceChecks(unittest.TestCase):
    def test_warm_requires_both_independent_decimal_values(self):
        check = subject["answer_checks"]
        self.assertTrue(
            all(check("warm-continuation", "总额1137.41，A余额835.12").values())
        )
        self.assertFalse(
            all(check("warm-continuation", "总额1137.41，A余额835.13").values())
        )

    def test_recovery_requires_four_facts(self):
        check = subject["answer_checks"]
        self.assertTrue(
            all(
                check(
                    "restart-recovery", "樱花小舍 抹茶松饼 09:20 京都站中央口"
                ).values()
            )
        )
        self.assertFalse(
            all(check("restart-recovery", "樱花小舍 抹茶松饼 09:20").values())
        )

    def test_reasoning_is_not_copied(self):
        value = {
            "content": [{"type": "reasoning", "text": "private-thought"}],
            "reasoning_content": "private-thought",
        }
        cleaned = subject["public_evidence"](value)
        self.assertNotIn("private-thought", str(cleaned))
        self.assertIn("sha256", str(cleaned))

    def test_log_prefix_can_append_but_cannot_rewrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            log = root / "session.jsonl"
            log.write_text('{"original":1}\n')
            before = subject["log_prefixes"](root)
            log.write_text('{"original":1}\n{"new":2}\n')
            self.assertTrue(subject["prefix_checks"](root, before)[0]["unchanged"])
            log.write_text('{"original":2}\n{"new":2}\n')
            self.assertFalse(subject["prefix_checks"](root, before)[0]["unchanged"])


if __name__ == "__main__":
    unittest.main()
