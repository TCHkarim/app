const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// Sessions in memory
const sessions = new Map();

function auth(req, res, next) {
  const token = req.cookies.session;
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  req.user = sessions.get(token);
  next();
}

// Auth
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  const token = require('crypto').randomBytes(32).toString('hex');
  sessions.set(token, { id: user.id, username: user.username, name: user.name, role: user.role });
  res.cookie('session', token, { httpOnly: true, sameSite: 'lax' });
  res.json({ user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

app.post('/api/logout', (req, res) => {
  const token = req.cookies.session;
  if (token) sessions.delete(token);
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const token = req.cookies.session;
  if (!token || !sessions.has(token)) return res.status(401).json({ error: 'No autorizado' });
  res.json({ user: sessions.get(token) });
});

// Dashboard
app.get('/api/dashboard', auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const todaySales = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(total),0) as total FROM sales WHERE date(date) = date('now','localtime') AND status='completada'").get();
  const monthSales = db.prepare("SELECT COUNT(*) as count, COALESCE(SUM(total),0) as total FROM sales WHERE strftime('%Y-%m', date) = strftime('%Y-%m','now','localtime') AND status='completada'").get();
  const lowStock = db.prepare("SELECT COUNT(*) as count FROM products WHERE active=1 AND stock <= min_stock").get();
  const totalProducts = db.prepare("SELECT COUNT(*) as count FROM products WHERE active=1").get();
  const totalClients = db.prepare("SELECT COUNT(*) as count FROM clients WHERE active=1").get();
  const recentSales = db.prepare(`
    SELECT s.id, s.date, s.total, s.payment_method, c.name as client_name, u.name as user_name
    FROM sales s
    LEFT JOIN clients c ON c.id = s.client_id
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.status='completada'
    ORDER BY s.id DESC LIMIT 10
  `).all();
  const topProducts = db.prepare(`
    SELECT p.name, SUM(si.qty) as qty, SUM(si.subtotal) as total
    FROM sale_items si
    JOIN products p ON p.id = si.product_id
    JOIN sales s ON s.id = si.sale_id
    WHERE s.status='completada' AND strftime('%Y-%m', s.date) = strftime('%Y-%m','now','localtime')
    GROUP BY p.id ORDER BY total DESC LIMIT 5
  `).all();
  const lowStockList = db.prepare("SELECT id, name, stock, min_stock, unit FROM products WHERE active=1 AND stock <= min_stock ORDER BY stock ASC LIMIT 10").all();
  
  res.json({ todaySales, monthSales, lowStock, totalProducts, totalClients, recentSales, topProducts, lowStockList });
});

// Categories
app.get('/api/categories', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name').all());
});

app.post('/api/categories', auth, (req, res) => {
  const { name, description } = req.body;
  try {
    const r = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(name, description || null);
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Products
app.get('/api/products', auth, (req, res) => {
  const { q, category_id, low_stock } = req.query;
  let sql = `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1`;
  const params = [];
  if (q) { sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (category_id) { sql += ' AND p.category_id = ?'; params.push(category_id); }
  if (low_stock === '1') { sql += ' AND p.stock <= p.min_stock'; }
  sql += ' ORDER BY p.name';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/products/:id', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  res.json(p);
});

app.post('/api/products', auth, (req, res) => {
  const { sku, barcode, name, category_id, unit, cost, price, stock, min_stock, is_production } = req.body;
  try {
    const r = db.prepare(`INSERT INTO products (sku, barcode, name, category_id, unit, cost, price, stock, min_stock, is_production) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(sku || null, barcode || null, name, category_id || null, unit || 'kg', cost || 0, price || 0, stock || 0, min_stock || 0, is_production ? 1 : 0);
    if (stock > 0) {
      db.prepare('INSERT INTO stock_movements (product_id, type, qty, notes) VALUES (?, ?, ?, ?)').run(r.lastInsertRowid, 'inicial', stock, 'Stock inicial');
    }
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/products/:id', auth, (req, res) => {
  const { sku, barcode, name, category_id, unit, cost, price, min_stock, is_production } = req.body;
  try {
    db.prepare(`UPDATE products SET sku=?, barcode=?, name=?, category_id=?, unit=?, cost=?, price=?, min_stock=?, is_production=? WHERE id=?`)
      .run(sku || null, barcode || null, name, category_id || null, unit, cost, price, min_stock, is_production ? 1 : 0, req.params.id);
    res.json({ ok: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/products/:id', auth, (req, res) => {
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Stock adjust
app.post('/api/products/:id/stock', auth, (req, res) => {
  const { qty, type, notes } = req.body;
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'No encontrado' });
  const delta = type === 'ajuste' ? qty : (type === 'entrada' ? Math.abs(qty) : -Math.abs(qty));
  db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(delta, req.params.id);
  db.prepare('INSERT INTO stock_movements (product_id, type, qty, notes) VALUES (?,?,?,?)').run(req.params.id, type, delta, notes || null);
  res.json({ ok: true, stock: p.stock + delta });
});

// Clients
app.get('/api/clients', auth, (req, res) => {
  const { q } = req.query;
  let sql = 'SELECT * FROM clients WHERE active = 1';
  const params = [];
  if (q) { sql += ' AND (name LIKE ? OR cuit LIKE ? OR phone LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/clients', auth, (req, res) => {
  const { name, cuit, phone, email, address, notes } = req.body;
  const r = db.prepare('INSERT INTO clients (name, cuit, phone, email, address, notes) VALUES (?,?,?,?,?,?)').run(name, cuit || null, phone || null, email || null, address || null, notes || null);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/clients/:id', auth, (req, res) => {
  const { name, cuit, phone, email, address, notes } = req.body;
  db.prepare('UPDATE clients SET name=?, cuit=?, phone=?, email=?, address=?, notes=? WHERE id=?').run(name, cuit || null, phone || null, email || null, address || null, notes || null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/clients/:id', auth, (req, res) => {
  db.prepare('UPDATE clients SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Suppliers
app.get('/api/suppliers', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM suppliers WHERE active = 1 ORDER BY name').all());
});

app.post('/api/suppliers', auth, (req, res) => {
  const { name, cuit, phone, email, address, notes } = req.body;
  const r = db.prepare('INSERT INTO suppliers (name, cuit, phone, email, address, notes) VALUES (?,?,?,?,?,?)').run(name, cuit || null, phone || null, email || null, address || null, notes || null);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/suppliers/:id', auth, (req, res) => {
  const { name, cuit, phone, email, address, notes } = req.body;
  db.prepare('UPDATE suppliers SET name=?, cuit=?, phone=?, email=?, address=?, notes=? WHERE id=?').run(name, cuit || null, phone || null, email || null, address || null, notes || null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/suppliers/:id', auth, (req, res) => {
  db.prepare('UPDATE suppliers SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Sales (POS)
app.post('/api/sales', auth, (req, res) => {
  const { client_id, items, discount, payment_method, notes } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'La venta no tiene productos' });
  
  const tx = db.transaction(() => {
    let subtotal = 0;
    for (const it of items) {
      const p = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
      if (!p) throw new Error('Producto no encontrado');
      if (p.stock < it.qty) throw new Error(`Stock insuficiente de ${p.name}`);
      subtotal += it.qty * it.unit_price;
    }
    const disc = discount || 0;
    const total = subtotal - disc;
    const sale = db.prepare('INSERT INTO sales (client_id, user_id, subtotal, discount, total, payment_method, notes) VALUES (?,?,?,?,?,?,?)')
      .run(client_id || null, req.user.id, subtotal, disc, total, payment_method || 'efectivo', notes || null);
    const saleId = sale.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO sale_items (sale_id, product_id, qty, unit_price, subtotal) VALUES (?,?,?,?,?)');
    const updateStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    const insertMove = db.prepare('INSERT INTO stock_movements (product_id, type, qty, reference_type, reference_id) VALUES (?,?,?,?,?)');
    for (const it of items) {
      const sub = it.qty * it.unit_price;
      insertItem.run(saleId, it.product_id, it.qty, it.unit_price, sub);
      updateStock.run(it.qty, it.product_id);
      insertMove.run(it.product_id, 'venta', -it.qty, 'sale', saleId);
    }
    db.prepare('INSERT INTO cash_movements (type, amount, description, reference_type, reference_id) VALUES (?,?,?,?,?)')
      .run('ingreso', total, `Venta #${saleId}`, 'sale', saleId);
    return { id: saleId, total, subtotal, discount: disc };
  });
  
  try {
    const result = tx();
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/sales', auth, (req, res) => {
  const { from, to, q } = req.query;
  let sql = `SELECT s.*, c.name as client_name, u.name as user_name FROM sales s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = s.user_id WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND date(s.date) >= date(?)'; params.push(from); }
  if (to) { sql += ' AND date(s.date) <= date(?)'; params.push(to); }
  if (q) { sql += ' AND (s.id LIKE ? OR c.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`); }
  sql += ' ORDER BY s.id DESC LIMIT 200';
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/sales/:id', auth, (req, res) => {
  const sale = db.prepare(`SELECT s.*, c.name as client_name, u.name as user_name FROM sales s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(req.params.id);
  if (!sale) return res.status(404).json({ error: 'No encontrada' });
  const items = db.prepare(`SELECT si.*, p.name as product_name, p.unit FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ?`).all(req.params.id);
  res.json({ ...sale, items });
});

// Purchases
app.post('/api/purchases', auth, (req, res) => {
  const { supplier_id, items, notes } = req.body;
  if (!items || items.length === 0) return res.status(400).json({ error: 'La compra no tiene productos' });
  const tx = db.transaction(() => {
    let total = 0;
    for (const it of items) total += it.qty * it.unit_cost;
    const purchase = db.prepare('INSERT INTO purchases (supplier_id, total, notes) VALUES (?,?,?)').run(supplier_id || null, total, notes || null);
    const pid = purchase.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO purchase_items (purchase_id, product_id, qty, unit_cost, subtotal) VALUES (?,?,?,?,?)');
    const updateStock = db.prepare('UPDATE products SET stock = stock + ?, cost = ? WHERE id = ?');
    const insertMove = db.prepare('INSERT INTO stock_movements (product_id, type, qty, reference_type, reference_id) VALUES (?,?,?,?,?)');
    for (const it of items) {
      insertItem.run(pid, it.product_id, it.qty, it.unit_cost, it.qty * it.unit_cost);
      updateStock.run(it.qty, it.unit_cost, it.product_id);
      insertMove.run(it.product_id, 'compra', it.qty, 'purchase', pid);
    }
    db.prepare('INSERT INTO cash_movements (type, amount, description, reference_type, reference_id) VALUES (?,?,?,?,?)')
      .run('egreso', total, `Compra #${pid}`, 'purchase', pid);
    return { id: pid, total };
  });
  try { res.json(tx()); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get('/api/purchases', auth, (req, res) => {
  res.json(db.prepare(`SELECT p.*, s.name as supplier_name FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id ORDER BY p.id DESC LIMIT 100`).all());
});

// Cash / Finance
app.get('/api/cash', auth, (req, res) => {
  const movements = db.prepare('SELECT * FROM cash_movements ORDER BY id DESC LIMIT 100').all();
  const balance = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE -amount END),0) as b FROM cash_movements`).get().b;
  const today = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type='ingreso' THEN amount ELSE -amount END),0) as b FROM cash_movements WHERE date(created_at) = date('now','localtime')`).get().b;
  res.json({ movements, balance, today });
});

app.post('/api/cash', auth, (req, res) => {
  const { type, amount, description } = req.body;
  db.prepare('INSERT INTO cash_movements (type, amount, description) VALUES (?,?,?)').run(type, amount, description || null);
  res.json({ ok: true });
});

// Stock movements
app.get('/api/stock-movements', auth, (req, res) => {
  res.json(db.prepare(`SELECT sm.*, p.name as product_name FROM stock_movements sm JOIN products p ON p.id = sm.product_id ORDER BY sm.id DESC LIMIT 200`).all());
});

// Users
app.get('/api/users', auth, (req, res) => {
  res.json(db.prepare('SELECT id, username, name, role, active, created_at FROM users').all());
});

app.post('/api/users', auth, (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo administradores' });
  const { username, password, name, role } = req.body;
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?,?,?,?)').run(username, hash, name, role || 'vendedor');
    res.json({ id: r.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// Production
app.post('/api/productions', auth, (req, res) => {
  const { product_id, qty, notes } = req.body;
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO productions (product_id, qty, notes) VALUES (?,?,?)').run(product_id, qty, notes || null);
    db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(qty, product_id);
    db.prepare('INSERT INTO stock_movements (product_id, type, qty, reference_type, reference_id) VALUES (?,?,?,?,?)').run(product_id, 'produccion', qty, 'production', r.lastInsertRowid);
    return { id: r.lastInsertRowid };
  });
  res.json(tx());
});

app.get('/api/productions', auth, (req, res) => {
  res.json(db.prepare(`SELECT pr.*, p.name as product_name FROM productions pr JOIN products p ON p.id = pr.product_id ORDER BY pr.id DESC LIMIT 100`).all());
});

app.listen(PORT, () => console.log(`Fiambrería app en http://localhost:${PORT}`));