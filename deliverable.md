# 数织 · Nonogram · 交付卡

> 本文件由 `003_辅助能力/audit/script/gen_deliverable.py` 从本仓 README、package.json 与 `git ls-files` 生成，**不要手改**；改源后重跑，`--check` 必须逐字节一致。
> 读数取自本仓 `git ls-files` 与 package.json，均不含本文件自身；这里不写提交号，所以 `--check` 比的是内容，不是时间。

## 一句话

*数字就是证词。每一格都能被推理钉死，这一局不需要你猜。*

- 仓名：`z-biz-game-nonogram-cos`　组别：A · 益智消除与棋类
- 技术栈：Electron + Canvas

## 怎么跑

```sh
npm start    # node server.cjs
```

README 的快速开始：

```sh
npm start            # 零依赖静态服务 → http://127.0.0.1:5173
npm run electron     # 桌面壳（electron/main.cjs，同一份代码）
```

## 怎么验

| 层 | 命令 |
| --- | --- |
| 整仓门禁 | `bash tools/verify.sh` |
| 单元/规则测试 | `npm test` |
| npm verify | `npm run verify` |

## 规模

| 指标 | 读数 |
| --- | ---: |
| 跟踪文件 | 52 |
| 应用代码 | 3,590 行（JS 3,069 / CSS 331 / HTML 190） |
| 测试/工具文件 | 8 个 |
| 依赖 | `dependencies` 0 / `devDependencies` 1 |
| 位图资产（不含 shots） | 17 个 / 473 KB |

## 目录

```
.github .gitignore DESIGN.md LICENSE README.md assets css electron icons index.html js manifest.webmanifest package.json server.cjs sw.js tools
```

## 已知边界

- 提示一次只落**一格**，不铺满整条线；没有"自动解到卡住为止"的托管模式。
- 图案是 5 类形状文法生成的 motif，不是插画库；同一风格下会重样。
- 只有中文文案，没有 i18n。
- 没有云存档、没有排行榜、没有多设备同步——数据只在本机 `localStorage` 的一个键里。
- 桌面端是单栏布局的 Electron 壳，没有为宽屏做多栏重排。
- 键盘可达但没有完整屏幕阅读器叙述层（`aria-live` 只覆盖状态行）。
---

## 证据

- 重跑：在 lead 仓根执行 `python3 003_辅助能力/audit/script/gen_deliverable.py ../z-biz-game-nonogram-cos --check`，应与本文件逐字节一致。
- 漂了就重跑并复核读数变化：新增文件、改 README 的边界小节、加/删闸都会让它变，这些变化本身就是要看的内容。
