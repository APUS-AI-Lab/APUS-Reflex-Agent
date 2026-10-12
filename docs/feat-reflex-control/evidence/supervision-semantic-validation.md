# Semantic supervision model validation

English | [中文](supervision-semantic-validation.zh.md)

Four isolated decisions used the real `APUS-OpenJev-v1-9B-5949` model, high effort and the unchanged 0.8 adoption threshold. Requests were generated from the production supervision and feedback definitions. These checks validate the model decision and deterministic adoption criteria; they do not replace a real Codex task, consumed advice, terminal result or independent artifact verification.

The [initial English alignment question](supervision-semantic-initial.json) classified the unrelated marketing window with probability 0.62156, below threshold. Although its separate action question preferred realignment, Host eligibility rejected correction. This failed positive case remains recorded. The final Chinese alignment question explicitly compares the entire sufficient native action/path window with the Goal and accepted requirements, without requiring hidden context or treating one unrelated item as persistent deviation.

The [final responses](supervision-semantic-final.json) classified distinct successful marketing changes as unrelated to the billing Goal at 0.99566 and related billing work as related at 0.99559. Incomplete path evidence still produced a model action suggestion to realign (0.85152); the Host rejected it because semantic eligibility and repeated-work evidence were both absent. For an unrelated successful verification, the relevant-verification probability was 0.000335 and no improvement was accepted. Raw decision verdicts and Host outcomes are recorded separately, including direct-spec expectation mismatches, so a model suggestion is not misreported as an executed correction.

The [first real Codex semantic trial](semantic-codex-attempt1-interrupted.json) was externally stopped when the Host integration build failed on readonly-to-JSON typing. Its native process was terminated and cleanup completed; the report records `error` and the external interruption explicitly. This partial run is not a completed end-to-end acceptance and is retained separately from model-only checks.
