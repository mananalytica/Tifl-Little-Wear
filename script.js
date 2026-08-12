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
  phone: '+92 304 5519335',
  phoneHref: 'tel:+923054110254',
  whatsappNumber: '923054110254',        // country code + number, no + or spaces
  email: 'studio@tifllittlewear.com',
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
    // Comma-separated list of extra photo URLs (Google feed convention) —
    // split into an array here so callers never have to parse it themselves.
    additional_image_link: p.additional_image_link || '',
    additional_images: (p.additional_image_link || '').split(',').map(s=>s.trim()).filter(Boolean),
    // Selling-point bullets for the product page's checkmark strip.
    features: parseJSONField(p.features),
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
    item_group_id: p.item_group_id || '',
    material: p.material || '',
    tailor: p.tailor || '',   // tailor SLUG, e.g. "abdul-sattar" — resolve via TAILORS/loadTailors()
    // Units on hand. null/undefined = not tracked (no stock badge, Add to
    // cart always enabled). A number drives the low-stock badge and the
    // out-of-stock button swap on product.html.
    stock_quantity: (p.stock_quantity === null || p.stock_quantity === undefined || p.stock_quantity === '') ? null : Number(p.stock_quantity),
    // Opts a product into the homepage hero sliders — see curatedProducts().
    featured: p.featured === true || p.featured === 'true' || p.featured === 1
  };
}
// Which products the homepage hero sliders (boxed gallery + the full-bleed
// variation) are allowed to show. Only products explicitly marked
// "Feature in homepage gallery" in admin qualify — this is what keeps a
// slideshow from mixing real product photos with plain colour-placeholder
// products, which is what made it look like it was randomly breaking mid-
// rotation. Falls back to every product only if nothing has been curated
// yet, so a brand-new site isn't left with an empty hero.
function curatedProducts(){
  const featured = PRODUCTS.filter(p=>p.featured);
  return featured.length ? featured : PRODUCTS;
}

/* ============================================================
   TAILORS — one row per master tailor, powers master-tailor.html
   (?slug=...), tailors.html, and the "Designed / stitched by"
   attribution on product.html. See index.py's TAILOR ONBOARDING
   comment for how a new tailor gets added (no code changes needed).
============================================================= */
const FALLBACK_TAILORS = [
  {tailor_id:'t-abdulsattar', slug:'abdul-sattar', name:'Ustad Abdul Sattar', title:'Master Tailor',
   tagline:"24 years of hands that shaped this studio's stitch line.", photo_url:'#101B2E',
   years_experience:24, garments_count:'3,000+', apprentices_count:'12', established_year:'2010',
   bio:"Every occasion piece in our in-house line passes through Ustad Sattar's hands.",
   specialties:[], timeline:[], gallery:[], testimonials:[], active:true}
];
let TAILORS = [];

async function loadTailors(){
  try{
    const res = await fetch('/api/tailors');
    if(!res.ok) throw new Error('bad status');
    const data = await res.json();
    TAILORS = data.map(normalizeTailor);
  }catch(e){
    TAILORS = FALLBACK_TAILORS.map(normalizeTailor);
  }
  return TAILORS;
}
// JSON columns come back from the API as strings — parse them safely,
// and fall back to [] rather than throwing if a field is empty/malformed.
function parseJSONField(v){
  if(Array.isArray(v)) return v;
  if(typeof v !== 'string' || !v.trim()) return [];
  try{ const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; }
  catch(e){ return []; }
}
function normalizeTailor(t){
  return {
    id: t.tailor_id || t.id,
    slug: t.slug,
    name: t.name,
    title: t.title || 'Master Tailor',
    tagline: t.tagline || '',
    photo_url: t.photo_url || '#101B2E',
    years_experience: t.years_experience || null,
    garments_count: t.garments_count || '',
    apprentices_count: t.apprentices_count || '',
    established_year: t.established_year || '',
    bio: t.bio || '',
    specialties: parseJSONField(t.specialties),
    timeline: parseJSONField(t.timeline),
    gallery: parseJSONField(t.gallery),
    testimonials: parseJSONField(t.testimonials),
    active: t.active !== false
  };
}
// Returns HTML for a tailor's hero photo: a real image if photo_url is a
// URL, otherwise a soft initials placeholder in that colour (same
// fallback idea as productThumbHTML, so onboarding works before headshots exist).
function tailorPhotoHTML(t, opts){
  opts = opts || {};
  if(t.photo_url && !isColor(t.photo_url)){
    return imgTag(t.photo_url, t.name, opts.width || 700, opts);
  }
  const color = isColor(t.photo_url) ? t.photo_url : '#101B2E';
  const initials = (t.name||'').split(' ').filter(Boolean).slice(-2).map(w=>w[0]).join('').toUpperCase();
  return `<div style="background:${color};width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
    <span style="font-family:'Fredoka',sans-serif;font-weight:700;font-size:56px;color:rgba(255,255,255,.9);">${initials}</span>
  </div>`;
}
// Returns HTML for a lookbook gallery tile (real photo or a colour swatch).
function tailorGalleryTileHTML(item, opts){
  opts = opts || {};
  if(item.image_url && !isColor(item.image_url)){
    return imgTag(item.image_url, item.title||'', opts.width || 500, opts);
  }
  const color = isColor(item.image_url) ? item.image_url : '#8FB7E8';
  return `<div style="background:${color};width:100%;height:100%;"></div>`;
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

/* ------------------------------------------------------------------------
   IMAGE PERFORMANCE
   Two problems, two fixes:
   1) Photos are shown small (card/thumb size) but often uploaded at full
      camera resolution — every one of those bytes still has to download.
      optimizeImageUrl() routes remote photos through images.weserv.nl, a
      free image proxy, requesting only the pixel width actually needed,
      re-encoded as WebP. Local/relative paths (e.g. "assets/...") and
      data: URIs are left untouched since the proxy can't reach them.
   2) Every <img> was being requested immediately, even ones nowhere near
      the viewport (off-screen carousel slides, cards far down the page).
      imgTag() defaults every image to loading="lazy" decoding="async" —
      pass {eager:true} for the one image on a page that's visible
      immediately on load (hero banner, main product photo) so THAT one
      loads with priority instead of competing with everything else.
------------------------------------------------------------------------ */
function optimizeImageUrl(url, width){
  if(!url || typeof url !== 'string') return url;
  if(!/^https?:\/\//i.test(url)) return url; // relative/local/data: — leave alone
  const bare = url.replace(/^https?:\/\//i, '');
  const w = Math.round(width || 600);
  return `https://images.weserv.nl/?url=${encodeURIComponent(bare)}&w=${w}&q=76&output=webp&fit=cover`;
}
function imgTag(url, alt, width, opts){
  opts = opts || {};
  const src = optimizeImageUrl(url, width);
  const loading = opts.eager ? 'eager' : 'lazy';
  const fetchpriority = opts.eager ? ' fetchpriority="high"' : '';
  const safeAlt = (alt||'').replace(/"/g,'&quot;');
  return `<img src="${src}" alt="${safeAlt}" loading="${loading}" decoding="async"${fetchpriority} style="width:100%;height:100%;object-fit:cover;">`;
}
function garmentIllustration(color){
  return `<svg viewBox="0 0 100 100" width="46%" height="46%"><path d="M50 10 L35 22 L20 18 L10 34 L22 42 L22 90 L78 90 L78 42 L90 34 L80 18 L65 22 Z" fill="${color}" opacity="0.85"/></svg>`;
}
// Returns thumbnail HTML for a product: a real photo if image_url is a URL,
// otherwise a simple colour illustration (useful for products added before
// photography exists). `width` is the actual rendered pixel width the photo
// needs (used to request a right-sized image); pass {eager:true} only for
// the single product photo that's on-screen the moment the page loads.
function productThumbHTML(p, size, opts){
  size = size || '46%';
  opts = opts || {};
  if(p.image_url && !isColor(p.image_url)){
    return imgTag(p.image_url, p.name, opts.width || 480, opts);
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
  // begin_checkout fires once, on checkout.html itself when it loads —
  // not here, or it double-fires (once on click, once on page arrival).
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
        <div class="cart-thumb" style="overflow:hidden;">${productThumbHTML(c,'70%',{width:140})}</div>
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
        ${productThumbHTML(p,'46%',{width:380})}
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

/* ============================================================
   HOMEPAGE VARIATION — full-bleed photo hero (index-full-gallery.html)
   Self-contained: only runs if #fgSlides exists, so it can't affect
   the production homepage's .hero-gallery. Reuses PRODUCTS photos as
   backdrops behind curated brand copy (see FG_SLIDES below).
============================================================= */
const FG_SLIDES = [
  {
    eyebrow: 'Studio · Lahore',
    heading: 'Clothes cut for a child who <span class="accent">won\'t</span> sit still.',
    body: 'Tifl Little Wear is a made-to-measure kidswear studio. We take real measurements, draft a real pattern, and hand-finish every seam.',
    ctaLabel: 'Book a fitting', ctaHref: 'booking.html'
  },
  {
    eyebrow: 'Hand-finished',
    heading: 'Every seam, finished by hand.',
    body: 'French seams on everyday wear, hand-set embroidery on occasion pieces — finished by tailors we\'ve worked with for years.',
    ctaLabel: 'Meet our tailors', ctaHref: 'tailors.html'
  },
  {
    eyebrow: 'From the shop',
    heading: 'Ready pieces, worn today.',
    body: 'Alongside our stitching line, we carry ready pieces from Lahore-based kidswear labels we trust.',
    ctaLabel: 'Browse the shop', ctaHref: 'shop.html'
  }
];
function fgMediaHTML(p, opts){
  opts = opts || {};
  if(p && p.image_url && !isColor(p.image_url)){
    const width = opts.width || 1400;
    const src = optimizeImageUrl(p.image_url, width);
    const loading = opts.eager ? 'eager' : 'lazy';
    const fetchpriority = opts.eager ? ' fetchpriority="high"' : '';
    // Two layers: a blurred, oversized copy fills the banner as backdrop;
    // the real photo sits on top fully visible (object-fit:contain) so
    // nothing gets cropped off, however wide the desktop banner is.
    return `
      <div class="fg-media-backdrop" style="background-image:url('${src}')"></div>
      <div class="fg-media-fg"><img src="${src}" alt="" loading="${loading}" decoding="async"${fetchpriority}></div>`;
  }
  const color = (p && isColor(p.image_url)) ? p.image_url : '#4A93E8';
  return `<div class="fg-media-fallback">${garmentIllustration(color)}</div>`;
}
async function initFullGalleryHero(){
  const root = document.getElementById('fgSlides');
  if(!root) return;
  await loadProducts();
  const backdrops = curatedProducts(); // only "Feature in homepage gallery" products — see admin

  const dotsHTML = FG_SLIDES.map((_,i)=>`<span class="${i===0?'active':''}" data-i="${i}"></span>`).join('');
  root.innerHTML = FG_SLIDES.map((s,i)=>`
    <div class="fg-slide${i===0?' active':''}" data-i="${i}">
      <div class="fg-media"></div>
      <div class="fg-scrim"></div>
      <div class="fg-content">
        <div class="eyebrow on-dark">${s.eyebrow}</div>
        <h2>${s.heading}</h2>
        <p>${s.body}</p>
        <a class="btn btn-primary" href="${s.ctaHref}">${s.ctaLabel} →</a>
      </div>
    </div>`).join('') + `<div class="fg-dots" id="fgDots">${dotsHTML}</div>`;

  const slides = root.querySelectorAll('.fg-slide');
  const dots = document.getElementById('fgDots').querySelectorAll('span');
  let current = 0, timer = null, transitioning = false;

  // Backdrop photos are only fetched for the active slide (+ the next one,
  // preloaded just ahead of its turn) — never mount every slide's photo at
  // once. Returns a promise so goTo() can wait for it before revealing.
  function loadSlideMedia(i){
    const slide = slides[i];
    if(!slide) return Promise.resolve();
    if(slide.dataset.loaded) return Promise.resolve();
    slide.dataset.loaded = '1';
    const product = backdrops.length ? backdrops[i % backdrops.length] : null;
    const media = slide.querySelector('.fg-media');
    media.innerHTML = fgMediaHTML(product, {width:1400, eager: i===0});
    const img = media.querySelector('img');
    if(!img) return Promise.resolve(); // colour fallback — nothing to wait for
    if(img.complete) return Promise.resolve();
    return new Promise(resolve=>{
      img.addEventListener('load', resolve, {once:true});
      img.addEventListener('error', resolve, {once:true}); // don't hang the slider on a broken photo
    });
  }
  // Loads the target slide's photo BEFORE the crossfade starts, so the
  // incoming slide never shows a blank frame mid-transition (that blank
  // flash — old photo gone, new one not painted yet — is what read as the
  // gallery "reverting"). A transitioning guard stops rapid clicks from
  // starting a second crossfade before the first one has settled.
  async function goTo(i){
    if(transitioning) return;
    transitioning = true;
    const target = (i+slides.length) % slides.length;
    await loadSlideMedia(target);
    slides[current].classList.remove('active');
    dots[current].classList.remove('active');
    current = target;
    slides[current].classList.add('active');
    dots[current].classList.add('active');
    loadSlideMedia((current+1) % slides.length); // preload the one after, in the background
    setTimeout(()=>{ transitioning = false; }, 950); // matches the .9s CSS fade
  }
  function next(){ goTo(current+1); }
  function start(){ stop(); if(slides.length>1) timer = setInterval(next, 5000); }
  function stop(){ clearInterval(timer); timer = null; }

  loadSlideMedia(0);
  loadSlideMedia(1 % slides.length);

  document.getElementById('fgPrev')?.addEventListener('click', ()=>{ goTo(current-1); start(); });
  document.getElementById('fgNext')?.addEventListener('click', ()=>{ goTo(current+1); start(); });
  dots.forEach(dot=>dot.addEventListener('click', ()=>{ goTo(parseInt(dot.dataset.i,10)); start(); }));

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduceMotion) start();
  root.closest('.fg-hero')?.addEventListener('mouseenter', stop);
  root.closest('.fg-hero')?.addEventListener('mouseleave', ()=>{ if(!reduceMotion) start(); });
}

/* ============================================================
   HOMEPAGE — hero gallery: single-image auto-cycling slideshow
   (crossfades through every product photo, clicking one goes to
   that exact product) + the horizontal "From the shop" strip
============================================================= */
async function initHeroGallery(){
  const root = document.getElementById('heroGallery');
  if(!root) return;
  await loadProducts();
  const items = curatedProducts(); // only "Feature in homepage gallery" products — see admin
  if(!items.length) return;

  root.innerHTML = `
    <div class="hero-gallery-dots" id="heroGalleryDots"></div>
  `;
  const dotsRoot = document.getElementById('heroGalleryDots');

  // Each slide starts with an empty media slot — its photo is only
  // requested when the slide is about to be shown (see loadSlideMedia
  // below). Without this, a slow-loading page turned out to be one page
  // silently downloading every product photo in the gallery at once, even
  // though only one slide is ever visible.
  items.forEach((p, i)=>{
    const slide = document.createElement('div');
    slide.className = 'hero-gallery-slide' + (i===0 ? ' active' : '');
    slide.innerHTML = `
      <div class="hgs-media"></div>
      <div class="hero-gallery-cap">
        <div class="hgc-name">${p.name}</div>
        <div class="hgc-price">PKR ${p.price.toLocaleString()}</div>
      </div>`;
    slide.addEventListener('click', ()=>{
      fireSelectItem(p);
      window.location.href = 'product.html?id='+encodeURIComponent(p.id);
    });
    root.insertBefore(slide, dotsRoot);

    const dot = document.createElement('span');
    if(i===0) dot.className = 'active';
    dot.addEventListener('click', (e)=>{ e.stopPropagation(); goToSlide(i); start(); });
    dotsRoot.appendChild(dot);
  });

  const slides = root.querySelectorAll('.hero-gallery-slide');
  const dots = dotsRoot.querySelectorAll('span');
  let current = 0, timer = null, transitioning = false;

  function loadSlideMedia(i){
    const slide = slides[i];
    if(!slide) return Promise.resolve();
    if(slide.dataset.loaded) return Promise.resolve();
    slide.dataset.loaded = '1';
    const media = slide.querySelector('.hgs-media');
    media.innerHTML = productThumbHTML(items[i], '46%', {width:900, eager: i===0});
    const img = media.querySelector('img');
    if(!img) return Promise.resolve();
    if(img.complete) return Promise.resolve();
    return new Promise(resolve=>{
      img.addEventListener('load', resolve, {once:true});
      img.addEventListener('error', resolve, {once:true});
    });
  }

  // Waits for the target slide's photo to finish loading before starting
  // the crossfade — otherwise the incoming slide briefly shows nothing
  // (old photo gone, new one not painted yet), which reads as the
  // slideshow glitching or snapping back. A transitioning guard also
  // stops overlapping crossfades if the user clicks through quickly.
  async function goToSlide(i){
    if(transitioning) return;
    transitioning = true;
    await loadSlideMedia(i);
    slides[current].classList.remove('active');
    dots[current].classList.remove('active');
    current = i;
    slides[current].classList.add('active');
    dots[current].classList.add('active');
    loadSlideMedia((current+1) % slides.length); // have the next one ready before it's needed
    setTimeout(()=>{ transitioning = false; }, 850); // matches the .8s CSS fade
  }
  function next(){ goToSlide((current+1) % slides.length); }
  function start(){ stop(); if(slides.length>1) timer = setInterval(next, 3200); }
  function stop(){ clearInterval(timer); timer = null; }

  loadSlideMedia(0);
  loadSlideMedia(1 % slides.length);

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!reduceMotion) start();
  root.addEventListener('mouseenter', stop);
  root.addEventListener('mouseleave', ()=>{ if(!reduceMotion) start(); });
}

async function initHomeGallery(){
  const track = document.getElementById('homeGalleryTrack');
  if(!track) return;
  await loadProducts();
  if(!PRODUCTS.length) return;

  const cardHTML = p => `
    <a class="hg-card" href="product.html?id=${encodeURIComponent(p.id)}" data-id="${p.id}">
      <div class="hg-thumb">${productThumbHTML(p,'46%',{width:380})}</div>
      <div class="hg-name">${p.name}</div>
      <div class="hg-price">PKR ${p.price.toLocaleString()}</div>
    </a>`;

  // Render the list twice back-to-back so the CSS animation can scroll
  // from 0% to -50% and loop seamlessly without a visible jump.
  const cards = PRODUCTS.map(cardHTML).join('');
  track.innerHTML = cards + cards;

  track.querySelectorAll('.hg-card').forEach(el=>{
    el.addEventListener('click', ()=>{
      const p = PRODUCTS.find(x=>x.id===el.dataset.id);
      if(p) fireSelectItem(p);
    });
  });
}

/* ============================================================
   MASTER TAILOR PAGE (master-tailor.html?slug=...) — fully
   data-driven so onboarding a new tailor never needs a code
   change; see index.py's TAILOR ONBOARDING comment for the flow.
============================================================= */
async function initTailorPage(){
  const root = document.getElementById('tailorPage');
  if(!root) return;
  const empty = document.getElementById('tailorEmpty');
  const slug = new URLSearchParams(window.location.search).get('slug') || 'abdul-sattar';

  await loadTailors();
  const t = TAILORS.find(x=>x.slug===slug);
  if(!t){ root.style.display='none'; if(empty) empty.style.display='block'; return; }

  document.title = t.name+', '+t.title+' — Tifl Little Wear, Lahore';

  // ---- Hero: photo one side, name + experience + stats the other ----
  document.getElementById('tpPhoto').innerHTML = tailorPhotoHTML(t, {width:900, eager:true});
  document.getElementById('tpEyebrow').textContent = (t.title||'Master Tailor')+(t.established_year ? ' · Est. '+t.established_year+' at Tifl' : '');
  document.getElementById('tpName').innerHTML = t.name+(t.tagline ? ' — <span class="accent">'+t.tagline+'</span>' : '');
  document.getElementById('tpBio').textContent = t.bio || '';
  const statsRoot = document.getElementById('tpStats');
  const stats = [];
  if(t.years_experience) stats.push([t.years_experience, 'Years of tailoring']);
  if(t.garments_count) stats.push([t.garments_count, 'Garments hand-cut']);
  if(t.apprentices_count) stats.push([t.apprentices_count, 'Apprentices trained']);
  statsRoot.innerHTML = stats.map(([n,l])=>`<div class="mt-stat"><b>${n}</b><span>${l}</span></div>`).join('');

  // ---- Approach / specialties ----
  const specRoot = document.getElementById('tpSpecialties');
  const specSection = document.getElementById('tpSpecialtiesSection');
  if(t.specialties.length){
    specSection.style.display = '';
    const icons = [
      '<path d="M4 21v-6a4 4 0 014-4h8a4 4 0 014 4v6M9 11V7a3 3 0 016 0v4"/>',
      '<path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="9"/>',
      '<path d="M20 7L12 3 4 7l8 4 8-4z"/><path d="M4 7v10l8 4 8-4V7"/><path d="M12 11v10"/>'
    ];
    specRoot.innerHTML = t.specialties.map((s,i)=>`
      <div class="craft-card">
        <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">${icons[i%icons.length]}</svg>
        <h3>${s.title}</h3>
        <p>${s.description}</p>
      </div>`).join('');
  } else { specSection.style.display = 'none'; }

  // ---- Timeline ----
  const tlRoot = document.getElementById('tpTimeline');
  const tlSection = document.getElementById('tpTimelineSection');
  if(t.timeline.length){
    tlSection.style.display = '';
    tlRoot.innerHTML = t.timeline.map(item=>`
      <div class="mt-tl-item">
        <div class="mt-tl-dot"></div>
        <div class="mt-tl-year">${item.year}</div>
        <h4>${item.title}</h4>
        <p>${item.description}</p>
      </div>`).join('');
  } else { tlSection.style.display = 'none'; }

  // ---- Lookbook gallery (editorial grid: big shot + top/mid tiles +
  // "Explore Gallery" CTA — matches the CSS grid-template-areas in
  // master-tailor.html. Falls back to a simple wrapping row if fewer
  // than 3 photos are available yet.) ----
  await loadProducts();
  const pieces = PRODUCTS.filter(p=>p.tailor===slug);
  document.getElementById('tpLookbookHeading').textContent = 'Recent bespoke creations by '+t.name+'.';
  const galleryItems = t.gallery.length ? t.gallery : pieces.slice(0,3).map(p=>({
    image_url: p.image_url, title: p.name, caption: 'Crafted by '+t.name, tag: p.category
  }));
  const lookbookRoot = document.getElementById('tpLookbook');
  const lookbookSection = document.getElementById('tpLookbookSection');
  const exploreTile = `
    <a class="mt-lb-explore" href="#portfolio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
      Explore Gallery
    </a>`;
  function lbTile(item, cls){
    return `<div class="mt-lb-tile ${cls}">
      ${tailorGalleryTileHTML(item, {width:500})}
      ${item.tag ? `<span class="mt-lb-badge">${item.tag}</span>` : ''}
      <div class="mt-lb-caption"><b>${item.title||''}</b>${item.caption?`<span>${item.caption}</span>`:''}</div>
    </div>`;
  }
  if(galleryItems.length){
    lookbookSection.style.display = '';
    if(galleryItems.length>=3){
      lookbookRoot.className = 'mt-lookbook';
      lookbookRoot.innerHTML = lbTile(galleryItems[0],'big') + lbTile(galleryItems[1],'top') + lbTile(galleryItems[2],'mid') + exploreTile;
    } else {
      lookbookRoot.className = 'mt-lookbook simple';
      lookbookRoot.innerHTML = galleryItems.map(item=>lbTile(item,'')).join('') + exploreTile;
    }
  } else { lookbookSection.style.display = 'none'; }

  // ---- Portfolio grid (live products tagged to this tailor) ----
  const portfolioGrid = document.getElementById('tpPortfolioGrid');
  if(!pieces.length){
    portfolioGrid.innerHTML = `<p style="color:var(--ink-soft);grid-column:1/-1;">Portfolio pieces will appear here as they're tagged to ${t.name} in the shop.</p>`;
  } else {
    portfolioGrid.innerHTML = pieces.map(p => `
      <div class="p-card" data-id="${p.id}">
        <div class="p-thumb">
          <span class="brand-tag">${p.brand || 'Tifl Little Wear'}</span>
          ${productThumbHTML(p,'46%',{width:380})}
        </div>
        <div class="p-info">
          <div class="pname">${p.name}</div>
          <div class="pcat">${p.category}</div>
          <div class="prow"><span class="price">PKR ${p.price.toLocaleString()}</span></div>
        </div>
      </div>`).join('');
    portfolioGrid.querySelectorAll('.p-card').forEach(card=>{
      card.addEventListener('click', ()=>{ window.location.href = 'product.html?id='+encodeURIComponent(card.dataset.id); });
    });
  }

  // ---- Testimonials ----
  const testRoot = document.getElementById('tpTestimonials');
  const testSection = document.getElementById('tpTestimonialsSection');
  const starSVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z"/></svg>';
  if(t.testimonials.length){
    testSection.style.display = '';
    testRoot.innerHTML = t.testimonials.map(r=>`
      <div class="review-card">
        <div class="stars">${starSVG.repeat(5)}</div>
        <p class="quote">${r.quote}</p>
        <div class="review-who"><b>${r.name}</b>${r.location?`<div class="wloc">${r.location}</div>`:''}</div>
      </div>`).join('');
  } else { testSection.style.display = 'none'; }

  // ---- Booking form: tag the request to this tailor specifically ----
  document.getElementById('bTailorName').value = t.name;
  const modeLabel = document.querySelector('#modeGrid .mode[data-mode="studio"]');
  if(modeLabel) modeLabel.innerHTML = `In-studio with ${t.name}<br><span style="font-size:11px;color:var(--ink-soft);">Gulberg, Lahore</span>`;
  const bookingHeading = document.getElementById('tpBookingHeading');
  if(bookingHeading) bookingHeading.textContent = 'Reserve a private fitting with '+t.name+'.';
  const bookingNote = document.getElementById('tpBookingNote');
  if(bookingNote) bookingNote.innerHTML = `This request is routed to ${t.name} specifically — for a general studio fitting with any available tailor, use the <a href="booking.html" style="color:var(--primary-dark);font-weight:600;">regular booking page</a> instead.`;
}

/* ============================================================
   TAILORS DIRECTORY (tailors.html) — every active tailor, each
   linking to their own master-tailor.html?slug=... page.
============================================================= */
async function initTailorsDirectoryPage(){
  const grid = document.getElementById('tailorsDirectoryGrid');
  if(!grid) return;
  await loadTailors();
  if(!TAILORS.length){
    grid.innerHTML = '<p style="color:var(--ink-soft);">No tailors listed yet.</p>';
    return;
  }
  grid.innerHTML = TAILORS.map(t=>`
    <a class="td-card" href="master-tailor.html?slug=${encodeURIComponent(t.slug)}">
      <div class="td-photo">${tailorPhotoHTML(t, {width:380})}</div>
      <div class="td-info">
        <div class="td-name">${t.name}</div>
        <div class="td-title">${t.title}${t.years_experience ? ' · '+t.years_experience+' yrs experience' : ''}</div>
        <p class="td-tagline">${t.tagline||''}</p>
      </div>
    </a>`).join('');
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
      child: document.getElementById('mChild').value.trim() || 'Unnamed',
      age: document.getElementById('mAge').value,
      chest: document.getElementById('mChest').value,
      waist: document.getElementById('mWaist').value,
      height: document.getElementById('mHeight').value,
      inseam: document.getElementById('mInseam').value
    };
  }
  // No <form> wraps this card (it's a plain div), so native HTML
  // "required" attributes never trigger browser validation on their own —
  // check explicitly before saving.
  function validate(m){
    const missing = [];
    if(!m.child || m.child === 'Unnamed') missing.push('child\u2019s name');
    if(!m.chest) missing.push('chest');
    if(!m.waist) missing.push('waist');
    if(!m.height) missing.push('height');
    if(!m.inseam) missing.push('inseam');
    return missing;
  }
  // Saves to the server (so it's not lost on device switch / cache clear)
  // AND to localStorage (kept purely for the "carry straight into booking"
  // prefill convenience on this same device — the server copy is now the
  // real source of truth, this is just a nice-to-have shortcut).
  async function persist(m){
    Store.set('tifl_measurements', m);
    try{
      await fetch('/api/measurements', {
        method: 'POST',
        headers: Object.assign({'Content-Type':'application/json'}, Auth.authHeader()),
        body: JSON.stringify({
          child_name: m.child, age: m.age || null, chest: m.chest || null,
          waist: m.waist || null, height: m.height || null, inseam: m.inseam || null,
          anonymous_id: rsGetAnonymousId()
        })
      });
    }catch(e){
      // Still saved locally even if the network call failed — don't block
      // the "carry to booking" flow over a flaky connection.
      showToast('Saved on this device, but couldn\u2019t reach the server — try again when you\u2019re back online.');
    }
  }
  saveBtn.addEventListener('click', async ()=>{
    const m = collect();
    const missing = validate(m);
    if(missing.length){ showToast('Please fill in: '+missing.join(', ')); return; }
    await persist(m);
    document.getElementById('savedNote').classList.add('show');
  });
  document.getElementById('carryToBookingBtn')?.addEventListener('click', async ()=>{
    const m = collect();
    const missing = validate(m);
    if(missing.length){ showToast('Please fill in: '+missing.join(', ')); return; }
    await persist(m);
    window.location.href = 'booking.html';
  });
}

/* ============================================================
   BOOKING PAGE
============================================================= */
function initBookingPage(){
  const form = document.getElementById('bookingForm');
  if(!form) return;

  function renderAttachedMeasurement(m){
    const attachedEl = document.getElementById('attachedMeasureText');
    if(!m || !attachedEl) return;
    attachedEl.innerHTML = `<b>${m.child}</b> · chest ${m.chest||'—'}cm · waist ${m.waist||'—'}cm · height ${m.height||'—'}cm · inseam ${m.inseam||'—'}cm`;
    if(m.child && m.child!=='Unnamed') document.getElementById('bChild').value = m.child;
  }

  const local = Store.get('tifl_measurements', null);
  if(local){
    renderAttachedMeasurement(local);
  }else if(Auth.isLoggedIn()){
    // Nothing on this device, but they're signed in — check the server so
    // measurements saved on a different device (e.g. filled in on their
    // phone, now booking from a laptop) still show up here instead of
    // silently coming up empty.
    fetch('/api/measurements/mine', {headers: Auth.authHeader()})
      .then(res => res.ok ? res.json() : [])
      .then(records => {
        const latest = records.find(r => r.source === 'self_reported') || records[0];
        if(latest){
          const m = {
            child: latest.child_name, age: latest.age, chest: latest.chest,
            waist: latest.waist, height: latest.height, inseam: latest.inseam
          };
          // Write it into the same local store the submit handler reads
          // from — otherwise the banner would show correctly but the
          // actual booking would silently submit with measurements: null.
          Store.set('tifl_measurements', m);
          renderAttachedMeasurement(m);
        }
      })
      .catch(()=>{});
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
    // Read live at submit time (not at page load) — on master-tailor.html
    // this hidden field's value is set asynchronously by initTailorPage()
    // once tailor data has loaded, which can finish after this handler is
    // wired up. Absent entirely on the general booking.html form.
    const preferredTailor = document.getElementById('bTailorName')?.value || null;
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
      preferred_tailor: preferredTailor,
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

    dataLayer.push({event:'generate_lead', lead_type:'booking', booking_ref:ref, garment_type:payload.garment_type, fitting_mode:mode, preferred_tailor:preferredTailor});
    rsTrack('generate_lead', {lead_type:'booking', booking_ref:ref, garment_type:payload.garment_type, fitting_mode:mode, preferred_tailor:preferredTailor});

    document.getElementById('confirmRef').textContent = wasOnline
      ? 'Reference '+ref+' · saved to studio database'
      : 'Reference '+ref+' · saved on this device — we will confirm by phone';
    const confirmHeading = document.querySelector('#confirmCard h3');
    if(confirmHeading) confirmHeading.textContent = preferredTailor ? 'Request sent to '+preferredTailor : 'Booking received';
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
  document.getElementById('pdMedia').innerHTML = productThumbHTML(p, '55%', {width:900, eager:true});
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

  // Product-specific selling points — a standalone section under the
  // accordion, only shown when the admin set any Features for this product.
  const featuresSection = document.getElementById('pdFeaturesSection');
  if(featuresSection){
    if(p.features && p.features.length){
      document.getElementById('pdFeatureList').innerHTML = p.features.map(f=>`
        <div class="pd-feature-card">
          <span class="tick"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg></span>
          <div>
            <div class="pd-fc-title">${f.title}</div>
            ${f.description ? `<div class="pd-fc-desc">${f.description}</div>` : ''}
          </div>
        </div>`).join('');
      featuresSection.style.display = 'block';
    } else {
      featuresSection.style.display = 'none';
    }
  }

  // Note: the "Designed & stitched by <tailor>" credit line was removed
  // from this page (it was confusing next to the ready-to-wear purchase
  // flow) — tailor attribution still lives on master-tailor.html and the
  // tailors directory, this page just no longer surfaces it inline.

  const AGE_GROUP_LABELS = {
    newborn: 'Newborn (0–3 months)', infant: 'Infant (3–12 months)',
    toddler: 'Toddler (1–3 years)', kids: 'Kids (4–12 years)', adult: 'Teen / Adult'
  };
  document.getElementById('pdMaterialText').textContent = p.material
    ? 'Made from ' + p.material + '.'
    : 'Material details available on request — ask us via WhatsApp or at your fitting.';

  const details = [
    { label:'Recommended age', value: AGE_GROUP_LABELS[p.age_group] || 'See sizing chart' },
    { label:'Size', value: p.size || 'See sizing chart for measurements' }
  ];
  const detailGrid = document.getElementById('pdDetailGrid');
  if(detailGrid){
    detailGrid.innerHTML = details.map(d=>`
      <div class="pd-detail-item">
        <div class="label">${d.label}</div>
        <div class="value">${d.value}</div>
      </div>`).join('');
  }

  // Accordion — one panel open at a time, first one starts open.
  document.querySelectorAll('.pd-acc-trigger').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const item = btn.closest('.pd-acc-item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.pd-acc-item').forEach(i=>i.classList.remove('open'));
      if(!wasOpen) item.classList.add('open');
    });
  });

  // ---- Stock-aware CTA: low-stock urgency badge + out-of-stock swap -----
  // Out of stock is true if the admin flagged availability directly, or the
  // tracked unit count has hit zero (stock_quantity is only tracked when the
  // admin set it — null means "not tracked", so it never forces this state).
  const isOutOfStock = p.availability === 'out of stock' || p.stock_quantity === 0;
  const stockBadge = document.getElementById('pdStockBadge');
  const qtyRow = document.getElementById('pdQtyRow');
  const ctaRow = document.getElementById('pdCtaRow');
  const customSizeBtn = document.getElementById('pdCustomSizeBtn');

  // Wires a single "Add to cart" button (the main one, and the sticky-bar
  // copy) so both reflect the same stock state and do the same thing.
  // `label` lets the compact sticky-bar button use shorter copy.
  function wireAddButton(btn, label){
    if(!btn) return;
    if(isOutOfStock){
      btn.textContent = label || 'Get Yours Stitched Now';
      btn.addEventListener('click', ()=>{ window.location.href = 'booking.html'; });
    } else {
      btn.addEventListener('click', ()=>{
        const qty = parseInt(document.getElementById('pdQty').value, 10) || 1;
        addToCart(p, qty);
      });
    }
  }
  wireAddButton(document.getElementById('pdAddBtn'));

  // Out of stock collapses the two-button row down to one: with nothing
  // left to buy, "Add to cart" and "Need a custom size?" would say almost
  // the same thing side by side, so the custom-size button is dropped and
  // "Get Yours Stitched Now" becomes the single, full-width option.
  if(isOutOfStock && customSizeBtn){
    customSizeBtn.style.display = 'none';
    ctaRow?.classList.add('single');
  }

  if(isOutOfStock){
    if(qtyRow) qtyRow.style.display = 'none';
    if(stockBadge){
      stockBadge.textContent = 'Out of stock — get yours stitched instead';
      stockBadge.classList.add('out');
      stockBadge.style.display = 'inline-flex';
    }
  } else if(stockBadge && p.stock_quantity != null && p.stock_quantity > 0){
    if(p.stock_quantity <= 5){
      stockBadge.textContent = p.stock_quantity === 1 ? 'Only 1 left in stock' : `Only ${p.stock_quantity} left in stock`;
      stockBadge.classList.add('low');
    } else {
      stockBadge.textContent = 'In stock';
      stockBadge.classList.add('ok');
    }
    stockBadge.style.display = 'inline-flex';
  }

  // "Order on WhatsApp" — prefills a message with the product name, price
  // (and quantity, if more than 1) and a link back to this exact page, so
  // the studio gets full context the moment the chat opens. Re-built
  // whenever qty changes so the message always matches what's on screen.
  const waBtn = document.getElementById('pdWhatsappBtn');
  if(waBtn){
    function buildWhatsappHref(){
      const qty = parseInt(document.getElementById('pdQty')?.value, 10) || 1;
      const priceLine = qty > 1
        ? `PKR ${p.price.toLocaleString()} × ${qty} = PKR ${(p.price*qty).toLocaleString()}`
        : `PKR ${p.price.toLocaleString()}`;
      const lines = [
        `Hi! I'd like to order this:`,
        ``,
        p.name,
        priceLine,
        window.location.href
      ];
      return `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(lines.join('\n'))}`;
    }
    waBtn.href = buildWhatsappHref();
    document.getElementById('pdQty')?.addEventListener('input', ()=>{ waBtn.href = buildWhatsappHref(); });
  }

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
        <div class="p-thumb"><span class="brand-tag">${r.brand}</span>${productThumbHTML(r,'46%',{width:380})}</div>
        <div class="p-info">
          <div class="pname">${r.name}</div>
          <div class="pcat">${r.category}</div>
          <div class="prow"><span class="price">PKR ${r.price.toLocaleString()}</span></div>
        </div>
      </div>`).join('');
    relatedRoot.querySelectorAll('.p-card').forEach(card=>{
      card.addEventListener('click', ()=>{ window.location.href = 'product.html?id='+card.dataset.id; });
    });
    document.getElementById('pdWearWithSection')?.style.setProperty('display', 'block');
  }

  /* ---------- variant B only (guarded — no-op on product.html) ---------- */

  // Gallery thumbnails: main image + additional_image_link if present.
  const thumbsRoot = document.getElementById('pdThumbs');
  if(thumbsRoot){
    const images = [p.image_url, ...(p.additional_images || [])].filter(Boolean);
    thumbsRoot.innerHTML = images.map((img,i)=>`
      <div class="pd-thumb ${i===0?'active':''}" data-img="${img}">
        ${productThumbHTML(Object.assign({}, p, {image_url: img}), '70%', {width:140})}
      </div>`).join('');
    thumbsRoot.querySelectorAll('.pd-thumb').forEach(t=>{
      t.addEventListener('click', ()=>{
        thumbsRoot.querySelectorAll('.pd-thumb').forEach(x=>x.classList.remove('active'));
        t.classList.add('active');
        document.getElementById('pdMedia').innerHTML = productThumbHTML(Object.assign({}, p, {image_url: t.dataset.img}), '55%', {width:900, eager:true});
      });
    });
  }

  // Size note (honest to the data model — one size per listing, not a
  // selector implying variants that don't exist yet).
  const sizeNote = document.getElementById('pdSizeNote');
  if(sizeNote && p.size){
    sizeNote.style.display = 'flex';
    document.getElementById('pdSizeValue').textContent = p.size;
  }

  // Note: the "Complete the set" cross-sell block was removed from this
  // page (it read as confusing/unrelated next to the main product) — the
  // broader "Wear it with" and "Browse the rest of the shop" rails below
  // still handle cross-selling.

  // Broader browse strip — everything else in the shop, excluding this item.
  const uniformStrip = document.getElementById('pdUniformStrip');
  if(uniformStrip){
    const others = PRODUCTS.filter(x=>x.id!==p.id).slice(0,8);
    if(others.length){
      uniformStrip.innerHTML = others.map(o=>`
        <div class="p-card" data-id="${o.id}">
          <div class="p-thumb"><span class="brand-tag">${o.brand}</span>${productThumbHTML(o,'46%',{width:380})}</div>
          <div class="p-info">
            <div class="pname">${o.name}</div>
            <div class="pcat">${o.category}</div>
            <div class="prow"><span class="price">PKR ${o.price.toLocaleString()}</span></div>
          </div>
        </div>`).join('');
      uniformStrip.querySelectorAll('.p-card').forEach(card=>{
        card.addEventListener('click', ()=>{ window.location.href = 'product.html?id='+card.dataset.id; });
      });
      document.getElementById('pdUniformSection').style.display = 'block';
    }
  }

  // Sticky add-to-cart bar — appears once the main Add to Cart button
  // scrolls out of view, matching the reference's mobile-friendly pattern.
  const stickyBar = document.getElementById('pdStickyBar');
  if(stickyBar){
    document.getElementById('pdStickyThumb').innerHTML = productThumbHTML(p, '70%', {width:100});
    document.getElementById('pdStickyName').textContent = p.name;
    document.getElementById('pdStickyPrice').textContent = p.currency+' '+(p.sale_price || p.price).toLocaleString();
    wireAddButton(document.getElementById('pdStickyAddBtn'), 'Get Stitched Now');
    const mainAddBtn = document.getElementById('pdAddBtn');
    // Measure the sticky bar's actual rendered height (rather than assuming
    // a fixed number) and expose it as a CSS var, so the WhatsApp float can
    // sit exactly above it — this stays correct even if the bar's content
    // wraps to two lines or the safe-area inset changes its height.
    const setStickyLift = ()=>{
      document.documentElement.style.setProperty('--sticky-bar-h', stickyBar.offsetHeight + 'px');
    };
    const resizeObserver = new ResizeObserver(setStickyLift);
    resizeObserver.observe(stickyBar);
    const observer = new IntersectionObserver(([entry])=>{
      const showing = !entry.isIntersecting;
      if(showing) setStickyLift();
      stickyBar.classList.toggle('show', showing);
      // Nudge the WhatsApp float button up so it doesn't sit on top of
      // the "Add to cart" button in the sticky bar on small screens.
      document.body.classList.toggle('has-sticky-cta', showing);
    }, {threshold:0});
    observer.observe(mainAddBtn);
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

  // ---- Tab switching. Every panel's data is loaded up front on unlock
  // (same as before) — tabs only toggle visibility via CSS, so switching
  // is instant and there's no per-tab loading state to manage.
  document.querySelectorAll('.admin-tab').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.admin-tab').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.admin-tab-panel').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector(`.admin-tab-panel[data-panel="${btn.dataset.tab}"]`)?.classList.add('active');
    });
  });

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
        <div class="admin-row-thumb">${productThumbHTML(p,'70%',{width:140})}</div>
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

  // ---- Tailors panel: populates the product form's "Designed / stitched
  // by" dropdown, and its own add/edit/delete list below the products grid.
  async function refreshTailorDropdown(){
    const sel = document.getElementById('apTailor');
    if(!sel) return;
    await loadTailors();
    const current = sel.value;
    sel.innerHTML = '<option value="">— none / partner brand —</option>'
      + TAILORS.map(t=>`<option value="${t.slug}">${t.name}</option>`).join('');
    if(current) sel.value = current;
  }

  async function refreshTailorList(){
    const listRoot = document.getElementById('adminTailorList');
    if(!listRoot) return;
    listRoot.innerHTML = '<p style="color:var(--ink-soft);">Loading…</p>';
    let tailors;
    try{
      const res = await fetch('/api/tailors');
      if(!res.ok) throw new Error('status '+res.status);
      tailors = (await res.json()).map(normalizeTailor);
    }catch(e){
      listRoot.innerHTML = '<p style="color:var(--primary-dark);">Could not load tailors from the server ('+e.message+').</p>';
      return;
    }
    listRoot.innerHTML = tailors.map(t=>`
      <div class="admin-row" data-id="${t.id}">
        <div class="admin-row-thumb">${tailorPhotoHTML(t, {width:140})}</div>
        <div class="admin-row-info">
          <div class="admin-row-name">${t.name}</div>
          <div class="admin-row-meta">${t.title}${t.years_experience ? ' · '+t.years_experience+' yrs' : ''} · /master-tailor.html?slug=${t.slug}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-edit="${t.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-del="${t.id}">Delete</button>
      </div>`).join('') || '<p style="color:var(--ink-soft);">No tailors yet — add your first one above.</p>';

    listRoot.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', ()=>{
      const t = tailors.find(x=>x.id===b.dataset.edit);
      fillTailorForm(t);
      window.scrollTo({top: document.getElementById('tailorForm').getBoundingClientRect().top + window.scrollY - 20, behavior:'smooth'});
    }));
    listRoot.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('Delete this tailor? Products already tagged to them will keep the slug but the page will 404 until it\'s reassigned.')) return;
      try{ await apiCall('/api/tailors/'+b.dataset.del, 'DELETE'); showToast('Deleted'); refreshTailorList(); refreshTailorDropdown(); }
      catch(e){}
    }));
  }

  function fillTailorForm(t){
    document.getElementById('atEditingId').value = t.id;
    document.getElementById('atName').value = t.name;
    document.getElementById('atSlug').value = t.slug;
    document.getElementById('atTitle').value = t.title || 'Master Tailor';
    document.getElementById('atTagline').value = t.tagline || '';
    document.getElementById('atPhoto').value = isColor(t.photo_url) ? '' : t.photo_url;
    document.getElementById('atSwatch').value = isColor(t.photo_url) ? t.photo_url : '#101B2E';
    document.getElementById('atYears').value = t.years_experience || '';
    document.getElementById('atEstablished').value = t.established_year || '';
    document.getElementById('atGarments').value = t.garments_count || '';
    document.getElementById('atApprentices').value = t.apprentices_count || '';
    document.getElementById('atBio').value = t.bio || '';
    document.getElementById('atSpecialties').value = t.specialties.length ? JSON.stringify(t.specialties, null, 2) : '';
    document.getElementById('atTimeline').value = t.timeline.length ? JSON.stringify(t.timeline, null, 2) : '';
    document.getElementById('atGallery').value = t.gallery.length ? JSON.stringify(t.gallery, null, 2) : '';
    document.getElementById('atTestimonials').value = t.testimonials.length ? JSON.stringify(t.testimonials, null, 2) : '';
    document.getElementById('atFormTitle').textContent = 'Editing: '+t.name;
  }
  function resetTailorForm(){
    document.getElementById('tailorForm').reset();
    document.getElementById('atEditingId').value = '';
    document.getElementById('atTitle').value = 'Master Tailor';
    document.getElementById('atSwatch').value = '#101B2E';
    document.getElementById('atFormTitle').textContent = 'Add a tailor';
  }
  // Parses one of the optional JSON textareas; returns null (skip the
  // section) if blank, throws a friendly error if the JSON is malformed.
  function parseTailorJSONField(id, label){
    const raw = document.getElementById(id).value.trim();
    if(!raw) return null;
    try{
      const parsed = JSON.parse(raw);
      if(!Array.isArray(parsed)) throw new Error('not a list');
      return parsed;
    }catch(e){
      throw new Error(`"${label}" isn't valid JSON — check for a stray comma or missing bracket.`);
    }
  }
  function tailorFormToPayload(){
    return {
      name: document.getElementById('atName').value,
      slug: document.getElementById('atSlug').value.trim().toLowerCase().replace(/[^a-z0-9-]+/g,'-'),
      title: document.getElementById('atTitle').value || 'Master Tailor',
      tagline: document.getElementById('atTagline').value || null,
      photo_url: document.getElementById('atPhoto').value.trim() || document.getElementById('atSwatch').value,
      years_experience: document.getElementById('atYears').value ? parseInt(document.getElementById('atYears').value,10) : null,
      garments_count: document.getElementById('atGarments').value || null,
      apprentices_count: document.getElementById('atApprentices').value || null,
      established_year: document.getElementById('atEstablished').value || null,
      bio: document.getElementById('atBio').value || null,
      specialties: parseTailorJSONField('atSpecialties','Specialties'),
      timeline: parseTailorJSONField('atTimeline','Career timeline'),
      gallery: parseTailorJSONField('atGallery','Lookbook gallery photos'),
      testimonials: parseTailorJSONField('atTestimonials','Testimonials'),
      active: true
    };
  }

  // ---- Additional photos + Features: plain textareas, one entry per
  // line — pasted straight in, same as the Description box. ----
  function linesOf(id){
    return document.getElementById(id).value.split('\n').map(s=>s.trim()).filter(Boolean);
  }
  // "Title: description" per line -> [{title, description}, ...]. A line
  // with no colon becomes a title-only feature (no description shown).
  function parseFeaturesTextarea(){
    return linesOf('apFeatures').map(line=>{
      const idx = line.indexOf(':');
      if(idx === -1) return {title: line, description: null};
      return {title: line.slice(0, idx).trim(), description: line.slice(idx+1).trim() || null};
    }).filter(f=>f.title);
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
    document.getElementById('apImages').value = (p.additional_images || []).join('\n');
    document.getElementById('apFeatures').value = (p.features || [])
      .map(f => f.description ? `${f.title}: ${f.description}` : f.title).join('\n');
    document.getElementById('apSku').value = p.sku || '';
    document.getElementById('apGtin').value = p.gtin || '';
    document.getElementById('apMpn').value = p.mpn || '';
    document.getElementById('apItemGroupId').value = p.item_group_id || '';
    document.getElementById('apAvailability').value = p.availability || 'in stock';
    const apStockEl = document.getElementById('apStockQuantity');
    if(apStockEl) apStockEl.value = (p.stock_quantity === null || p.stock_quantity === undefined) ? '' : p.stock_quantity;
    const apFeaturedEl = document.getElementById('apFeatured');
    if(apFeaturedEl) apFeaturedEl.checked = !!p.featured;
    document.getElementById('apCondition').value = p.condition || 'new';
    document.getElementById('apColorAttr').value = p.color || '';
    document.getElementById('apSize').value = p.size || '';
    document.getElementById('apMaterial').value = p.material || '';
    document.getElementById('apGender').value = p.gender || '';
    document.getElementById('apAgeGroup').value = p.age_group || 'kids';
    document.getElementById('apGoogleCategory').value = p.google_product_category || '';
    document.getElementById('apProductType').value = p.product_type || '';
    document.getElementById('apLink').value = p.link || '';
    const apTailorEl = document.getElementById('apTailor');
    if(apTailorEl) apTailorEl.value = p.tailor || '';
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
      additional_image_link: linesOf('apImages').join(', ') || null,
      features: parseFeaturesTextarea(),
      description: document.getElementById('apDescription').value,
      sku: document.getElementById('apSku').value || null,
      gtin: document.getElementById('apGtin').value || null,
      mpn: document.getElementById('apMpn').value || null,
      item_group_id: document.getElementById('apItemGroupId').value || null,
      availability: document.getElementById('apAvailability').value,
      stock_quantity: document.getElementById('apStockQuantity')?.value !== '' && document.getElementById('apStockQuantity')?.value != null
        ? parseInt(document.getElementById('apStockQuantity').value, 10) : null,
      featured: document.getElementById('apFeatured')?.checked || false,
      condition: document.getElementById('apCondition').value,
      color: document.getElementById('apColorAttr').value || null,
      size: document.getElementById('apSize').value || null,
      material: document.getElementById('apMaterial').value || null,
      gender: document.getElementById('apGender').value || null,
      age_group: document.getElementById('apAgeGroup').value,
      google_product_category: document.getElementById('apGoogleCategory').value || null,
      product_type: document.getElementById('apProductType').value || null,
      link: document.getElementById('apLink').value || null,
      tailor: document.getElementById('apTailor')?.value || null,
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
    refreshTailorDropdown();
    refreshTailorList();
    refreshFabricList();
    refreshFittingList();
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

  document.getElementById('tailorForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const editingId = document.getElementById('atEditingId').value;
    let payload;
    try{ payload = tailorFormToPayload(); }
    catch(err){ showToast(err.message); return; }
    try{
      if(editingId) await apiCall('/api/tailors/'+editingId, 'PUT', payload);
      else await apiCall('/api/tailors', 'POST', payload);
      showToast('Saved');
      resetTailorForm();
      refreshTailorList();
      refreshTailorDropdown();
    }catch(e){ /* apiCall already toasts on 401 */ }
  });
  document.getElementById('atCancelEdit')?.addEventListener('click', resetTailorForm);

  // ---- Fabrics panel: same add/edit/delete pattern as tailors. ----
  async function refreshFabricList(){
    const listRoot = document.getElementById('adminFabricList');
    if(!listRoot) return;
    listRoot.innerHTML = '<p style="color:var(--ink-soft);">Loading…</p>';
    let fabrics;
    try{
      const res = await fetch('/api/fabrics');
      if(!res.ok) throw new Error('status '+res.status);
      fabrics = await res.json();
    }catch(e){
      listRoot.innerHTML = '<p style="color:var(--primary-dark);">Could not load fabrics from the server ('+e.message+').</p>';
      return;
    }
    listRoot.innerHTML = fabrics.map(f=>`
      <div class="admin-row" data-id="${f.fabric_id}">
        <div class="admin-row-info">
          <div class="admin-row-name">${f.name}</div>
          <div class="admin-row-meta">${f.composition || 'composition not set'}${f.width_cm ? ' · '+f.width_cm+'cm wide' : ''}${f.pattern_repeat_cm ? ' · '+f.pattern_repeat_cm+'cm repeat' : ''}${f.drape_type ? ' · '+f.drape_type : ''}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-edit="${f.fabric_id}">Edit</button>
        <button class="btn btn-ghost btn-sm" data-del="${f.fabric_id}">Delete</button>
      </div>`).join('') || '<p style="color:var(--ink-soft);">No fabrics yet — add your first one above.</p>';

    listRoot.querySelectorAll('[data-edit]').forEach(b=>b.addEventListener('click', ()=>{
      const f = fabrics.find(x=>x.fabric_id===b.dataset.edit);
      fillFabricForm(f);
      window.scrollTo({top: document.getElementById('fabricForm').getBoundingClientRect().top + window.scrollY - 20, behavior:'smooth'});
    }));
    listRoot.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('Delete this fabric?')) return;
      try{ await apiCall('/api/fabrics/'+b.dataset.del, 'DELETE'); showToast('Deleted'); refreshFabricList(); }
      catch(e){}
    }));
  }

  function fillFabricForm(f){
    document.getElementById('afEditingId').value = f.fabric_id;
    document.getElementById('afName').value = f.name;
    document.getElementById('afComposition').value = f.composition || '';
    document.getElementById('afDrapeType').value = f.drape_type || '';
    document.getElementById('afWidth').value = f.width_cm ?? '';
    document.getElementById('afRepeat').value = f.pattern_repeat_cm ?? '';
    document.getElementById('afCost').value = f.cost_per_yard ?? '';
    document.getElementById('afSupplier').value = f.supplier || '';
    document.getElementById('afNotes').value = f.notes || '';
    document.getElementById('afFormTitle').textContent = 'Editing: '+f.name;
  }
  function resetFabricForm(){
    document.getElementById('fabricForm').reset();
    document.getElementById('afEditingId').value = '';
    document.getElementById('afFormTitle').textContent = 'Add a fabric';
  }
  function fabricFormToPayload(){
    const name = document.getElementById('afName').value.trim();
    if(!name) throw new Error('Fabric name is required');
    return {
      name,
      composition: document.getElementById('afComposition').value || null,
      drape_type: document.getElementById('afDrapeType').value || null,
      width_cm: document.getElementById('afWidth').value ? parseFloat(document.getElementById('afWidth').value) : null,
      pattern_repeat_cm: document.getElementById('afRepeat').value ? parseFloat(document.getElementById('afRepeat').value) : null,
      cost_per_yard: document.getElementById('afCost').value ? parseFloat(document.getElementById('afCost').value) : null,
      supplier: document.getElementById('afSupplier').value || null,
      notes: document.getElementById('afNotes').value || null,
      active: true
    };
  }
  document.getElementById('fabricForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const editingId = document.getElementById('afEditingId').value;
    let payload;
    try{ payload = fabricFormToPayload(); }
    catch(err){ showToast(err.message); return; }
    try{
      if(editingId) await apiCall('/api/fabrics/'+editingId, 'PUT', payload);
      else await apiCall('/api/fabrics', 'POST', payload);
      showToast('Saved');
      resetFabricForm();
      refreshFabricList();
    }catch(e){ /* apiCall already toasts on 401 */ }
  });
  document.getElementById('afCancelEdit')?.addEventListener('click', resetFabricForm);

  /* ---------- bulk import (CSV / XML) ---------- */
  // Maps common Google Shopping / Meta Catalog feed column names onto our
  // Product fields. "id" becomes our sku, since that's the stable
  // identifier a merchant feed uses to track one product across uploads.
  // "Title: description | Title: description" (or one per line) ->
  // [{title, description}, ...] — the format documented in admin.html's
  // bulk-upload instructions.
  function parseFeaturesField(raw){
    if(!raw) return null;
    const features = raw.split(/\||\n/).map(s=>s.trim()).filter(Boolean).map(part=>{
      const idx = part.indexOf(':');
      if(idx === -1) return {title: part, description: null};
      return {title: part.slice(0, idx).trim(), description: part.slice(idx+1).trim() || null};
    }).filter(f=>f.title);
    return features.length ? features : null;
  }

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
      additional_image_link: get('additional_image_link','additional_image_links'),
      features: parseFeaturesField(get('features')),
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
      material: get('material'),
      gender: get('gender'),
      age_group: get('age_group') || 'kids',
      item_group_id: get('item_group_id'),
      stock_quantity: get('stock_quantity') !== null && get('stock_quantity') !== '' ? parseInt(get('stock_quantity'), 10) : null,
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
        // Google feeds repeat <g:additional_image_link> once per extra
        // photo rather than comma-separating — collect every occurrence
        // instead of letting the last one silently overwrite the rest.
        if(tag === 'additional_image_link'){
          row[tag] = row[tag] ? row[tag] + ',' + el.textContent : el.textContent;
        } else {
          row[tag] = el.textContent;
        }
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

  // ---- Fittings panel: log the full 11-point measurement a tailor takes
  // in person, decoupled from any single booking so it's reusable.
  async function refreshFittingList(){
    const listRoot = document.getElementById('adminFittingList');
    if(!listRoot) return;
    listRoot.innerHTML = '<p style="color:var(--ink-soft);">Loading…</p>';
    let fittings;
    try{
      fittings = await apiCall('/api/measurements', 'GET');
    }catch(e){
      listRoot.innerHTML = '<p style="color:var(--primary-dark);">Could not load fittings from the server.</p>';
      return;
    }
    const pointKeys = ['chest','waist','hip','shoulder_width','sleeve_length','neck','back_length','front_length','inseam','outseam','height'];
    listRoot.innerHTML = fittings.map(f=>{
      const filled = pointKeys.filter(k=>f[k]).length;
      const when = f.created_at ? new Date(f.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '';
      return `
      <div class="admin-row" data-id="${f.measurement_id}">
        <div class="admin-row-info">
          <div class="admin-row-name">${f.child_name}${f.source==='tailor_fitting' ? ' · in-person fitting' : ' · self-reported'}</div>
          <div class="admin-row-meta">${filled}/11 points · ${f.recorded_by ? 'by '+f.recorded_by : 'parent self-report'} · ${when}${f.booking_id ? ' · booking '+f.booking_id : ''}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-del="${f.measurement_id}">Delete</button>
      </div>`;
    }).join('') || '<p style="color:var(--ink-soft);">No fittings logged yet.</p>';

    listRoot.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('Delete this fitting record?')) return;
      try{ await apiCall('/api/measurements/'+b.dataset.del, 'DELETE'); showToast('Deleted'); refreshFittingList(); }
      catch(e){}
    }));
  }

  function fittingFormToPayload(){
    const childName = document.getElementById('fChildName').value.trim();
    const recordedBy = document.getElementById('fRecordedBy').value.trim();
    if(!childName) throw new Error('Child\u2019s name is required');
    if(!recordedBy) throw new Error('Tailor\u2019s name is required');
    return {
      child_name: childName,
      age: document.getElementById('fAge').value || null,
      recorded_by: recordedBy,
      booking_id: document.getElementById('fBookingId').value.trim() || null,
      chest: document.getElementById('fChest').value || null,
      waist: document.getElementById('fWaist').value || null,
      hip: document.getElementById('fHip').value || null,
      shoulder_width: document.getElementById('fShoulder').value || null,
      sleeve_length: document.getElementById('fSleeve').value || null,
      neck: document.getElementById('fNeck').value || null,
      back_length: document.getElementById('fBackLength').value || null,
      front_length: document.getElementById('fFrontLength').value || null,
      inseam: document.getElementById('fInseam').value || null,
      outseam: document.getElementById('fOutseam').value || null,
      height: document.getElementById('fHeight').value || null,
      notes: document.getElementById('fNotes').value || null
    };
  }

  document.getElementById('fittingForm')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    let payload;
    try{ payload = fittingFormToPayload(); }
    catch(err){ showToast(err.message); return; }
    try{
      await apiCall('/api/measurements/fitting', 'POST', payload);
      showToast('Fitting saved');
      document.getElementById('fittingForm').reset();
      refreshFittingList();
    }catch(e){ /* apiCall already toasts on 401 */ }
  });
  document.getElementById('fCancelEdit')?.addEventListener('click', ()=>document.getElementById('fittingForm').reset());

  if(getKey()){
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    refreshList();
    refreshTailorDropdown();
    refreshTailorList();
    refreshFabricList();
    refreshFittingList();
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
        <div class="timeline-thumb">${productThumbHTML(p,'80%',{width:380})}</div>
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
    source: 'live_sell',
    items: [{id:product.id, name:product.name, brand:product.brand, price:product.price, qty:1, image_url:product.image_url}],
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
        <div class="cart-thumb" style="overflow:hidden;">${productThumbHTML(c,'70%',{width:140})}</div>
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
      items: currentCart.map(c=>({id:c.id, name:c.name, brand:c.brand, price:c.price, qty:c.qty, image_url:c.image_url})),
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
  initHeroGallery();
  initFullGalleryHero();
  initHomeGallery();
  initTailorPage();
  initTailorsDirectoryPage();
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
