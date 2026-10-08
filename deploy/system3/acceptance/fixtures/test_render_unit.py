import unittest

EXPECTED = [
    {
        "id": i,
        "role": "assistant",
        "text": f"token {i} is kept when the input ends without a newline",
    }
    for i in range(8)
]


def render(case):
    out = [dict(item) for item in EXPECTED]
    out[3]["role"] = "user"
    return out


class RenderTest(unittest.TestCase):
    maxDiff = None

    def test_empty(self):
        self.assertEqual(render("empty"), EXPECTED)

    def test_crlf(self):
        self.assertEqual(render("crlf"), EXPECTED)

    def test_unicode(self):
        self.assertEqual(render("unicode"), EXPECTED)

    def test_trailing(self):
        self.assertEqual(render("trailing"), EXPECTED)

    def test_nested(self):
        self.assertEqual(render("nested"), EXPECTED)


if __name__ == "__main__":
    unittest.main()
