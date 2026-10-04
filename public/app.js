const form = document.getElementById('task-form');
const input = document.getElementById('task-input');
const list = document.getElementById('task-list');
const emptyMsg = document.getElementById('empty-msg');

async function loadTasks() {
  const res = await fetch('/api/tasks');
  const tasks = await res.json();
  render(tasks);
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
      await fetch(`/api/tasks/${task.id}`, { method: 'PATCH' });
      loadTasks();
    });

    const span = document.createElement('span');
    span.textContent = task.title;

    const del = document.createElement('button');
    del.textContent = 'Xóa';
    del.className = 'delete';
    del.addEventListener('click', async () => {
      await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
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

  await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title })
  });

  input.value = '';
  loadTasks();
});

loadTasks();