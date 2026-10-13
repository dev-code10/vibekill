'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const state = {
  user: null, category: '전체', search: '', sort: 'recent', page: 1,
  totalPages: 1, currentPostId: null, editingPostId: null,
  authMode: 'login', adminTab: 'users', adminPage: 1
};

async function api(url, options = {}) {
  const config = { method: options.method || 'GET', credentials: 'same-origin', headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } };
  if (options.body !== undefined) config.body = JSON.stringify(options.body);
  const response = await fetch(url, config);
  let payload = {};
  try { payload = await response.json(); } catch (_) { /* empty response body */ }
  if (!response.ok) {
    const error = new Error(payload.error || '요청을 처리하지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' error' : ''}`;
  el.textContent = message;
  $('#toastRegion').append(el);
  window.setTimeout(() => el.remove(), 3400);
}

function formatDate(value, withTime = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return withTime ? `오늘 ${date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '오늘';
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (!withTime && date.toDateString() === yesterday.toDateString()) return '어제';
  return date.toLocaleDateString('ko-KR', withTime ? { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { year: 'numeric', month: 'short', day: 'numeric' });
}

function avatarNode(name, url, sizeClass = '') {
  const avatar = document.createElement('span');
  avatar.className = `avatar ${sizeClass}`.trim();
  if (url) {
    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { avatar.textContent = (name || '?').slice(0, 1).toUpperCase(); }, { once: true });
    avatar.append(image);
  } else avatar.textContent = (name || '?').trim().slice(0, 1).toUpperCase();
  return avatar;
}

function showModal(id) {
  $('#modalBackdrop').classList.remove('hidden');
  $('#modalBackdrop').setAttribute('aria-hidden', 'false');
  $$('.modal').forEach((modal) => modal.classList.add('hidden'));
  $(`#${id}`).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  const focusTarget = $(`#${id} input:not([disabled]), #${id} textarea, #${id} button`);
  if (focusTarget) window.setTimeout(() => focusTarget.focus(), 40);
}
function closeModal() {
  $('#modalBackdrop').classList.add('hidden');
  $('#modalBackdrop').setAttribute('aria-hidden', 'true');
  $$('.modal').forEach((modal) => modal.classList.add('hidden'));
  document.body.style.overflow = '';
  state.editingPostId = null;
  state.currentPostId = null;
}
function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === 'register';
  $('#authTitle').textContent = isRegister ? '모루에 오신 걸 환영해요' : '다시 만나서 반가워요';
  $('#authSubtitle').textContent = isRegister ? '새로운 연결을 만들고 이야기를 나눠 보세요.' : '이야기가 이어지는 곳, 모루에 로그인하세요.';
  $('#authSubmit').innerHTML = isRegister ? '계정 만들기 <span>→</span>' : '로그인하기 <span>→</span>';
  $('#registerNameWrap').classList.toggle('hidden', !isRegister);
  $('#registerName').required = isRegister;
  $('#authPassword').autocomplete = isRegister ? 'new-password' : 'current-password';
  $$('.auth-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.mode === mode));
}
function openAuth(mode = 'login') {
  setAuthMode(mode);
  $('#authForm').reset();
  showModal('authModal');
}
function requireLogin() {
  if (state.user) return true;
  openAuth('login');
  toast('계속하려면 먼저 로그인해 주세요.', 'error');
  return false;
}

function renderHeader() {
  const area = $('#userArea');
  area.replaceChildren();
  if (!state.user) {
    const login = document.createElement('button'); login.className = 'button button-light'; login.dataset.action = 'open-auth'; login.dataset.mode = 'login'; login.textContent = '로그인';
    const register = document.createElement('button'); register.className = 'button button-primary'; register.dataset.action = 'open-auth'; register.dataset.mode = 'register'; register.textContent = '가입하기';
    area.append(login, register);
    $('#adminNav').classList.add('hidden');
    $('#welcomeUser').textContent = '모루에 오신 걸 환영해요';
  } else {
    const profile = document.createElement('button'); profile.className = 'user-chip'; profile.dataset.action = 'profile';
    profile.append(avatarNode(state.user.displayName, state.user.avatarUrl));
    const name = document.createElement('span'); name.className = 'user-chip-name'; name.textContent = state.user.displayName;
    profile.append(name);
    const logout = document.createElement('button'); logout.className = 'button button-light'; logout.dataset.action = 'logout'; logout.textContent = '로그아웃';
    area.append(profile, logout);
    $('#adminNav').classList.toggle('hidden', state.user.role !== 'admin');
    $('#welcomeUser').textContent = `${state.user.displayName}님, 반가워요`;
  }
  const option = $('.admin-only', $('#postCategory'));
  if (option) option.hidden = !(state.user && state.user.role === 'admin');
}

function renderPostCard(post) {
  const card = document.createElement('article');
  card.className = 'post-card'; card.dataset.postId = post.id; card.tabIndex = 0; card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `${post.title} 게시글 보기`);
  const main = document.createElement('div'); main.className = 'post-card-main';
  const top = document.createElement('div'); top.className = 'post-card-top';
  const category = document.createElement('span'); category.className = 'post-category'; category.dataset.category = post.category; category.textContent = post.category;
  const time = document.createElement('span'); time.className = 'post-time'; time.textContent = formatDate(post.createdAt, true);
  top.append(category, time);
  const title = document.createElement('h3'); title.textContent = post.title;
  const excerpt = document.createElement('p'); excerpt.className = 'post-excerpt'; excerpt.textContent = post.excerpt;
  const bottom = document.createElement('div'); bottom.className = 'post-card-bottom';
  const author = document.createElement('div'); author.className = 'post-author'; author.append(avatarNode(post.author.displayName, post.author.avatarUrl), document.createTextNode(post.author.displayName));
  const meta = document.createElement('div'); meta.className = 'post-meta';
  const comments = document.createElement('span'); comments.textContent = `☏ ${post.commentCount}`;
  const views = document.createElement('span'); views.textContent = `◉ ${post.viewCount.toLocaleString('ko-KR')}`;
  meta.append(comments, views); bottom.append(author, meta);
  main.append(top, title, excerpt, bottom);
  const marker = document.createElement('div'); marker.className = 'post-side-mark'; marker.textContent = '↗';
  card.append(main, marker);
  return card;
}

async function loadPosts() {
  const params = new URLSearchParams({ page: String(state.page), sort: state.sort });
  if (state.category !== '전체') params.set('category', state.category);
  if (state.search) params.set('search', state.search);
  $('#feedStatus').classList.remove('hidden'); $('#feedStatus').textContent = '이야기를 불러오고 있어요…';
  $('#postList').replaceChildren(); $('#pagination').replaceChildren();
  try {
    const data = await api(`/api/posts?${params.toString()}`);
    state.totalPages = data.totalPages;
    $('#feedPostCount').textContent = data.total.toLocaleString('ko-KR');
    $('#feedStatus').classList.toggle('hidden', data.posts.length > 0);
    $('#feedStatus').textContent = data.posts.length ? '' : '';
    if (!data.posts.length) {
      const empty = document.createElement('div'); empty.className = 'empty-state';
      const icon = document.createElement('div'); icon.className = 'empty-icon'; icon.textContent = '✎';
      const title = document.createElement('h3'); title.textContent = state.search ? '검색 결과가 없어요' : '아직 등록된 이야기가 없어요';
      const copy = document.createElement('p'); copy.textContent = state.search ? '다른 검색어로 찾아보거나 첫 이야기를 남겨 주세요.' : '가장 먼저 모루의 이야기를 시작해 보세요.';
      const button = document.createElement('button'); button.className = 'button button-primary'; button.dataset.action = 'new-post'; button.classList.add('empty-cta'); button.textContent = '첫 게시글 작성하기';
      empty.append(icon, title, copy, button); $('#postList').append(empty);
    } else data.posts.forEach((post) => $('#postList').append(renderPostCard(post)));
    renderPagination();
    const visibleComments = data.posts.reduce((sum, post) => sum + post.commentCount, 0);
    $('#feedCommentCount').textContent = visibleComments ? `${visibleComments.toLocaleString('ko-KR')}개의 댓글이 이어지고 있어요` : '새로운 댓글을 기다려요';
  } catch (error) {
    $('#feedStatus').classList.remove('hidden'); $('#feedStatus').textContent = error.message;
    toast(error.message, 'error');
  }
}

function renderPagination() {
  const container = $('#pagination');
  if (state.totalPages <= 1) return;
  const add = (page, label, active = false, disabled = false) => {
    const button = document.createElement('button'); button.className = `page-button${active ? ' active' : ''}`; button.textContent = label; button.disabled = disabled; button.addEventListener('click', () => { state.page = page; loadPosts(); window.scrollTo({ top: 250, behavior: 'smooth' }); }); container.append(button);
  };
  add(Math.max(1, state.page - 1), '‹', false, state.page === 1);
  const start = Math.max(1, state.page - 2), end = Math.min(state.totalPages, start + 4);
  for (let page = Math.max(1, end - 4); page <= end; page++) add(page, String(page), state.page === page);
  add(Math.min(state.totalPages, state.page + 1), '›', false, state.page === state.totalPages);
}

function setCategory(category) {
  state.category = category; state.page = 1;
  $$('.category-pill').forEach((button) => button.classList.toggle('active', button.dataset.category === category));
  $$('.primary-nav .nav-item').forEach((button) => button.classList.toggle('is-active', button.dataset.category === category || (!button.dataset.category && category === '전체')));
  loadPosts();
}

function openComposer(post = null) {
  if (!requireLogin()) return;
  if (post && post.category === '공지' && state.user.role !== 'admin') return toast('공지 게시글은 관리자만 수정할 수 있습니다.', 'error');
  state.editingPostId = post ? post.id : null;
  $('#composerTitle').textContent = post ? '이야기 수정하기' : '새로운 이야기 쓰기';
  $('#postSubmit').innerHTML = post ? '수정 내용 저장 <span>→</span>' : '게시글 등록 <span>→</span>';
  $('#postTitle').value = post ? post.title : '';
  $('#postContent').value = post ? post.content : '';
  $('#postCategory').value = post ? post.category : '자유';
  const option = $('.admin-only', $('#postCategory'));
  if (option) option.hidden = !(state.user.role === 'admin');
  showModal('composerModal');
}

function detailElement(tag, className, text) {
  const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el;
}

async function openPost(id, countView = true) {
  try {
    const data = await api(`/api/posts/${id}${countView ? '?view=1' : ''}`);
    state.currentPostId = data.post.id;
    renderPostDetail(data.post, data.comments);
    showModal('detailModal');
  } catch (error) { toast(error.message, 'error'); }
}

function renderPostDetail(post, comments) {
  const root = $('#detailBody'); root.replaceChildren();
  const header = detailElement('div', 'detail-header');
  const meta = detailElement('div', 'detail-head-meta');
  meta.append(detailElement('span', 'post-category', post.category), detailElement('span', 'post-time', formatDate(post.createdAt, true)));
  const title = detailElement('h2', '', post.title); title.id = 'detailTitle';
  const author = detailElement('div', 'detail-author-row'); author.append(avatarNode(post.author.displayName, post.author.avatarUrl));
  const info = detailElement('div', 'detail-author-info'); info.append(detailElement('span', 'detail-author-name', post.author.displayName), detailElement('span', 'detail-date', `조회 ${post.viewCount.toLocaleString('ko-KR')}회 · ${formatDate(post.createdAt)}`));
  author.append(info); header.append(meta, title, author);
  const copy = detailElement('div', 'detail-body-copy', post.content);
  const actions = detailElement('div', 'detail-actions');
  const left = detailElement('div', 'detail-action-left'); left.append(detailElement('span', 'post-time', `◉ 조회 ${post.viewCount.toLocaleString('ko-KR')}`));
  const right = detailElement('div', 'detail-action-right');
  if (state.user && (state.user.id === post.author.id || state.user.role === 'admin')) {
    const edit = detailElement('button', 'small-button', '수정'); edit.dataset.action = 'edit-post'; edit.dataset.postId = post.id;
    const del = detailElement('button', 'small-button danger', '삭제'); del.dataset.action = 'delete-post'; del.dataset.postId = post.id;
    right.append(edit, del);
  }
  actions.append(left, right);
  const section = detailElement('section', 'comments-section');
  const commentsTitle = detailElement('h3', 'comments-title', '댓글'); commentsTitle.append(detailElement('span', '', String(comments.length)));
  const list = detailElement('div', 'comment-list');
  if (!comments.length) list.append(detailElement('p', 'detail-date', '첫 댓글로 대화를 시작해 보세요.'));
  comments.forEach((comment) => {
    const item = detailElement('div', 'comment-item'); item.dataset.commentId = comment.id;
    item.append(avatarNode(comment.author.displayName, comment.author.avatarUrl));
    const body = detailElement('div', 'comment-content'); const top = detailElement('div', 'comment-top');
    top.append(detailElement('span', 'comment-name', comment.author.displayName), detailElement('span', 'comment-date', formatDate(comment.createdAt, true)));
    if (state.user && (state.user.id === comment.userId || state.user.role === 'admin')) {
      const del = detailElement('button', 'comment-delete', '삭제'); del.dataset.action = 'delete-comment'; del.dataset.commentId = comment.id; top.append(del);
    }
    body.append(top, detailElement('p', 'comment-text', comment.content)); item.append(body); list.append(item);
  });
  section.append(commentsTitle, list);
  if (state.user) {
    const form = detailElement('form', 'comment-form'); form.id = 'commentForm';
    const input = document.createElement('input'); input.name = 'content'; input.maxLength = 2000; input.placeholder = '따뜻한 댓글을 남겨 보세요…'; input.required = true; input.setAttribute('aria-label', '댓글 내용');
    const button = detailElement('button', '', '댓글 등록'); button.type = 'submit'; form.append(input, button); section.append(form);
  } else {
    const note = detailElement('div', 'comment-login-note', '댓글을 남기려면 로그인이 필요해요.');
    const login = detailElement('button', 'small-button', '로그인하기'); login.dataset.action = 'open-auth'; login.dataset.mode = 'login'; login.style.marginLeft = '8px'; note.append(login); section.append(note);
  }
  root.append(header, copy, actions, section);
}

async function refreshCurrentPost() {
  const id = state.currentPostId;
  if (id) await openPost(id, false);
}

function openProfile() {
  if (!requireLogin()) return;
  $('#profileEmail').value = state.user.email;
  $('#profileName').value = state.user.displayName;
  $('#profileAvatar').value = state.user.avatarUrl || '';
  $('#profileBio').value = state.user.bio || '';
  showModal('profileModal');
}

async function loadAdminStats() {
  const data = await api('/api/admin/stats');
  const stats = [
    ['전체 회원', data.users.toLocaleString('ko-KR'), `활성 회원 ${data.activeUsers.toLocaleString('ko-KR')}명`],
    ['게시글', data.posts.toLocaleString('ko-KR'), '모루에 쌓인 이야기'],
    ['댓글', data.comments.toLocaleString('ko-KR'), '이어지는 대화'],
    ['활성 회원 비율', data.users ? `${Math.round(data.activeUsers / data.users * 100)}%` : '0%', '계정 상태 기준']
  ];
  const root = $('#adminStats'); root.replaceChildren();
  stats.forEach(([label, value, note]) => {
    const card = detailElement('div', 'admin-stat'); card.append(detailElement('span', 'admin-stat-label', label), detailElement('strong', 'admin-stat-value', value), detailElement('div', 'admin-stat-note', note)); root.append(card);
  });
}

function setAdminTab(tab) {
  state.adminTab = tab;
  $$('.admin-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  loadAdminPanel(1);
}

async function loadAdminPanel(page = state.adminPage) {
  state.adminPage = page;
  const root = $('#adminPanelContent'); root.replaceChildren(detailElement('p', 'status-line', '관리 데이터를 불러오고 있어요…'));
  try {
    if (state.adminTab === 'users') {
      const data = await api(`/api/admin/users?page=${page}`); root.replaceChildren();
      if (!data.users.length) { root.append(detailElement('div', 'admin-empty', '등록된 회원이 없습니다.')); return; }
      const table = document.createElement('table'); table.className = 'admin-table';
      const thead = document.createElement('thead'); const hr = document.createElement('tr');
      ['회원','권한','상태','가입일','관리'].forEach((label) => hr.append(detailElement('th', '', label)));
      thead.append(hr); table.append(thead);
      const tbody = document.createElement('tbody');
      data.users.forEach((user) => {
        const tr = document.createElement('tr');
        const userCell = document.createElement('td'); const userDiv = detailElement('div', 'admin-user');
        userDiv.append(avatarNode(user.displayName, '' , 'admin-avatar'));
        const info = detailElement('div', ''); info.append(detailElement('div', 'admin-user-name', user.displayName), detailElement('div', 'admin-user-email', user.email)); userDiv.append(info); userCell.append(userDiv);
        const roleCell = document.createElement('td'); roleCell.append(detailElement('span', `role-badge ${user.role}`, user.role === 'admin' ? '관리자' : '일반 회원'));
        const statusCell = document.createElement('td'); statusCell.append(detailElement('span', `status-badge ${user.isActive ? 'active' : 'inactive'}`, user.isActive ? '활성' : '비활성'));
        const dateCell = detailElement('td', '', formatDate(user.createdAt));
        const actionsCell = document.createElement('td'); const actions = detailElement('div', 'table-actions');
        if (user.id !== state.user.id) {
          const roleButton = detailElement('button', 'table-action', user.role === 'admin' ? '일반 회원으로' : '관리자 지정'); roleButton.dataset.action = 'admin-role'; roleButton.dataset.userId = user.id; roleButton.dataset.role = user.role === 'admin' ? 'user' : 'admin'; actions.append(roleButton);
          const activeButton = detailElement('button', 'table-action', user.isActive ? '비활성화' : '활성화'); activeButton.dataset.action = 'admin-status'; activeButton.dataset.userId = user.id; activeButton.dataset.active = String(!user.isActive); actions.append(activeButton);
          const deleteButton = detailElement('button', 'table-action danger', '삭제'); deleteButton.dataset.action = 'admin-delete-user'; deleteButton.dataset.userId = user.id; actions.append(deleteButton);
        } else actions.append(detailElement('span', 'post-time', '현재 로그인 계정'));
        actionsCell.append(actions); tr.append(userCell, roleCell, statusCell, dateCell, actionsCell); tbody.append(tr);
      });
      table.append(tbody); root.append(table); appendAdminPager(root, data.page, Math.ceil(data.total / 20));
    } else {
      const data = await api(`/api/admin/posts?page=${page}`); root.replaceChildren();
      if (!data.posts.length) { root.append(detailElement('div', 'admin-empty', '등록된 게시글이 없습니다.')); return; }
      const table = document.createElement('table'); table.className = 'admin-table';
      const thead = document.createElement('thead'); const hr = document.createElement('tr');
      ['게시글','게시판','작성자','작성일','관리'].forEach((label) => hr.append(detailElement('th', '', label)));
      thead.append(hr); table.append(thead); const tbody = document.createElement('tbody');
      data.posts.forEach((post) => {
        const tr = document.createElement('tr');
        const title = detailElement('td', '', post.title); title.style.fontWeight = '700'; title.style.minWidth = '210px';
        const category = detailElement('td', '', post.category); const author = detailElement('td', '', post.author); const date = detailElement('td', '', formatDate(post.createdAt));
        const actionCell = document.createElement('td'); const wrap = detailElement('div', 'table-actions');
        const view = detailElement('button', 'table-action', '보기'); view.dataset.action = 'admin-view-post'; view.dataset.postId = post.id;
        const remove = detailElement('button', 'table-action danger', '삭제'); remove.dataset.action = 'admin-delete-post'; remove.dataset.postId = post.id;
        wrap.append(view, remove); actionCell.append(wrap); tr.append(title, category, author, date, actionCell); tbody.append(tr);
      });
      table.append(tbody); root.append(table); appendAdminPager(root, data.page, Math.ceil(data.total / 20));
    }
  } catch (error) {
    root.replaceChildren(detailElement('p', 'admin-empty', error.message));
    if (error.status === 401 || error.status === 403) { toast(error.message, 'error'); window.location.href = '/'; }
  }
}

function appendAdminPager(root, current, total) {
  if (total <= 1) return;
  const nav = detailElement('div', 'admin-pagination');
  for (let p = 1; p <= total; p++) {
    if (p > 5 && p !== current && p !== total) continue;
    const button = detailElement('button', `page-button${p === current ? ' active' : ''}`, String(p));
    button.addEventListener('click', () => loadAdminPanel(p)); nav.append(button);
  }
  root.append(nav);
}

async function boot() {
  try { const data = await api('/api/me'); state.user = data.user; } catch (_) { state.user = null; }
  renderHeader();
  if (window.location.pathname === '/admin') {
    $('#feedPage').classList.add('hidden'); $('#adminPage').classList.remove('hidden');
    if (!state.user) { openAuth('login'); $('#authSubtitle').textContent = '관리자 센터 이용을 위해 로그인해 주세요.'; return; }
    if (state.user.role !== 'admin') {
      $('#adminPage').innerHTML = '<div class="empty-state"><div class="empty-icon">⌁</div><h3>관리자 권한이 필요합니다</h3><p>관리자 계정으로 로그인해 주세요.</p><a href="/" class="button button-primary empty-cta">커뮤니티로 돌아가기</a></div>';
      return;
    }
    await Promise.all([loadAdminStats(), loadAdminPanel(1)]);
  } else {
    $('#feedPage').classList.remove('hidden'); $('#adminPage').classList.add('hidden');
    await loadPosts();
  }
}

// Centralized actions keep dynamically rendered controls working without unsafe HTML templates.
document.addEventListener('click', async (event) => {
  const actionEl = event.target.closest('[data-action]');
  if (actionEl) {
    const action = actionEl.dataset.action;
    try {
      if (action === 'open-auth') openAuth(actionEl.dataset.mode || 'login');
      else if (action === 'auth-tab') setAuthMode(actionEl.dataset.mode);
      else if (action === 'close-modal') closeModal();
      else if (action === 'home') { event.preventDefault(); state.category = '전체'; state.search = ''; state.page = 1; $('#searchInput').value = ''; setCategory('전체'); }
      else if (action === 'category') { event.preventDefault(); setCategory(actionEl.dataset.category || '전체'); }
      else if (action === 'profile') openProfile();
      else if (action === 'logout') {
        await api('/api/auth/logout', { method: 'POST', body: {} }); state.user = null; renderHeader(); toast('로그아웃했습니다.');
        if (window.location.pathname === '/admin') window.location.href = '/'; else loadPosts();
      }
      else if (action === 'new-post') openComposer();
      else if (action === 'edit-post') {
        event.stopPropagation();
        const data = await api(`/api/posts/${actionEl.dataset.postId}`); closeModal(); openComposer(data.post);
      }
      else if (action === 'delete-post') {
        event.stopPropagation();
        if (!window.confirm('이 게시글을 삭제할까요? 댓글도 함께 삭제됩니다.')) return;
        await api(`/api/posts/${actionEl.dataset.postId}`, { method: 'DELETE' }); closeModal(); toast('게시글을 삭제했습니다.');
        if (window.location.pathname === '/admin') await Promise.all([loadAdminStats(), loadAdminPanel(state.adminPage)]); else loadPosts();
      }
      else if (action === 'delete-comment') {
        event.stopPropagation();
        if (!window.confirm('이 댓글을 삭제할까요?')) return;
        await api(`/api/comments/${actionEl.dataset.commentId}`, { method: 'DELETE' }); toast('댓글을 삭제했습니다.'); await refreshCurrentPost();
      }
      else if (action === 'admin-tab') setAdminTab(actionEl.dataset.tab);
      else if (action === 'admin-role') {
        const role = actionEl.dataset.role; const label = role === 'admin' ? '관리자로 지정' : '일반 회원으로 변경';
        if (!window.confirm(`이 회원을 ${label}할까요?`)) return;
        await api(`/api/admin/users/${actionEl.dataset.userId}/role`, { method: 'PATCH', body: { role } }); toast('회원 권한을 변경했습니다.'); await Promise.all([loadAdminStats(), loadAdminPanel(state.adminPage)]);
      }
      else if (action === 'admin-status') {
        const isActive = actionEl.dataset.active === 'true';
        if (!window.confirm(`이 회원을 ${isActive ? '활성화' : '비활성화'}할까요?`)) return;
        await api(`/api/admin/users/${actionEl.dataset.userId}/status`, { method: 'PATCH', body: { isActive } }); toast('회원 상태를 변경했습니다.'); await Promise.all([loadAdminStats(), loadAdminPanel(state.adminPage)]);
      }
      else if (action === 'admin-delete-user') {
        if (!window.confirm('이 회원을 삭제할까요? 작성한 게시글과 댓글도 함께 삭제됩니다. 이 작업은 되돌릴 수 없습니다.')) return;
        await api(`/api/admin/users/${actionEl.dataset.userId}`, { method: 'DELETE' }); toast('회원을 삭제했습니다.'); await Promise.all([loadAdminStats(), loadAdminPanel(state.adminPage)]);
      }
      else if (action === 'admin-delete-post') {
        if (!window.confirm('이 게시글과 댓글을 삭제할까요?')) return;
        await api(`/api/admin/posts/${actionEl.dataset.postId}`, { method: 'DELETE' }); toast('게시글을 삭제했습니다.'); await Promise.all([loadAdminStats(), loadAdminPanel(state.adminPage)]);
      }
      else if (action === 'admin-view-post') { await openPost(actionEl.dataset.postId); }
    } catch (error) { toast(error.message, 'error'); }
    return;
  }
  const postCard = event.target.closest('.post-card');
  if (postCard) openPost(postCard.dataset.postId);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !$('#modalBackdrop').classList.contains('hidden')) closeModal();
  if ((event.key === 'Enter' || event.key === ' ') && event.target.classList.contains('post-card')) { event.preventDefault(); openPost(event.target.dataset.postId); }
});
$('#modalBackdrop').addEventListener('click', (event) => { if (event.target === $('#modalBackdrop')) closeModal(); });
$('#authForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#authSubmit'); button.disabled = true;
  try {
    const body = { email: $('#authEmail').value.trim(), password: $('#authPassword').value };
    const data = state.authMode === 'register'
      ? await api('/api/auth/register', { method: 'POST', body: { ...body, displayName: $('#registerName').value.trim() } })
      : await api('/api/auth/login', { method: 'POST', body });
    state.user = data.user; closeModal(); renderHeader(); toast(state.authMode === 'register' ? '모루에 오신 걸 환영해요!' : '로그인했습니다.');
    if (window.location.pathname === '/admin' && state.user.role === 'admin') window.location.reload();
    else if (window.location.pathname === '/admin') window.location.href = '/';
    else { await loadPosts(); }
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; }
});

$('#composerForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!requireLogin()) return;
  const button = $('#postSubmit'); button.disabled = true;
  const wasEditing = Boolean(state.editingPostId);
  const editId = state.editingPostId;
  const body = { title: $('#postTitle').value.trim(), content: $('#postContent').value.trim(), category: $('#postCategory').value };
  try {
    if (wasEditing) await api(`/api/posts/${editId}`, { method: 'PATCH', body });
    else await api('/api/posts', { method: 'POST', body });
    closeModal(); toast(wasEditing ? '게시글을 수정했습니다.' : '새로운 이야기를 등록했습니다.');
    state.category = '전체'; state.page = 1; $$('.category-pill').forEach((pill) => pill.classList.toggle('active', pill.dataset.category === '전체'));
    if (window.location.pathname === '/admin') await loadAdminPanel(state.adminPage); else await loadPosts();
  } catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; }
});

$('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const data = await api('/api/me', { method: 'PATCH', body: { displayName: $('#profileName').value.trim(), avatarUrl: $('#profileAvatar').value.trim(), bio: $('#profileBio').value.trim() } });
    state.user = data.user; renderHeader(); closeModal(); toast('프로필을 저장했습니다.');
    if (window.location.pathname === '/admin') await loadAdminPanel(state.adminPage);
  } catch (error) { toast(error.message, 'error'); }
});

document.addEventListener('submit', async (event) => {
  if (event.target.id !== 'commentForm') return;
  event.preventDefault();
  const input = $('input[name="content"]', event.target); const content = input.value.trim();
  if (!content || !state.currentPostId) return;
  const button = $('button[type="submit"]', event.target); button.disabled = true;
  try { await api(`/api/posts/${state.currentPostId}/comments`, { method: 'POST', body: { content } }); toast('댓글을 등록했습니다.'); await refreshCurrentPost(); }
  catch (error) { toast(error.message, 'error'); }
  finally { button.disabled = false; }
});

$('#sortSelect').addEventListener('change', (event) => { state.sort = event.target.value; state.page = 1; loadPosts(); });
let searchTimer;
$('#searchInput').addEventListener('input', (event) => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => { state.search = event.target.value.trim(); state.page = 1; loadPosts(); }, 280);
});
$('#searchInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') { window.clearTimeout(searchTimer); state.search = event.target.value.trim(); state.page = 1; loadPosts(); } });
$('#themeButton').addEventListener('click', () => toast('편안한 대화를 위한 모루의 기본 테마입니다.'));

boot();
