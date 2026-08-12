"""[已废弃] 此文件不再被 main.py 引用。

所有路由已拆分到 app/modules/ 下的模块路由：
  - app/modules/events/router.py
  - app/modules/skills/router.py
  - app/modules/insights/router.py
  - app/modules/ai/router.py

系统端点（health/config/llm_health）已内联到 app/main.py。

此文件保留仅作为迁移参考，后续可安全删除整个 api/ 目录。
"""
