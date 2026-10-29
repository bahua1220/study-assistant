# 测试与验证

所有回归应使用隔离数据和模拟模型接口，不使用真实账号、题目或模型额度。

## 静态检查与构建

```bash
npm ci
npm run lint
npm run build
```

## Python 离线回归

先安装 backend/requirements.txt，在仓库根目录执行：

```bash
python -m unittest discover -s tests -p "test_*.py"
```

测试使用虚构的模型名称与 example.invalid 地址。不要为了运行测试填写真实模型配置。

## 浏览器回归

浏览器测试需要 Playwright，可在本机单独安装：

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run dev -- --config tests/vite.config.ts --host 127.0.0.1 --port 5181 --strictPort
```

另一个终端执行：

```bash
node tests/vocab-plan-recreate.mjs
node tests/vocab-plan-management.mjs
node tests/vocab-multi-plans.mjs
node tests/vocab-learning-1.1.9.mjs
node tests/vocab-learning-edge.mjs
node tests/vocab-notebooks.mjs
node tests/vocab-pagination.mjs
node tests/vocab-three-photos.mjs
node tests/vocab-add-actions.mjs
node tests/vocab-batch-import.mjs
node tests/vocab-draft-lookup.mjs
```

默认使用 Playwright 下载的 Chromium，也可设置 CHROME_PATH 使用自己的浏览器。PLAYWRIGHT_MODULE 可指定已有 Playwright 模块路径。测试服务端口默认5181，TEST_ORIGIN可覆盖；测试不会调用真实后端。

tests/vite.config.ts 关闭文件监控。修改源码后应重启测试服务，确保缓存不影响回归结果。

## 性能基准

生产构建后运行 npm run preview，指定端口5182，再执行 node tests/vocab-performance.mjs。基准使用模拟词卡与4倍CPU限速，检查100/1000/3000词场景仍按页挂载，而不是渲染全词库。

性能结果只代表当次电脑浏览器环境；AI 答题准确率与手机表现需单独设计评测，不能由这些回归测试推断。
