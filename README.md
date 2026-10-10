# Paperclip 简体中文显示层

适用于官方 Paperclip **v2026.916.1** managed installation 的本地、可回滚界面翻译。默认显示简体中文，右下角 `EN` 可切回英文；语言选择只保存在当前浏览器。插件、数据库、Agent 配置与任务数据不受安装脚本影响。

这是静态前端显示层：它翻译导航、看板、任务、智能体、设置等常用页面的文字，不改动 Paperclip 后端或 API。未命中的新文案保持英文；用户输入、富文本编辑器和代码块不会被翻译。词库在同源 `/paperclip-zh/` 加载，不调用外部翻译服务。

## 安装

要求 Node.js 20+、Paperclip `v2026.916.1` 的静态 UI，以及对该安装目录的写入权限。先确保已备份 Paperclip 数据及密钥。安装脚本会再单独备份它即将修改的 `index.html`。

```sh
PAPERCLIP_HOME=/path/to/paperclip-home node install.mjs check
PAPERCLIP_HOME=/path/to/paperclip-home node install.mjs install
```

如果 managed installation 不在默认结构中，可设置 `PAPERCLIP_UI_DIST` 为包含 `index.html` 的 `@paperclipai/server/ui-dist` 绝对路径。`check` 会报告当前文件是否匹配固定版本；版本不匹配时安装会拒绝修改。确实存在已审阅的自定义 `index.html` 时，可显式设置 `PAPERCLIP_ZH_ALLOW_CUSTOM_INDEX=1`。

安装输出中的 `backupDir` 是本次修改前的备份目录。恢复时传入它：

```sh
PAPERCLIP_HOME=/path/to/paperclip-home node install.mjs restore /absolute/backupDir/from/install/output
```

浏览器刷新后生效。恢复只还原 `index.html`，保留备份与未引用的静态词库文件。升级 Paperclip 后先核对版本和页面，再决定是否更新此显示层。

## 翻译来源

- `overrides.zh-CN.json`：针对 `v2026.916.1` 常用页面校对的词条。
- `vendor/penclip-zh-CN.json`：从 [penclipai/paperclip-cn](https://github.com/penclipai/paperclip-cn/tree/047c4d51f8e53f32c1daca494e69460cf1695095) 的中文词库复制的静态数据；本仓库不执行该项目代码。上游许可见 `vendor/LICENSE.penclip`。
- 本项目其余代码按根目录 `LICENSE` 的 MIT 许可发布。

## English

This is a reversible, local Simplified Chinese display layer for Paperclip `v2026.916.1`. It patches only the installed static UI index and adds same-origin translation assets. The backend, APIs, database, agent configuration, and user content stay unchanged. Use `check` before `install`, and use the printed `backupDir` to `restore`. Some new or editor-owned strings may remain in English.
