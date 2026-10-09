const authSection = document.getElementById('auth-section');
const appSection = document.getElementById('app-section');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const signupBtn = document.getElementById('signup-btn');
const authMsg = document.getElementById('auth-msg');
const userEmail = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');

const form = document.getElementById('task-form');
const input = document.getElementById('task-input');
const dueInput = document.getElementById('due-input');
const filterBar = document.getElementById('filters');
const countEl = document.getElementById('count');
const list = document.getElementById('task-list');
const emptyMsg = document.getElementById('empty-msg');

let sb = null;       // kết nối Supabase
let token = null;    // token đăng nhập hiện tại
let allTasks = [];   // toàn bộ việc của người dùng
let filter = 'all';  // bộ lọc đang chọn

function showMsg(text, isError = true) {
  authMsg.textContent = text;
  authMsg.style.color = isError ? '#dc2626' : '#16a34a';
}

function translateError(message) {
  if (/invalid login credentials/i.test(message)) return 'Sai email hoặc mật khẩu';
  if (/already registered/i.test(message)) return 'Email này đã được đăng ký';
  if (/at least 6/i.test(message)) return 'Mật khẩu phải có ít nhất 6 ký tự';
  if (/email not confirmed/i.test(message)) return 'Bạn cần bấm link xác nhận trong email trước';
  return message;
}

function todayStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatDate(s) {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
}

// Gọi API, tự gắn token vào mỗi yêu cầu
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    }
  });
  if (res.status === 401) {
    await sb.auth.signOut();
    throw new Error('Phiên đăng nhập hết hạn');
  }
  return res;
}

async function loadTasks() {
  try {
    const res = await api('/api/tasks');
    if (!res.ok) throw new Error('Không tải được danh sách');
    allTasks = await res.json();
    render();
  } catch (err) {
    console.error(err);
  }
}

function render() {
  const remaining = allTasks.filter(t => !t.done).length;
  countEl.textContent = allTasks.length ? `Còn ${remaining} việc chưa xong` : '';

  const tasks = allTasks.filter(t =>
    filter === 'all' ? true : filter === 'active' ? !t.done : t.done
  );

  list.innerHTML = '';
  emptyMsg.hidden = tasks.length > 0;
  emptyMsg.textContent = allTasks.length === 0
    ? 'Chưa có việc nào. Hãy thêm việc đầu tiên!'
    : 'Không có việc nào trong mục này.';

  tasks.forEach(task => list.appendChild(taskItem(task)));
}

function taskItem(task) {
  const li = document.createElement('li');
  if (task.done) li.classList.add('done');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = task.done;
  checkbox.addEventListener('change', async () => {
    await api(`/api/tasks/${task.id}`, { method: 'PATCH' });
    loadTasks();
  });

  const main = document.createElement('div');
  main.className = 'task-main';

  const span = document.createElement('span');
  span.textContent = task.title;
  main.appendChild(span);

  if (task.due_date) {
    const due = document.createElement('small');
    due.className = 'due';
    due.textContent = 'Hạn: ' + formatDate(task.due_date);
    if (!task.done && task.due_date < todayStr()) {
      due.classList.add('overdue');
      due.textContent += ' (quá hạn)';
    }
    main.appendChild(due);
  }

  const edit = document.createElement('button');
  edit.textContent = 'Sửa';
  edit.className = 'edit';
  edit.addEventListener('click', () => startEdit(li, task));

  const del = document.createElement('button');
  del.textContent = 'Xóa';
  del.className = 'delete';
  del.addEventListener('click', async () => {
    await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    loadTasks();
  });

  li.append(checkbox, main, edit, del);
  return li;
}

function startEdit(li, task) {
  li.innerHTML = '';
  li.classList.remove('done');

  const row = document.createElement('div');
  row.className = 'edit-row';

  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = task.title;
  titleInput.maxLength = 200;

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = task.due_date || '';

  const save = document.createElement('button');
  save.textContent = 'Lưu';

  const cancel = document.createElement('button');
  cancel.textContent = 'Hủy';
  cancel.className = 'secondary';

  async function doSave() {
    const title = titleInput.value.trim();
    if (!title) {
      titleInput.focus();
      return;
    }
    await api(`/api/tasks/${task.id}`, {
      method: 'PUT',
      body: JSON.stringify({ title, due_date: dateInput.value || null })
    });
    loadTasks();
  }

  save.addEventListener('click', doSave);
  cancel.addEventListener('click', render);
  titleInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') doSave();
    if (e.key === 'Escape') render();
  });

  row.append(titleInput, dateInput, save, cancel);
  li.appendChild(row);
  titleInput.focus();
}

// Thêm việc
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;

  await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title, due_date: dueInput.value || null })
  });

  input.value = '';
  dueInput.value = '';
  loadTasks();
});

// Bộ lọc
filterBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-filter]');
  if (!btn) return;
  filter = btn.dataset.filter;
  filterBar.querySelectorAll('.filter').forEach(b =>
    b.classList.toggle('active', b === btn)
  );
  render();
});

// Đăng nhập
authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showMsg('');
  const { error } = await sb.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value
  });
  if (error) showMsg(translateError(error.message));
});

// Đăng ký
signupBtn.addEventListener('click', async () => {
  if (!authForm.reportValidity()) return;
  showMsg('');
  const { data, error } = await sb.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value
  });
  if (error) return showMsg(translateError(error.message));
  if (!data.session) {
    showMsg('Đã gửi email xác nhận. Hãy bấm link trong email rồi quay lại đăng nhập.', false);
  }
});

// Đăng xuất
logoutBtn.addEventListener('click', () => sb.auth.signOut());

// Khởi động
async function init() {
  const res = await fetch('/api/config');
  const cfg = await res.json();
  sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);

  sb.auth.onAuthStateChange((event, session) => {
    token = session ? session.access_token : null;
    if (session) {
      userEmail.textContent = session.user.email;
      authSection.hidden = true;
      appSection.hidden = false;
      if (event !== 'TOKEN_REFRESHED') setTimeout(loadTasks, 0);
    } else {
      authSection.hidden = false;
      appSection.hidden = true;
      allTasks = [];
      list.innerHTML = '';
    }
  });
}

init();