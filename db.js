const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, 'fiambreria.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'vendedor',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE,
      barcode TEXT,
      name TEXT NOT NULL,
      category_id INTEGER REFERENCES categories(id),
      unit TEXT NOT NULL DEFAULT 'kg',
      cost REAL NOT NULL DEFAULT 0,
      price REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      min_stock REAL NOT NULL DEFAULT 0,
      is_production INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cuit TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      balance REAL NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      cuit TEXT,
      phone TEXT,
      email TEXT,
      address TEXT,
      notes TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER REFERENCES clients(id),
      user_id INTEGER REFERENCES users(id),
      date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      subtotal REAL NOT NULL DEFAULT 0,
      discount REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'efectivo',
      status TEXT NOT NULL DEFAULT 'completada',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      qty REAL NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER REFERENCES suppliers(id),
      date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      total REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'recibida',
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES products(id),
      qty REAL NOT NULL,
      unit_cost REAL NOT NULL,
      subtotal REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      type TEXT NOT NULL,
      qty REAL NOT NULL,
      reference_type TEXT,
      reference_id INTEGER,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      reference_type TEXT,
      reference_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS productions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      qty REAL NOT NULL,
      date TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      notes TEXT
    );
  `);

  // Seed
  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  if (userCount === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run('admin', hash, 'Administrador', 'admin');
    
    const cats = ['Fiambres', 'Quesos', 'Embutidos', 'Lácteos', 'Bebidas', 'Almacén'];
    const insertCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
    cats.forEach(c => insertCat.run(c));

    const products = [
      { sku: 'F001', name: 'Jamón cocido', cat: 1, unit: 'kg', cost: 8500, price: 12500, stock: 15, min: 5 },
      { sku: 'F002', name: 'Jamón crudo', cat: 1, unit: 'kg', cost: 15000, price: 22000, stock: 8, min: 3 },
      { sku: 'F003', name: 'Salame', cat: 1, unit: 'kg', cost: 9000, price: 14000, stock: 10, min: 4 },
      { sku: 'Q001', name: 'Queso cremoso', cat: 2, unit: 'kg', cost: 7000, price: 11000, stock: 12, min: 5 },
      { sku: 'Q002', name: 'Queso tybo', cat: 2, unit: 'kg', cost: 9500, price: 14500, stock: 6, min: 3 },
      { sku: 'Q003', name: 'Queso parmesano', cat: 2, unit: 'kg', cost: 12000, price: 18000, stock: 4, min: 2 },
      { sku: 'E001', name: 'Mortadela', cat: 3, unit: 'kg', cost: 5500, price: 8500, stock: 9, min: 4 },
      { sku: 'E002', name: 'Salchichón', cat: 3, unit: 'kg', cost: 6500, price: 10000, stock: 7, min: 3 },
      { sku: 'L001', name: 'Leche entera', cat: 4, unit: 'unidad', cost: 1200, price: 1800, stock: 24, min: 12 },
      { sku: 'L002', name: 'Yogur', cat: 4, unit: 'unidad', cost: 800, price: 1300, stock: 30, min: 10 },
      { sku: 'B001', name: 'Coca Cola 1.5L', cat: 5, unit: 'unidad', cost: 1500, price: 2300, stock: 20, min: 8 },
      { sku: 'B002', name: 'Agua mineral 500ml', cat: 5, unit: 'unidad', cost: 400, price: 800, stock: 40, min: 15 },
      { sku: 'A001', name: 'Pan lactal', cat: 6, unit: 'unidad', cost: 1800, price: 2800, stock: 15, min: 6 },
      { sku: 'A002', name: 'Aceitunas 200g', cat: 6, unit: 'unidad', cost: 900, price: 1500, stock: 18, min: 8 },
    ];
    const insertProd = db.prepare('INSERT INTO products (sku, name, category_id, unit, cost, price, stock, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    products.forEach(p => insertProd.run(p.sku, p.name, p.cat, p.unit, p.cost, p.price, p.stock, p.min));

    db.prepare('INSERT INTO clients (name, phone, email) VALUES (?, ?, ?)').run('Consumidor Final', '', '');
    db.prepare('INSERT INTO clients (name, cuit, phone, email) VALUES (?, ?, ?, ?)').run('Restaurante La Esquina', '30-12345678-9', '3511234567', 'contacto@laesquina.com');
    
    db.prepare('INSERT INTO suppliers (name, cuit, phone) VALUES (?, ?, ?)').run('Distribuidora Lácteos SA', '30-98765432-1', '3517654321');
    db.prepare('INSERT INTO suppliers (name, cuit, phone) VALUES (?, ?, ?)').run('Frigorífico Central', '30-11223344-5', '3515556666');
  }
}

init();
module.exports = db;