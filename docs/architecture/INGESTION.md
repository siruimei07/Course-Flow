# 课程资料流水线

P4 后 CourseFlow 采用纯手工资料路径。Source Document 是原文容器，不是正式课程事实；上传、预览或删除资料都不能自动创建或修改课程、课节、事项或成绩。

## 1. 外部 interface

`sources` 模块公开最小操作：

- `beginUpload(scope, input)`：验证所有权、文件数量、声明 MIME、大小和稳定位置，创建 uploading metadata 与受限上传授权。
- `completeUpload(scope, sourceId, expectedVersion)`：服务端检查实际对象、长度、签名与 MIME 后把 Source 标为 ready。
- `listSources(scope, filter)` / `getSource(scope, sourceId)`：只返回当前 owner 可见的 metadata/view model。
- `getPreview(scope, sourceId, assetId)`：鉴权后返回短期、同源或受控签名的预览响应。
- `deleteSource(scope, sourceId, expectedVersion)`：metadata 立即 fail closed，再清理对象；失败可按同一版本安全重试。

页面从 ready Source 打开既有手工表单。表单提交继续调用 `academics` 或 `planning` 的公开 command；`sources` 不持有这些模块的写权限。

## 2. 上传协议

1. 浏览器提交显示名、所属课程和每个资源的文件名、声明 MIME、字节数与位置。
2. server 验证 owner/course、数量、单文件与总量上限，生成随机对象 key 和短期上传授权。
3. 浏览器直接上传到私有 object storage，不把文件正文写进普通日志或数据库。
4. 浏览器提交完成命令；server 重新检查对象存在、长度、文件签名与允许 MIME。
5. 全部资源通过后 Source 进入 `ready`。任何失败保持可解释状态，并允许用户删除或重新上传。

允许类型为 PDF、JPEG、PNG、WebP。扩展名和声明 MIME 不能单独作为信任依据；预览响应使用安全 `Content-Type`、`Content-Disposition`、`nosniff` 和私有缓存策略。

## 3. 状态与删除

Source 只需要资料生命周期状态：`uploading`、`ready`、`failed`、`deleted`。没有后台解析或审核状态。

删除命令先把 metadata 标记为 deleted，并把对象清理置为 pending；从这一刻开始读取与预览均 fail closed。对象删除成功后标记 complete；暂时失败时由同版本重试继续，不能让已删除资料重新可见。

## 4. 手工核对闭环

1. 用户在 `/sources` 选择一份 ready Source。
2. 页面显示安全预览和文件顺序，不把原文注入正式领域对象。
3. 用户点击“手工添加事项”等入口，既有表单在保留 Source 上下文的同时打开。
4. 用户对照原文填写并明确提交。
5. 正式 command 重新执行 owner、日期、时区、版本和领域校验；成功后 Dashboard、Timeline、Tasks、冲突、负荷和 ICS 从同一正式 snapshot 派生。

验收必须证明上传本身不改变正式计划，只有表单提交会写入，且删除 Source 不删除已确认的正式记录。

## 5. 安全、隐私与可观测性

- 对象 key 不含原始文件名或用户输入；bucket 私有，上传/预览授权短时有效且绑定 owner、对象和方法。
- 列表、详情、完成上传、预览和删除全部执行 owner scope；不存在无作用域的 `findById`。
- 日志只记录 request/source/asset ID、状态、字节数、MIME 判定和耗时；不记录文件正文、签名 URL 查询参数或存储凭据。
- 指标覆盖上传成功/失败、完成校验、预览错误、删除清理与延迟；不采集原文。
- 删除、账号注销和备份保留遵循 [质量与数据生命周期](./QUALITY.md)。

## 6. 最低证明集

- 单元：文件数量/大小/MIME/位置、版本冲突、owner scope、状态转换和删除幂等。
- PostgreSQL/S3 contract：begin → upload → complete → preview → delete；跨 owner 读取/删除拒绝；对象签名不匹配失败。
- 浏览器：Sources 上传与预览，打开手工表单，提交后在 Timeline/Dashboard 回读；页面无自动解析或审核入口。
- 发布面：`pnpm test:manual-only` 确认远程 AI 路径、配置、表与 UI 均不存在。
