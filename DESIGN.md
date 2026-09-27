# 设计文档 · 数织 Nonogram

面向维护者的技术说明：为什么这样实现、哪些不变量不能破坏、踩过的坑写在哪。
玩法与承诺清单在 [README.md](README.md)，验证矩阵也在那边。

---

## 1. 选型：为什么是浏览器而不是 SwiftUI

本组织的游戏仓有两套栈：SwiftUI + XcodeGen（`-ios`）与 Web/Canvas（`-cos`）。这个仓选后者，
理由不是"Web 更时髦"，而是**治理规则 2：交付报告里的每一条声称必须可核**。

- 这台机器只有 CommandLineTools：`xcodegen not found`，`xcodebuild` 需要完整 Xcode。
  写 Swift 就**无法编译验证**，只能靠读代码声称"能跑"——那正是本组织反复出假通过的地方。
- 浏览器栈的验证环是一条命令：起服务 → 开无头 Chrome → CDP 注入输入 → 读运行时对象 → 断言。
  而且同一份代码可以直接发到 GitHub Pages，别人**点链接就能玩**，交付不需要评审人相信任何话。
- 数织的难点在**推理机制**而不在渲染，Canvas 2D 的表现在这个品类里没有天花板问题。

代价：Electron 壳是本机的，`-ios` 那批仓的 App Store 分发路径这里没有。

## 2. 一个机制，四处复用

整个仓的承重结构是 `js/engine/line.js` 的**逐行求解器**。它同时是四样东西：

| 用途 | 走哪条路 |
|---|---|
| 唯一性证明 | `sweep()` 从空盘扫到不动点；扫满 ⇒ 唯一解 |
| 难度量尺 | `grade()` 数它要几趟 pass、首看解不出多少格 |
| 提示引擎 | `deduce()` 返回带 `rule` 的事件，提示就是"下一个事件 + 它的规则名" |
| 测试预言机 | `verify engine` 在浏览器里跑它，断言解出的盘等于生成的图 |

这件事决定了架构：**不能有第二套"给测试用的规则实现"**。`window.nonogram` 暴露的每个入口
（`paint` / `stroke` / `solveAll` / `useHint`）都是手指走的那条路。第二条路会让测试通过而游戏是坏的。

唯一性还额外用 `generate.js` 里的 `countSolutions()` 复核——**那是另一套算法**（逐行 DP 过列状态
`[completedRuns, currentRun, lastFilled]`）。求解器自证是"我推得动"，DP 独立数解是"确实只有一个"。
两者一致才有意义：`analyseLine` 如果有 bug，光靠它自己会既"证明"唯一又"证明"可解。

## 3. 全局不变量（破坏即出 bug）

### 3.1 种子的两层
```
originSeed  玩家/存档看到的种子，例如 'daily|2026-09-27'
base        generate() 内部派生的 `${seed}|${tier}|${size}`，写进 puzzle.seed
```
`generate()` 会自己加后缀。所以**存档必须存 `originSeed`**（`Store.saveResume` 里
`puzzle.originSeed || puzzle.seed`），否则"继续本局"会把 `base` 当种子再派生一次，
生成一张**名字相同但像素不同**的图——盘面、计时、线索全部错位，而且没有任何一处会报错。

### 3.2 笔（stroke）的生命周期
`beginStroke() → paint/write… → endStroke()`，`endStroke` 的顺序是刻意的：

1. 把 stroke 数组**先推进 `history`、`moves++`**；
2. 然后**保持这个数组为 open**（`this.stroke = stroke`）再跑 `afterChange()`，
   于是自动打叉的 `write()` 追加进**同一个 entry** ⇒ 一次撤销同时收回墨迹与它的推论；
3. 最后才 `this.stroke = null` 并广播 `commit`。

`moves++` 必须在 `afterChange()` **之前**：否则赢家那一笔还没入账，结算页的步数永远少一步
（`verify play` 现在钉住了这条）。
`paint()` 只在**自己开的那一笔**上收尾（`owned = !this.stroke`）。拖动逐格调 `paint()`，
如果每次 `paint()` 都提交，一笔拖拽会变成 N 个撤销步骤。

### 3.3 提示必须"只给可推导的格"
`hint()` 不允许直接读 `puzzle.solution` 抄答案——它跑 `deduce()` 取下一个事件。
于是"提示永远正确"和"提示永远有用"是同一条性质：一个只会答的提示机会把卡住的玩家
留在原地，而本作的要求是**只吃提示也能把盘清空**（`verify hint` 的 `boardsClearedByHints`）。

`Game.afterChange()` 里的 `announced` 集合是重复事件的门闩：线索闭合要响，但同一条线
第二次被扫到不能再响。用 `Set` 而不是"分数变了就震一下"，因为规则是"线闭合"这个事件。

### 3.4 尺寸与颜色只有一个来源
`js/theme.js` 是唯一的令牌表，`applyThemeVars()` 把它注入成 CSS 自定义属性，
样式表和 canvas 读同一份。`BoardView.layout()` 从容器尺寸**推导** cell 边长
（`Cell.min 17 … Cell.max 46`），CSS 里不允许出现裸像素尺寸，视图里不允许出现裸 `Color(hex:)`。
`color-scheme: dark` 负责首帧不闪白，而不是再写一遍背景色。

### 3.5 位掩码的硬上限
线形用 32 位整数位掩码表示（`maskOf(len)` 在 `len >= 31` 时钳到 0x7fffffff，`runsOf` 靠 `>>>` 位移）。
**盘面边长不能做到 31 以上**，否则高位置 1 会被符号位移吃掉。要出 20×20 以上的档，
先换成 `BigInt` 或分段掩码并给 `enumerate` 加缓存上限，再改 `TIERS`。

### 3.6 难度带是读出来的，不是调出来的
`generate.js` 的 `TIERS[].band` 必须与 `npm run balance` 打印的实测分位一致。
如果改了 `grade()` 的权重，**必须重跑 balance 并重写 band**；
手改 band 让它"看起来对"会让生成器退化成随机铺点，而 README 里"每档实测区间"那张表立刻变成假话。
`engine-test` 和 `verify gen` 都会检查 in-band，改权重不重跑就是红。

### 3.7 存档要带上这一局的"花费"
`saveResume()` 除盘面外必须写 `moves` 与 `hints`，`begin({restore})` 必须把它们装回 `game`。
最佳时间是由 `hints` 判定优先级的（`recordBest`），而这两个数只活在动作里、不在盘面里：
不存就等于"吃六次提示 → 关标签页 → 回来清盘"能刷出一条**提示 0** 的纪录。
`verify resume` 现在钉住了三件事：存档里的数等于当场、重载后的数等于存档、
续局之后再用一次提示**仍然会+1**（续局不是免费模式）。

## 4. 踩过的坑

- **`enumerate` 的缓存**是进程级 `Map`。位掩码一律 **LSB-first**（`while (m) { if (m & 1) … m >>>= 1 }`）；
  写成 MSB-first 会让 `runsOf` 与 `clueFromSolution` 方向相反，症状是"线索正确但图是镜像的"。
- **动效开关是两个来源的并集**：`matchMedia('(prefers-reduced-motion: reduce)')` **和**游戏内开关
  （`theme.js` 的 `setReduceMotion`）。只看 OS 会让设置里那个开关成为谎言。
- **`autoCross` 也曾是谎言**：旧写法先落叉再查设置。现在 `afterChange()` 分岔：
  设置关掉时真的把叉留给玩家，只是不再自动落，而不是"背后照样落"。
- **开局预填（`prime()`）不能进撤销栈**：线索为 `0` 的整行在落第一笔之前就已是空，
  那是"读题"不是"输入"。`prime()` 用一次性 scratch stroke 承接这些叉，然后丢弃。
- **键盘方向键不能落墨**：那会把导航变成输入，撤销栈立刻失去意义。方向键只移动 `view.cursor`，空格提交。
- **`pointerleave` 不能结束拖拽**：canvas 上有 pointer capture，离开元素是常态。
  结束只认 `pointerup`/`pointercancel`，外加一个 window 级兜底。
- **存档落盘的时机是"一笔提交"，不是"一个格"**。`persistResume` 的门闩必须看 `game.moves`
  而不是 `history.length`：一笔要到 `endStroke` 才进 history，用后者判断会**静默跳过每一局的第一步**。
  离开页面（`pagehide` / `visibilitychange`）走 `flushResume()` 同步写，不等 400ms 防抖——
  后台标签页随时可能被丢弃。
- **`navigator.vibrate` 与 `AudioContext` 要问浏览器而不是问事件**：合成 `PointerEvent` 也会到达
  监听器，据它解锁就只会刷一串 "Blocked call to navigator.vibrate" 的 console error，
  把真正该看见的报错埋掉。判据用 `navigator.userActivation.hasBeenActive`。
- **`.hidden = true` 不等于看不见**。UA 样式表里的 `[hidden] { display: none }` 特异性是 0，
  任何作者层的 `display` 都能压过它。于是 `#screen-game { display: flex }` 让游戏屏永远在渲染
  （首页底下压着一块活棋盘、结算卡接在盘面下面），`.resume-card { display: flex }` 让"继续"卡
  在没有任何存档时也照样出现——而**所有读 `.hidden` 标志的断言全绿**。
  现在 `css/game.css` 顶部有一条 `[hidden] { display: none !important; }` 统一兜住，
  屏切换的断言只问布局（`getClientRects()`）不问标志。加新的可隐藏元素时不要再写局部补丁。
- **测试自己也会说谎**：`tools/scenarios.js` 的 `done()` 必须 `splice` 出快照。
  返回 live 数组再清空，会让每个场景报 `0 checks` 却仍然带着失败计数——
  一份"看着像绿"的报告。`verify.sh` 现在对零断言直接判失败。

## 5. 验证台的操作细节

```bash
SCENARIOS="play hint" ./tools/verify.sh     # 只跑指定场景
HTTP_PORT=5300 ./tools/verify.sh           # 换端口（见下）
BASE_URL=https://… ./tools/verify.sh       # 打线上：同一套断言，验的是部署后的产物
```

- **端口不用 5173**。5173 是本组织其他 `-cos` 仓的默认口，一个长期跑着的服务器会
  在 5173 上端出**另一个 app 的 `index.html`**；页面加载"成功"、`window.nonogram` 永远不出现，
  而你只会看到一次莫名的超时。现在 `verify.sh` 用 5217，并在开浏览器之前先 `curl` 校验
  首页里确实有 nonogram 字样。
- **不要加** `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`：
  软件光栅会占满所有核心，且没有 CDP 客户端时 Chrome 不会自己退出。
- **`document.hidden` 必须强制 false**，否则无头模式认为页面在后台，渲染循环跳帧，
  依赖 rAF 的场景会对着一个"其实在跑"的浏览器超时。
- `playtest.cjs` 把机器可读结论放在**最后一行**（`RESULT <json>`），console 噪声走 stderr：
  日志里出现 `{` 不会劫持解析器。
- 等待用轮询 `/json/version` 与 `window.nonogram.version`，不用 `sleep`——全新
  `--user-data-dir` 绑定 DevTools 的时间是不定的。

## 6. 文件地图

```
js/engine/rng.js       FNV-1a 哈希 + mulberry32；dateSeed()：一切盘面按种子寻址
js/engine/art.js       形状文法：rect/ellipse/diamond/triangle/ring + 镜像/山脊 + 可读性度量
js/engine/line.js      位掩码枚举、强制格、sweep/deduce —— 承重的求解器
js/engine/generate.js  TIERS、grade()、countSolutions()（独立 DP）、makePuzzle 往返校验
js/theme.js            令牌 + applyThemeVars() + 动效开关并集
js/audio/synth.js      零素材 WebAudio：fill/cross/erase/lineDone/hint/error/win
js/store.js            单键 localStorage、RLE 盘面、recordBest 判优、markDaily streak
js/render/board.js     layout() 推导尺寸、hitTest()（棋盘 + 两条线索槽）、render()
js/ui/game.js          Game：笔、撤销栈、冲突归因、hint 解释、计时与暂停
js/main.js             三屏路由、菜单、输入接线、window.nonogram 验证入口
tools/                 engine-test / balance / playtest(CDP) / scenarios / verify.sh
```

## 7. 明确不做

- 不做"只有文件没有接线"的幽灵功能：新类型必须被视图或引擎真实调用。
- 不加运行时依赖。数织不需要后端、不需要打包器；加一个就等于把 CI 变成网络的函数。
- 不做需要猜的图。哪怕意味着某些种子生成失败、退回更简单的档，也不上线"看起来无解"的盘。
