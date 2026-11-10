import http from 'node:http';

export const ORDER_FIELDS = ['customer', 'email', 'product', 'qty'];
export const TABLE_FIELDS = ['id', ...ORDER_FIELDS];
export const PRODUCTS = ['Standing desk', 'Monitor arm', 'Desk lamp', 'Office chair', 'Cable tray'];
export const DEMO_USER = 'demo';
export const DEMO_PASS = 'demo-pass';

const SESSION = 'sid=demo-session';
const PAGE_SIZE = 10;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => '&#' + char.charCodeAt(0) + ';');
}

function page(title, body) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title} | Local Orders</title>
<style>
  body { font: 16px system-ui, sans-serif; margin: 0; background: #f4f6fa; color: #18243a }
  header { background: #172844; color: white; padding: 16px 28px; font-weight: 700 }
  main { padding: 16px 28px 28px; max-width: 960px; margin: auto }
  form { display: grid; gap: 12px; max-width: 380px }
  label { display: grid; gap: 5px }
  input, select, button { font: inherit; padding: 9px 11px; border: 1px solid #aebbd0; border-radius: 6px }
  button { background: #1f539e; color: white; font-weight: 600; cursor: pointer }
  a { color: #184887; margin-right: 12px }
  table { border-collapse: collapse; width: 100%; background: white }
  td, th { padding: 8px 12px; border-bottom: 1px solid #dce3ee; text-align: left }
  th { background: #e8eef8 }
  .message { padding: 12px 14px; border-radius: 6px; background: #e3f5ea; color: #16552e }
  .error { background: #fce8e8; color: #8a1c1c }
</style></head>
<body><header>Local Orders Demo</header><main>${body}</main></body></html>`;
}

function send(res, status, html = '', headers = {}) {
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', ...headers });
  res.end(html);
}

async function readForm(req) {
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) body += chunk;
  return new URLSearchParams(body);
}

export async function startSite({ port = 0, failFirstPosts = 1 } = {}) {
  const orders = Array.from({ length: 18 }, (_, index) => {
    const id = index + 1;
    return {
      id,
      customer: 'Seed Customer ' + id,
      email: 'seed' + id + '@orders.example.com',
      product: ['Desk lamp', 'Monitor arm', 'Cable tray'][index % 3],
      qty: (index % 5) + 1,
    };
  });
  let failuresLeft = failFirstPosts;

  async function handle(req, res) {
    const url = new URL(req.url, 'http://127.0.0.1');
    const route = url.pathname;
    if (route === '/login' && req.method === 'POST') {
      const form = await readForm(req);
      if (form.get('user') === DEMO_USER && form.get('pass') === DEMO_PASS) {
        return send(res, 303, '', {
          location: '/orders',
          'set-cookie': SESSION + '; HttpOnly; SameSite=Strict; Path=/',
        });
      }
      return send(res, 401, page('Sign-in failed', '<p id="login-error" class="message error">Wrong user or password</p>'));
    }
    if (route === '/login') {
      return send(res, 200, page('Sign in', `<h1>Sign in</h1><form method="post" action="/login">
<label>User<input name="user" required></label>
<label>Password<input name="pass" type="password" required></label>
<button>Sign in</button></form>`));
    }
    if (!req.headers.cookie?.split(/;\s*/).includes(SESSION)) {
      return send(res, 303, '', { location: '/login' });
    }

    if (route === '/orders/new' && req.method === 'POST') {
      const form = await readForm(req);
      const order = {
        id: orders.length + 1,
        customer: form.get('customer'),
        email: form.get('email'),
        product: form.get('product'),
        qty: Number(form.get('qty')),
      };
      if (!order.customer?.trim() || !order.email || !PRODUCTS.includes(order.product)
          || !Number.isSafeInteger(order.qty) || order.qty < 1) {
        return send(res, 422, page('Order rejected', '<p class="message error">Invalid order fields</p>'));
      }
      orders.push(order);
      return send(res, 200, page('Order saved', `
<p id="saved" data-order-id="${order.id}" class="message">Order #${order.id} saved for ${escapeHtml(order.customer)}</p>
<nav><a href="/orders/new">New order</a><a href="/orders">All orders</a></nav>`));
    }
    if (route === '/orders/new') {
      return send(res, 200, page('New order', `<h1>New order</h1><form method="post" action="/orders/new">
<label>Customer<input name="customer" required></label>
<label>Email<input name="email" type="email" required></label>
<label>Product<select name="product">${PRODUCTS.map((product) => '<option>' + escapeHtml(product) + '</option>').join('')}</select></label>
<label>Quantity<input name="qty" type="number" min="1" value="1" required></label>
<button>Save order</button></form>`));
    }
    if (route === '/orders') {
      const pages = Math.ceil(orders.length / PAGE_SIZE);
      const requested = Number(url.searchParams.get('page')) || 1;
      if (!Number.isInteger(requested) || requested < 1 || requested > pages) {
        return send(res, 404, page('Page unavailable', '<p class="message error">Order page does not exist</p>'));
      }
      const rows = orders.slice((requested - 1) * PAGE_SIZE, requested * PAGE_SIZE)
        .map((order) => '<tr>' + TABLE_FIELDS.map((field) => '<td>' + escapeHtml(order[field]) + '</td>').join('') + '</tr>')
        .join('');
      const next = requested < pages ? `<a rel="next" href="/orders?page=${requested + 1}">Next page</a>` : '';
      return send(res, 200, page('Orders', `<h1>Orders</h1><nav><a href="/orders/new">New order</a></nav>
<p>Page ${requested} of ${pages} · ${orders.length} orders</p>
<table><thead><tr><th>ID</th><th>Customer</th><th>Email</th><th>Product</th><th>Qty</th></tr></thead>
<tbody>${rows}</tbody></table><p>${next}</p>`));
    }
    return send(res, 404, page('Page unavailable', '<p class="message error">Page does not exist</p>'));
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (res.headersSent) res.destroy();
      else send(res, 500, page('Server error', '<p class="message error">HTTP 500. Server error.</p>'));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, orders, url: 'http://127.0.0.1:' + server.address().port };
}
