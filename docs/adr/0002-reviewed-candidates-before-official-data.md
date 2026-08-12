# AI 输出先成为候选，审核后才进入正式数据

AI、OCR 和外部课程资料都可能含糊或错误，因此导入流水线只写不可变 artifact、Evidence 和 Candidate。只有经过已授权用户的 Review Decision，Candidate 才能在同一 transaction 中生成或更新正式课程记录。该选择增加一个审核页面和候选存储，但防止错误截止日期静默触发热力图、冲突或日历导出，并保留纠错依据。
