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
  // Bảng việc (giữ nguyên các cột cũ)
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

  // Bảng thư mục
  await pool.query(`
    CREATE TABLE IF NOT EXISTS folders (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      user_id UUID NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES folders(id) ON DELETE CASCADE
  `);

  // Gom các việc cũ (chưa có thư mục) vào thư mục "Chưa phân loại"
  await pool.query(`
    INSERT INTO folders (name, user_id)
    SELECT DISTINCT 'Chưa phân loại', user_id FROM tasks
    WHERE folder_id IS NULL AND user_id IS NOT NULL
  `);
  await pool.query(`
    UPDATE tasks t
    SET folder_id = (
      SELECT f.id FROM folders f
      WHERE f.user_id = t.user_id AND f.name = 'Chưa phân loại'
      ORDER BY f.id LIMIT 1
    )
    WHERE t.folder_id IS NULL AND t.user_id IS NOT NULL
  `);

  await pool.query('CREATE INDEX IF NOT EXISTS tasks_user_id_idx ON tasks (user_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS tasks_folder_id_idx ON tasks (folder_id)');
  await pool.query('CREATE INDEX IF NOT EXISTS folders_user_id_idx ON folders (user_id)');
  await pool.query('ALTER TABLE tasks ENABLE ROW LEVEL SECURITY');
  await pool.query('ALTER TABLE folders ENABLE ROW LEVEL SECURITY');
}

// Kiểm tra ngày: null (không có ngày), chuỗi hợp lệ, hoặc undefined (sai định dạng)
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

// Kiểm tra máy chủ và database còn sống không
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
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
app.use('/api/folders', requireAuth);

// ===== THƯ MỤC =====

// Lấy danh sách thư mục kèm số việc
app.get('/api/folders', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT f.id, f.name,
              (COUNT(t.id) FILTER (WHERE t.done = false))::int AS open_count,
              COUNT(t.id)::int AS total
       FROM folders f
       LEFT JOIN tasks t ON t.folder_id = f.id
       WHERE f.user_id = $1
       GROUP BY f.id
       ORDER BY f.id`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// Tạo thư mục
app.post('/api/folders', async (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 100);
  if (!name) {
    return res.status(400).json({ error: 'Tên thư mục không được để trống' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO folders (name, user_id) VALUES ($1, $2) RETURNING id, name',
      [name, req.user.id]
    );
    res.status(201).json({ ...result.rows[0], open_count: 0, total: 0 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// Đổi tên thư mục
app.put('/api/folders/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Mã thư mục không hợp lệ' });
  const name = (req.body.name || '').trim().slice(0, 100);
  if (!name) {
    return res.status(400).json({ error: 'Tên thư mục không được để trống' });
  }
  try {
    const result = await pool.query(
      'UPDATE folders SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id, name',
      [name, id, req.user.id]
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

// Xóa thư mục (các việc bên trong bị xóa theo)
app.delete('/api/folders/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Mã thư mục không hợp lệ' });
  try {
    await pool.query('DELETE FROM folders WHERE id = $1 AND user_id = $2', [id, req.user.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// ===== VIỆC =====

// Lấy danh sách việc trong một thư mục
app.get('/api/tasks', async (req, res) => {
  const folderId = parseId(req.query.folder_id);
  if (!folderId) return res.status(400).json({ error: 'Thiếu mã thư mục' });
  try {
    const result = await pool.query(
      `SELECT ${COLUMNS} FROM tasks
       WHERE user_id = $1 AND folder_id = $2 ORDER BY id`,
      [req.user.id, folderId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi máy chủ' });
  }
});

// Thêm việc vào thư mục (chỉ thêm được vào thư mục của chính mình)
app.post('/api/tasks', async (req, res) => {
  const title = (req.body.title || '').trim().slice(0, 200);
  if (!title) {
    return res.status(400).json({ error: 'Nội dung không được để trống' });
  }
  const folderId = parseId(req.body.folder_id);
  if (!folderId) return res.status(400).json({ error: 'Thiếu mã thư mục' });
  const due = parseDue(req.body.due_date);
  if (due === undefined) {
    return res.status(400).json({ error: 'Ngày không hợp lệ' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO tasks (title, due_date, user_id, folder_id)
       SELECT $1, $2, $3, f.id FROM folders f WHERE f.id = $4 AND f.user_id = $3
       RETURNING ${COLUMNS}`,
      [title, due, req.user.id, folderId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Không tìm thấy thư mục' });
    }
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