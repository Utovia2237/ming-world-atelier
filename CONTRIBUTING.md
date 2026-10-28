# 贡献与版本发布

GitHub `main` 分支是可公开访问网站的发布源。每次功能修改、修复或版本迭代，都要把代码、测试和相关文档一起提交并推送到 GitHub；合并到 `main` 后会自动运行测试并更新 GitHub Pages。

## 每次修改

1. 从最新 `main` 创建功能分支；不要直接在本地长期维护一份与 GitHub 分离的副本。
2. 完成修改，并按 `AGENTS.md` 的项目约束补齐测试与参数迁移逻辑。
3. 运行 `node --check app.js`、`node --check terrain.js` 和 `npm test`。涉及高清导出或 PNG 编码时，再运行 `npm run test:hires`。
4. 更新 `README.md` 中受影响的功能、用法或验证说明。用户可见行为变化要有对应测试。
5. 提交修改并推送分支到 GitHub，创建 Pull Request；检查 `Tests` 工作流通过后再合并到 `main`。
6. 合并后确认 `Deploy GitHub Pages` 工作流成功，并打开其输出的网站地址检查页面。

## 版本迭代

每次发布功能版本时，同一提交中同步更新 `package.json` 的 `version`、`package-lock.json` 和 `CHANGELOG.md`。遵循语义化版本：破坏兼容性的改动递增主版本，新增兼容功能递增次版本，兼容性修复递增修订版本。`terrain.js` 的版本还承担项目 JSON 兼容检查；改变该版本时须同步旧项目迁移与测试。普通小修复也必须推送并合并到 GitHub，不得只保存在本地。

GitHub Pages 由 `main` 的 `Deploy GitHub Pages` 工作流发布。部署产物只包含浏览器运行所需的 HTML、CSS 和 JavaScript；测试依赖、开发文件和本地生成物不会被发布。

## 部署设置

- 官方仓库：<https://github.com/Utovia2237/ming-world-atelier>。
- 公开网站：<https://utovia2237.github.io/ming-world-atelier/>。
- 仓库的 `Settings → Pages → Build and deployment → Source` 设为 `GitHub Actions`。
- 不需要手动上传 HTML，也不需要维护 `gh-pages` 分支。`main` 每次推送会先运行完整测试，再发布；测试失败时不会发布本次改动。
- 如果认证、网络、权限或 CI 阻止同步，保留本地修改并明确报告原因、提交状态和待办，不能声称已经同步或上线。
