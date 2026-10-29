# 依赖检查（2026-10-29）

## 当前状态：Android 补丁修复后

@capacitor/android、@capacitor/core、@capacitor/cli 已从6.2.1固定到6.2.2，修复 GHSA-rvm3-566m-v7fv。安装后再次执行 npm audit --json：当前为11项告警（4 moderate / 6 high / 1 critical），Android 包已不在告警列表中。没有执行强制升级，也没有迁移到Capacitor 8。

剩余critical来自CLI工具链的tar，不是此次Android运行时修复的同一问题；Vite、路由和其他依赖的告警仍需单独处理。不能把本次修复称为零漏洞或完整安全审计。

说明与验证范围见 [Capacitor补丁记录](security/capacitor-6.2.2.md)。

## 初始检查记录（修复前）

本次使用锁文件执行 npm ci 与 npm audit --json。检查报告：12项已知依赖告警，包含4项moderate、6项high、2项critical。

主要涉及运行时Android桥接包、路由相关依赖，以及CLI、打包器和其传递依赖。这些是npm审计报告，不代表本项目已被证明存在可利用漏洞，也不能据此宣布项目安全。

- @capacitor/android：critical，审计提示存在修复版本。
- tar：critical，经@capacitor/cli引入；审计建议的整体修复涉及CLI大版本升级。
- @capacitor/cli、vite及部分传递依赖：存在high等告警；部分建议涉及大版本升级。
- 其他报告项包括@xmldom/xmldom、brace-expansion、nanoid、postcss-selector-parser、react-router、react-router-dom、source-map-js及esbuild。

为避免在源码整理过程中擅自引入框架迁移，本快照保留原锁文件，没有运行npm audit fix --force。仓库用于私有代码展示和本地开发，不应直接按生产安全基线对外部署。

后续应在独立分支升级依赖，核对上游公告，并重新验证Android插件、词库/计划数据升级、打包及浏览器回归。只在受信本地网络运行开发服务器；完成验证后重新记录审计结果。Python依赖本次未做漏洞审计。
