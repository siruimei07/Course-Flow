# DeepSeek 受控评测运行手册

当前状态为 `AI_PENDING`。P3 只允许 deterministic fake 和 `--dry-run`；不得填写真实 key、不得发网络请求、不得把 live adapter 装入默认 production composition。

## P3 dry-run

```powershell
pnpm ai:eval:dry-run
```

该命令校验 `ai-eval-policy-v1`、corpus manifest、冻结 prompt/schema/budget 版本、请求 allowlist 和默认生产隔离，然后输出不含正文的计划摘要。退出码 `0` 只证明 runner 可执行，不证明 DeepSeek 能力。

## P4 live 前置条件

1. 产品、隐私和工程三位签署人填写 policy signatures；任何 `null` 都是 `UNVERIFIED`。
2. 产品所有者通过受保护 secret input 临时提供 key；不得写入 `.env`、shell history、数据库、日志、trace 或报告。
3. live runner 必须仍使用冻结 corpus、阈值和版本；运行后不得修改以求通过。
4. 记录 Responses `id`、实际 `model`、token、延迟、估算费用和安全错误码；不记录 key、输入/输出正文、reasoning 或 Chain of Thought。
5. 完成后立即撤销/删除 key。任一硬门禁失败或仍为 `UNVERIFIED` 时执行 `MANUAL_ONLY` 清理。

本仓库 P3 不提供可调用网络的 live runner；P4 只有获得用户临时授权后才能加入并执行。
