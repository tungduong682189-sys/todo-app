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
const list = document.getElementById('task-list');
const emptyMsg = document.getElementById('empty-msg');

let sb = null;      // kết nối Supabase
let token = null;   // token đăng nhập hiện tại

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

// Hàm gọi API, tự gắn token vào mỗi yêu cầu
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
    const tasks = await res.json();
    render(tasks);
  } catch (err) {
    console.error(err);
  }
}

function render(tasks) {
  list.innerHTML = '';
  emptyMsg.hidden = tasks.length > 0;

  tasks.forEach(task => {
    const li = document.createElement('li');
    if (task.done) li.classList.add('done');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = task.done;
    checkbox.addEventListener('change', async () => {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH' });
      loadTasks();
    });

    const span = document.createElement('span');
    span.textContent = task.title;

    const del = document.createElement('button');
    del.textContent = 'Xóa';
    del.className = 'delete';
    del.addEventListener('click', async () => {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      loadTasks();
    });

    li.append(checkbox, span, del);
    list.appendChild(li);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = input.value.trim();
  if (!title) return;

  await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ title })
  });

  input.value = '';
  loadTasks();
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

// Khởi động: lấy cấu hình, kết nối Supabase, theo dõi trạng thái đăng nhập
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
      list.innerHTML = '';
    }
  });
}

init();