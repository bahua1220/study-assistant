# Capacitor 6.2.2 安全补丁

日期：2026-10-29。对应应用版本1.1.11（versionCode 13）。

## 问题与范围

[上游公告 GHSA-rvm3-566m-v7fv](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv) 指出：旧版本的内部HTTP代理路径可能把远端文档置于App自身来源下运行。关闭CapacitorHttp开关并不能单独修复旧版本；需要使用补丁版本并重新构建、分发App。

本次仅将@capacitor/android、@capacitor/core、@capacitor/cli固定为6.2.2，保持在6系列。Camera插件、React、Vite、路由及FSRS等直接依赖未升级大版本。数据库结构、模型配置及服务器均不变。

## 修复检查

- package.json、package-lock.json和实际安装的三个Capacitor包均为6.2.2。
- 原生导航在插件处理前拦截内部代理路径。
- 内部代理默认关闭，开启后也拒绝文档/主框架请求。
- node tests/capacitor-security.mjs 覆盖上述原生源码防护条件，不依赖远端模型或真实用户数据。
- 重新构建Android APK才会把修复装入客户端；仅更新源码或后端不保护旧安装。

## 验证边界

本次完成了TypeScript/Vite构建、Capacitor同步、Android APK构建、应用模块的基础JUnit测试，以及词汇学习/错词本、计划重建、计划管理、多计划、单词本、三图识别、数据升级与分页等浏览器回归，32项Python离线回归也通过。

首次运行所有Android模块的离线单元测试因缺少缓存测试依赖未能完成。随后应用模块的 :app:testDebugUnitTest 成功运行；Capacitor模块的测试任务最终显示NO-SOURCE，没有测试用例，不能据此声称做了原生WebView端到端漏洞复现。

最终APK版本、原签名、生产构建资产一致性已核对，DEX中可检出补丁新增的文档请求防护方法。未连接真实手机测试。

浏览器回归、类型检查、Vite/Capacitor同步和Android构建用于验证兼容性。离线源码检查不是在真实手机上重现漏洞的端到端测试；没有据此推断项目曾遭攻击，也没有声称解决了全部依赖风险。

修复后npm audit仍有11项告警（4 moderate / 6 high / 1 critical），详见 [依赖检查](../dependency-audit.md)。其中CLI工具链的tar仍需单独处理。本次不使用npm audit fix --force掩盖未评估的大版本迁移。
