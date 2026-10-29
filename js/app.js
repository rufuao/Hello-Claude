/*
 * 羊城漫游 · 应用逻辑
 * 路由（hash）、注册登录、点赞收藏、Top10 排名、备份导出导入。
 * 数据保存在 localStorage；demo.html 通过 ?demo=1 使用独立的存储命名空间，并接收演示指令。
 */
(function () {
  'use strict';

  var D = window.GZ_DATA;
  var DEMO = /[?&]demo=1/.test(window.location.search);
  var STORE_KEY = DEMO ? 'gzroam.demo.v1' : 'gzroam.v1';
  var APP_ID = 'gz-roam';
  var BACKUP_VERSION = 1;
  var PAGES = ['attractions', 'foods', 'top', 'me'];
  var TABS = [
    { id: 'attractions', label: '学点', d: '<path d="M12 3 V21"/><path d="M8.5 21 L11 9.5"/><path d="M15.5 21 L13 9.5"/><path d="M9 15 H15"/><path d="M6.5 21 H17.5"/>' },
    { id: 'foods', label: '美食', d: '<path d="M3 11 H21 Q20 19 12 19.5 Q4 19 3 11 Z"/><path d="M8 7.5 Q9 9.5 8 11"/><path d="M12 5.5 Q13 7.5 12 9.5"/><path d="M16 7.5 Q17 9.5 16 11"/>' },
    { id: 'top', label: 'Top10', d: '<circle cx="12" cy="15" r="6"/><path d="M8.5 3.5 L10.5 9"/><path d="M15.5 3.5 L13.5 9"/><path d="M10 15 L11.5 16.5 L14.5 13.5"/>' },
    { id: 'me', label: '我的', d: '<circle cx="12" cy="8" r="4"/><path d="M4.5 21 Q12 10.5 19.5 21"/>' }
  ];
  var FILTER = 'url(#rough)';

  var ITEMS = Object.create(null);
  var LISTS = { attr: D.attractions, food: D.foods };
  D.attractions.forEach(function (it, i) { it.kind = 'attr'; it.idx = i; ITEMS[it.id] = it; });
  D.foods.forEach(function (it, i) { it.kind = 'food'; it.idx = i; ITEMS[it.id] = it; });

  var ui = { authMode: 'login', board: 'attr' };
  var view = document.getElementById('view');

  /* ---------- 工具函数 ---------- */

  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clampInt(v, lo, hi) {
    var n = parseInt(v, 10);
    if (isNaN(n)) n = lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function uniq(a) {
    return a.filter(function (v, i) { return a.indexOf(v) === i; });
  }

  function strList(a) {
    if (!Array.isArray(a)) return [];
    return uniq(a.filter(function (x) { return typeof x === 'string' && !!ITEMS[x]; }));
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(t) {
    var d = new Date(t);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function stamp() {
    var d = new Date();
    return '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function randomSalt() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // 简单哈希（FNV 类，加盐）。仅用于本地演示，避免明文存储，并不具备真正的安全性。
  function hashPw(salt, pw) {
    var s = salt + '|' + pw;
    var out = '';
    for (var seed = 0; seed < 2; seed++) {
      var h = (0x811c9dc5 ^ Math.imul(seed, 0x9e3779b9)) >>> 0;
      for (var r = 0; r < 64; r++) {
        for (var i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i) + r;
          h = Math.imul(h, 0x01000193) >>> 0;
        }
      }
      out += ('00000000' + h.toString(16)).slice(-8);
    }
    return out;
  }

  /* ---------- 状态与存储 ---------- */

  function normalizeUsers(src) {
    var out = Object.create(null);
    Object.keys(src).forEach(function (name) {
      var u = src[name];
      if (!u || typeof u !== 'object' || !u.salt || !u.hash) return;
      out[name] = {
        nick: String(u.nick || name).slice(0, 10),
        salt: String(u.salt),
        hash: String(u.hash),
        avatar: clampInt(u.avatar, 0, D.avatars.length - 1),
        theme: clampInt(u.theme, 0, D.themes.length - 1),
        likes: strList(u.likes),
        favs: strList(u.favs),
        history: Array.isArray(u.history)
          ? u.history.filter(function (h) { return h && ITEMS[h.id]; }).slice(0, 20)
              .map(function (h) { return { id: h.id, t: Number(h.t) || 0 }; })
          : []
      };
    });
    return out;
  }

  function loadState() {
    try {
      var raw = window.localStorage.getItem(STORE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.users && typeof s.users === 'object') {
          return { users: normalizeUsers(s.users), session: typeof s.session === 'string' ? s.session : null };
        }
      }
    } catch (e) { /* 存储不可用或数据损坏：按空数据处理 */ }
    return { users: Object.create(null), session: null };
  }

  var state = loadState();

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      toast('浏览器禁止保存数据，本次修改仅临时有效');
      return false;
    }
  }

  function me() {
    return state.session && state.users[state.session] ? state.users[state.session] : null;
  }

  function userLikeCount(id) {
    var n = 0;
    Object.keys(state.users).forEach(function (k) {
      if (state.users[k].likes.indexOf(id) >= 0) n++;
    });
    return n;
  }

  function score(it) {
    return it.seed + userLikeCount(it.id);
  }

  // 当前排名：按（初始热度 + 用户点赞）降序；同分时，用户点赞多者在前，其次初始热度高者在前。
  function ranked(kind) {
    var list = LISTS[kind].slice();
    var uc = Object.create(null);
    list.forEach(function (it) { uc[it.id] = userLikeCount(it.id); });
    list.sort(function (a, b) {
      return (b.seed + uc[b.id]) - (a.seed + uc[a.id]) || uc[b.id] - uc[a.id] || b.seed - a.seed || a.idx - b.idx;
    });
    return list.map(function (it) { return { item: it, score: it.seed + uc[it.id], userLikes: uc[it.id] }; });
  }

  // 初始榜单：仅按初始热度排序，用于计算排名升降。
  function baseRanks(kind) {
    var m = Object.create(null);
    LISTS[kind].slice()
      .sort(function (a, b) { return b.seed - a.seed || a.idx - b.idx; })
      .forEach(function (it, i) { m[it.id] = i + 1; });
    return m;
  }

  /* ---------- 插画 ---------- */

  function art(it) {
    return '<svg class="ill" viewBox="0 0 200 150" role="img" aria-label="' + esc(it.title) + '插画">' +
      '<rect width="200" height="150" fill="' + it.bg + '"/>' +
      '<g filter="' + FILTER + '" style="stroke:var(--ink)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
      it.draw + '</g></svg>';
  }

  function avatar(idx, size) {
    var a = D.avatars[idx];
    return '<svg class="avatar" viewBox="0 0 100 100" width="' + size + '" height="' + size + '" role="img" aria-label="头像' + (idx + 1) + '">' +
      '<rect width="100" height="100" fill="' + a.bg + '"/>' +
      '<g filter="' + FILTER + '" style="stroke:var(--ink)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none">' +
      a.draw + '</g></svg>';
  }

  function flower(size) {
    var petals = [0, 72, 144, 216, 288].map(function (a) {
      return '<ellipse cx="18" cy="9.5" rx="5.6" ry="8.5" transform="rotate(' + a + ' 18 18)"/>';
    }).join('');
    return '<svg class="flower" viewBox="0 0 36 36" width="' + size + '" height="' + size + '" aria-hidden="true">' +
      '<g fill="#d9443a" stroke="#2b2b2b" stroke-width="1.4">' + petals + '</g>' +
      '<circle cx="18" cy="18" r="3.6" fill="#f6d77a" stroke="#2b2b2b" stroke-width="1.4"/></svg>';
  }

  /* ---------- 轻提示 ---------- */

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1900);
  }

  /* ---------- 页面 ---------- */

  function card(it, i) {
    var u = me();
    var liked = !!(u && u.likes.indexOf(it.id) >= 0);
    var faved = !!(u && u.favs.indexOf(it.id) >= 0);
    var read = !!(u && u.history.some(function (h) { return h.id === it.id; }));
    var cnt = it.seed + userLikeCount(it.id);
    return '<article class="card tilt-' + (i % 4) + (read ? ' read' : '') + '" data-id="' + it.id + '">' +
      '<button class="card-art" data-act="view" data-id="' + it.id + '" aria-label="查看' + esc(it.title) + '">' + art(it) + '</button>' +
      '<div class="card-body">' +
        '<div class="card-head"><span class="tag">' + esc(it.tag) + '</span><span class="seen">已浏览</span></div>' +
        '<h3><button class="title-btn" data-act="view" data-id="' + it.id + '">' + esc(it.title) + '</button></h3>' +
        '<p class="intro">' + esc(it.intro) + '</p>' +
        '<div class="actions">' +
          '<button class="btn like' + (liked ? ' on' : '') + '" data-act="like" data-id="' + it.id + '" aria-pressed="' + liked + '">' +
            (liked ? '♥' : '♡') + ' 点赞 <b class="cnt">' + cnt + '</b></button>' +
          '<button class="btn fav' + (faved ? ' on' : '') + '" data-act="fav" data-id="' + it.id + '" aria-pressed="' + faved + '">' +
            (faved ? '★' : '☆') + ' 收藏</button>' +
        '</div>' +
      '</div></article>';
  }

  function pageCards(kind) {
    var isAttr = kind === 'attr';
    var list = LISTS[kind];
    var hero = isAttr
      ? '<section class="hero">' + flower(44) + '<div><h2>广州学点</h2><p>广州建城逾2200年，老城街巷与新地标交织。十个值得细品的去处，点赞后可在 Top10 看到排名变化。</p></div></section>'
      : '<section class="hero">' + flower(44) + '<div><h2>广州美食</h2><p>早茶、烧腊、糖水，一口一个广州味。点赞、收藏、浏览，都会记在你的账号里。</p></div></section>';
    return '<section class="page">' + hero +
      '<div class="cards">' + list.map(card).join('') + '</div></section>';
  }

  function pageTop() {
    var board = ui.board;
    var rows = ranked(board).slice(0, 10);
    var base = baseRanks(board);
    var max = rows.length ? rows[0].score : 1;
    var u = me();
    var html = rows.map(function (r, k) {
      var rank = k + 1;
      var d = base[r.item.id] - rank;
      var delta = d > 0 ? '<em class="delta up">▲' + d + '</em>'
        : d < 0 ? '<em class="delta down">▼' + (-d) + '</em>'
        : '<em class="delta same">—</em>';
      var medal = rank <= 3 ? ' medal m' + rank : '';
      var mine = u && u.likes.indexOf(r.item.id) >= 0 ? '<span class="mine">我已赞</span>' : '';
      return '<li class="row" data-rank-id="' + r.item.id + '">' +
        '<span class="num' + medal + '">' + rank + '</span>' +
        '<span class="thumb">' + art(r.item) + '</span>' +
        '<div class="meta"><b>' + esc(r.item.title) + '</b>' + mine +
          '<span class="bar"><i style="width:' + Math.round(r.score / max * 100) + '%"></i></span></div>' +
        '<div class="score"><b>' + r.score + '</b><small>赞</small>' + delta + '</div>' +
      '</li>';
    }).join('');
    return '<section class="page">' +
      '<section class="hero"><div><h2>Top10 排行榜</h2>' +
        '<p>点赞数 = 初始热度 + 用户点赞。▲▼ 表示相对“仅按初始热度排序”的升降位次。</p></div></section>' +
      '<div class="seg" role="group" aria-label="榜单切换">' +
        '<button data-act="board" data-board="attr" aria-pressed="' + (board === 'attr') + '">学点榜</button>' +
        '<button data-act="board" data-board="food" aria-pressed="' + (board === 'food') + '">美食榜</button>' +
      '</div>' +
      '<ol class="rank" id="rank-' + board + '">' + html + '</ol>' +
    '</section>';
  }

  function authPanel() {
    var mode = ui.authMode;
    var isReg = mode === 'register';
    return '<section class="card panel auth">' +
      '<h2>欢迎来到羊城漫游</h2>' +
      '<p class="muted">游客可以浏览全部内容；注册或登录后，可以点赞、收藏，并保存浏览历史。</p>' +
      '<div class="seg" role="group" aria-label="登录或注册">' +
        '<button data-act="switch-auth" data-mode="login" aria-pressed="' + (!isReg) + '">登录</button>' +
        '<button data-act="switch-auth" data-mode="register" aria-pressed="' + isReg + '">注册</button>' +
      '</div>' +
      '<form id="auth-form" data-mode="' + mode + '" autocomplete="off" novalidate>' +
        '<div class="field"><label class="lbl" for="auth-user">用户名</label>' +
          '<input id="auth-user" name="username" maxlength="12" placeholder="2–12 位字母、数字、汉字或下划线"></div>' +
        '<div class="field"><label class="lbl" for="auth-pass">密码</label>' +
          '<input id="auth-pass" name="password" type="password" maxlength="20" placeholder="4–20 位"></div>' +
        (isReg
          ? '<div class="field"><label class="lbl" for="auth-nick">昵称（可选）</label>' +
            '<input id="auth-nick" name="nick" maxlength="10" placeholder="默认与用户名相同"></div>'
          : '') +
        '<p class="err" id="auth-err" role="alert"></p>' +
        '<button class="btn primary wide" type="submit" id="auth-submit">' + (isReg ? '注册并进入' : '登录') + '</button>' +
      '</form>' +
    '</section>';
  }

  function profilePanel(u) {
    var avatars = D.avatars.map(function (a, i) {
      return '<button data-act="avatar" data-idx="' + i + '" aria-pressed="' + (u.avatar === i) + '" aria-label="选择头像' + (i + 1) + '">' + avatar(i, 46) + '</button>';
    }).join('');
    var themes = D.themes.map(function (t, i) {
      return '<button class="chip-color" style="--c:' + t.color + '" data-act="theme" data-idx="' + i + '" aria-pressed="' + (u.theme === i) + '" aria-label="' + t.name + '"></button>' +
        '<span class="chip-name">' + t.name + '</span>';
    }).join('');
    return '<section class="card panel profile">' +
      '<div class="pf-head">' + avatar(u.avatar, 64) +
        '<div><h2>' + esc(u.nick) + '</h2><p class="muted">用户名 ' + esc(state.session) + ' · 已赞 ' + u.likes.length + ' · 收藏 ' + u.favs.length + '</p></div></div>' +
      '<form id="nick-form" class="inline" autocomplete="off">' +
        '<label class="lbl" for="nick-input">昵称</label>' +
        '<div class="row2"><input id="nick-input" maxlength="10" value="' + esc(u.nick) + '">' +
        '<button class="btn" type="submit">保存</button></div></form>' +
      '<div class="field"><span class="lbl">头像</span><div class="avatars">' + avatars + '</div></div>' +
      '<div class="field"><span class="lbl">主题色</span><div class="chips">' + themes + '</div></div>' +
      '<button class="btn ghost" data-act="logout">退出登录</button>' +
    '</section>';
  }

  function listPanel(title, ids, empty) {
    var body = ids.length
      ? '<ul class="mini-list">' + ids.map(function (id) {
          var it = ITEMS[id];
          return '<li><span class="mini-thumb">' + art(it) + '</span><span>' + esc(it.title) + '</span></li>';
        }).join('') + '</ul>'
      : '<p class="muted">' + empty + '</p>';
    return '<section class="card panel"><h3>' + title + '</h3>' + body + '</section>';
  }

  function historyPanel(u) {
    var body = u.history.length
      ? '<ul class="mini-list">' + u.history.slice(0, 10).map(function (h) {
          return '<li><span class="mini-thumb">' + art(ITEMS[h.id]) + '</span><span>' + esc(ITEMS[h.id].title) +
            '</span><small class="muted">' + fmtTime(h.t) + '</small></li>';
        }).join('') + '</ul>'
      : '<p class="muted">还没有浏览记录，去学点或美食里逛逛吧。</p>';
    return '<section class="card panel"><h3>浏览历史</h3>' + body + '</section>';
  }

  function backupPanel() {
    return '<section class="card panel backup"><h3>数据备份</h3>' +
      '<p class="muted">账号、收藏、点赞与浏览历史都保存在本浏览器中。导出为 JSON 文件可留作存档或在其他浏览器导入；导入时同名账号会被备份中的数据覆盖。</p>' +
      '<div class="row2">' +
        '<button class="btn primary" id="btn-export" data-act="export">导出备份 JSON</button>' +
        '<button class="btn" id="btn-import" data-act="import">导入备份</button>' +
        '<input type="file" id="import-file" accept="application/json,.json" hidden>' +
      '</div></section>';
  }

  function pageMe() {
    var u = me();
    if (!u) return '<section class="page">' + authPanel() + backupPanel() + '</section>';
    var favIds = u.favs.slice();
    return '<section class="page">' + profilePanel(u) +
      listPanel('我的收藏', favIds, '还没有收藏，在学点或美食里点一下“收藏”即可。') +
      historyPanel(u) + backupPanel() + '</section>';
  }

  var PAGE_FN = {
    attractions: function () { return pageCards('attr'); },
    foods: function () { return pageCards('food'); },
    top: pageTop,
    me: pageMe
  };

  /* ---------- 渲染与路由 ---------- */

  function currentRoute() {
    var h = (window.location.hash || '').replace(/^#\/?/, '');
    return PAGES.indexOf(h) >= 0 ? h : 'attractions';
  }

  function applyTheme(u) {
    var t = D.themes[u ? u.theme : 0] || D.themes[0];
    document.documentElement.style.setProperty('--accent', t.color);
  }

  function renderHeader(u) {
    var who = document.getElementById('who');
    who.innerHTML = u
      ? avatar(u.avatar, 28) + '<span class="who-name">' + esc(u.nick) + '</span>'
      : '<a href="#/me">游客 · 去登录</a>';
    var route = currentRoute();
    var btns = document.querySelectorAll('#tabbar button');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-tab') === route;
      btns[i].setAttribute('aria-current', on ? 'page' : 'false');
    }
  }

  function render() {
    var route = currentRoute();
    var u = me();
    var prev = view.getAttribute('data-route');
    var top = prev === route ? view.scrollTop : 0;
    applyTheme(u);
    view.innerHTML = PAGE_FN[route]();
    view.setAttribute('data-route', route);
    view.scrollTop = top;
    renderHeader(u);
  }

  function go(hash) {
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
  }

  function buildTabbar() {
    var bar = document.getElementById('tabbar');
    bar.innerHTML = TABS.map(function (t) {
      return '<button data-tab="' + t.id + '"><svg viewBox="0 0 24 24" aria-hidden="true">' + t.d + '</svg><span>' + t.label + '</span></button>';
    }).join('');
    document.getElementById('brand-mark').innerHTML = flower(30);
  }

  /* ---------- 业务操作 ---------- */

  function setErr(msg) {
    var el = document.getElementById('auth-err');
    if (el) el.textContent = msg;
  }

  function doAuth(form) {
    var mode = form.getAttribute('data-mode');
    var name = ($('#auth-user').value || '').trim();
    var pw = $('#auth-pass').value || '';
    if (!/^[A-Za-z0-9_一-龥]{2,12}$/.test(name)) return setErr('用户名需为 2–12 位字母、数字、汉字或下划线');
    if (pw.length < 4 || pw.length > 20) return setErr('密码长度需为 4–20 位');
    if (mode === 'register') {
      if (state.users[name]) return setErr('该用户名已被注册，请直接登录');
      var salt = randomSalt();
      var nickEl = $('#auth-nick');
      var nick = nickEl && nickEl.value.trim() ? nickEl.value.trim().slice(0, 10) : name;
      state.users[name] = {
        nick: nick, salt: salt, hash: hashPw(salt, pw), avatar: 0, theme: 0,
        likes: [], favs: [], history: []
      };
      state.session = name;
      save();
      toast('注册成功，欢迎你，' + nick);
    } else {
      var u = state.users[name];
      if (!u || u.hash !== hashPw(u.salt, pw)) return setErr('用户名或密码不正确');
      state.session = name;
      save();
      toast('登录成功，欢迎回来');
    }
    render();
  }

  function toggleItem(act, id) {
    var u = me();
    if (!u) {
      toast('请先注册或登录，再点赞或收藏');
      return go('#/me');
    }
    var list = act === 'like' ? u.likes : u.favs;
    var i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
    save();
    if (act === 'like') toast(i >= 0 ? '已取消点赞' : '点赞成功，去 Top10 看看排名变化');
    else toast(i >= 0 ? '已取消收藏' : '已加入我的收藏');
    render();
  }

  function viewItem(id) {
    var u = me();
    if (u) {
      u.history = u.history.filter(function (h) { return h.id !== id; });
      u.history.unshift({ id: id, t: Date.now() });
      u.history = u.history.slice(0, 20);
      save();
    } else {
      toast('注册或登录后，可保存浏览历史');
    }
    render();
  }

  function updateMe(fn, msg) {
    var u = me();
    if (!u) return toast('请先登录');
    fn(u);
    save();
    render();
    if (msg) toast(msg);
  }

  function saveNick(form) {
    var u = me();
    if (!u) return;
    var v = ($('#nick-input').value || '').trim();
    if (!v) return toast('昵称不能为空');
    u.nick = v.slice(0, 10);
    save();
    render();
    toast('昵称已保存');
  }

  function exportBackup() {
    var payload = {
      app: APP_ID,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      users: state.users
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'gz-roam-backup-' + stamp() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    toast('备份已导出');
  }

  function importBackup(text) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { return toast('备份文件不是有效的 JSON'); }
    if (!obj || obj.app !== APP_ID || !obj.users || typeof obj.users !== 'object') {
      return toast('这不是羊城漫游的备份文件');
    }
    var incoming = normalizeUsers(obj.users);
    var names = Object.keys(incoming);
    if (!names.length) return toast('备份中没有账号数据');
    names.forEach(function (n) { state.users[n] = incoming[n]; });
    save();
    render();
    toast('已导入 ' + names.length + ' 个账号的数据');
  }

  /* ---------- 事件 ---------- */

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-tab],[data-act]') : null;
    if (!t) return;
    if (t.hasAttribute('data-tab')) return go('#/' + t.getAttribute('data-tab'));
    var act = t.getAttribute('data-act');
    var id = t.getAttribute('data-id');
    switch (act) {
      case 'like':
      case 'fav':
        return toggleItem(act, id);
      case 'view':
        return viewItem(id);
      case 'board':
        ui.board = t.getAttribute('data-board') === 'food' ? 'food' : 'attr';
        return render();
      case 'switch-auth':
        ui.authMode = t.getAttribute('data-mode') === 'register' ? 'register' : 'login';
        return render();
      case 'avatar':
        return updateMe(function (u) { u.avatar = clampInt(t.getAttribute('data-idx'), 0, D.avatars.length - 1); }, '头像已更新');
      case 'theme':
        return updateMe(function (u) { u.theme = clampInt(t.getAttribute('data-idx'), 0, D.themes.length - 1); }, '主题色已更新');
      case 'logout':
        state.session = null;
        save();
        render();
        return toast('已退出登录');
      case 'export':
        return exportBackup();
      case 'import':
        return document.getElementById('import-file').click();
    }
  });

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'auth-form') return doAuth(e.target);
    if (e.target.id === 'nick-form') return saveNick(e.target);
  });

  document.addEventListener('change', function (e) {
    if (e.target.id !== 'import-file') return;
    var f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () { importBackup(String(reader.result)); };
    reader.onerror = function () { toast('读取备份文件失败'); };
    reader.readAsText(f);
  });

  window.addEventListener('hashchange', render);

  /* ---------- 演示页桥接（仅 ?demo=1 时启用） ---------- */

  if (DEMO) {
    window.addEventListener('message', function (e) {
      var m = e.data;
      if (!m || m.__gz !== 'demo' || !e.source) return;
      var out = { __gz: 'demo-reply', id: m.id, ok: true };
      try {
        if (m.cmd === 'reset') {
          state = { users: Object.create(null), session: null };
          save();
          window.location.hash = '#/attractions';
          render();
        } else if (m.cmd === 'scrollto') {
          var a = $(m.sel);
          if (a) a.scrollIntoView({ block: 'center', behavior: 'smooth' }); else out.ok = false;
        } else if (m.cmd === 'rect') {
          var b = $(m.sel);
          if (!b) out.ok = false;
          else {
            var r = b.getBoundingClientRect();
            out.rect = { x: r.left, y: r.top, w: r.width, h: r.height };
          }
        } else if (m.cmd === 'click') {
          var c = $(m.sel);
          if (c) c.click(); else out.ok = false;
        } else if (m.cmd === 'type') {
          var d = $(m.sel);
          if (d) d.value = m.text; else out.ok = false;
        } else {
          out.ok = false;
        }
      } catch (err) {
        out.ok = false;
        out.error = String(err);
      }
      e.source.postMessage(out, '*');
    });
  }

  /* ---------- 启动 ---------- */

  buildTabbar();
  render();
  if (DEMO && window.parent !== window) {
    window.parent.postMessage({ __gz: 'demo-ready' }, '*');
  }
})();
