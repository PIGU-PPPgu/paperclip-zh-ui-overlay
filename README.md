# Paperclip 简体中文界面

这是一个独立于 Paperclip 安装包的中文显示入口。它在本机 `127.0.0.1:3101` 转发到官方 Paperclip `127.0.0.1:3100`，并在网页响应中加载同源词库。**升级 Paperclip managed installation 不需要重装或修改中文入口**；升级后应检查界面是否仍匹配新文案。右下角的 `EN` 按钮可切回英文。

## 推荐：独立入口

要求 Node.js 24+。先启动官方 Paperclip，再在本仓库执行：

```sh
npm ci --prefix sidecar --omit=dev
node sidecar/proxy.mjs
```

打开 `http://127.0.0.1:3101`。`http://127.0.0.1:3101/_paperclip_zh/health` 会报告入口和上游状态。入口只绑定 loopback；如需供其他成员访问，应先将 Paperclip 切到需要登录的部署模式，再用受控的 HTTPS 私有入口发布。

若已有书签指向 `3100`，可将 Paperclip 实例本身改为仅监听 `127.0.0.1:3102`，让中文入口占用原地址，并让 `3101` 同时作为兼容入口：

```sh
PAPERCLIP_UPSTREAM_URL=http://127.0.0.1:3102 \
PAPERCLIP_ZH_BIND_PORT=3100 \
PAPERCLIP_ZH_ALIAS_PORT=3101 \
node sidecar/proxy.mjs
```

这要求先在实例数据目录中配置并启动 Paperclip 的 `3102` 监听，再启动 sidecar；两者都必须保持 loopback。这样从旧 `3100` 书签进入的页面也会加载汉化。升级前后检查 `3100`/`3101` 的中文入口、`3102` 的官方健康接口及一条实际浏览器页面。

将该进程交由 macOS LaunchAgent 或 Linux systemd 常驻，并把本仓库文件放在**Paperclip managed installation 之外**的固定目录。上游升级只替换 Paperclip 的程序 payload；中文入口、词库和进程配置继续留在固定目录。它不会修改 Paperclip 后端、数据库、API、Agent 配置或 NAS。

未命中的新文案会保留英文；用户输入、富文本编辑器和代码块不翻译。若将来上游改变页面结构，入口会原样返回页面，不会阻止 Paperclip 启动；此时需要更新词库或入口代码才能恢复完整汉化。独立安装保证的是**无需逐次重装补丁**，无法保证任意未来上游版本都保持相同的 DOM 文案。

## 旧版静态补丁

`install.mjs` 是 `v2026.916.1` 的旧版、可回滚安装器，直接修改该版本的 `ui-dist/index.html`。它保留给已经使用过该方式的实例恢复原文件，**不满足升级免重装要求**。切换独立入口前，先用安装时得到的 `backupDir` 恢复官方 `index.html`。新部署无需执行 `install.mjs install`。

```sh
PAPERCLIP_HOME=/path/to/paperclip-home node install.mjs check
PAPERCLIP_HOME=/path/to/paperclip-home node install.mjs restore /absolute/backupDir/from/install/output
```

## 翻译与许可

- `overrides.zh-CN.json`：针对 Paperclip `v2026.916.1` 常用页面校对的词条。
- 智能体页补充运行状态、运行器配置、心跳策略与模型测试文案；上游新增或改名的文案仍需逐版核对。
- `vendor/penclip-zh-CN.json`：从 [penclipai/paperclip-cn](https://github.com/penclipai/paperclip-cn/tree/047c4d51f8e53f32c1daca494e69460cf1695095) 复制的静态词库；不运行其代码，许可见 `vendor/LICENSE.penclip`。
- 入口与其余代码按根目录 `LICENSE` 的 MIT 许可发布。

## English

The default setup is a persistent loopback sidecar at `127.0.0.1:3101`, proxying an unmodified Paperclip instance at `127.0.0.1:3100`. To keep existing `3100` bookmarks Chinese, run Paperclip internally on `3102` and the sidecar on `3100` with `3101` as an optional alias. A managed Paperclip upgrade does not overwrite the sidecar, so there is no per-version reinstall. New UI strings may still require updated translations. The old `install.mjs` patcher remains only for restoring existing installations.
