/* ============================================================
   CONSENT BANNER
   Shows once per visitor until they make a choice. "Accept" calls
   tiflStartAnalytics() (defined in rudderstack.js) to actually load
   the SDK — nothing analytics-related runs before that. "Reject"
   just records the choice; the site works identically either way,
   only tracking is affected.
   Load order matters: rudderstack.js, then this file, then script.js.
============================================================= */

function tiflGetConsent(){
  try{ return JSON.parse(localStorage.getItem('tifl_consent') || 'null'); }
  catch(e){ return null; }
}
function tiflSetConsent(analytics){
  try{
    localStorage.setItem('tifl_consent', JSON.stringify({ analytics, decided_at: new Date().toISOString() }));
  }catch(e){ /* storage unavailable — consent just won't persist across visits */ }
}

function tiflInjectConsentStyles(){
  if(document.getElementById('tiflConsentStyles')) return;
  const style = document.createElement('style');
  style.id = 'tiflConsentStyles';
  style.textContent = `
    .tifl-consent-bar{position:fixed;left:0;right:0;bottom:0;z-index:1200;background:var(--bg);border-top:1px solid var(--line);box-shadow:0 -8px 24px -12px rgba(31,42,61,.18);padding:18px 24px;display:none;}
    .tifl-consent-bar.show{display:block;animation:tiflConsentUp .3s ease;}
    @keyframes tiflConsentUp{from{transform:translateY(100%);}to{transform:translateY(0);}}
    .tifl-consent-inner{max-width:1180px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap;}
    .tifl-consent-text{flex:1;min-width:240px;font-size:13.3px;color:var(--ink-soft);line-height:1.5;}
    .tifl-consent-text a{color:var(--primary-dark);font-weight:600;text-decoration:none;}
    .tifl-consent-actions{display:flex;gap:10px;flex-wrap:wrap;}
    @media (max-width:560px){ .tifl-consent-bar{padding:16px;} .tifl-consent-actions{width:100%;} .tifl-consent-actions .btn{flex:1;} }
  `;
  document.head.appendChild(style);
}

function tiflBuildConsentBanner(){
  if(document.getElementById('tiflConsentBar')) return document.getElementById('tiflConsentBar');
  tiflInjectConsentStyles();
  const bar = document.createElement('div');
  bar.className = 'tifl-consent-bar';
  bar.id = 'tiflConsentBar';
  bar.innerHTML = `
    <div class="tifl-consent-inner">
      <p class="tifl-consent-text">
        We use cookies for cart/account features and, with your permission, to understand how visitors use the site.
        See our <a href="cookie-policy.html">Cookie Policy</a> and <a href="privacy-policy.html">Privacy Policy</a>.
      </p>
      <div class="tifl-consent-actions">
        <button class="btn btn-ghost btn-sm" id="tiflConsentReject">Reject non-essential</button>
        <button class="btn btn-primary btn-sm" id="tiflConsentAccept">Accept all</button>
      </div>
    </div>`;
  document.body.appendChild(bar);

  document.getElementById('tiflConsentAccept').addEventListener('click', ()=>{
    tiflSetConsent(true);
    bar.classList.remove('show');
    if(typeof tiflStartAnalytics === 'function') tiflStartAnalytics();
  });
  document.getElementById('tiflConsentReject').addEventListener('click', ()=>{
    tiflSetConsent(false);
    bar.classList.remove('show');
  });
  return bar;
}

// Exposed so a "Cookie preferences" footer link can reopen this anytime,
// even after a decision was already made.
function tiflOpenConsentBanner(){
  const bar = tiflBuildConsentBanner();
  bar.classList.add('show');
}

document.addEventListener('DOMContentLoaded', ()=>{
  const existing = tiflGetConsent();
  if(existing === null){
    tiflOpenConsentBanner();
  }
  // Wire up any footer "Cookie preferences" link present on the page.
  document.querySelectorAll('[data-open-consent]').forEach(el=>{
    el.addEventListener('click', (e)=>{ e.preventDefault(); tiflOpenConsentBanner(); });
  });
});
