# 课表保存重复规则与例外，课节实例按需派生

CourseFlow 把一门课程的 Lecture、Tutorial（TUT）、Practical（PRA）保存为 `MeetingPattern`，把 Reading Week 保存为学期 `AcademicCalendarException`，把单次取消、改期或明确保留保存为 `MeetingException`。日历、今日课程和下一节课在有界查询区间内展开 `MeetingOccurrence`，不预先为整个学期写入每一次上课记录。

这样做让周期规则保持可编辑，Reading Week 和单次例外有明确优先级，并避免修改课表后批量同步大量重复行。课节实例使用 pattern ID 与原 occurrence date 形成稳定身份，因此改期不会在日历导出中制造重复事件。代价是 Schedule query 必须正确处理课程时区、DST、例外合并与查询范围，并需要纯展开算法和 golden tests；若未来性能数据要求缓存，缓存仍是可删除、可重建的派生数据，不能成为第二真相。
