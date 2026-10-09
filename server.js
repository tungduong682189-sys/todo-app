require('dotenv').config();

const missing = ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY']
  .filter(k => !process.env[k]);
if (missing.length) {
  console.error('Thiếu biến môi trường:', missing.join(', '));
  process.exit(1);
}

const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const COLUMNS = "id, title, done, to_char(due_date, 'YYYY-MM-DD') AS due_date";

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      done BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS user_id UUID');
  await pool.query('ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_date DATE');
  await pool.query('CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id)');
  await pool.query('ALTER TABLE tasks ENABLE ROW LEVEL SECURITY');
}

// Kiểm tra ngày: trả về null (không có ngày), chuỗi hợp lệ, hoặc undefined (sai định dạng)
function parseDue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const d = new Date(value + 'T00:00:00Z');
  if (isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return undefined;
  return value;
}

function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY
  });
});

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });
    }
    req.user = data.user;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
}

app.use('/api/tasks', requireAuth);

// Lấy danh sách việc
app.get('/api/tasks', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM tasks WHERE user_id = $1 ORDER BY id`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// Thêm việc mới
app.post('/api/tasks', async (req, res) => {
  const title = (req.body.title || '').trim().slice(0, 200);
  if (!title) {
    return res.status(400).json({ error: 'Nội dung không được để trống' });
  }
  const due = parseDue(req.body.due_date);
  if (due === undefined) {
    return res.status(400).json({ error: 'Ngày không hợp lệ' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, due_date, user_id) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
      [title, due, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// Sửa tên và hạn chót
app.put('/api/tasks/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Mã việc không hợp lệ' });

  const title = (req.body.title || '').trim().slice(0, 200);
  if (!title) {
    return res.status(400).json({ error: 'Nội dung không được để trống' });
  }
  const due = parseDue(req.body.due_date);
  if (due === undefined) {
    return res.status(400).json({ error: 'Ngày không hợp lệ' });
  }
  try {
    const result = await pool.query(
      `UPDATE tasks SET title = $1, due_date = $2
       WHERE id = $3 AND user_id = $4 RETURNING ${COLUMNS}`,
      [title, due, id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// Đảo trạng thái hoàn thành
app.patch('/api/tasks/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Mã việc không hợp lệ' });
  try {
    const result = await pool.query(
      `UPDATE tasks SET done = NOT done WHERE id = $1 AND user_id = $2 RETURNING ${COLUMNS}`,
      [id, req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// Xóa việc
app.delete('/api/tasks/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Mã việc không hợp lệ' });
  try {
    await pool.query('DELETE FROM tasks WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Máy chủ chạy tại http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Không kết nối được database:', err.message);
    process.exit(1);
  });