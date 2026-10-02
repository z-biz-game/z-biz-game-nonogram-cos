'use strict';
// 注册要静默失败：file://（Electron 直接 loadFile）、iOS 的 file 沙盒、旧 Safari、无痕窗口
// 都拿不到 serviceWorker。那不是玩家的错，不该在控制台抛红，更不该把主流程带崩。
(function () {
  try {
    var nav = typeof navigator === 'undefined' ? null : navigator;
    var loc = typeof location === 'undefined' ? null : location;
    if (!nav || !('serviceWorker' in nav) || !loc) return;
    // http/https 之外一律跳过：file:// 下 register() 必然 reject，还会留一条红色未捕获异常。
    if (loc.protocol !== 'https:' && loc.protocol !== 'http:') return;
    // 相对 'sw.js' 会按本页解析，Pages 把仓发在 /<repo>/ 前缀下也能命中。
    var base = new URL('.', loc.href);
    var ready = function () {
      try {
        return nav.serviceWorker.register('sw.js', { scope: base.pathname }).catch(function () { return null; });
      } catch (e) {
        return null;
      }
    };
    if (document.readyState === 'complete') ready();
    else window.addEventListener('load', ready, { once: true });
  } catch (e) {
    /* 注册失败不影响可玩性 */
  }
})();
