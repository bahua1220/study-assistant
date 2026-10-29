# 依赖检查（2026-10-29）

本次使用锁文件执行 npm ci 与 npm audit --json。检查报告：12项已知依赖告警，包含4项moderate、6项high、2项critical。

主要涉及运行时Android桥接包、路由相关依赖，以及CLI、打包器和其传递依赖。这些是npm审计报告，不代表本项目已被证明存在可利用漏洞，也不能据此宣布项目安全。

- @capacitor/android：critical，审计提示存在修复版本。
- tar：critical，经@capacitor/cli引入；审计建议的整体修复涉及CLI大版本升级。
- @capacitor/cli、vite及部分传递依赖：存在high等告警；部分建议涉及大版本升级。
- 其他报告项包括@xmldom/xmldom、brace-expansion、nanoid、postcss-selector-parser、react-router、react-router-dom、source-map-js及esbuild。

为避免在源码整理过程中擅自引入框架迁移，本快照保留原锁文件，没有运行npm audit fix --force。仓库用于私有代码展示和本地开发，不应直接按生产安全基线对外部署。

后续应在独立分支升级依赖，核对上游公告，并重新验证Android插件、词库/计划数据升级、打包及浏览器回归。只在受信本地网络运行开发服务器；完成验证后重新记录审计结果。Python依赖本次未做漏洞审计。
