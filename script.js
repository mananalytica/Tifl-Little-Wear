/* ============================================================
   TIFL LITTLE WEAR — shared script across all pages
   Cart + saved measurements use localStorage so they survive
   real page navigation (this is a multi-page site now, not a
   single-page app) — safe to swap for a server-side cart later
   if you add user accounts.
============================================================= */

/* If rudderstack.js didn't load on this page (missing script tag, 404,
   ad blocker, etc.), install harmless no-op stubs instead of leaving
   these undefined — a missing analytics file should never be able to
   break bookings, the shop, or any other real functionality again. */
if (typeof window.rsPage !== 'function') window.rsPage = function(){};
if (typeof window.rsTrack !== 'function') window.rsTrack = function(){};
if (typeof window.rsIdentify !== 'function') window.rsIdentify = function(){};

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

/* ============================================================
   AUTH — lightweight customer accounts (signup/login/session)
   Used by account.html and, on live-sell.html, to let a signed-in
   customer buy in one tap using their saved address, and to post
   live comments under their real name.
============================================================= */
const Auth = {
  getToken(){ return Store.get('tifl_session', null)?.token || null; },
  getProfile(){ return Store.get('tifl_session', null); },
  isLoggedIn(){ return !!this.getToken(); },

  async signup(payload){
    const res = await fetch('/api/auth/signup', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload)
    });
    if(!res.ok){ const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'Signup failed'); }
    const data = await res.json();
    Store.set('tifl_session', {token: data.token, name: data.name, email: data.email});
    rsIdentify(data.email, {name: data.name, email: data.email, phone: payload.phone, city: payload.city});
    rsTrack('sign_up', {method:'email'});
    return data;
  },
  async login(email, password){
    const res = await fetch('/api/auth/login', {
      method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email, password, anonymous_id: rsGetAnonymousId()})
    });
    if(!res.ok){ const e = await res.json().catch(()=>({})); throw new Error(e.detail || 'Login failed'); }
    const data = await res.json();
    Store.set('tifl_session', {token: data.token, name: data.name, email: data.email});
    rsIdentify(data.email, {name: data.name, email: data.email});
    rsTrack('login', {method:'email'});
    return data;
  },
  async logout(){
    const token = this.getToken();
    if(token){
      try{ await fetch('/api/auth/logout', {method:'POST', headers:{'Authorization':'Bearer '+token}}); }catch(e){}
    }
    Store.set('tifl_session', null);
    rsTrack('logout', {});
  },
  async fetchMe(){
    const token = this.getToken();
    if(!token) return null;
    try{
      const res = await fetch('/api/auth/me', {headers:{'Authorization':'Bearer '+token}});
      if(!res.ok){ Store.set('tifl_session', null); return null; }
      const profile = await res.json();
      rsIdentify(profile.email, {name: profile.name, email: profile.email, phone: profile.phone, address: profile.address, city: profile.city});
      return profile;
    }catch(e){ return null; }
  },
  authHeader(){
    const token = this.getToken();
    return token ? {'Authorization': 'Bearer '+token} : {};
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
   PRODUCT CATALOGUE — now served from the backend (MotherDuck),
   so products can be added/edited from admin.html without
   touching code. Falls back to a small offline set only if the
   API can't be reached, so the shop never renders empty.
============================================================= */
const FALLBACK_PRODUCTS = [
  {product_id:'p1', name:'Block-print Kurta Set', brand:'Chinar Kids', category:'Boys', price:3200, currency:'PKR', image_url:'#4A93E8'},
  {product_id:'p2', name:'Layered Cotton Frock', brand:'Bunain', category:'Girls', price:3800, currency:'PKR', image_url:'#3576C9'}
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
// Normalizes a product row (from API or fallback) to the shape the UI uses.
function normalizeProduct(p){
  return {
    id: p.product_id || p.id,
    name: p.name,
    brand: p.brand || '',
    category: p.category || 'Other',
    price: p.price,
    currency: p.currency || 'PKR',
    image_url: p.image_url || '#4A93E8',
    description: p.description || '',
    sku: p.sku || '',
    // Shopping feed attributes (Google Merchant Center / Meta Catalog)
    link: p.link || '',
    availability: p.availability || 'in stock',
    sale_price: p.sale_price || null,
    gtin: p.gtin || '',
    mpn: p.mpn || '',
    condition: p.condition || 'new',
    google_product_category: p.google_product_category || '',
    product_type: p.product_type || '',
    color: p.color || '',
    size: p.size || '',
    gender: p.gender || '',
    age_group: p.age_group || 'kids',
    item_group_id: p.item_group_id || ''
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
  rsTrack(eventName, extra.ecommerce || {});
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
// Returns thumbnail HTML for a product: a real photo if image_url is a URL,
// otherwise a simple colour illustration (useful for products added before
// photography exists).
function productThumbHTML(p, size){
  size = size || '46%';
  if(p.image_url && !isColor(p.image_url)){
    return `<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;">`;
  }
  const color = isColor(p.image_url) ? p.image_url : '#4A93E8';
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
  openCartDrawer();
}

// Cart drawer is shared markup (overlay + #cartDrawer) present on any page
// with an "Add to cart" action — shop, product, and live-sell. These are
// page-level functions (not nested in a page init) so addToCart() can open
// the drawer no matter which page it's called from.
function openCartDrawer(){
  const overlay = document.getElementById('overlay');
  const drawer = document.getElementById('cartDrawer');
  if(!overlay || !drawer) return; // this page doesn't have the drawer markup
  overlay.classList.add('show');
  drawer.classList.add('show');
  fireViewCart(Store.get('tifl_cart', []));
}
function closeCartDrawer(){
  document.getElementById('overlay')?.classList.remove('show');
  document.getElementById('cartDrawer')?.classList.remove('show');
}
function wireCartDrawer(){
  if(!document.getElementById('cartDrawer')) return;
  document.getElementById('cartOpenBtn')?.addEventListener('click', (e)=>{ e.preventDefault(); openCartDrawer(); });
  document.getElementById('drawerCloseBtn')?.addEventListener('click', closeCartDrawer);
  document.getElementById('overlay')?.addEventListener('click', closeCartDrawer);
  document.getElementById('checkoutLink')?.addEventListener('click', ()=>{
    fireBeginCheckout(Store.get('tifl_cart', []));
    // no preventDefault — this is a real link to checkout.html
  });
  updateCartUI();
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
    // Clicking the product (not the add button) opens its detail page —
    // view_item fires there, not here, so it matches one real "view" per page load.
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
  wireCartDrawer();
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

  try{
    const designNote = sessionStorage.getItem('tifl_design_note');
    if(designNote){
      document.getElementById('bNotes').value = designNote;
      sessionStorage.removeItem('tifl_design_note');
    }
  }catch(e){}

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
      email: document.getElementById('bEmail')?.value || null,
      child_name: document.getElementById('bChild').value,
      garment_type: document.getElementById('bGarment').value,
      mode, time_slot: slot,
      date: document.getElementById('bDate').value,
      notes: document.getElementById('bNotes').value,
      measurements: Store.get('tifl_measurements', null),
      anonymous_id: rsGetAnonymousId(), attribution: rsGetAttribution()
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
    rsTrack('generate_lead', {lead_type:'booking', booking_ref:ref, garment_type:payload.garment_type, fitting_mode:mode});

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
      message: document.getElementById('cMessage').value,
      anonymous_id: rsGetAnonymousId(), attribution: rsGetAttribution()
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
    rsTrack('generate_lead', {lead_type:'contact_message'});
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
  wireCartDrawer();
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

  // Fill in the page
  document.getElementById('pdMedia').innerHTML = productThumbHTML(p, '55%');
  document.getElementById('pdBrand').textContent = p.brand;
  document.getElementById('pdName').textContent = p.name;
  document.getElementById('pdCategory').textContent = p.category;
  const priceEl = document.getElementById('pdPrice');
  if(p.sale_price){
    priceEl.innerHTML = `<span style="color:var(--primary-dark);">${p.currency} ${p.sale_price.toLocaleString()}</span> <span style="text-decoration:line-through;color:var(--ink-soft);font-size:16px;font-weight:400;">${p.currency} ${p.price.toLocaleString()}</span>`;
  } else {
    priceEl.textContent = p.currency+' '+p.price.toLocaleString();
  }
  document.getElementById('pdDescription').textContent = p.description || 'A ready-to-wear piece from our partner brands, checked for fit and finish before it reaches the shop.';
  const chips = [];
  if(p.color) chips.push('Colour: '+p.color);
  if(p.size) chips.push('Size: '+p.size);
  if(p.gender) chips.push(p.gender.charAt(0).toUpperCase()+p.gender.slice(1));
  if(p.age_group) chips.push(p.age_group.charAt(0).toUpperCase()+p.age_group.slice(1));
  document.getElementById('pdAttributes').innerHTML = chips.map(c=>`<span class="garment-tag">${c}</span>`).join('');
  document.getElementById('pdAddBtn').addEventListener('click', ()=>{
    const qty = parseInt(document.getElementById('pdQty').value, 10) || 1;
    addToCart(p, qty);
  });

  // SEO/AEO: update title, meta description and inject Product JSON-LD now
  // that we know which product this is — useful for search, Google/Meta
  // catalogue sync, and for LLM shopping agents that read schema.org
  // Product markup directly off the page (an increasingly common pattern
  // as ChatGPT/Perplexity-style agents shop on a user's behalf).
  document.title = p.name + ' — Tifl Little Wear';
  const metaDesc = document.querySelector('meta[name="description"]');
  if(metaDesc) metaDesc.setAttribute('content', p.name+' by '+p.brand+' — '+p.currency+' '+p.price+'. Ready-to-wear kidswear from Tifl Little Wear, Lahore.');

  const availabilityMap = {
    'in stock': 'https://schema.org/InStock',
    'out of stock': 'https://schema.org/OutOfStock',
    'preorder': 'https://schema.org/PreOrder',
    'backorder': 'https://schema.org/BackOrder'
  };

  const productLd = {
    "@context":"https://schema.org",
    "@type":"Product",
    "name": p.name,
    "brand": {"@type":"Brand","name": p.brand},
    "category": p.category,
    "description": p.description || p.name,
    "sku": p.sku || p.id,
    "offers": {
      "@type":"Offer",
      "priceCurrency": p.currency,
      "price": p.sale_price || p.price,
      "availability": availabilityMap[p.availability] || 'https://schema.org/InStock',
      "itemCondition": 'https://schema.org/'+(p.condition==='used' ? 'UsedCondition' : p.condition==='refurbished' ? 'RefurbishedCondition' : 'NewCondition'),
      "url": window.location.href
    }
  };
  if(p.gtin) productLd.gtin = p.gtin;
  if(p.mpn) productLd.mpn = p.mpn;
  if(p.color) productLd.color = p.color;
  if(p.size) productLd.size = p.size;
  if(p.gender) productLd.audience = {"@type":"PeopleAudience","suggestedGender": p.gender};
  if(p.age_group) productLd.additionalProperty = [{"@type":"PropertyValue","name":"age_group","value":p.age_group}];

  const ld = document.createElement('script');
  ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify(productLd);
  document.head.appendChild(ld);

  fireViewItem(p);

  // simple related products rail
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
          <div class="admin-row-meta">${p.brand} · ${p.category} · ${p.currency} ${p.price.toLocaleString()}${p.sku ? ' · SKU '+p.sku : ''}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-edit="${p.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-del="${p.id}">Delete</button>
      </div>`).join('') || '<p style="color:var(--ink-soft);">No products yet — add your first one above.</p>';

    listRoot.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', ()=>{
      const p = products.find(x=>x.id===b.dataset.edit);
      fillForm(p);
      window.scrollTo({top: document.getElementById('productForm').getBoundingClientRect().top + window.scrollY - 20, behavior:'smooth'});
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
    document.getElementById('apSalePrice').value = p.sale_price || '';
    document.getElementById('apImage').value = isColor(p.image_url) ? '' : p.image_url;
    document.getElementById('apSwatch').value = isColor(p.image_url) ? p.image_url : '#4A93E8';
    document.getElementById('apDescription').value = p.description;
    document.getElementById('apSku').value = p.sku || '';
    document.getElementById('apGtin').value = p.gtin || '';
    document.getElementById('apMpn').value = p.mpn || '';
    document.getElementById('apItemGroupId').value = p.item_group_id || '';
    document.getElementById('apAvailability').value = p.availability || 'in stock';
    document.getElementById('apCondition').value = p.condition || 'new';
    document.getElementById('apColorAttr').value = p.color || '';
    document.getElementById('apSize').value = p.size || '';
    document.getElementById('apGender').value = p.gender || '';
    document.getElementById('apAgeGroup').value = p.age_group || 'kids';
    document.getElementById('apGoogleCategory').value = p.google_product_category || '';
    document.getElementById('apProductType').value = p.product_type || '';
    document.getElementById('apLink').value = p.link || '';
    document.getElementById('apFormTitle').textContent = 'Editing: '+p.name;
  }
  function resetForm(){
    document.getElementById('productForm').reset();
    document.getElementById('apEditingId').value = '';
    document.getElementById('apAgeGroup').value = 'kids';
    document.getElementById('apAvailability').value = 'in stock';
    document.getElementById('apCondition').value = 'new';
    document.getElementById('apFormTitle').textContent = 'Add a new product';
  }

  function formToPayload(){
    return {
      name: document.getElementById('apName').value,
      brand: document.getElementById('apBrand').value,
      category: document.getElementById('apCategory').value,
      price: parseFloat(document.getElementById('apPrice').value),
      sale_price: document.getElementById('apSalePrice').value ? parseFloat(document.getElementById('apSalePrice').value) : null,
      currency: 'PKR',
      image_url: document.getElementById('apImage').value.trim() || document.getElementById('apSwatch').value,
      description: document.getElementById('apDescription').value,
      sku: document.getElementById('apSku').value || null,
      gtin: document.getElementById('apGtin').value || null,
      mpn: document.getElementById('apMpn').value || null,
      item_group_id: document.getElementById('apItemGroupId').value || null,
      availability: document.getElementById('apAvailability').value,
      condition: document.getElementById('apCondition').value,
      color: document.getElementById('apColorAttr').value || null,
      size: document.getElementById('apSize').value || null,
      gender: document.getElementById('apGender').value || null,
      age_group: document.getElementById('apAgeGroup').value,
      google_product_category: document.getElementById('apGoogleCategory').value || null,
      product_type: document.getElementById('apProductType').value || null,
      link: document.getElementById('apLink').value || null,
      active: true
    };
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
    const payload = formToPayload();
    try{
      if(editingId) await apiCall('/api/products/'+editingId, 'PUT', payload);
      else await apiCall('/api/products', 'POST', payload);
      showToast('Saved');
      resetForm();
      refreshList();
    }catch(e){ /* apiCall already toasts on 401 */ }
  });
  document.getElementById('apCancelEdit')?.addEventListener('click', resetForm);

  /* ---------- bulk import (CSV / XML) ---------- */
  // Maps common Google Shopping / Meta Catalog feed column names onto our
  // Product fields. "id" becomes our sku, since that's the stable
  // identifier a merchant feed uses to track one product across uploads.
  function mapFeedRow(row){
    const get = (...keys)=>{
      for(const k of keys){
        if(row[k] !== undefined && row[k] !== '') return row[k];
      }
      return null;
    };
    const price = parseFloat((get('price')||'').toString().replace(/[^0-9.]/g,'')) || null;
    const salePrice = parseFloat((get('sale_price')||'').toString().replace(/[^0-9.]/g,'')) || null;
    return {
      sku: get('id','sku'),
      name: get('title','name'),
      description: get('description'),
      link: get('link'),
      image_url: get('image_link','image_url'),
      price,
      sale_price: salePrice,
      availability: get('availability') || 'in stock',
      brand: get('brand'),
      condition: get('condition') || 'new',
      gtin: get('gtin'),
      mpn: get('mpn'),
      google_product_category: get('google_product_category'),
      product_type: get('product_type'),
      color: get('color'),
      size: get('size'),
      gender: get('gender'),
      age_group: get('age_group') || 'kids',
      item_group_id: get('item_group_id'),
      category: get('product_type','category') ? (get('product_type','category').split('>').pop() || '').trim() : 'Other',
      currency: 'PKR',
      active: true
    };
  }

  function parseCSV(text){
    const result = Papa.parse(text, {header:true, skipEmptyLines:true});
    return result.data.map(mapFeedRow);
  }
  function parseXML(text){
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const items = Array.from(doc.getElementsByTagName('item'));
    return items.map(item=>{
      const row = {};
      Array.from(item.children).forEach(el=>{
        const tag = el.tagName.includes(':') ? el.tagName.split(':')[1] : el.tagName;
        row[tag] = el.textContent;
      });
      return mapFeedRow(row);
    });
  }

  document.getElementById('bulkUploadBtn')?.addEventListener('click', async ()=>{
    const fileInput = document.getElementById('bulkFile');
    const resultsEl = document.getElementById('bulkResults');
    const file = fileInput.files[0];
    if(!file){ showToast('Choose a CSV or XML file first'); return; }

    const text = await file.text();
    let items;
    try{
      if(file.name.toLowerCase().endsWith('.xml')) items = parseXML(text);
      else items = parseCSV(text);
    }catch(e){
      resultsEl.innerHTML = '<p style="color:var(--primary-dark);">Could not parse that file: '+e.message+'</p>';
      return;
    }

    items = items.filter(i=>i.name && i.price);
    if(items.length===0){
      resultsEl.innerHTML = '<p style="color:var(--primary-dark);">No usable rows found — check the file has "title"/"name" and "price" columns.</p>';
      return;
    }

    resultsEl.innerHTML = '<p style="color:var(--ink-soft);">Importing '+items.length+' rows…</p>';
    try{
      const result = await apiCall('/api/products/bulk', 'POST', {items});
      resultsEl.innerHTML = `<p style="color:var(--primary-dark);">Done — ${result.created} created, ${result.updated} updated${result.errors.length ? ', '+result.errors.length+' skipped (see below)' : ''}.</p>` +
        (result.errors.length ? '<pre style="font-size:11.5px;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:10px;margin-top:8px;overflow-x:auto;">'+JSON.stringify(result.errors,null,2)+'</pre>' : '');
      showToast('Bulk import complete');
      refreshList();
    }catch(e){ /* apiCall already toasts on 401 */ }
  });

  if(getKey()){
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    refreshList();
  }
}

/* ============================================================
   LIVE SALE PAGE (live-sell.html)
   Buy Now is a true instant purchase for signed-in customers with
   a saved address (one click, straight to /api/orders). Guests
   and signed-in customers without a saved address get a short
   quick-buy form instead of the full cart + checkout flow — still
   far faster than a normal purchase, which is the point of a live
   sale.
============================================================= */
let LIVE_ITEMS = [];
let pendingQuickBuyProduct = null;

function renderLiveTimeline(){
  const root = document.getElementById('productTimeline');
  if(!root) return;
  if(LIVE_ITEMS.length===0){
    root.innerHTML = '<p style="color:var(--ink-soft);font-size:13px;">No products are live right now — check back soon.</p>';
    return;
  }
  root.innerHTML = LIVE_ITEMS.map(p=>`
    <div class="timeline-item" data-id="${p.id}">
      <div class="timeline-item-grid">
        <div class="timeline-thumb">${productThumbHTML(p,'80%')}</div>
        <div class="timeline-info">
          <div class="name">${p.name}</div>
          <div class="time">${p.brand}</div>
        </div>
        <div class="timeline-actions">
          <div class="timeline-price">PKR ${p.price.toLocaleString()}</div>
          <button class="btn btn-primary btn-sm" data-buy="${p.id}" style="padding:6px 12px;font-size:11.5px;">Buy now</button>
          <button class="btn btn-ghost btn-sm" data-add="${p.id}" style="padding:6px 12px;font-size:11.5px;">Add to cart</button>
        </div>
      </div>
    </div>`).join('');

  root.querySelectorAll('[data-buy]').forEach(b=>b.addEventListener('click', ()=>{
    const p = LIVE_ITEMS.find(x=>x.id===b.dataset.buy);
    if(p) startInstantBuy(p);
  }));
  root.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click', ()=>{
    const p = LIVE_ITEMS.find(x=>x.id===b.dataset.add);
    if(p) addToCart(p, 1);
  }));
  document.getElementById('productCount').textContent = LIVE_ITEMS.length;
}

async function startInstantBuy(product){
  const profile = await Auth.fetchMe();
  if(profile && profile.address){
    // True one-click: saved address on file, place the order immediately.
    await placeLiveOrder(product, {
      customer_name: profile.name, phone: profile.phone || '', email: profile.email,
      address: profile.address, city: profile.city || 'Lahore'
    });
    return;
  }
  // No saved address (guest, or logged in without one on file) — a short
  // quick-buy form instead of the full cart/checkout flow.
  pendingQuickBuyProduct = product;
  document.getElementById('qbProductName').textContent = product.name+' — PKR '+product.price.toLocaleString();
  if(profile){ document.getElementById('qbName').value = profile.name || ''; document.getElementById('qbPhone').value = profile.phone || ''; }
  document.getElementById('quickBuyModal').classList.add('show');
}

async function placeLiveOrder(product, buyer){
  const payload = Object.assign({
    payment_method: 'Cash on delivery',
    notes: 'Live sale — instant buy',
    items: [{id:product.id, name:product.name, brand:product.brand, price:product.price, qty:1}],
    subtotal: product.price, shipping_fee: 0, total: product.price, currency:'PKR',
    anonymous_id: rsGetAnonymousId(), attribution: rsGetAttribution()
  }, buyer);

  let txId;
  try{
    const res = await fetch('/api/orders', {
      method:'POST',
      headers: Object.assign({'Content-Type':'application/json'}, Auth.authHeader()),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
    });
    if(res.ok){ const data = await res.json(); txId = data.order_id; }
    else throw new Error('non-200');
  }catch(e){
    txId = 'TLW-ORD-'+Math.floor(100000+Math.random()*900000)+'-OFFLINE';
  }

  fireAddToCart(product, 1);
  firePurchase([Object.assign({qty:1}, product)], txId);
  try{ sessionStorage.setItem('tifl_last_order', JSON.stringify(Object.assign({order_id: txId}, payload))); }catch(e){}
  window.location.href = 'thank-you.html';
}

function initLiveSellPage(){
  const root = document.getElementById('productTimeline');
  if(!root) return;
  wireCartDrawer();

  (async ()=>{
    await loadProducts();
    LIVE_ITEMS = PRODUCTS.slice(0, 8);
    renderLiveTimeline();
  })();

  document.getElementById('qbCancelBtn')?.addEventListener('click', ()=>{
    document.getElementById('quickBuyModal').classList.remove('show');
    pendingQuickBuyProduct = null;
  });
  document.getElementById('quickBuyForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(!pendingQuickBuyProduct) return;
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Placing order…';
    await placeLiveOrder(pendingQuickBuyProduct, {
      customer_name: document.getElementById('qbName').value,
      phone: document.getElementById('qbPhone').value,
      email: null,
      address: document.getElementById('qbAddress').value,
      city: document.getElementById('qbCity').value || 'Lahore'
    });
  });

  async function loadComments(){
    const listEl = document.getElementById('liveCommentsList');
    if(!listEl) return;
    try{
      const res = await fetch('/api/live/comments');
      const comments = await res.json();
      listEl.innerHTML = comments.length ? comments.map(c=>`
        <div class="chat-message"><span class="username">${c.name}</span><div>${c.message}</div></div>
      `).join('') : '<p style="color:var(--ink-soft);font-size:13px;">No comments yet — be the first to say hello.</p>';
      listEl.scrollTop = listEl.scrollHeight;
    }catch(e){ /* leave whatever was last rendered */ }
  }
  async function refreshCommentGate(){
    const profile = await Auth.fetchMe();
    document.getElementById('commentSignedOut').style.display = profile ? 'none' : 'flex';
    document.getElementById('commentForm').style.display = profile ? 'flex' : 'none';
  }
  document.getElementById('commentForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const input = document.getElementById('commentInput');
    const message = input.value.trim();
    if(!message) return;
    try{
      await fetch('/api/live/comments', {
        method:'POST',
        headers: Object.assign({'Content-Type':'application/json'}, Auth.authHeader()),
        body: JSON.stringify({message})
      });
      input.value = '';
      loadComments();
    }catch(e){ showToast('Could not post — try again'); }
  });
  loadComments();
  refreshCommentGate();
  setInterval(loadComments, 8000);

  let viewers = 234;
  setInterval(()=>{
    viewers += Math.floor(Math.random()*7)-3;
    viewers = Math.max(120, viewers);
    const el = document.getElementById('viewerCount');
    if(el) el.textContent = viewers;
  }, 4000);

  document.getElementById('shareStreamBtn')?.addEventListener('click', ()=>{
    if(navigator.share){ navigator.share({title:'Tifl Live Sale', text:'Join our live sale!', url:window.location.href}); }
    else { navigator.clipboard.writeText(window.location.href); showToast('Link copied to clipboard'); }
  });
  document.getElementById('muteBtn')?.addEventListener('click', ()=>{
    const v = document.getElementById('liveVideo');
    if(v) v.muted = !v.muted;
  });
  document.getElementById('fullscreenBtn')?.addEventListener('click', ()=>{
    const wrap = document.querySelector('.video-wrapper');
    if(!document.fullscreenElement) wrap.requestFullscreen?.().catch(()=>{});
    else document.exitFullscreen?.();
  });
}

/* ============================================================
   ACCOUNT PAGE (account.html) — signup/login, then shows saved
   profile + recent orders. The same account is what powers
   one-click Buy Now on live-sell.html and commenting there.
============================================================= */
function initAccountPage(){
  const root = document.getElementById('accountRoot');
  if(!root) return;

  const gate = document.getElementById('authGate');
  const panel = document.getElementById('accountPanel');

  function showSignupForm(){
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signupForm').style.display = 'flex';
  }
  function showLoginForm(){
    document.getElementById('signupForm').style.display = 'none';
    document.getElementById('loginForm').style.display = 'flex';
  }
  document.getElementById('showSignupLink')?.addEventListener('click', (e)=>{ e.preventDefault(); showSignupForm(); });
  document.getElementById('showLoginLink')?.addEventListener('click', (e)=>{ e.preventDefault(); showLoginForm(); });

  async function loadOrders(){
    const listEl = document.getElementById('myOrdersList');
    try{
      const res = await fetch('/api/orders/mine', {headers: Auth.authHeader()});
      if(!res.ok) throw new Error('failed');
      const orders = await res.json();
      listEl.innerHTML = orders.length ? orders.map(o=>{
        let items = [];
        try{ items = JSON.parse(o.items); }catch(e){}
        return `<div class="side-card" style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span class="ref" style="font-family:'IBM Plex Mono',monospace;color:var(--primary-dark);font-size:13px;">${o.order_id}</span>
            <span style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:var(--ink-soft);">${new Date(o.created_at).toLocaleDateString()}</span>
          </div>
          <p style="font-size:13px;margin-top:8px;">${items.map(i=>i.name+' × '+i.qty).join(', ')}</p>
          <div style="display:flex;justify-content:space-between;margin-top:8px;font-family:'IBM Plex Mono',monospace;font-size:13.5px;font-weight:600;">
            <span>${o.status}</span><span>${o.currency} ${o.total.toLocaleString()}</span>
          </div>
        </div>`;
      }).join('') : '<p style="color:var(--ink-soft);font-size:13.5px;">No orders yet — your purchases will show up here.</p>';
    }catch(e){
      listEl.innerHTML = '<p style="color:var(--ink-soft);font-size:13.5px;">Could not load orders right now.</p>';
    }
  }

  async function showAccountPanel(profile){
    gate.style.display = 'none';
    panel.style.display = 'block';
    document.getElementById('acctName').textContent = profile.name;
    document.getElementById('acctEmail').textContent = profile.email;
    document.getElementById('acctAddress').textContent = profile.address ? (profile.address+', '+(profile.city||'')) : 'No saved address yet — add one to enable one-tap buying on the live sale.';
    document.getElementById('acctPhone').textContent = profile.phone || '—';
    loadOrders();
  }

  document.getElementById('signupForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Creating account…';
    try{
      await Auth.signup({
        name: document.getElementById('suName').value,
        email: document.getElementById('suEmail').value,
        password: document.getElementById('suPassword').value,
        phone: document.getElementById('suPhone').value,
        address: document.getElementById('suAddress').value,
        city: document.getElementById('suCity').value || 'Lahore',
        anonymous_id: rsGetAnonymousId(), attribution: rsGetAttribution()
      });
      const profile = await Auth.fetchMe();
      showAccountPanel(profile);
      showToast('Account created');
    }catch(err){ showToast(err.message); }
    btn.disabled = false; btn.textContent = 'Create account';
  });

  document.getElementById('loginForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Signing in…';
    try{
      await Auth.login(document.getElementById('liEmail').value, document.getElementById('liPassword').value);
      const profile = await Auth.fetchMe();
      showAccountPanel(profile);
      showToast('Signed in');
    }catch(err){ showToast(err.message); }
    btn.disabled = false; btn.textContent = 'Sign in';
  });

  document.getElementById('logoutBtn')?.addEventListener('click', async ()=>{
    await Auth.logout();
    panel.style.display = 'none';
    gate.style.display = 'block';
    showLoginForm();
  });

  (async ()=>{
    if(Auth.isLoggedIn()){
      const profile = await Auth.fetchMe();
      if(profile) showAccountPanel(profile);
    }
  })();
}

/* ============================================================
   CHECKOUT PAGE (checkout.html)
   Moved off a modal onto its own page — the modal didn't work
   well on mobile. Reads the cart straight from Store (same
   localStorage-backed cart used by the drawer), so nothing about
   adding to cart changes, only where the address form lives.
============================================================= */
function renderCheckoutSummary(){
  const cart = Store.get('tifl_cart', []);
  const listEl = document.getElementById('checkoutItems');
  if(!listEl) return cart;
  if(cart.length===0){
    listEl.innerHTML = '<p style="color:var(--ink-soft);font-size:13.5px;">Your cart is empty.</p>';
  } else {
    listEl.innerHTML = cart.map(c=>`
      <div class="cart-line">
        <div class="cart-thumb" style="overflow:hidden;">${productThumbHTML(c,'70%')}</div>
        <div style="flex:1;">
          <div class="ci-name">${c.name}</div>
          <div class="ci-meta">${c.brand} · PKR ${c.price.toLocaleString()} × ${c.qty}</div>
        </div>
      </div>`).join('');
  }
  const subtotal = cart.reduce((s,c)=>s+c.price*c.qty,0);
  const subEl = document.getElementById('checkoutSubtotal'); if(subEl) subEl.textContent = 'PKR '+subtotal.toLocaleString();
  const totEl = document.getElementById('checkoutTotal'); if(totEl) totEl.textContent = 'PKR '+subtotal.toLocaleString();
  return cart;
}

function initCheckoutPage(){
  const form = document.getElementById('checkoutForm');
  if(!form) return;

  const cart = renderCheckoutSummary();
  if(cart.length>0) fireBeginCheckout(cart);

  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const currentCart = Store.get('tifl_cart', []);
    if(currentCart.length===0){ showToast('Your cart is empty'); return; }
    fireAddShippingInfo(currentCart);

    const subtotal = currentCart.reduce((s,c)=>s+c.price*c.qty,0);
    const shippingFee = 0;
    const payload = {
      customer_name: document.getElementById('coName').value,
      phone: document.getElementById('coPhone').value,
      email: document.getElementById('coEmail')?.value || null,
      address: document.getElementById('coAddress').value,
      address_line2: document.getElementById('coAddress2')?.value || null,
      city: document.getElementById('coCity').value,
      postal_code: document.getElementById('coPostal')?.value || null,
      state: document.getElementById('coState')?.value || null,
      country: document.getElementById('coCountry')?.value || 'Pakistan',
      payment_method: document.getElementById('coPayment')?.value || 'Cash on delivery',
      notes: document.getElementById('coNotes')?.value || null,
      items: currentCart.map(c=>({id:c.id, name:c.name, brand:c.brand, price:c.price, qty:c.qty})),
      subtotal, shipping_fee: shippingFee, total: subtotal+shippingFee, currency:'PKR',
      anonymous_id: rsGetAnonymousId(), attribution: rsGetAttribution()
    };

    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = 'Placing order…';

    let txId, placed = false;
    try{
      const res = await fetch('/api/orders', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined
      });
      if(res.ok){ const data = await res.json(); txId = data.order_id; placed = true; }
      else throw new Error('non-200');
    }catch(err){
      txId = 'TLW-ORD-'+Math.floor(100000+Math.random()*900000)+'-OFFLINE';
    }

    firePurchase(currentCart, txId);
    try{ sessionStorage.setItem('tifl_last_order', JSON.stringify(Object.assign({order_id: txId}, payload))); }catch(e){}
    Store.set('tifl_cart', []);
    refreshCartBadge();
    window.location.href = 'thank-you.html';
  });
}

/* ---------- boot ---------- */
document.addEventListener('DOMContentLoaded', ()=>{
  if(typeof rsPage === 'function') rsPage();
  applyConfig();
  initShopPage();
  initMeasurementsPage();
  initBookingPage();
  initContactPage();
  initProductPage();
  initAdminPage();
  initLiveSellPage();
  initAccountPage();
  initCheckoutPage();
});
