/* ============================================================
   TIFL LITTLE WEAR — shared script across all pages
   Cart + saved measurements use localStorage so they survive
   real page navigation (this is a multi-page site now, not a
   single-page app) — safe to swap for a server-side cart later
   if you add user accounts.
============================================================= */

/* ============================================================
   ⚙️  EDIT ME — site-wide settings
   Change a phone number, address, or WhatsApp number ONCE here
   and it updates everywhere on the site automatically. Any
   element in the HTML with data-config="phone" (etc) gets its
   text filled in from here on page load — you don't need to
   hunt through every HTML file.
============================================================= */
const CONFIG = {
  phone: '+92 42 1234 5678',
  phoneHref: 'tel:+924212345678',
  whatsappNumber: '924212345678',        // country code + number, no + or spaces
  email: 'studio@tiflwear.pk',
  address: 'Tifl Little Wear, MM Alam Road area, Gulberg III, Lahore, Pakistan.',
  hours: 'Open Tue–Sun, 11am – 8pm.',
  currency: 'PKR'
};

function applyConfig(){
  document.querySelectorAll('[data-config]').forEach(el=>{
    const key = el.dataset.config;
    if(CONFIG[key] !== undefined) el.textContent = CONFIG[key];
  });
  document.querySelectorAll('[data-config-href]').forEach(el=>{
    const key = el.dataset.configHref;
    if(CONFIG[key] !== undefined) el.setAttribute('href', CONFIG[key]);
  });
  document.querySelectorAll('.whatsapp-float').forEach(el=>{
    el.setAttribute('href', 'https://wa.me/'+CONFIG.whatsappNumber);
  });
}

window.dataLayer = window.dataLayer || [];

const Store = {
  get(key, fallback){
    try{ const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch(e){ return fallback; }
  },
  set(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){ /* storage unavailable, fail silently */ }
  }
};

/* ---------- nav ---------- */
document.getElementById('menuToggle')?.addEventListener('click', ()=>{
  document.getElementById('navTabs').classList.toggle('show');
});

/* ---------- toast ---------- */
let toastTimer;
function showToast(msg){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 2600);
}

/* ---------- cart badge (shown on every page) ---------- */
function cartCount(){
  const cart = Store.get('tifl_cart', []);
  return cart.reduce((s,c)=>s+c.qty,0);
}
function refreshCartBadge(){
  const badge = document.getElementById('cartBadge');
  if(!badge) return;
  const count = cartCount();
  badge.style.display = count>0 ? 'flex' : 'none';
  badge.textContent = count;
}
refreshCartBadge();

/* ============================================================
   PRODUCT CATALOGUE — served from the backend (MotherDuck),
   so products can be added/edited from admin.html without
   touching code. Falls back to a small offline set only if the
   API can't be reached, so the shop never renders empty.
============================================================= */
const FALLBACK_PRODUCTS = [
  {product_id:'p1', name:'Block-print Kurta Set', brand:'Chinar Kids', category:'Boys', price:3200, currency:'PKR', image_url:'#108A00'},
  {product_id:'p2', name:'Layered Cotton Frock', brand:'Bunain', category:'Girls', price:3800, currency:'PKR', image_url:'#0C6B00'}
];
let PRODUCTS = [];

async function loadProducts(){
  try{
    const res = await fetch('/api/products');
    if(!res.ok) throw new Error('bad status');
    const data = await res.json();
    PRODUCTS = data.map(normalizeProduct);
  }catch(e){
    PRODUCTS = FALLBACK_PRODUCTS.map(normalizeProduct);
  }
  return PRODUCTS;
}
function normalizeProduct(p){
  return {
    id: p.product_id || p.id,
    name: p.name,
    brand: p.brand || '',
    category: p.category || 'Other',
    price: p.price,
    currency: p.currency || 'PKR',
    image_url: p.image_url || '#108A00',
    description: p.description || ''
  };
}

/* ============================================================
   ECOMMERCE (GA4 / Google Ads enhanced ecommerce dataLayer)
   dataLayer only — no gtag.js / GA4 / Google Ads tag is loaded
   on this site. Wire up a tag (e.g. via Google Tag Manager)
   whenever you're ready to actually collect this data.
============================================================= */
function toGA4Item(p, qty){
  return {item_id:p.id, item_name:p.name, item_brand:p.brand, item_category:p.category, price:p.price, currency:'PKR', quantity:qty||1};
}
function pushEcom(eventName, extra){
  dataLayer.push({ecommerce:null});
  dataLayer.push(Object.assign({event:eventName}, extra));
}
function fireViewItemList(list, name){
  pushEcom('view_item_list', {ecommerce:{item_list_name:name, items:list.map(p=>toGA4Item(p))}});
}
function fireSelectItem(p){ pushEcom('select_item', {ecommerce:{item_list_name:'Shop', items:[toGA4Item(p)]}}); }
function fireViewItem(p){ pushEcom('view_item', {ecommerce:{currency:'PKR', value:p.price, items:[toGA4Item(p)]}}); }
function fireAddToCart(p, qty){ pushEcom('add_to_cart', {ecommerce:{currency:'PKR', value:p.price*qty, items:[toGA4Item(p, qty)]}}); }
function fireRemoveFromCart(p, qty){ pushEcom('remove_from_cart', {ecommerce:{currency:'PKR', value:p.price*qty, items:[toGA4Item(p, qty)]}}); }
function fireViewCart(cart){
  const items = cart.map(c=>toGA4Item(c, c.qty));
  const value = cart.reduce((s,c)=>s+c.price*c.qty,0);
  pushEcom('view_cart', {ecommerce:{currency:'PKR', value, items}});
}
function fireBeginCheckout(cart){
  const items = cart.map(c=>toGA4Item(c, c.qty));
  const value = cart.reduce((s,c)=>s+c.price*c.qty,0);
  pushEcom('begin_checkout', {ecommerce:{currency:'PKR', value, items}});
}
function fireAddShippingInfo(cart){
  const items = cart.map(c=>toGA4Item(c, c.qty));
  const value = cart.reduce((s,c)=>s+c.price*c.qty,0);
  pushEcom('add_shipping_info', {ecommerce:{currency:'PKR', value, shipping_tier:'Lahore standard', items}});
}
function firePurchase(cart, transactionId){
  const items = cart.map(c=>toGA4Item(c, c.qty));
  const value = cart.reduce((s,c)=>s+c.price*c.qty,0);
  pushEcom('purchase', {ecommerce:{transaction_id:transactionId, currency:'PKR', value, shipping:0, items}});
}

/* ============================================================
   SHOP + PRODUCT DETAIL
============================================================= */
function isColor(value){ return typeof value === 'string' && value.startsWith('#'); }
function garmentIllustration(color){
  return `<svg viewBox="0 0 100 100" width="46%" height="46%"><path d="M50 10 L35 22 L20 18 L10 34 L22 42 L22 90 L78 90 L78 42 L90 34 L80 18 L65 22 Z" fill="${color}" opacity="0.85"/></svg>`;
}
function productThumbHTML(p, size){
  size = size || '46%';
  if(p.image_url && !isColor(p.image_url)){
    return `<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;">`;
  }
  const color = isColor(p.image_url) ? p.image_url : '#108A00';
  return `<div style="background:${color}1A;width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 100 100" width="${size}" height="${size}"><path d="M50 10 L35 22 L20 18 L10 34 L22 42 L22 90 L78 90 L78 42 L90 34 L80 18 L65 22 Z" fill="${color}" opacity="0.85"/></svg></div>`;
}
function addToCart(p, qty=1){
  const cart = Store.get('tifl_cart', []);
  const existing = cart.find(c=>c.id===p.id);
  if(existing) existing.qty += qty; else cart.push(Object.assign({qty}, p));
  Store.set('tifl_cart', cart);
  fireAddToCart(p, qty);
  refreshCartBadge();
  updateCartUI();
  showToast(p.name+' added to cart');
}
function changeQty(id, delta){
  let cart = Store.get('tifl_cart', []);
  const item = cart.find(c=>c.id===id);
  if(!item) return;
  item.qty += delta;
  if(delta<0) fireRemoveFromCart(item, Math.abs(delta));
  if(item.qty<=0) cart = cart.filter(c=>c.id!==id);
  Store.set('tifl_cart', cart);
  refreshCartBadge();
  updateCartUI();
}
function updateCartUI(){
  const itemsEl = document.getElementById('drawerItems');
  if(!itemsEl) return;
  const cart = Store.get('tifl_cart', []);
  if(cart.length===0){
    itemsEl.innerHTML = '<div class="cart-empty">Your cart is empty — add something from the shop.</div>';
  } else {
    itemsEl.innerHTML = cart.map(c=>`
      <div class="cart-line">
        <div class="cart-thumb" style="overflow:hidden;">${productThumbHTML(c,'70%')}</div>
        <div style="flex:1;">
          <div class="ci-name">${c.name}</div>
          <div class="ci-meta">${c.brand} · PKR ${c.price.toLocaleString()}</div>
          <div class="qty-ctrl">
            <button data-qty-minus="${c.id}">−</button>
            <span>${c.qty}</span>
            <button data-qty-plus="${c.id}">+</button>
          </div>
        </div>
      </div>`).join('');
    itemsEl.querySelectorAll('[data-qty-minus]').forEach(b=>b.addEventListener('click', ()=>changeQty(b.dataset.qtyMinus,-1)));
    itemsEl.querySelectorAll('[data-qty-plus]').forEach(b=>b.addEventListener('click', ()=>changeQty(b.dataset.qtyPlus,1)));
  }
  const subtotal = cart.reduce((s,c)=>s+c.price*c.qty,0);
  const subEl = document.getElementById('cartSubtotal'); if(subEl) subEl.textContent = 'PKR '+subtotal.toLocaleString();
  const coEl = document.getElementById('coTotal'); if(coEl) coEl.textContent = 'PKR '+subtotal.toLocaleString();
}

function renderProducts(cat){
  const grid = document.getElementById('productGrid');
  if(!grid) return;
  grid.innerHTML = '';
  const list = (cat==='All') ? PRODUCTS : PRODUCTS.filter(p=>p.category===cat);
  if(list.length===0){
    grid.innerHTML = '<p style="color:var(--ink-soft);grid-column:1/-1;">No products in this category yet.</p>';
    return;
  }
  list.forEach(p=>{
    const card = document.createElement('div');
    card.className = 'p-card';
    card.innerHTML = `
      <div class="p-thumb">
        <span class="brand-tag">${p.brand}</span>
        ${productThumbHTML(p)}
      </div>
      <div class="p-info">
        <div class="pname">${p.name}</div>
        <div class="pcat">${p.category}</div>
        <div class="prow">
          <span class="price">PKR ${p.price.toLocaleString()}</span>
          <button class="add-btn" aria-label="Add ${p.name} to cart" data-add="${p.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>`;
    card.addEventListener('click', ()=>{
      fireSelectItem(p);
      window.location.href = 'product.html?id='+encodeURIComponent(p.id);
    });
    card.querySelector('[data-add]').addEventListener('click', (e)=>{ e.stopPropagation(); addToCart(p); });
    grid.appendChild(card);
  });
}

async function initShopPage(){
  if(!document.getElementById('productGrid')) return;
  await loadProducts();
  renderProducts('All');
  fireViewItemList(PRODUCTS, 'Shop — All products');
  document.querySelectorAll('#chipRow .chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      document.querySelectorAll('#chipRow .chip').forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
      renderProducts(chip.dataset.cat);
    });
  });
  updateCartUI();

  const overlay = document.getElementById('overlay');
  const drawer = document.getElementById('cartDrawer');
  document.getElementById('cartOpenBtn')?.addEventListener('click', (e)=>{
    e.preventDefault();
    overlay.classList.add('show'); drawer.classList.add('show');
    fireViewCart(Store.get('tifl_cart', []));
  });
  function closeDrawer(){ overlay.classList.remove('show'); drawer.classList.remove('show'); }
  document.getElementById('drawerCloseBtn')?.addEventListener('click', closeDrawer);
  overlay?.addEventListener('click', ()=>{ closeDrawer(); closeCheckout(); });

  const checkoutModal = document.getElementById('checkoutModal');
  function closeCheckout(){ checkoutModal.classList.remove('show'); }
  document.getElementById('checkoutBtn')?.addEventListener('click', ()=>{
    const cart = Store.get('tifl_cart', []);
    if(cart.length===0){ showToast('Your cart is empty'); return; }
    fireBeginCheckout(cart);
    checkoutModal.classList.add('show');
  });
  document.getElementById('coCancelBtn')?.addEventListener('click', closeCheckout);
  document.getElementById('checkoutForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const cart = Store.get('tifl_cart', []);
    fireAddShippingInfo(cart);

    const subtotal = cart.reduce((s,c)=>s+c.price*c.qty,0);
    const shippingFee = 0;
    const payload = {
      customer_name: document.getElementById('coName').value,
      phone: document.getElementById('coPhone').value,
      email: document.getElementById('coEmail')?.value || null,
      address: document.getElementById('coAddress').value,
      city: document.getElementById('coCity')?.value || 'Lahore',
      payment_method: document.getElementById('coPayment')?.value || 'Cash on delivery',
      notes: document.getElementById('coNotes')?.value || null,
      items: cart.map(c=>({id:c.id, name:c.name, brand:c.brand, price:c.price, qty:c.qty})),
      subtotal, shipping_fee: shippingFee, total: subtotal+shippingFee, currency:'PKR'
    };

    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = 'Placing order…';

    let txId, placed = false;
    try{
      const res = await fetch('/api/orders', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined
      });
      if(res.ok){ const data = await res.json(); txId = data.order_id; placed = true; }
      else throw new Error('non-200');
    }catch(err){
      txId = 'TLW-ORD-'+Math.floor(100000+Math.random()*900000)+'-OFFLINE';
    }

    firePurchase(cart, txId);

    // Save order details for the thank-you page, then go there.
    try{
      sessionStorage.setItem('tifl_last_order', JSON.stringify(Object.assign({order_id: txId}, payload)));
    }catch(e){ /* storage unavailable, thank-you page will show a fallback */ }

    closeCheckout(); closeDrawer();
    Store.set('tifl_cart', []);
    refreshCartBadge(); updateCartUI();
    window.location.href = 'thank-you.html';
  });
}

/* ============================================================
   MEASUREMENTS PAGE
============================================================= */
function initMeasurementsPage(){
  const saveBtn = document.getElementById('saveMeasureBtn');
  if(!saveBtn) return;
  function collect(){
    return {
      child: document.getElementById('mChild').value || 'Unnamed',
      age: document.getElementById('mAge').value,
      chest: document.getElementById('mChest').value,
      waist: document.getElementById('mWaist').value,
      height: document.getElementById('mHeight').value,
      inseam: document.getElementById('mInseam').value
    };
  }
  saveBtn.addEventListener('click', ()=>{
    Store.set('tifl_measurements', collect());
    document.getElementById('savedNote').classList.add('show');
  });
  document.getElementById('carryToBookingBtn')?.addEventListener('click', ()=>{
    Store.set('tifl_measurements', collect());
    window.location.href = 'booking.html';
  });
}

/* ============================================================
   BOOKING PAGE
============================================================= */
function initBookingPage(){
  const form = document.getElementById('bookingForm');
  if(!form) return;

  const m = Store.get('tifl_measurements', null);
  const attachedEl = document.getElementById('attachedMeasureText');
  if(m && attachedEl){
    attachedEl.innerHTML = `<b>${m.child}</b> · chest ${m.chest||'—'}cm · waist ${m.waist||'—'}cm · height ${m.height||'—'}cm · inseam ${m.inseam||'—'}cm`;
    if(m.child && m.child!=='Unnamed') document.getElementById('bChild').value = m.child;
  }

  document.querySelectorAll('#modeGrid .mode').forEach(el=>{
    el.addEventListener('click', ()=>{
      document.querySelectorAll('#modeGrid .mode').forEach(x=>x.classList.remove('active'));
      el.classList.add('active');
    });
  });
  document.querySelectorAll('#slotGrid .slot').forEach(el=>{
    el.addEventListener('click', ()=>{
      document.querySelectorAll('#slotGrid .slot').forEach(x=>x.classList.remove('active'));
      el.classList.add('active');
    });
  });

  let bookingCounter = 1042;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const mode = document.querySelector('#modeGrid .mode.active').dataset.mode;
    const slot = document.querySelector('#slotGrid .slot.active').dataset.slot;
    const payload = {
      parent_name: document.getElementById('bParent').value,
      phone: document.getElementById('bPhone').value,
      child_name: document.getElementById('bChild').value,
      garment_type: document.getElementById('bGarment').value,
      mode, time_slot: slot,
      date: document.getElementById('bDate').value,
      notes: document.getElementById('bNotes').value,
      measurements: Store.get('tifl_measurements', null)
    };

    const btn = document.getElementById('bookSubmitBtn');
    btn.disabled = true; btn.textContent = 'Sending…';

    let ref, wasOnline = false;
    try{
      const res = await fetch('/api/bookings', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined
      });
      if(res.ok){
        const data = await res.json();
        ref = data.booking_id || ('TLW-'+(bookingCounter++));
        wasOnline = true;
      } else { throw new Error('non-200'); }
    }catch(err){
      ref = 'TLW-'+(bookingCounter++)+'-OFFLINE';
    }

    dataLayer.push({event:'generate_lead', lead_type:'booking', booking_ref:ref, garment_type:payload.garment_type, fitting_mode:mode});

    document.getElementById('confirmRef').textContent = wasOnline
      ? 'Reference '+ref+' · saved to studio database'
      : 'Reference '+ref+' · saved on this device — we will confirm by phone';
    document.getElementById('confirmCard').classList.add('show');
    btn.disabled = false; btn.textContent = 'Confirm booking';
    showToast('Booking '+ref+' received');
  });
}

/* ============================================================
   CONTACT PAGE
============================================================= */
function initContactPage(){
  const form = document.getElementById('contactForm');
  if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const payload = {
      name: document.getElementById('cName').value,
      phone: document.getElementById('cPhone').value,
      email: document.getElementById('cEmail').value,
      message: document.getElementById('cMessage').value
    };
    const btn = document.getElementById('contactSubmitBtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    let ok = false;
    try{
      const res = await fetch('/api/contact', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined
      });
      ok = res.ok;
    }catch(err){ ok = false; }

    dataLayer.push({event:'generate_lead', lead_type:'contact_message'});
    document.getElementById('contactConfirm').classList.add('show');
    document.getElementById('contactConfirm').textContent = ok
      ? "Message sent — we'll reply within a day."
      : "Saved on this device — if this keeps happening, message us directly on WhatsApp.";
    btn.disabled = false; btn.textContent = 'Send message';
    form.reset();
  });
}

/* ============================================================
   PRODUCT DETAIL PAGE (product.html?id=...)
============================================================= */
async function initProductPage(){
  const root = document.getElementById('productDetail');
  if(!root) return;
  const id = new URLSearchParams(window.location.search).get('id');
  const empty = document.getElementById('productEmpty');
  if(!id){ root.style.display='none'; empty.style.display='block'; return; }

  let p;
  try{
    const res = await fetch('/api/products/'+encodeURIComponent(id));
    if(!res.ok) throw new Error('not found');
    p = normalizeProduct(await res.json());
  }catch(e){
    root.style.display='none'; empty.style.display='block'; return;
  }

  document.getElementById('pdMedia').innerHTML = productThumbHTML(p, '55%');
  document.getElementById('pdBrand').textContent = p.brand;
  document.getElementById('pdName').textContent = p.name;
  document.getElementById('pdCategory').textContent = p.category;
  document.getElementById('pdPrice').textContent = p.currency+' '+p.price.toLocaleString();
  document.getElementById('pdDescription').textContent = p.description || 'A ready-to-wear piece from our partner brands, checked for fit and finish before it reaches the shop.';
  document.getElementById('pdAddBtn').addEventListener('click', ()=>{
    const qty = parseInt(document.getElementById('pdQty').value, 10) || 1;
    addToCart(p, qty);
  });

  document.title = p.name + ' — Tifl Little Wear';
  const metaDesc = document.querySelector('meta[name="description"]');
  if(metaDesc) metaDesc.setAttribute('content', p.name+' by '+p.brand+' — '+p.currency+' '+p.price+'. Ready-to-wear kidswear from Tifl Little Wear, Lahore.');

  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({
    "@context":"https://schema.org",
    "@type":"Product",
    "name": p.name,
    "brand": {"@type":"Brand","name": p.brand},
    "category": p.category,
    "description": p.description || p.name,
    "offers": {
      "@type":"Offer",
      "priceCurrency": p.currency,
      "price": p.price,
      "availability": "https://schema.org/InStock",
      "url": window.location.href
    }
  });
  document.head.appendChild(ld);

  fireViewItem(p);

  await loadProducts();
  const related = PRODUCTS.filter(x=>x.id!==p.id && x.category===p.category).slice(0,4);
  const relatedRoot = document.getElementById('pdRelated');
  if(relatedRoot && related.length){
    relatedRoot.innerHTML = related.map(r=>`
      <div class="p-card" data-id="${r.id}">
        <div class="p-thumb"><span class="brand-tag">${r.brand}</span>${productThumbHTML(r)}</div>
        <div class="p-info">
          <div class="pname">${r.name}</div>
          <div class="pcat">${r.category}</div>
          <div class="prow"><span class="price">PKR ${r.price.toLocaleString()}</span></div>
        </div>
      </div>`).join('');
    relatedRoot.querySelectorAll('.p-card').forEach(card=>{
      card.addEventListener('click', ()=>{ window.location.href = 'product.html?id='+card.dataset.id; });
    });
  }
}

/* ============================================================
   ADMIN PAGE (admin.html) — add/edit/remove products
   Protected by a shared admin key (set ADMIN_KEY in Vercel env
   vars, then enter the same value here when prompted). This is
   simple shared-secret protection, fine for a small studio team
   — not full user accounts.
============================================================= */
function initAdminPage(){
  const root = document.getElementById('adminRoot');
  if(!root) return;

  function getKey(){ return sessionStorage.getItem('tifl_admin_key') || ''; }
  function setKey(k){ try{ sessionStorage.setItem('tifl_admin_key', k); }catch(e){} }

  async function apiCall(path, method, body){
    const res = await fetch(path, {
      method,
      headers:{'Content-Type':'application/json', 'X-Admin-Key': getKey()},
      body: body ? JSON.stringify(body) : undefined
    });
    if(res.status===401){ showToast('Admin key rejected — check it and try again'); throw new Error('unauthorized'); }
    return res.json();
  }

  async function refreshList(){
    const listRoot = document.getElementById('adminProductList');
    listRoot.innerHTML = '<p style="color:var(--ink-soft);">Loading…</p>';
    let products;
    try{
      const res = await fetch('/api/products');
      if(!res.ok) throw new Error('status '+res.status);
      products = (await res.json()).map(normalizeProduct);
    }catch(e){
      listRoot.innerHTML = '<p style="color:var(--primary-dark);">Could not load products from the server ('+e.message+'). Check that MOTHERDUCK_TOKEN is set in Vercel and try refreshing.</p>';
      return;
    }
    listRoot.innerHTML = products.map(p=>`
      <div class="admin-row" data-id="${p.id}">
        <div class="admin-row-thumb">${productThumbHTML(p,'70%')}</div>
        <div class="admin-row-info">
          <div class="admin-row-name">${p.name}</div>
          <div class="admin-row-meta">${p.brand} · ${p.category} · ${p.currency} ${p.price.toLocaleString()}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-edit="${p.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-del="${p.id}">Delete</button>
      </div>`).join('') || '<p style="color:var(--ink-soft);">No products yet — add your first one above.</p>';

    listRoot.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', ()=>{
      const p = products.find(x=>x.id===b.dataset.edit);
      fillForm(p);
    }));
    listRoot.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('Delete this product?')) return;
      try{ await apiCall('/api/products/'+b.dataset.del, 'DELETE'); showToast('Deleted'); refreshList(); }
      catch(e){}
    }));
  }

  function fillForm(p){
    document.getElementById('apEditingId').value = p.id;
    document.getElementById('apName').value = p.name;
    document.getElementById('apBrand').value = p.brand;
    document.getElementById('apCategory').value = p.category;
    document.getElementById('apPrice').value = p.price;
    document.getElementById('apImage').value = isColor(p.image_url) ? '' : p.image_url;
    document.getElementById('apColor').value = isColor(p.image_url) ? p.image_url : '#108A00';
    document.getElementById('apDescription').value = p.description;
    document.getElementById('apFormTitle').textContent = 'Editing: '+p.name;
  }
  function resetForm(){
    document.getElementById('productForm').reset();
    document.getElementById('apEditingId').value = '';
    document.getElementById('apFormTitle').textContent = 'Add a new product';
  }

  document.getElementById('adminUnlockBtn')?.addEventListener('click', ()=>{
    const key = document.getElementById('adminKeyInput').value.trim();
    if(!key){ showToast('Enter your admin key'); return; }
    setKey(key);
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    refreshList();
  });

  document.getElementById('productForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const editingId = document.getElementById('apEditingId').value;
    const imageUrl = document.getElementById('apImage').value.trim() || document.getElementById('apColor').value;
    const payload = {
      name: document.getElementById('apName').value,
      brand: document.getElementById('apBrand').value,
      category: document.getElementById('apCategory').value,
      price: parseFloat(document.getElementById('apPrice').value),
      currency: 'PKR',
      image_url: imageUrl,
      description: document.getElementById('apDescription').value,
      active: true
    };
    try{
      if(editingId) await apiCall('/api/products/'+editingId, 'PUT', payload);
      else await apiCall('/api/products', 'POST', payload);
      showToast('Saved');
      resetForm();
      refreshList();
    }catch(e){ /* apiCall already toasts on 401 */ }
  });
  document.getElementById('apCancelEdit')?.addEventListener('click', resetForm);

  if(getKey()){
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    refreshList();
  }
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  applyConfig();
  initShopPage();
  initMeasurementsPage();
  initBookingPage();
  initContactPage();
  initProductPage();
  initAdminPage();
});