// ==UserScript==
// @name         [全自动] 超星学习通 - 讨论自动回复
// @namespace    abc-helper-auto-discuss
// @version      2.0
// @description  自动遍历超星讨论话题，抓取他人回复改写后提交。进入讨论列表页点Start，全程模拟点击不调API。
// @author       patch
// @match        *://*.chaoxing.com/*
// @match        *://*.edu.cn/*
// @match        *://groupweb.chaoxing.com/*
// @run-at       document-end
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
  'use strict';

  // ======================== CONFIG ========================
  var MIN_DELAY = 8, MAX_DELAY = 22;      // 每两个话题间隔(秒)
  var BATCH_SIZE = 5;                      // 每批处理数
  var BATCH_REST = 150;                    // 批次间休息(秒)
  var MIN_REPLY_LEN = 15;                 // 最短回复字数
  var MAX_TOPICS = 30;                    // 单次最多处理

  function $(s, p) { return (p || document).querySelector(s); }
  function $$(s, p) { return Array.from((p || document).querySelectorAll(s)); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function rand(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }
  function jitter(min, max) { var base = rand(min, max); return base + rand(-Math.floor(base * 0.3), Math.floor(base * 0.3)); }

  // Fisher-Yates shuffle
  function shuffle(arr) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rand(0, i), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  // ======================== CONTENT TRANSFORM ========================
  var SYNONYMS = [
    ['我们','咱们','大家'], ['需要','应当','必须','要'], ['重要','关键','核心'],
    ['意义','价值','作用'], ['人生','生命','生活'], ['实现','达成','完成'],
    ['社会','集体','群体'], ['发展','进步','成长'], ['学习','研习','掌握'],
    ['能力','才能','本领'], ['努力','奋进','拼搏'], ['坚持','坚守','保持'],
    ['正确','准确','无误'], ['方法','途径','方式'], ['问题','议题','难题'],
    ['解决','化解','应对'], ['因此','所以','因而'], ['并且','而且','同时'],
    ['但是','然而','不过'], ['认为','觉得','相信'], ['体现','展现','呈现'],
    ['促进','推动','带动'], ['增强','加强','提升'],
  ];

  function transform(text) {
    if (!text) return text;
    var s = text.replace(/\s+/g, ' ').replace(/[，。！？；：、]+$/, '').trim();
    var parts = s.split(/[。！；]/).filter(function (p) { return p.trim(); });
    if (!parts.length) return s + '。';

    // Replace 1-2 synonym groups
    var groups = shuffle(SYNONYMS).slice(0, rand(1, 2));
    groups.forEach(function (g) {
      var pick = g[rand(0, g.length - 1)];
      g.forEach(function (w) {
        if (w !== pick && parts.some(function (p) { return p.indexOf(w) !== -1; }) && Math.random() < 0.5) {
          for (var i = 0; i < parts.length; i++) parts[i] = parts[i].replace(new RegExp(w, 'g'), pick);
        }
      });
    });

    // Shuffle sentences or drop one
    if (parts.length === 1) {
      var starts = ['我认为，','在我看来，','个人觉得，','我觉得，','可以说，'];
      return starts[rand(0, starts.length - 1)] + parts[0] + '。';
    } else if (parts.length === 2 && Math.random() < 0.5) {
      return parts[1] + '。' + parts[0] + '。';
    } else if (parts.length >= 4 && Math.random() < 0.4) {
      parts.splice(rand(1, parts.length - 2), 1);
    }
    if (parts.length >= 3 && Math.random() < 0.5) {
      var a = rand(1, parts.length - 2), b = rand(1, parts.length - 2);
      if (a !== b) { var t = parts[a]; parts[a] = parts[b]; parts[b] = t; }
    }
    return parts.join('。') + '。';
  }

  // ======================== PAGE DETECTION ========================
  var URL = location.href;
  var IS_TOPIC_LIST = /topic\/topicList|topicList/i.test(URL);

  // ======================== TOPIC LIST PAGE LOGIC ========================
  if (IS_TOPIC_LIST) {
    var isRunning = false;
    var stopFlag = false;

    function addLog(el, msg, cls) {
      var d = document.createElement('div');
      d.className = 'log' + (cls ? ' ' + cls : '');
      d.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
      el.appendChild(d);
      el.scrollTop = el.scrollHeight;
    }

    function createUI() {
      if (document.getElementById('abc-discuss-panel')) return;
      var panel = document.createElement('div');
      panel.id = 'abc-discuss-panel';
      panel.innerHTML = [
        '<style>',
        '#abc-discuss-panel{position:fixed;top:80px;right:12px;z-index:99998;width:360px;background:#fff;border-radius:8px;box-shadow:0 2px 16px rgba(0,0,0,.12);font:13px/1.6 system-ui,sans-serif;color:#333}',
        '#abc-discuss-panel .hd{padding:10px 14px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center;cursor:move;user-select:none;-webkit-user-select:none}',
        '#abc-discuss-panel .hd h4{margin:0;font-size:13px;font-weight:600;pointer-events:none}',
        '#abc-discuss-panel .hd .close{color:#bbb;cursor:pointer;font-size:16px;line-height:1;pointer-events:auto}',
        '#abc-discuss-panel .hd .close:hover{color:#666}',
        '#abc-discuss-panel .bd{padding:8px 14px;max-height:240px;overflow-y:auto;font-size:12px}',
        '#abc-discuss-panel .bd .ok{color:#52c41a}',
        '#abc-discuss-panel .bd .warn{color:#faad14}',
        '#abc-discuss-panel .bd .err{color:#ff4d4f}',
        '#abc-discuss-panel .bd .info{color:#1677ff}',
        '#abc-discuss-panel .ft{padding:8px 14px;border-top:1px solid #f0f0f0}',
        '#abc-discuss-panel .bar{font-size:11px;color:#999;margin-bottom:6px}',
        '#abc-discuss-panel .btn{display:inline-block;padding:6px 16px;border:0;border-radius:5px;cursor:pointer;font-size:13px}',
        '#abc-discuss-panel .btn-go{background:#1677ff;color:#fff;margin-right:6px}',
        '#abc-discuss-panel .btn-go:hover{background:#4096ff}',
        '#abc-discuss-panel .btn-go:disabled{background:#bbb;cursor:not-allowed}',
        '#abc-discuss-panel .btn-stop{background:#fff;color:#ff4d4f;border:1px solid #ffccc7}',
        '</style>',
        '<div class="hd" id="abc-drag-handle"><h4>Auto Discuss v2</h4><span class="close" id="abc-close">x</span></div>',
        '<div class="bd" id="abc-log"><div class="log">Ready. Click Start on the topic list page.</div></div>',
        '<div class="ft">',
        '<div class="bar" id="abc-bar"></div>',
        '<button class="btn btn-go" id="abc-start">Start</button>',
        '<button class="btn btn-stop" id="abc-stop" style="display:none">Stop</button>',
        '</div>',
      ].join('');
      document.body.appendChild(panel);

      // Drag
      var hd = document.getElementById('abc-drag-handle');
      var dragging = false, sx, sy, sl, st;
      hd.addEventListener('mousedown', function (e) {
        if (e.target.id === 'abc-close') return;
        dragging = true; var r = panel.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; sl = r.left; st = r.top;
        panel.style.right = 'auto'; panel.style.left = sl + 'px'; panel.style.top = st + 'px';
        e.preventDefault();
      });
      document.addEventListener('mousemove', function (e) {
        if (!dragging) return;
        panel.style.left = (sl + e.clientX - sx) + 'px';
        panel.style.top = (st + e.clientY - sy) + 'px';
      });
      document.addEventListener('mouseup', function () { dragging = false; });

      var logEl = document.getElementById('abc-log');
      var barEl = document.getElementById('abc-bar');
      var startBtn = document.getElementById('abc-start');
      var stopBtn = document.getElementById('abc-stop');

      document.getElementById('abc-close').onclick = function () { panel.remove(); };

      // Listen for results from popups
      window.addEventListener('message', function (e) {
        if (e.data && e.data.type === 'ABC_DISCUSS_RESULT') {
          if (e.data.ok) { addLog(logEl, 'OK: ' + (e.data.id || '').substring(0, 50), 'ok'); }
          else { addLog(logEl, 'FAIL: ' + e.data.msg, 'warn'); }
        }
      });

      startBtn.onclick = function () {
        if (isRunning) return;
        isRunning = true; stopFlag = false;
        startBtn.disabled = true; startBtn.textContent = 'Running...';
        stopBtn.style.display = 'inline-block';
        logEl.innerHTML = '';
        addLog(logEl, 'Scanning topic list...', 'info');
        startAutoDiscuss(addLog.bind(null, logEl), function (t) { barEl.textContent = t; }, function () { return stopFlag; })
          .then(function (r) { addLog(logEl, r, 'ok'); })
          .catch(function (e) { addLog(logEl, e.message, 'err'); })
          .finally(function () {
            isRunning = false; startBtn.disabled = false; startBtn.textContent = 'Start';
            stopBtn.style.display = 'none';
          });
      };

      stopBtn.onclick = function () { stopFlag = true; addLog(logEl, 'Stopping after current topic...', 'warn'); };
    }

    function getTopicLinks() {
      var links = [];

      // Try to access the topic list iframe
      var frame = document.getElementById('frame_content-tl');
      var doc = frame && frame.contentDocument;
      if (!doc) {
        // Fallback: look for topicId_ elements in main document
        doc = document;
      }

      // Topics are rendered as elements with id="topicId_XXXXX" and data-uuid="xxx"
      var items = doc.querySelectorAll('[id^="topicId_"]');
      items.forEach(function (el) {
        var m = el.id.match(/^topicId_(\d+)/);
        if (!m) return;
        var id = parseInt(m[1]);
        var uuid = el.getAttribute('data-uuid') || '';
        // Find title from the topic link inside
        var link = el.querySelector('.topicli_link, a');
        var title = (link ? link.textContent : el.textContent) || '';
        title = title.trim().replace(/\s+/g, ' ').substring(0, 80);
        if (id > 1000 && !links.some(function (l) { return l.id === id; })) {
          links.push({ id: id, title: title || ('Topic ' + id), uuid: uuid });
        }
      });

      // Fallback: search page scripts for topic data
      if (!links.length) {
        $$('script', doc).forEach(function (s) {
          var t = s.textContent || '';
          var re = /"title":"([^"]+)","type":\d+,"uuid":"([^"]+)".*?"id":(\d+)/g;
          var m;
          while ((m = re.exec(t)) !== null) {
            var tid = parseInt(m[3]);
            if (tid > 1000 && !links.some(function (l) { return l.id === tid; })) {
              links.push({ id: tid, title: m[1], uuid: m[2] });
            }
          }
        });
      }

      return links;
    }

    // ======================== IFRAME-BASED REPLY ========================
    function iframeWaitFor(selector, timeout, idoc) {
      return new Promise(function (resolve) {
        var start = Date.now(), doc = idoc || document;
        var chk = setInterval(function () {
          var el = doc.querySelector(selector);
          if (el) { clearInterval(chk); resolve(el); return; }
          if (Date.now() - start > (timeout || 15000)) { clearInterval(chk); resolve(null); }
        }, 300);
      });
    }

    function iframeGetReplies(idoc) {
      var contents = [];
      if (!idoc) return contents;
      var items = idoc.querySelectorAll('.topicDetail_replyItem, .replyContent, [content]');
      items.forEach(function (el) {
        var c = (el.getAttribute('content') || el.textContent || '').trim();
        c = c.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ').trim();
        if (c.length >= MIN_REPLY_LEN) contents.push(c);
      });
      return contents;
    }

    function processInIframe(url) {
      return new Promise(function (resolve) {
        // Remove old iframe
        var old = document.getElementById('abc-work-iframe');
        if (old) old.remove();

        var iframe = document.createElement('iframe');
        iframe.id = 'abc-work-iframe';
        iframe.style.cssText = 'position:fixed;top:0;left:-9999px;width:800px;height:800px;z-index:99999';
        iframe.src = url;
        document.body.appendChild(iframe);

        var timeout = setTimeout(function () {
          iframe.remove();
          resolve({ ok: false, msg: 'Timeout' });
        }, 35000);

        iframe.onload = async function () {
          var idoc = iframe.contentDocument;
          if (!idoc) { clearTimeout(timeout); iframe.remove(); resolve({ ok: false, msg: 'No document' }); return; }

          // Wait for reply list or topic detail
          var detail = await iframeWaitFor('.topicDetail_replyList, #bbsTopicDetail, .topicDetail_replyItem', 12000, idoc);
          if (!detail) { clearTimeout(timeout); iframe.remove(); resolve({ ok: false, msg: 'Page load timeout' }); return; }

          // Extra wait for AJAX replies
          await sleep(rand(2000, 4000));

          var replies = iframeGetReplies(idoc);
          if (!replies.length) { clearTimeout(timeout); iframe.remove(); resolve({ ok: false, msg: 'No replies found' }); return; }

          // Pick + transform
          var src = replies[rand(0, replies.length - 1)];
          var transformed = transform(src);
          if (transformed === src) transformed = '我认为，' + transformed;

          // Find form
          var ta = idoc.querySelector('textarea[placeholder*="回复"]') || idoc.querySelector('textarea') || idoc.querySelector('.replyEdit textarea');
          var btn = idoc.querySelector('.addReply') || idoc.querySelector('.replyBtn');
          if (!ta || !btn) { clearTimeout(timeout); iframe.remove(); resolve({ ok: false, msg: 'Form not found' }); return; }

          // Fill
          ta.value = transformed;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          await sleep(rand(500, 1500));

          // Click reply
          btn.click();
          await sleep(rand(3000, 5000));

          // Verify
          var newReplies = iframeGetReplies(idoc);
          var ok = newReplies.length > replies.length ||
                   newReplies.some(function (r) { return r.indexOf(transformed.substring(0, 10)) !== -1; });

          clearTimeout(timeout);
          iframe.remove();
          resolve({ ok: ok, msg: ok ? 'OK' : 'Unconfirmed' });
        };

        iframe.onerror = function () {
          clearTimeout(timeout); iframe.remove();
          resolve({ ok: false, msg: 'Load error' });
        };
      });
    }

    async function startAutoDiscuss(addLog, setBar, isStopped) {
      // Extract course info from page/iframe
      var bbsid = '', courseId = '', clazzId = '';
      var doc = (document.getElementById('frame_content-tl') || {}).contentDocument || document;
      var scripts = doc.querySelectorAll('script');
      for (var si = 0; si < scripts.length; si++) {
        var t = scripts[si].textContent || '';
        var m;
        m = t.match(/"courseid"\s*:\s*"?(\d+)"?/i) || t.match(/courseid[=:](\d+)/i);
        if (m) courseId = m[1];
        m = t.match(/"clazzid"\s*:\s*"?(\d+)"?/i) || t.match(/clazzid[=:](\d+)/i);
        if (m) clazzId = m[1];
        m = t.match(/"bbsid"\s*:\s*"?([^"]+)"?/i) || t.match(/bbsid[=:]([^&\s"]+)/i);
        if (m) bbsid = m[1];
        if (bbsid && courseId) break;
      }
      addLog('bbsid=' + bbsid + ' courseId=' + courseId + ' clazzId=' + clazzId, 'info');

      var topics = getTopicLinks();
      addLog('Found ' + topics.length + ' topic links.');

      if (!topics.length) {
        addLog('No topics found. Open the discussion topic list page first.', 'err');
        return 'Failed: no topics.';
      }

      topics = shuffle(topics);
      if (topics.length > MAX_TOPICS) topics = topics.slice(0, MAX_TOPICS);

      var ok = 0, skip = 0, fail = 0, batchCount = 0;

      for (var i = 0; i < topics.length; i++) {
        if (isStopped()) { addLog('Stopped.', 'warn'); break; }

        var topic = topics[i];
        setBar((i + 1) + '/' + topics.length + ' | ok:' + ok + ' skip:' + skip + ' fail:' + fail);
        addLog('[' + (i + 1) + '] ' + topic.title);

        var detailUrl = 'https://groupweb.chaoxing.com/pc/topic/jumpToTopicDetail' +
          '?bbsid=' + bbsid + '&uuid=' + (topic.uuid || '');
        if (!topic.uuid) {
          detailUrl = 'https://groupweb.chaoxing.com/course/topic/detail' +
            '?topicId=' + topic.id + '&courseid=' + courseId + '&clazzid=' + clazzId + '&bbsid=' + bbsid;
        }

        var result = await processInIframe(detailUrl);
        if (result.ok) { addLog('  OK', 'ok'); ok++; }
        else { addLog('  ' + result.msg, 'warn'); fail++; }

        batchCount++;
        if (batchCount >= BATCH_SIZE && i < topics.length - 1) {
          addLog('Batch done, resting ' + Math.floor(BATCH_REST / 60) + ' min...', 'info');
          setBar('Resting...');
          await sleep(BATCH_REST * 1000);
          batchCount = 0;
          if (isStopped()) break;
        } else if (i < topics.length - 1) {
          var delay = jitter(MIN_DELAY * 1000, MAX_DELAY * 1000);
          addLog('  Waiting ' + Math.floor(delay / 1000) + 's...');
          await sleep(delay);
        }

        // Count results from postMessage
        // (Results are handled by the message listener above)
      }

      // Give the user a summary
      addLog('All topics processed. Check logs above for per-topic results.', 'info');
      return 'Done processing ' + i + ' topics.';
    }

    function init() {
      if (document.readyState === 'complete') createUI();
      else window.addEventListener('load', createUI);
    }

    init();
  }
})();
