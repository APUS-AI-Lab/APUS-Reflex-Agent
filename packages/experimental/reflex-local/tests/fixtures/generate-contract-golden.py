"""Write contract-golden.json: prompts rendered by the APUS Reflex training contract.

The rendering functions below are copied from ``openjev_contracts.py`` and the ``CHAT``
wrapper from ``examples/openjev_local.py`` in the model repository
apus-ailab/APUS-Reflex-4B-GGUF at revision 191bfcb721ec6d44352c622a30d290ae6afbabc8
under the license published in that repository. The only local change is that JSON
state is rendered with the same ``json.dumps`` rule as the task section, because the
training contract accepts string state only.

Run from the repository root with ``python3 -I`` so no local module shadows ``json``:

    python3 -I packages/experimental/reflex-local/tests/fixtures/generate-contract-golden.py
"""

import json
from pathlib import Path

LABELS = tuple("ABCDEFGHIJKLMNOP")
BINARY_CRITERIA = [
    {"id": "yes", "description": "The stated proposition is true."},
    {"id": "no", "description": "The stated proposition is false."},
]
CHAT = "<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n"
CHOICE_INSTRUCTIONS = "Choose the best candidate."
NOUL_INSTRUCTIONS = "Judge whether the proposition in the shared state is true."


def validate_request(record):
    for key in ("id", "group_id", "state", "instructions"):
        if not isinstance(record.get(key), str) or not record[key].strip():
            raise ValueError(f"{key} must be a nonempty string")
    if record.get("primitive") not in ("choice", "noul", "score_level"):
        raise ValueError("unsupported primitive")
    criteria = record.get("criteria")
    if not isinstance(criteria, list) or not 2 <= len(criteria) <= len(LABELS):
        raise ValueError("criteria must contain 2..16 candidates")
    ids = []
    for candidate in criteria:
        if not isinstance(candidate, dict):
            raise TypeError("candidate must be an object")
        for key in ("id", "description"):
            if not isinstance(candidate.get(key), str) or not candidate[key].strip():
                raise ValueError(f"candidate {key} must be nonempty")
        ids.append(candidate["id"])
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate candidate ids")
    if record["primitive"] != "choice" and criteria != BINARY_CRITERIA:
        raise ValueError("noul and score_level require canonical yes/no criteria")


def render_prompt_parts(record):
    """Text prefix/suffix; callers MUST check tokenizer boundary equivalence."""
    validate_request(record)
    prefix = "Shared state:\n" + record["state"] + "\n\n"
    task = {
        "primitive": record["primitive"],
        "instructions": record["instructions"],
        "criteria": [
            {"label": label, "description": candidate["description"]}
            for label, candidate in zip(LABELS, record["criteria"])
        ],
    }
    suffix = json.dumps(task, ensure_ascii=False, sort_keys=True)
    suffix += (
        "\nReturn only the selected letter: "
        + ", ".join(LABELS[: len(record["criteria"])])
        + ".\nAnswer:"
    )
    return prefix, suffix


def render_prompt(record):
    return "".join(render_prompt_parts(record))


def render_state(state):
    if isinstance(state, str):
        return state
    return json.dumps(state, ensure_ascii=False, sort_keys=True)


def case(name, state, primitive, instructions, descriptions):
    if primitive == "noul":
        criteria = BINARY_CRITERIA
    else:
        criteria = [
            {"id": f"c{index}", "description": description}
            for index, description in enumerate(descriptions)
        ]
    record = {
        "id": name,
        "group_id": name,
        "primitive": primitive,
        "state": render_state(state),
        "instructions": instructions,
        "criteria": criteria,
    }
    return {
        "name": name,
        "state": state,
        "primitive": primitive,
        "instructions": instructions,
        "descriptions": [candidate["description"] for candidate in criteria],
        "prompt": CHAT.format(prompt=render_prompt(record)),
    }


NOUL_DESCRIPTIONS = [candidate["description"] for candidate in BINARY_CRITERIA]
CASES = [
    case(
        "official-support-731",
        "Order 731 was delivered. The customer confirms that the issue is resolved.",
        "choice",
        "Select the next support action.",
        [
            "Close the ticket as resolved.",
            "Escalate to a human agent.",
            "Issue a refund.",
        ],
    ),
    case(
        "string-state-verbatim",
        '订单 "731"\t已送达\\n 不转义\n第二行 😀 \x01 {"k": 1}',
        "choice",
        CHOICE_INSTRUCTIONS,
        ["关闭工单", "升级"],
    ),
    case(
        "object-text-escapes",
        {
            "中文": "用户说：“问题已解决”",
            "quote": 'He said "hi"',
            "backslash": "C:\\path\\file",
            "whitespace": "line1\nline2\ttab\rreturn",
            "controls": "\x00\x01\x08\x0c\x1f\x7f",
            "separators": "\u2028\u2029",
            'key "quoted"\n': "\\",
        },
        "choice",
        "选择下一步：\"关闭\"或'升级'\n\t注意反斜杠 \\",
        ['Close "now"', "Back\\slash\x02", "Emoji 🚀 候选"],
    ),
    case(
        "astral-key-order",
        {
            "a": 1,
            "é": 2,
            "\ue000": 3,
            "\uff01": 4,
            "😀": 5,
            "𝒜": 6,
            "Z": 7,
            "": 8,
            "aa": 9,
            "a😀": 10,
            "a\uffff": 11,
        },
        "choice",
        CHOICE_INSTRUCTIONS,
        ["first", "second"],
    ),
    case(
        "nested-values",
        {
            "list": [1, [2, [3, []]], {}, {"b": None, "a": True}],
            "flags": {"on": True, "off": False, "unset": None},
            "empty": {"object": {}, "array": []},
        },
        "choice",
        CHOICE_INSTRUCTIONS,
        ["keep", "drop", "defer"],
    ),
    case(
        "numbers",
        {
            "ints": [0, -7, 42, 9007199254740991, -9007199254740991],
            "half": 0.5,
            "tiny": 1e-07,
            "big": 1e16,
            "mixed": 123456.789,
            "negative_zero": -0.0,
            "fixed_small": 0.0001,
            "exp_small": 1e-05,
            "sum": 0.1 + 0.2,
            "unsafe_integer": 9007199254740992.0,
            "fixed_large": 1234567890123456.8,
            "exp_large": 12345678901234568.0,
            "huge": 1e22,
            "max": 1.7976931348623157e308,
            "subnormal": 5e-324,
            "negative": -2.5e-10,
        },
        "choice",
        CHOICE_INSTRUCTIONS,
        ["low", "high"],
    ),
    case("scalar-null", None, "choice", CHOICE_INSTRUCTIONS, ["yes", "no"]),
    case("scalar-bool", True, "choice", CHOICE_INSTRUCTIONS, ["yes", "no"]),
    case("scalar-float", 3.25, "choice", CHOICE_INSTRUCTIONS, ["yes", "no"]),
    case(
        "array-state-two-candidates",
        ["步骤一", {"done": False}, 3],
        "choice",
        "Pick one.",
        ["Continue the current step.", "Stop and ask the user."],
    ),
    case(
        "choice-sixteen",
        {"task": "pick a letter"},
        "choice",
        CHOICE_INSTRUCTIONS,
        [f"Candidate {label} 候选" for label in LABELS],
    ),
    case(
        "noul-canonical",
        {"proposition": "测试全部通过", "evidence": ["exit 0", "42 passed"]},
        "noul",
        NOUL_INSTRUCTIONS,
        NOUL_DESCRIPTIONS,
    ),
    case(
        "score-levels",
        {"diff": "+3 -1"},
        "choice",
        "Rate the risk of this change.",
        ["none", "low", "medium", "high", "critical"],
    ),
]

if __name__ == "__main__":
    target = Path(__file__).resolve().parent / "contract-golden.json"
    text = json.dumps(CASES, ensure_ascii=False, indent=2) + "\n"
    target.write_text(text, encoding="utf-8")
