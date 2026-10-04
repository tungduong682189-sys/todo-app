const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'tasks.json');

app.use(express.json());
app.use(express.static('public'));

// Đọc và ghi dữ liệu
function readTasks() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeTasks(tasks) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(tasks, null, 2));
}

// Lấy danh sách việc
app.get('/api/tasks', (req, res) => {
  res.json(readTasks());
});

// Thêm việc mới
app.post('/api/tasks', (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) {
    return res.status(400).json({ error: 'Nội dung không được để trống' });
  }
  const tasks = readTasks();
  const task = { id: Date.now(), title: title.slice(0, 200), done: false };
  tasks.push(task);
  writeTasks(tasks);
  res.status(201).json(task);
});

// Đánh dấu hoàn thành / bỏ hoàn thành
app.patch('/api/tasks/:id', (req, res) => {
  const tasks = readTasks();
  const task = tasks.find(t => t.id === Number(req.params.id));
  if (!task) return res.status(404).json({ error: 'Không tìm thấy' });
  task.done = !task.done;
  writeTasks(tasks);
  res.json(task);
});

// Xóa việc
app.delete('/api/tasks/:id', (req, res) => {
  const tasks = readTasks().filter(t => t.id !== Number(req.params.id));
  writeTasks(tasks);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Máy chủ chạy tại http://localhost:${PORT}`);
});