# Reflex input classification: live API diagnostic

English | [中文](live-intent-diagnostic.zh.md)

Date: 2026-10-13. Actual model: `APUS-OpenJev-v1-9B-5949`. This diagnostic uses the generated Desktop System3 configuration, an isolated temporary profile, the real Loader and Jev, and a mock main model. The Skill registry is empty, so it does not validate filesystem discovery, Skill loading, main-model quality or UI rendering. Credentials are read from the local managed store into memory only. Builds ran concurrently. These results describe connectivity and recovery, not certified performance or a 3× speedup.

## Three-second budget: all 30 requests retained

| Input | Expected | high: three durations, ms | high correct | low: three durations, ms | low correct |
|---|---|---|---|---|---|
| 你好啊 | conversation | 1735, 438, 402 | 3/3 | 1439, 289, 296 | 3/3 |
| 找回我上次的照片命名规则 | retrieval | 311, 330, 312 | 3/3 | 319, 341, 292 | 3/3 |
| 帮我整理一份旅行计划 | creation | 433, 368, 304 | 3/3 | 301, 307, 313 | 3/3 |
| 帮我查今天AI新闻 | research | 306, 307, 310 | 0/3 | 381, 285, 311 | 0/3 |
| 帮我运行项目测试 | action | 312, 311, 1155 | 3/3 | 298, 289, 303 | 0/3 |

Both groups received 15/15 network results without a timeout. With high effort, 12/15 labels matched expectations; all three news requests were classified as action. With low effort, 9/15 labels matched expectations; the six news and test-execution requests fell below the 0.5 confidence threshold, so no intent was displayed. The threshold was not lowered and unsuccessful samples were retained. The high and low groups ran sequentially, so these results do not establish a causal performance difference between effort settings.

Median preparation time was 312 ms for high and 303 ms for low. The first high request took 1735 ms and another took 1155 ms; the first low request took 1439 ms. These exceed the one-second experience target. Preparation time includes the empty catalog query, credentials, network, response parsing and receipt preparation, rather than model computation alone.

## Cancellation defect and fix

The original 1000 ms diagnostic produced 2/10 classifications and 8/10 timeouts; the main model continued in all 10 cases. An additional unhandled rejection caused test exit code 1, so the run did not pass. Async hooks traced the error to Node's embedded undici `abortFetch`: after the SDK clones an active network body, the catch for cancelling `response.body.stream` throws again, producing a rejected Promise detached from the request.

A local real-HTTP regression sends headers and partial JSON, then stalls the body and cancels ten consecutive requests. Before the fix, it recorded ten unhandled rejections. The provider now locks and completely reads the original network body in its fetch adapter before handing an in-memory Response to the SDK. All ten cancellations preserve the caller error without an unhandled rejection. No global error-swallowing handler was installed, the SDK was not modified, and native network cancellation remains enabled.

An additional post-fix live diagnostic with a 1000 ms budget ran 15 requests: 13 classifications, two timeouts, and 15 main-model continuations. The test exited with code 0 and no unhandled rejection. Connection and service conditions had changed, so this batch is not a causal performance comparison with the initial 2/10 result.

## Product configuration and remaining acceptance

The Desktop total preparation budget is 3000 ms. One second is an experience target, and timeouts still produce an explicit fallback. The preliminary decision still adds delay before the main model starts. Demonstrating a reduction in total task time requires a Reflex-disabled control using identical inputs, the complete main-model and tool-execution chain, and end-to-end timing. The research and action definitions overlap and need clarification before testing independent inputs. A proposed follow-up limits research to public-information lookup, current news and fact checking, and action to command execution or state changes, explicitly giving information lookup precedence as research. This proposal has not changed the running code.

Complete per-request data remains in the current worktree at `.artifacts/reflex-intent-live-diagnostic.json`, `.artifacts/reflex-intent-live-3000-high.json`, `.artifacts/reflex-intent-live-3000-low.json` and `.artifacts/reflex-intent-live-abort-fixed.json`. These retain all samples without credentials; temporary live-API scripts have been moved out of the permanent test directory.
