// ===== Utilities =====
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const fmtARS = (n) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(n || 0);
const fmtDate = (d) => new Date(d).toLocaleString('es-AR', { timeZone: 'America/Argentina/Cordoba', dateStyle: 'short', timeStyle: 'short' });
const fmtDateOnly = (d) => new Date(d).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Cordoba' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

function toast(msg, type = 'success') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function confirmDialog(msg) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" style="max-width:400px">
        <div class="modal-header"><h3>Confirmar</h3></div>
        <div class="modal-body"><p>${esc(msg)}</p></div>
        <div class="modal-footer">
          <button class="btn btn-secondary" data-act="no">Cancelar</button>
          <button class="btn btn-danger" data-act="yes">Confirmar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      const act = e.target.dataset.act;
      if (act) { overlay.remove(); resolve(act === 'yes'); }
      else if (e.target === overlay) { overlay.remove(); resolve(false); }
    });
  });
}

function openModal(title, bodyHTML, footerHTML = '') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>${esc(title)}</h3><button class="modal-close">&times;</button></div>
      <div class="modal-body">${bodyHTML}</div>
      ${footerHTML ? `<div class="modal-footer">${footerHTML}</div>` : ''}
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('.modal-close').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  return { overlay, close };
}

// ===== State =====
let state = {
  user: null,
  view: 'dashboard',
  products: [],
  clients: [],
  suppliers: [],
  categories: [],
  cart: [],
};

// ===== Auth =====
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    const data = await api('/login', { method: 'POST', body: {
      username: $('#login-user').value,
      password: $('#login-pass').value,
    }});
    state.user = data.user;
    await startApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/logout', { method: 'POST' });
  location.reload();
});

async function startApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  $('#user-name').textContent = state.user.name;
  $('#user-role').textContent = state.user.role;
  $('#user-avatar').textContent = state.user.name.charAt(0).toUpperCase();
  if (state.user.role !== 'admin') {
    $$('.nav-item[data-view="users"]').forEach(el => el.style.display = 'none');
  }
  await loadReferenceData();
  navigate('dashboard');
}

async function loadReferenceData() {
  const [products, clients, suppliers, categories] = await Promise.all([
    api('/products'), api('/clients'), api('/suppliers'), api('/categories'),
  ]);
  state.products = products;
  state.clients = clients;
  state.suppliers = suppliers;
  state.categories = categories;
}

// ===== Navigation =====
$$('.nav-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    navigate(el.dataset.view);
  });
});

$('#menu-toggle').addEventListener('click', () => {
  $('.sidebar').classList.toggle('open');
});

const viewTitles = {
  dashboard: 'Dashboard', pos: 'Punto de Venta', sales: 'Ventas',
  products: 'Productos', inventory: 'Inventario', purchases: 'Compras',
  clients: 'Clientes', suppliers: 'Proveedores', production: 'Producción',
  cash: 'Caja', users: 'Usuarios',
};

async function navigate(view) {
  state.view = view;
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === view));
  $('#view-title').textContent = viewTitles[view] || view;
  $('.sidebar').classList.remove('open');
  const content = $('#view-content');
  content.innerHTML = '<div class="text-muted">Cargando...</div>';
  try {
    await views[view](content);
  } catch (err) {
    content.innerHTML = `<div class="card text-danger">Error: ${esc(err.message)}</div>`;
  }
}

// ===== Views =====
const views = {};

views.dashboard = async (el) => {
  const d = await api('/dashboard');
  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card success">
        <div class="stat-label">Ventas de hoy</div>
        <div class="stat-value">${fmtARS(d.todaySales.total)}</div>
        <div class="stat-sub">${d.todaySales.count} operaciones</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Ventas del mes</div>
        <div class="stat-value">${fmtARS(d.monthSales.total)}</div>
        <div class="stat-sub">${d.monthSales.count} operaciones</div>
      </div>
      <div class="stat-card ${d.lowStock.count > 0 ? 'warning' : ''}">
        <div class="stat-label">Productos con stock bajo</div>
        <div class="stat-value">${d.lowStock.count}</div>
        <div class="stat-sub">de ${d.totalProducts.count} productos</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Clientes activos</div>
        <div class="stat-value">${d.totalClients.count}</div>
        <div class="stat-sub">registrados</div>
      </div>
    </div>
    <div class="dashboard-grid">
      <div class="card">
        <div class="card-header"><h3>Últimas ventas</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Fecha</th><th>Cliente</th><th class="text-right">Total</th></tr></thead>
            <tbody>
              ${d.recentSales.length ? d.recentSales.map(s => `
                <tr>
                  <td>${s.id}</td>
                  <td>${fmtDate(s.date)}</td>
                  <td>${esc(s.client_name || 'Consumidor Final')}</td>
                  <td class="text-right fw-bold">${fmtARS(s.total)}</td>
                </tr>`).join('') : '<tr><td colspan="4" class="text-center text-muted">Sin ventas</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>Productos más vendidos (mes)</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Producto</th><th class="text-right">Cantidad</th><th class="text-right">Total</th></tr></thead>
            <tbody>
              ${d.topProducts.length ? d.topProducts.map(p => `
                <tr>
                  <td>${esc(p.name)}</td>
                  <td class="text-right">${p.qty}</td>
                  <td class="text-right fw-bold">${fmtARS(p.total)}</td>
                </tr>`).join('') : '<tr><td colspan="3" class="text-center text-muted">Sin datos</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    ${d.lowStockList.length ? `
    <div class="card mt-16">
      <div class="card-header"><h3>⚠️ Productos con stock bajo</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Producto</th><th class="text-right">Stock actual</th><th class="text-right">Stock mínimo</th><th>Unidad</th></tr></thead>
          <tbody>
            ${d.lowStockList.map(p => `
              <tr>
                <td>${esc(p.name)}</td>
                <td class="text-right text-danger fw-bold">${p.stock}</td>
                <td class="text-right">${p.min_stock}</td>
                <td>${esc(p.unit)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}
  `;
};

views.pos = async (el) => {
  await loadReferenceData();
  state.cart = [];

  el.innerHTML = `
    <div class="pos-layout">
      <div class="pos-products card">
        <div class="toolbar">
          <input type="text" id="pos-search" placeholder="Buscar producto por nombre, código o código de barras...">
          <select id="pos-category">
            <option value="">Todas las categorías</option>
            ${state.categories.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="pos-grid" id="pos-grid"></div>
      </div>

      <div class="pos-cart">
        <div class="pos-cart-header">
          <h3>🛒 Carrito</h3>
          <button class="btn btn-sm btn-secondary" id="pos-clear">Vaciar</button>
        </div>
        <div class="pos-cart-items" id="pos-cart-items"></div>
        <div class="pos-cart-footer">
          <div class="form-group mb-16">
            <label>Cliente</label>
            <select id="pos-client">
              <option value="">Consumidor Final</option>
              ${state.clients.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="form-group mb-16">
            <label>Método de pago</label>
            <select id="pos-payment">
              <option value="efectivo">Efectivo</option>
              <option value="debito">Débito</option>
              <option value="credito">Crédito</option>
              <option value="transferencia">Transferencia</option>
              <option value="cuenta_corriente">Cuenta corriente</option>
            </select>
          </div>
          <div class="form-group mb-16">
            <label>Descuento ($)</label>
            <input type="number" id="pos-discount" value="0" min="0" step="0.01">
          </div>
          <div class="cart-total-row"><span>Subtotal</span><span id="pos-subtotal">$0,00</span></div>
          <div class="cart-total-row"><span>Descuento</span><span id="pos-discount-view">-$0,00</span></div>
          <div class="cart-total-row total"><span>Total</span><span id="pos-total">$0,00</span></div>
          <button class="btn btn-primary btn-block btn-lg mt-16" id="pos-checkout">Cobrar</button>
        </div>
      </div>
    </div>`;

  const grid = $('#pos-grid');
  const cartItems = $('#pos-cart-items');

  // --- Render de productos ---
  function renderProducts() {
    const q = ($('#pos-search').value || '').toLowerCase().trim();
    const cat = $('#pos-category').value;
    const list = state.products.filter(p => {
      if (cat && String(p.category_id) !== cat) return false;
      if (!q) return true;
      return (p.name || '').toLowerCase().includes(q)
        || (p.code || '').toLowerCase().includes(q)
        || (p.barcode || '').toLowerCase().includes(q);
    });

    if (!list.length) {
      grid.innerHTML = '<div class="text-muted text-center" style="grid-column:1/-1;padding:24px">Sin productos</div>';
      return;
    }
    grid.innerHTML = list.map(p => `
      <div class="pos-product" data-id="${p.id}">
        <div class="pos-product-name">${esc(p.name)}</div>
        <div class="pos-product-price">${fmtARS(p.price)}</div>
        <div class="pos-product-stock ${p.stock <= 0 ? 'text-danger' : ''}">
          Stock: ${p.stock} ${esc(p.unit || '')}
        </div>
      </div>`).join('');
  }

  // --- Agregar al carrito ---
  function addToCart(productId) {
    const p = state.products.find(x => x.id === productId);
    if (!p) return;
    if (p.stock <= 0) { toast('Sin stock disponible', 'error'); return; }

    const item = state.cart.find(i => i.product_id === productId);
    if (item) {
      if (item.qty + 1 > p.stock) { toast('No hay más stock', 'error'); return; }
      item.qty++;
    } else {
      state.cart.push({ product_id: p.id, name: p.name, price: p.price, qty: 1, unit: p.unit });
    }
    renderCart();
  }

  // --- Render del carrito + totales ---
  function renderCart() {
    if (!state.cart.length) {
      cartItems.innerHTML = '<div class="text-muted text-center" style="padding:24px">Carrito vacío</div>';
    } else {
      cartItems.innerHTML = state.cart.map((i, idx) => `
        <div class="cart-item">
          <div class="cart-item-info">
            <div class="cart-item-name">${esc(i.name)}</div>
            <div class="cart-item-price">${fmtARS(i.price)} x ${i.qty}</div>
          </div>
          <div class="cart-item-controls">
            <button class="btn btn-sm btn-secondary" data-act="dec" data-idx="${idx}">−</button>
            <span>${i.qty}</span>
            <button class="btn btn-sm btn-secondary" data-act="inc" data-idx="${idx}">+</button>
            <button class="btn btn-sm btn-danger" data-act="del" data-idx="${idx}">✕</button>
          </div>
        </div>`).join('');
    }

    const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
    const discount = Math.max(0, parseFloat($('#pos-discount').value) || 0);
    const total = Math.max(0, subtotal - discount);

    $('#pos-subtotal').textContent = fmtARS(subtotal);
    $('#pos-discount-view').textContent = '-' + fmtARS(discount);
    $('#pos-total').textContent = fmtARS(total);
  }

  // --- Eventos ---
  $('#pos-search').addEventListener('input', renderProducts);
  $('#pos-category').addEventListener('change', renderProducts);

  grid.addEventListener('click', e => {
    const card = e.target.closest('.pos-product');
    if (card) addToCart(Number(card.dataset.id));
  });

  cartItems.addEventListener('click', e => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const idx = Number(btn.dataset.idx);
    const item = state.cart[idx];
    if (!item) return;

    if (btn.dataset.act === 'inc') {
      const p = state.products.find(x => x.id === item.product_id);
      if (p && item.qty + 1 > p.stock) { toast('No hay más stock', 'error'); return; }
      item.qty++;
    } else if (btn.dataset.act === 'dec') {
      item.qty--;
      if (item.qty <= 0) state.cart.splice(idx, 1);
    } else if (btn.dataset.act === 'del') {
      state.cart.splice(idx, 1);
    }
    renderCart();
  });

  $('#pos-discount').addEventListener('input', renderCart);

  $('#pos-clear').addEventListener('click', async () => {
    if (!state.cart.length) return;
    if (await confirmDialog('¿Vaciar el carrito?')) {
      state.cart = [];
      renderCart();
    }
  });

  $('#pos-checkout').addEventListener('click', async () => {
    if (!state.cart.length) { toast('El carrito está vacío', 'error'); return; }

    const subtotal = state.cart.reduce((s, i) => s + i.price * i.qty, 0);
    const discount = Math.max(0, parseFloat($('#pos-discount').value) || 0);
    const total = Math.max(0, subtotal - discount);

    if (!(await confirmDialog(`¿Confirmar venta por ${fmtARS(total)}?`))) return;

    try {
      const sale = await api('/sales', {
        method: 'POST',
        body: {
          client_id: $('#pos-client').value ? Number($('#pos-client').value) : null,
          payment_method: $('#pos-payment').value,
          discount,
          items: state.cart.map(i => ({ product_id: i.product_id, qty: i.qty, price: i.price })),
        },
      });
      toast(`Venta #${sale.id} registrada correctamente`);
      state.cart = [];
      $('#pos-discount').value = '0';
      await loadReferenceData(); // refresca stock
      renderProducts();
      renderCart();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  renderProducts();
  renderCart();
};