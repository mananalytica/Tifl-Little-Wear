/* ============================================================
   TIFL LITTLE WEAR — ADMIN PANEL LOGIC
   Split out of script.js (PageSpeed audit, Aug 2026): this single
   function was ~935 lines — about a third of the whole shared script —
   and is only ever used on admin.html, which no customer ever visits.
   Every other page was downloading and parsing all of it for nothing.
   Loaded only by admin.html, AFTER script.js (so shared helpers this
   depends on — showToast, isColor, loadTailors, productThumbHTML,
   tailorPhotoHTML — already exist in global scope by the time this runs).
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
    if(!res.ok){
      // Surface the backend's actual error detail (FastAPI's HTTPException
      // body is {"detail": "..."}) instead of silently returning it as if
      // it were valid data — every call site's try/catch now gets the
      // real reason a request failed, not a generic downstream crash.
      let detail = 'Request failed ('+res.status+')';
      try{ const errBody = await res.json(); if(errBody.detail) detail = errBody.detail; }catch(e){}
      throw new Error(detail);
    }
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
    refreshTechPackBookingDropdown();
    refreshTechPackFabricDropdown();
    refreshTechPackList();
    refreshAnalytics();
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

  // ---- Tech Packs panel ----
  let tpFabricLookup = {}; // fabric_id -> name, for showing readable names in the list
  let tpCurrentId = null;  // the tech pack currently loaded in the editor, if any

  async function refreshTechPackBookingDropdown(){
    const sel = document.getElementById('tpBookingSelect');
    let bookings;
    try{ bookings = await apiCall('/api/bookings', 'GET'); }
    catch(e){ sel.innerHTML = '<option value="">Could not load bookings</option>'; return; }
    // Bookings with a design brief are the obvious candidates — list them first.
    bookings.sort((a,b)=> (b.design_brief?1:0) - (a.design_brief?1:0));
    sel.innerHTML = '<option value="">— select a booking —</option>' + bookings.map(b=>{
      const label = `${b.booking_id} — ${b.child_name || 'no name'} (${b.garment_type || '—'})${b.design_brief ? ' · has design brief' : ''}`;
      return `<option value="${b.booking_id}">${label}</option>`;
    }).join('');
  }

  async function refreshTechPackFabricDropdown(){
    const sel = document.getElementById('tpFabricSelect');
    let fabrics;
    try{
      const res = await fetch('/api/fabrics');
      fabrics = res.ok ? await res.json() : [];
    }catch(e){ fabrics = []; }
    tpFabricLookup = {};
    fabrics.forEach(f=>tpFabricLookup[f.fabric_id]=f.name);
    sel.innerHTML = '<option value="">— select a fabric —</option>' + fabrics.map(f=>
      `<option value="${f.fabric_id}">${f.name}</option>`
    ).join('');
  }

  async function refreshTechPackList(){
    const listRoot = document.getElementById('adminTechPackList');
    listRoot.innerHTML = '<p style="color:var(--ink-soft);">Loading…</p>';
    let packs;
    try{ packs = await apiCall('/api/tech-packs', 'GET'); }
    catch(e){ listRoot.innerHTML = '<p style="color:var(--primary-dark);">Could not load tech packs.</p>'; return; }
    listRoot.innerHTML = packs.map(tp=>{
      const when = tp.created_at ? new Date(tp.created_at).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}) : '';
      return `
      <div class="admin-row" data-id="${tp.tech_pack_id}">
        <div class="admin-row-info">
          <div class="admin-row-name">${tp.tech_pack_id} · ${tp.status === 'approved' ? '✅ Approved' : '📝 Draft'}</div>
          <div class="admin-row-meta">Booking ${tp.booking_id} · ${tpFabricLookup[tp.fabric_id] || tp.fabric_id} · ${when}</div>
        </div>
        <button class="btn btn-ghost btn-sm" data-open="${tp.tech_pack_id}">Open</button>
        <button class="btn btn-ghost btn-sm" data-del="${tp.tech_pack_id}">Delete</button>
      </div>`;
    }).join('') || '<p style="color:var(--ink-soft);">No tech packs generated yet.</p>';

    listRoot.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click', async ()=>{
      try{ const tp = await apiCall('/api/tech-packs/'+b.dataset.open, 'GET'); loadTechPackIntoEditor(tp); }
      catch(e){}
    }));
    listRoot.querySelectorAll('[data-del]').forEach(b=>b.addEventListener('click', async ()=>{
      if(!confirm('Delete this tech pack?')) return;
      try{
        await apiCall('/api/tech-packs/'+b.dataset.del, 'DELETE');
        showToast('Deleted');
        if(tpCurrentId === b.dataset.del){ tpCurrentId = null; document.getElementById('tpEditor').style.display = 'none'; }
        refreshTechPackList();
      }catch(e){}
    }));
  }

  function loadTechPackIntoEditor(tp){
    tpCurrentId = tp.tech_pack_id;
    document.getElementById('tpEditor').style.display = 'block';
    document.getElementById('tpEditorTitle').textContent = tp.tech_pack_id;
    const badge = document.getElementById('tpStatusBadge');
    badge.textContent = tp.status === 'approved' ? 'APPROVED' : 'DRAFT';
    badge.style.color = tp.status === 'approved' ? 'var(--primary-dark)' : 'var(--ink-soft)';
    document.getElementById('tpEditorMeta').textContent = `Booking ${tp.booking_id} · Fabric ${tpFabricLookup[tp.fabric_id] || tp.fabric_id}${tp.generated_by ? ' · generated by '+tp.generated_by : ''}${tp.approved_by ? ' · approved by '+tp.approved_by : ''}`;
    document.getElementById('tpYardage').value = tp.yardage_estimate || '';
    document.getElementById('tpSeam').value = tp.seam_allowance || '';
    document.getElementById('tpDarts').value = tp.dart_placement || '';
    document.getElementById('tpClosures').value = tp.closures || '';
    document.getElementById('tpLining').value = tp.lining || '';
    document.getElementById('tpZipper').value = tp.bom_zipper || '';
    document.getElementById('tpThread').value = tp.bom_thread_color || '';
    document.getElementById('tpInterfacing').value = tp.bom_interfacing || '';
    document.getElementById('tpButtons').value = tp.bom_buttons || '';
    document.getElementById('tpOther').value = tp.bom_other || '';
    document.getElementById('tpCutEn').value = tp.cutting_instructions_en || '';
    document.getElementById('tpCutUr').value = tp.cutting_instructions_ur || '';
    document.getElementById('tpStitchEn').value = tp.stitching_instructions_en || '';
    document.getElementById('tpStitchUr').value = tp.stitching_instructions_ur || '';
    window.scrollTo({top: document.getElementById('tpEditor').getBoundingClientRect().top + window.scrollY - 20, behavior:'smooth'});
  }

  function techPackEditorToPayload(){
    return {
      yardage_estimate: document.getElementById('tpYardage').value,
      seam_allowance: document.getElementById('tpSeam').value,
      dart_placement: document.getElementById('tpDarts').value,
      closures: document.getElementById('tpClosures').value,
      lining: document.getElementById('tpLining').value,
      bom_zipper: document.getElementById('tpZipper').value,
      bom_thread_color: document.getElementById('tpThread').value,
      bom_interfacing: document.getElementById('tpInterfacing').value,
      bom_buttons: document.getElementById('tpButtons').value,
      bom_other: document.getElementById('tpOther').value,
      cutting_instructions_en: document.getElementById('tpCutEn').value,
      cutting_instructions_ur: document.getElementById('tpCutUr').value,
      stitching_instructions_en: document.getElementById('tpStitchEn').value,
      stitching_instructions_ur: document.getElementById('tpStitchUr').value,
    };
  }

  document.getElementById('tpGenerateBtn')?.addEventListener('click', async ()=>{
    const bookingId = document.getElementById('tpBookingSelect').value;
    const fabricId = document.getElementById('tpFabricSelect').value;
    if(!bookingId || !fabricId){ showToast('Pick a booking and a fabric first'); return; }
    const btn = document.getElementById('tpGenerateBtn');
    const statusEl = document.getElementById('tpGenerateStatus');
    btn.disabled = true; btn.textContent = 'Generating…';
    statusEl.textContent = 'Calling Gemini — this can take up to 30-45 seconds for both languages.';
    try{
      const tp = await apiCall(
        '/api/tech-packs/generate?booking_id='+encodeURIComponent(bookingId)+'&fabric_id='+encodeURIComponent(fabricId),
        'POST'
      );
      statusEl.textContent = '';
      showToast('Draft generated — review before approving');
      loadTechPackIntoEditor({...tp, booking_id: bookingId, fabric_id: fabricId, status: 'draft'});
      refreshTechPackList();
    }catch(e){
      statusEl.textContent = 'Generation failed — check that GEMINI_API_KEY is set, or try again.';
    }
    btn.disabled = false; btn.textContent = 'Generate tech pack';
  });

  document.getElementById('tpSaveBtn')?.addEventListener('click', async ()=>{
    if(!tpCurrentId) return;
    try{
      await apiCall('/api/tech-packs/'+tpCurrentId, 'PUT', techPackEditorToPayload());
      showToast('Saved');
      refreshTechPackList();
    }catch(e){}
  });

  document.getElementById('tpApproveBtn')?.addEventListener('click', async ()=>{
    if(!tpCurrentId) return;
    try{
      await apiCall('/api/tech-packs/'+tpCurrentId, 'PUT', {...techPackEditorToPayload(), approve: true});
      showToast('Approved');
      document.getElementById('tpStatusBadge').textContent = 'APPROVED';
      refreshTechPackList();
    }catch(e){}
  });

  document.getElementById('tpCloseBtn')?.addEventListener('click', ()=>{
    tpCurrentId = null;
    document.getElementById('tpEditor').style.display = 'none';
  });

  document.getElementById('tpExportBtn')?.addEventListener('click', ()=>{
    const p = techPackEditorToPayload();
    const title = document.getElementById('tpEditorTitle').textContent;
    const meta = document.getElementById('tpEditorMeta').textContent;
    const escHtml = (s)=> (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    document.getElementById('techPackPrintView').innerHTML = `
      <h1>${escHtml(title)}</h1>
      <p class="tp-print-meta">${escHtml(meta)}</p>
      <table class="tp-print-table">
        <tr><th>Yardage estimate</th><td>${escHtml(p.yardage_estimate)}</td></tr>
        <tr><th>Seam allowance</th><td>${escHtml(p.seam_allowance)}</td></tr>
        <tr><th>Dart placement</th><td>${escHtml(p.dart_placement)}</td></tr>
        <tr><th>Closures</th><td>${escHtml(p.closures)}</td></tr>
        <tr><th>Lining</th><td>${escHtml(p.lining)}</td></tr>
      </table>
      <h2>Bill of materials</h2>
      <table class="tp-print-table">
        <tr><th>Zipper</th><td>${escHtml(p.bom_zipper)}</td></tr>
        <tr><th>Thread color</th><td>${escHtml(p.bom_thread_color)}</td></tr>
        <tr><th>Interfacing</th><td>${escHtml(p.bom_interfacing)}</td></tr>
        <tr><th>Buttons</th><td>${escHtml(p.bom_buttons)}</td></tr>
        <tr><th>Other</th><td>${escHtml(p.bom_other)}</td></tr>
      </table>
      <h2>Cutting instructions</h2>
      <div class="tp-print-langs">
        <div><h3>English</h3><p>${escHtml(p.cutting_instructions_en)}</p></div>
        <div dir="rtl" class="tp-urdu"><h3>اردو</h3><p>${escHtml(p.cutting_instructions_ur)}</p></div>
      </div>
      <h2>Stitching instructions</h2>
      <div class="tp-print-langs">
        <div><h3>English</h3><p>${escHtml(p.stitching_instructions_en)}</p></div>
        <div dir="rtl" class="tp-urdu"><h3>اردو</h3><p>${escHtml(p.stitching_instructions_ur)}</p></div>
      </div>
    `;
    window.print();
  });

  // ---- Analytics dashboard (Plotly — interactive: zoom, pan, hover,
  // exportable PNG, range slider on the time series) ----
  const AN_COLORS = ['#4A93E8', '#16233B', '#3576C9', '#9FB1CC', '#7BB0EE', '#101B2E'];
  const AN_FONT = { family: "'Inter', Arial, sans-serif", color: '#5C6B85', size: 12 };
  const AN_CONFIG = { displayModeBar: true, displaylogo: false, responsive: true,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'] };

  function anBaseLayout(overrides){
    return Object.assign({
      font: AN_FONT,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { t: 20, r: 20, b: 40, l: 60 },
      showlegend: false,
    }, overrides || {});
  }

  function anEmpty(divId, msg){
    document.getElementById(divId).innerHTML = `<p style="color:var(--ink-soft);padding:20px 0;">${msg || 'No data in this window yet.'}</p>`;
  }

  function anPlotlyLine(divId, dates, values){
    if(!dates.length){ anEmpty(divId); return; }
    Plotly.purge(divId);
    Plotly.newPlot(divId, [{
      x: dates, y: values, type: 'scatter', mode: 'lines',
      line: { color: '#4A93E8', width: 2.5, shape: 'spline' },
      fill: 'tozeroy', fillcolor: 'rgba(74,147,232,0.12)',
      hovertemplate: 'PKR %{y:,.0f}<extra></extra>',
    }], anBaseLayout({
      height: 260,
      xaxis: { rangeslider: { visible: true, thickness: 0.08 }, showgrid: false },
      yaxis: { title: 'Revenue (PKR)', tickprefix: '', separatethousands: true, gridcolor: '#E1E8F2' },
      hovermode: 'x unified',
      margin: { t: 20, r: 20, b: 70, l: 65 },
    }), AN_CONFIG);
  }

  function anPlotlyPie(divId, labels, values, hole){
    if(!labels.length){ anEmpty(divId); return; }
    Plotly.purge(divId);
    Plotly.newPlot(divId, [{
      labels, values, type: 'pie', hole: hole ?? 0.45,
      marker: { colors: AN_COLORS },
      textinfo: 'label+percent', textfont: AN_FONT,
      hovertemplate: '%{label}: %{value:,.0f}<extra></extra>',
    }], anBaseLayout({ height: 260, showlegend: true, legend: { orientation: 'h', y: -0.15 } }), AN_CONFIG);
  }

  // Horizontal bar — categories reversed so the highest value renders at
  // the TOP (Plotly's default is bottom-to-top for the first item).
  function anPlotlyBarH(divId, labels, values, opts){
    opts = opts || {};
    if(!labels.length){ anEmpty(divId); return; }
    Plotly.purge(divId);
    Plotly.newPlot(divId, [{
      x: [...values].reverse(), y: [...labels].reverse(), type: 'bar', orientation: 'h',
      marker: { color: '#4A93E8' },
      hovertemplate: (opts.prefix || '') + '%{x:,.0f}' + (opts.suffix || '') + '<extra></extra>',
    }], anBaseLayout({
      height: Math.max(180, labels.length * 38),
      margin: { t: 10, r: 20, b: 30, l: Math.min(180, Math.max(...labels.map(l=>String(l).length)) * 6.5) },
      xaxis: { showgrid: true, gridcolor: '#E1E8F2' },
      yaxis: { automargin: true },
    }), AN_CONFIG);
  }

  function anRenderKpis(overview){
    const fmt = (n)=> new Intl.NumberFormat('en-PK').format(n||0);
    const cards = [
      ["Unique visitors", fmt(overview.unique_visitors)],
      ["Revenue", "PKR "+fmt(Math.round(overview.revenue))],
      ["Orders", fmt(overview.orders)],
      ["Avg order value", "PKR "+fmt(Math.round(overview.avg_order_value))],
      ["Bookings", fmt(overview.bookings)],
      ["Custom design requests", fmt(overview.custom_design_bookings)],
      ["New signups", fmt(overview.signups)],
      ["Total events tracked", fmt(overview.total_events)],
    ];
    document.getElementById('anKpiGrid').innerHTML = cards.map(([label,val])=>`
      <div class="an-kpi-card">
        <div class="an-kpi-label">${label}</div>
        <div class="an-kpi-value">${val}</div>
      </div>`).join('');
  }

  function anRenderFunnel(containerId, steps){
    const max = steps.length ? Math.max(...steps.map(s=>s.count), 1) : 1;
    document.getElementById(containerId).innerHTML = steps.map((s, i)=>{
      const pct = max ? Math.round((s.count/max)*100) : 0;
      const dropoff = i>0 && steps[i-1].count ? Math.round(100 - (s.count/steps[i-1].count)*100) : null;
      return `
      <div class="an-funnel-step">
        <div class="an-funnel-bar"><div class="an-funnel-fill" style="width:${Math.max(pct,4)}%;"></div>
          <div class="an-funnel-label"><span>${s.step}</span><span>${s.count}</span></div>
        </div>
        ${dropoff!==null ? `<div class="an-funnel-drop">${dropoff>0 ? '↓ '+dropoff+'% drop-off from previous step' : 'No drop-off'}</div>` : ''}
      </div>`;
    }).join('') || '<p style="color:var(--ink-soft);">No data in this window yet.</p>';
  }

  async function refreshAnalytics(){
    const days = document.getElementById('anRange').value;
    const qs = 'days='+encodeURIComponent(days);

    let overview, funnel, ecommerce, journey;
    try{
      [overview, funnel, ecommerce, journey] = await Promise.all([
        apiCall('/api/analytics/overview?'+qs, 'GET'),
        apiCall('/api/analytics/funnel?'+qs, 'GET'),
        apiCall('/api/analytics/ecommerce?'+qs, 'GET'),
        apiCall('/api/analytics/journey?'+qs, 'GET'),
      ]);
    }catch(e){
      document.getElementById('anKpiGrid').innerHTML = '<p style="color:var(--primary-dark);">Could not load analytics: '+e.message+'</p>';
      return;
    }

    anRenderKpis(overview);
    anRenderFunnel('anShopFunnel', funnel.shop_funnel);
    anRenderFunnel('anLeadFunnel', funnel.lead_funnel);

    anPlotlyLine('anRevenueChart', ecommerce.revenue_by_day.map(d=>d.date), ecommerce.revenue_by_day.map(d=>d.revenue));

    anPlotlyPie('anSourceChart', ecommerce.revenue_by_source.map(s=>s.source), ecommerce.revenue_by_source.map(s=>s.revenue));

    anPlotlyBarH('anTopProducts', ecommerce.top_products.map(p=>p.name), ecommerce.top_products.map(p=>p.revenue), { prefix: 'PKR ' });

    anPlotlyBarH('anRevenueChannel', ecommerce.revenue_by_channel.map(c=>c.channel), ecommerce.revenue_by_channel.map(c=>c.revenue), { prefix: 'PKR ' });

    anPlotlyBarH('anBookingsChannel', ecommerce.bookings_by_channel.map(c=>c.channel), ecommerce.bookings_by_channel.map(c=>c.count));

    anPlotlyBarH('anTopCities', ecommerce.revenue_by_city.map(c=>c.city), ecommerce.revenue_by_city.map(c=>c.revenue), { prefix: 'PKR ' });

    anPlotlyPie('anBookingSources', ecommerce.booking_sources.map(b=>b.source === 'custom_design' ? 'Custom design request' : 'Standard booking'), ecommerce.booking_sources.map(b=>b.count), 0.5);

    document.getElementById('anTransitions').innerHTML = journey.top_transitions.map(t=>`
      <div class="an-transition-row" style="margin-bottom:8px;">
        <span class="an-path">${t.from || '(unknown)'} → ${t.to || '(unknown)'}</span>
        <span class="an-count">${t.count}</span>
      </div>`).join('') || '<p style="color:var(--ink-soft);">No page-transition data yet — needs real visitor traffic with analytics consent accepted.</p>';

    anPlotlyBarH('anEntryPages', journey.top_entry_pages.map(p=>p.page || '(unknown)'), journey.top_entry_pages.map(p=>p.count));
  }

  document.getElementById('anRange')?.addEventListener('change', refreshAnalytics);

  if(getKey()){
    document.getElementById('adminGate').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    refreshList();
    refreshTailorDropdown();
    refreshTailorList();
    refreshFabricList();
    refreshFittingList();
    refreshTechPackBookingDropdown();
    refreshTechPackFabricDropdown();
    refreshTechPackList();
    refreshAnalytics();
  }
}
