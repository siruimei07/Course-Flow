# 采用模块化单体与独立 worker

CourseFlow 首版采用一个 TypeScript 模块化单体、一个 Next.js web 进程和一个共享 core 的 Node.js worker。资料解析具有长耗时、重试和外部 AI 依赖，因而从请求进程隔离；其余领域规则保留在同一部署单元和数据库 transaction 内。相比微服务，这能让审核决定与正式数据原子写入，并显著降低早期部署和跨服务一致性成本；若未来处理量要求独立扩容，worker 的队列 seam 已提供拆分位置。
