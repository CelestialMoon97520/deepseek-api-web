// MIT history search: https://github.com/darrindeyoung791/ds-api-demo-hotkeys/d87a5deb4f49aadb7131f59fe251c1c8ef277126
window.addEventListener('deepseek-local-ready', ({ detail }) => {
    const { getVisibleMessages, db, useChatStore } = detail;
    // Same plain-text projection used by both upstream chat clients.
    const getReplyText = (reply) => reply.blocks.map((block) => block.type === 'text' ? block.text : '').join('');

/**
 * 历史对话搜索索引。文本在建立索引时折叠空白，摘要窗口与命中判断都基于同一份字符串；
 * 索引只在打开搜索浮层时构建一次，输入时只在内存中匹配。
 *
 * 与官方一致：只匹配消息正文（不单独匹配标题），关键词为空时没有结果。
 */

                            
                   
                   
               
                            
              
                                         
                
                   
 

                     
                                 
 

                         
                     
             
                   
               
                            
                   
                 
 

/** 摘要窗口：命中位置前后保留的字符数 */
const SNIPPET_BEFORE = 24
const SNIPPET_AFTER = 96

/** 折叠换行与连续空白：结果行是单行文本，命中位置也要与展示文本一致 */
const normalize = (text        ) => text.replace(/\s+/g, ' ').trim()

const messageText = (message         ) =>
  normalize(message.role === 'user' ? message.content : getReplyText(message))

/**
 * 读取全部会话的正文构建索引：已打开的会话用内存中的最新版本，其余逐条从 IndexedDB 读取。
 * 单个会话读取失败时跳过，不影响其他会话的结果。
 */
const collectHistoryIndex = async ()                        => {
  const { sessions, sessionCache } = useChatStore.getState()
  const messages                        = []

  for (const summary of sessions) {
    let session                      = Object.hasOwn(sessionCache, summary.id)
      ? sessionCache[summary.id]
      : undefined
    if (!session) {
      try {
        session = await db.loadSession(summary.id)
      } catch {
        continue
      }
    }
    if (!session) {
      continue
    }

    for (const message of getVisibleMessages(session)) {
      const text = messageText(message)
      if (!text) {
        continue
      }
      messages.push({
        messageId: message.id,
        sessionId: summary.id,
        title: summary.title,
        role: message.role,
        text,
        search: text.toLowerCase(),
        createdAt: message.createdAt,
      })
    }
  }

  return { messages }
}

/** 命中位置前后各取一段，被截断时补省略号 */
const buildSnippet = (text        , at        , length        ) => {
  const start = Math.max(0, at - SNIPPET_BEFORE)
  const end = Math.min(text.length, at + length + SNIPPET_AFTER)
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
}

/** 正文逐条匹配，结果按时间倒序；关键词为空时返回空列表（与官方一致，不展示最近对话） */
const searchHistory = (index              , rawQuery        )                     => {
  const query = normalize(rawQuery)
  if (!query) {
    return []
  }

  const needle = query.toLowerCase()
  const hits                     = []
  for (const entry of index.messages) {
    const at = entry.search.indexOf(needle)
    if (at < 0) {
      continue
    }
    hits.push({
      key: `message:${entry.messageId}`,
      sessionId: entry.sessionId,
      title: entry.title,
      role: entry.role,
      createdAt: entry.createdAt,
      snippet: buildSnippet(entry.text, at, query.length),
    })
  }

  // 全部命中都返回（不再截断），按时间倒序；结果由界面整体替换
  return hits.sort((a, b) => b.createdAt - a.createdAt)
}

function mountHistorySearch({ collectHistoryIndex, searchHistory, selectSession, closeDrawer, useChatStore }) {
  const searchLabel = () => document.documentElement.lang.startsWith('zh') ? '搜索历史对话' : 'Search chat history';
  const dialog = document.createElement('dialog');
  dialog.className = 'local-history';
  dialog.setAttribute('aria-label', searchLabel());

  const header = document.createElement('div');
  header.className = 'local-history-header';
  const input = document.createElement('input');
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', searchLabel());
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '×';
  close.addEventListener('click', () => dialog.close());
  header.append(input, close);

  const status = document.createElement('div');
  status.className = 'local-history-status';
  status.setAttribute('role', 'status');
  const results = document.createElement('div');
  results.className = 'local-history-results';
  dialog.append(header, status, results);
  document.body.append(dialog);

  const chinese = () => document.documentElement.lang.startsWith('zh');
  const translate = (zh, en) => chinese() ? zh : en;
  let index;
  let generation = 0;
  let debounce;
  let cancelJump = () => {};

  function jumpToHit(hit) {
    cancelJump();
    const selected = `[data-local-message-id="${CSS.escape(hit.key.slice('message:'.length))}"]`;
    const observer = new MutationObserver(reveal);
    const timeout = setTimeout(() => cancelJump(), 4000);
    cancelJump = () => {
      observer.disconnect();
      clearTimeout(timeout);
      cancelJump = () => {};
    };
    function reveal() {
      const element = document.querySelector(selected);
      if (useChatStore.getState().activeId !== hit.sessionId || !element) return;
      cancelJump();
      // Wait for the conversation's initial scroll-to-bottom and the drawer state update.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!element.isConnected || useChatStore.getState().activeId !== hit.sessionId) return;
        element.scrollIntoView({ block: 'center' });
        element.classList.add('local-history-highlight');
        setTimeout(() => element.classList.remove('local-history-highlight'), 1500);
      }));
    }
    observer.observe(document.getElementById('root'), { childList: true, subtree: true });
    dialog.close();
    selectSession(hit.sessionId);
    closeDrawer();
    reveal();
  }

  function render() {
    clearTimeout(debounce);
    results.replaceChildren();
    if (!index) return;
    const query = input.value.trim();
    if (!query) {
      status.textContent = translate('输入关键词，搜索提问和回复', 'Enter a keyword to search questions and replies');
      return;
    }
    const hits = searchHistory(index, query);
    status.textContent = hits.length ? '' : translate('没有匹配的消息', 'No matching messages');
    const needle = query.replace(/\s+/g, ' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(${needle})`, 'gi');
    const fragment = document.createDocumentFragment();
    for (const hit of hits) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'local-history-result';
      const title = document.createElement('strong');
      title.textContent = hit.title || translate('未命名对话', 'Untitled chat');
      const snippet = document.createElement('span');
      hit.snippet.split(match).forEach((part, position) => {
        if (position % 2 === 0) {
          snippet.append(part);
        } else {
          const mark = document.createElement('mark');
          mark.textContent = part;
          snippet.append(mark);
        }
      });
      button.append(title, snippet);
      button.addEventListener('click', () => jumpToHit(hit));
      fragment.append(button);
    }
    results.append(fragment);
    results.scrollTop = 0;
  }

  function queueRender() {
    clearTimeout(debounce);
    debounce = setTimeout(render, 150);
  }
  input.addEventListener('input', (event) => {
    if (!event.isComposing) queueRender();
  });
  input.addEventListener('compositionstart', () => clearTimeout(debounce));
  input.addEventListener('compositionend', queueRender);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    render();
    results.querySelector('button')?.click();
  });
  dialog.addEventListener('close', () => {
    generation += 1;
    clearTimeout(debounce);
    index = undefined;
    results.replaceChildren();
  });

  async function open() {
    if (dialog.open || useChatStore.getState().importingHistory) return;
    const request = ++generation;
    index = undefined;
    input.value = '';
    input.placeholder = translate('搜索提问和回复', 'Search questions and replies');
    close.setAttribute('aria-label', translate('关闭搜索', 'Close search'));
    status.textContent = translate('正在读取历史对话…', 'Loading chat history…');
    dialog.showModal();
    input.focus();
    try {
      const data = await collectHistoryIndex();
      if (request !== generation || !dialog.open) return;
      index = data;
      render();
    } catch {
      if (request === generation && dialog.open) {
        status.textContent = translate('读取历史失败，请重试', 'Unable to read history. Try again.');
      }
    }
  }

  function addEntry() {
    for (const list of document.querySelectorAll('.app-frame [class^="sider-"] > [class^="listWrap-"]')) {
      const previous = list.previousElementSibling;
      if (previous?.classList.contains('local-history-entry')) continue;
      const entry = document.createElement('button');
      entry.type = 'button';
      entry.className = 'local-history-entry';
      entry.textContent = searchLabel();
      entry.addEventListener('click', open);
      list.before(entry);
    }
  }
  new MutationObserver(addEntry).observe(document.getElementById('root'), { childList: true, subtree: true });
  addEntry();
}

function mountDrawerDrag({ drawer, openDrawer, closeDrawer, overlayOpen }) {
  const mobile = window.matchMedia('(max-width: 767px)');
  const interactive = 'input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"])';
  let gesture;
  let settling = false;
  let frameRequest = 0;

  const selectionActive = () => {
    const selection = window.getSelection();
    return selection && !selection.isCollapsed;
  };
  const blocked = () => overlayOpen() || document.querySelector('dialog[open], [role="dialog"]');
  const limit = (distance, width) => Math.max(0, Math.min(width, distance));

  function canScrollHorizontally(element, delta) {
    for (; element && element !== document.body; element = element.parentElement) {
      const limit = element.scrollWidth - element.clientWidth;
      if (limit > 0 && /auto|scroll/.test(getComputedStyle(element).overflowX) &&
          (delta > 0 ? element.scrollLeft > 0 : element.scrollLeft < limit - 1)) return true;
    }
    return false;
  }

  function paint(drag) {
    drag.frame.style.setProperty('--local-drawer-distance', `${drag.distance}px`);
  }

  function snap(drag, open) {
    gesture = undefined;
    cancelAnimationFrame(frameRequest);
    frameRequest = 0;
    if (!drag.active) return;
    settling = true;
    paint(drag);
    requestAnimationFrame(() => {
      // Restore the transition before handing the position back to the drawer state.
      drag.frame.dataset.localDrawer = 'settle';
      if (open !== drawer.getState().open) (open ? openDrawer : closeDrawer)();
      requestAnimationFrame(() => {
        delete drag.frame.dataset.localDrawer;
        drag.frame.style.removeProperty('--local-drawer-distance');
        settling = false;
      });
    });
  }

  document.addEventListener('touchstart', (event) => {
    if (gesture) snap(gesture, gesture.wasOpen);
    if (settling || !mobile.matches || event.touches.length !== 1 || blocked() || selectionActive()) return;
    const target = event.target instanceof Element ? event.target : null;
    const frame = target?.closest('.app-frame');
    if (!frame || target.closest(interactive)) return;
    const touch = event.touches[0];
    const wasOpen = drawer.getState().open;
    const x = touch.clientX - frame.getBoundingClientRect().left;
    // Leave the Android system back gesture a strip along both screen edges.
    if (x < 20 || x > frame.clientWidth - 20 || (!wasOpen && x > 96)) return;
    const panel = frame.querySelector(':scope > [data-local-drawer-open]');
    const main = frame.querySelector(':scope > main');
    if (!panel?.offsetWidth || !main) return;
    const width = panel.offsetWidth;
    const distance = limit(main.getBoundingClientRect().left - frame.getBoundingClientRect().left, width);
    gesture = {
      id: touch.identifier, frame, target, wasOpen, width, distance, startDistance: distance,
      x: touch.clientX, y: touch.clientY, active: false,
      lastX: touch.clientX, lastTime: performance.now(), velocity: 0,
    };
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    const drag = gesture;
    if (!drag) return;
    if (event.touches.length !== 1 || blocked() || selectionActive()) {
      snap(drag, drag.wasOpen);
      return;
    }
    const touch = event.touches[0];
    if (touch.identifier !== drag.id) return;
    const dx = touch.clientX - drag.x;
    const dy = touch.clientY - drag.y;
    if (!drag.active) {
      if (Math.abs(dx) < 9 && Math.abs(dy) < 9) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.3 || (drag.wasOpen ? dx >= 0 : dx <= 0) ||
          canScrollHorizontally(drag.target, dx)) {
        gesture = undefined;
        return;
      }
      drag.active = true;
      drag.distance = limit(drag.startDistance + dx, drag.width);
      paint(drag);
      drag.frame.dataset.localDrawer = 'drag';
    }
    if (event.cancelable) event.preventDefault();
    const now = performance.now();
    drag.velocity = (touch.clientX - drag.lastX) / Math.max(12, now - drag.lastTime);
    drag.lastTime = now;
    drag.lastX = touch.clientX;
    drag.distance = limit(drag.startDistance + dx, drag.width);
    if (!frameRequest) {
      frameRequest = requestAnimationFrame(() => {
        frameRequest = 0;
        paint(drag);
      });
    }
  }, { passive: false });

  document.addEventListener('touchend', (event) => {
    const drag = gesture;
    if (!drag) return;
    const touch = Array.from(event.changedTouches).find((point) => point.identifier === drag.id);
    if (!touch) return;
    drag.distance = limit(drag.startDistance + touch.clientX - drag.x, drag.width);
    const recent = performance.now() - drag.lastTime < 90;
    const flick = recent && Math.abs(drag.velocity) > 0.45 && Math.abs(touch.clientX - drag.x) > 30;
    const open = flick ? drag.velocity > 0 : drag.distance > drag.width * (drag.wasOpen ? 0.55 : 0.4);
    snap(drag, blocked() ? drag.wasOpen : open);
  }, { passive: true });
  document.addEventListener('touchcancel', () => {
    if (gesture) snap(gesture, gesture.wasOpen);
  }, { passive: true });
}

    mountHistorySearch({ ...detail, collectHistoryIndex, searchHistory });
    mountDrawerDrag(detail);
}, { once: true });
