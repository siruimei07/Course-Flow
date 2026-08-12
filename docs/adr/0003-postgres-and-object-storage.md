# PostgreSQL 管理结构化状态，对象存储管理原始资料

正式课程数据、导入状态、候选、审核决定和后台任务以 PostgreSQL 为权威来源；PDF、图片和大型派生产物放入 S3-compatible 对象存储。后台队列优先复用 PostgreSQL，避免首版额外运营 Redis，同时让创建导入批次与提交任务具备原子实现路径。对象存储通过小型 port 隔离，本地和生产使用不同 adapter，不把供应商 URL 保存为领域身份。
