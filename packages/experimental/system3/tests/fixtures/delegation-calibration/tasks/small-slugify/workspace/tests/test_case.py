from textkit.case import snake_case


def test_camel_case():
    assert snake_case("BlogPost") == "blog_post"


def test_mixed_case_and_digits():
    assert snake_case("parseHTML5Doc") == "parse_html5_doc"


def test_kebab_case():
    assert snake_case("post-title") == "post_title"
