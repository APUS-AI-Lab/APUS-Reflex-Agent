# feat-local-jev-mlx 笔记

[English](notes.md) | 中文

## 2026-10-14 · 随包 llama-server 的本机冒烟实测

环境：Apple M5，24 GB 统一内存，macOS 26（Darwin 25.5）。运行时 llama.cpp `b11118`（`e6ab7c1a4`，模型作者在 Mac 上验证用的同一版本），官方 `llama-b11118-bin-macos-arm64.tar.gz`，sha256 `ca0ea3156257b21eeb11d0628f2baecd3928013a3d060e2e192042276e5b1f35`。权重 `APUS-Reflex-4B-GGUF` revision `191bfcb7` 的 Q8_0。只是冒烟，不是 P0：单机、单次、合成状态，没有与云端对比。

### 分发

- `llama-server` 运行所需文件是可执行文件加 10 个 `@rpath` dylib，合计 24 MB。压缩包里有 18 个符号链接，而 `macos-runtime.ts` 要求运行时目录不含符号链接，打包时须按 soname（如 `libllama.0.dylib`）物化为实体文件。
- 官方二进制是 ad-hoc 签名。加 `--options runtime` 后再 ad-hoc 签名，加载被拒，报 "mapping process and mapped file (non-platform) have different Team IDs"。这证实所有 Mach-O 必须用同一 Team ID 签名，发布流水线逐个签名的现有做法正好满足这一点。
- 主程序只加 `disable-library-validation`（模拟同 Team 签名）、**不加 `allow-jit`** 时，Metal 设备可见，推理速度为 GPU 水平。结论：llama-server 不需要 JIT entitlement。真实 Developer ID 签名与公证未测，本机没有签名身份。
- 从 Hugging Face 下载中途断开（4.02/4.48 GB），`curl -C -` 发 Range 请求返回 **206**，补齐后 sha256 等于 `SHA256SUMS` 的 `5e57075a…`。HF 的 Range 续传可用。

### 性能

| 项 | 实测 |
| --- | --- |
| 进程启动到 `/health` 200 | 4.0 s |
| 预填充，Metal（`llama-bench` pp512 / pp4096） | 1,092 / 976 token/s |
| 预填充，仅 CPU | 100 / 95 token/s |
| 驻留 | RSS 3.4 GB（含 mmap 权重），phys_footprint 781 MB |
| 官方示例（118 token） | 209 ms，`close_ticket` 0.9995 |
| 一个请求 4 问，状态约 3.4k token，冷 | 首问 3.86 s（3,921 token 全量预填充）；第 2..4 问 0.58 / 0.59 / 0.84 s（`cache_n` 3,405，只算任务段） |
| 同一请求再来一次 | 每问 0.43–0.60 s |
| 下一轮（状态追加一句） | 每问约 0.43 s |
| `n_probs` 1024 的额外开销 | 可忽略（完全命中缓存时整次请求 59 ms） |
| 16 候选的分布 | `n_probs: 1024` 下完整，候选质量 0.98 |

要点：

1. 前缀缓存有效，但**任务段排在状态之后**，所以每问都要重算任务段与状态增量。每问的暖态下限约 0.4–0.6 s，由任务段长度决定（16 个候选的 Skill 列表最长）。
2. 冷态首问由状态长度决定，约 1 s / 1k token（M5 基础款）。旧款或基础款芯片会更慢，需要 P0 在 M1/M2 上实测。
3. 一个 4 问请求暖态约 2 s，冷态约 6 s。是否可接受取决于云端判断的实测区间，P0 必须拿到这个对比。

### 未测

真实 Developer ID 签名与公证、Q4_K_M、9B、M1/M2 与 8 GB 机型、真实 Harness 决策点的 prompt、与云端的分布对比、多 slot 并行处理 N 问。

## 2026-10-14 · P0（部分）：真实 System3 请求在本机的延迟与 noul 渲染对比

环境：Apple M5 24 GB，llama.cpp b11118 Metal，4B Q8_0，`-c 9216 -np 1`。请求取自 `docs/feat-jev-decision-kernel/completion-live-product-result-requirement.json`（task.frame、completion.review 的真实线上请求与云端 9B 答案），以及按代码构造的 handoff.pack、entry.route 请求。脚本：会话临时目录 `p0/strategies.py`。

| 请求 | 问题数 | 本机合计 | 云端参考 |
| --- | --- | --- | --- |
| task.frame | 6 | 1.58 s（规范 noul） | 该次 2.44 s；标注集 p50 0.69–0.74 s |
| completion.review | 1 | 0.41 s | 该次 1.50 s；评测 p50 0.51–0.55 s |
| completion.review | 2 | 1.12 s | 该次 2.33 s |
| handoff.pack | 4 | 1.21 s | 0.53–2.23 s |
| entry.route | 1（6 候选） | 0.56 s | p50 0.47 s，p95 1.21–1.34 s |

- 每问约 0.28–0.56 s；这些请求的任务说明内嵌了目标与消息，状态前缀很短，前缀缓存几乎不命中（`cache_n` 多为 0），所以同请求第 2..N 问没有明显加速。
- 结论：M5 上与云端同量级，全部落在各决策点截止时间内（5–15 s）。task.frame 是后台异步，不阻塞。
- **noul 渲染定案**：规范 `noul` 原语（是非候选）比「把 true/false 文案渲染成二选一 choice」更贴近云端：`correction` 规范 noul 0.759 / 二选一 0.020 / 云端 0.947；`acceptance` 0.964 / 0.844 / 0.989。二选一会反转判断。
- 本机为 4B，云端为 9B，数值差异部分来自模型规模。

## 2026-10-14 · 交付形态调整

- 标准 DSH 桌面不装载 System3/Jev；System3 桌面是独立前端仓库，装载 `deploy/system3/runtime.patch.yml`（含云端 Jev）。
- 因此：标准 DSH 走可选 bundle（本机为唯一 Jev provider）；System3 桌面通过引擎 `cloudProviderId` 与 `configEditor` 在云端与本机之间切换。
- runner 随桌面 primary runtime 分发（不做 npm 平台包），见 [impl-spec.zh.md](impl-spec.zh.md)。
