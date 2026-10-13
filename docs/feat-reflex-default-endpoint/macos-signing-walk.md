# macOS signing traversal patch

English | [中文](macos-signing-walk.zh.md)

The patch targets `@electron/osx-sign` 1.3.3 and changes only `walkAsync` in its CJS and ESM distributions. It replaces recursive unbounded `Promise.all` traversal with sequential traversal. Binary candidates, nested application/framework ordering, `.cstemp` cleanup and filesystem errors retain their behavior. Signing, entitlements and resource-seal verification remain enabled. No package files are excluded from inspection.

The Full and Lite arm64 jobs in release run 38418508324 reached an effective soft file limit of 32768 but still failed with `EMFILE` while scanning signing resources. Sign-ignore configuration does not solve this stage because the dependency walks the tree before filtering signing candidates. Sequential traversal bounds active probes without adding a semaphore, tuning constant or new dependency; its tradeoff is less scanning concurrency.

## Ownership and removal

The replayable change is [the versioned patch](../../frontend/patches/@electron+osx-sign+1.3.3.patch). Its behavior tests are [macos-signing-walk.test.mjs](../../frontend/test/macos-signing-walk.test.mjs); real signing coverage remains in [macos-signature.test.mjs](../../frontend/test/macos-signature.test.mjs). Remove the patch when an upgraded upstream package provides bounded traversal and passes the same candidate-order, cleanup, error, low-descriptor and resource-tampering checks. Neither a higher shell limit nor a successfully generated archive alone satisfies that removal condition.

## Local verification

A clean temporary directory received the unchanged frontend package manifest, lockfile, `.npmrc`, local package sources and the complete patch set. `npm ci --no-audit --no-fund` installed 990 packages in 16 seconds and its normal postinstall applied the new patch successfully. The running preview's dependencies and build outputs were not modified. An initial incomplete copy lacked `.npmrc` and failed peer-dependency lock validation before installation; restoring the repository configuration allowed the unchanged lockfile to pass.

| Check | Observed result |
|---|---|
| Unpatched negative control, soft limit 128, 1200 binary files in 30 directories | Child process failed with `EMFILE`, as expected |
| Patched CJS and ESM candidate order, temporary-file cleanup, idempotence and error propagation | Four tests passed |
| Patched CJS, same low limit and large tree | All 1200 binary candidates returned; one test passed |
| Existing macOS native signing, entitlements, bundled Node execution and resource tampering | Two tests passed; the signed bundle validated and modifying a resource was rejected |

The five traversal tests completed in 447 ms; the two signing tests completed in 3.32 seconds. These are fixture run times, not full-product packaging benchmarks. The ESM distribution is exercised through the existing Vitest loader; the low-descriptor child uses the actual CJS module. A source-map warning about missing upstream source files is retained. Logs are `/tmp/apus-osx-sign-negative.log`, `/tmp/apus-osx-sign-clean-ci.log`, `/tmp/apus-osx-sign-patched-tests.log` and `/tmp/apus-osx-sign-seal-test.log` on the verification machine. No installer was rebuilt or published by these checks; actual Full/Lite platform packaging and installation remain required.
