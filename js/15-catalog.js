/* Chittam Enterprises — Product Catalog v2 */
"use strict";

(() => {
  const PHOTO_KEY = "ce_catalog_photos_v2";

  const products = () =>
    (typeof getProducts === "function" ? getProducts() || [] : []).map((p,i) => ({
      raw:p,
      id:String(p.id ?? p.productId ?? p.name ?? i),
      name:p.name || p.productName || "Product",
      category:p.category || p.productCategory || "General",
      price:p.price ?? p.sellingPrice ?? p.rate ?? "",
      brand:p.brand || "",
      description:p.description || p.specifications || ""
    }));

  const photos = () => {
    try { return JSON.parse(localStorage.getItem(PHOTO_KEY) || "{}"); }
    catch (_) { return {}; }
  };
  const savePhotos = x => localStorage.setItem(PHOTO_KEY, JSON.stringify(x));
  const esc = x => String(x ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money = x => {
    if (x === "" || x == null) return "Price on request";
    const n = Number(x);
    return Number.isFinite(n) ? "₹"+n.toLocaleString("en-IN",{maximumFractionDigits:2}) : String(x);
  };

  function styles() {
    if (document.getElementById("ce-cat-v2-css")) return;
    const s=document.createElement("style");
    s.id="ce-cat-v2-css";
    s.textContent=`
      .ce-cat-heading{padding:13px 20px 6px;font-size:11px;font-weight:800;letter-spacing:.08em;color:#8b8f98}
      .ce-cat-nav{display:flex!important;align-items:center;gap:8px;cursor:pointer}
      .ce-cat-nav.ce-on{background:#2563eb!important;color:#fff!important;border-radius:9px}
      .ce-cat-tools{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0 14px}
      .ce-cat-tools input,.ce-cat-tools select{min-height:42px;padding:9px 13px;border:1px solid #d8dee9;border-radius:10px;background:#fff;font:inherit}
      .ce-cat-tools input{min-width:250px;flex:1}
      .ce-cat-btn{border:0;border-radius:10px;padding:10px 14px;font-weight:700;cursor:pointer;font:inherit}
      .ce-green{background:#16c96b;color:#fff}.ce-light{background:#eef2ff;color:#172554}
      .ce-count{padding:10px 13px;margin-bottom:14px;background:#f7f8fa;border-radius:10px;color:#475467;font-size:13px}
      .ce-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
      .ce-card{border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 3px 12px rgba(0,0,0,.05)}
      .ce-img{height:190px;background:#f4f6f8;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
      .ce-img img{width:100%;height:100%;object-fit:contain}.ce-placeholder{font-size:52px;opacity:.35}
      .ce-check{position:absolute!important;z-index:3;top:11px;left:11px;width:21px!important;height:21px!important;accent-color:#2563eb}
      .ce-body{padding:14px}.ce-brand{font-size:11px;font-weight:800;color:#2563eb;text-transform:uppercase}
      .ce-meta{font-size:12px;color:#667085;margin:5px 0}.ce-body h3{margin:0 0 7px;font-size:16px;line-height:1.25}
      .ce-price{font-size:18px;font-weight:800;margin-bottom:12px}.ce-actions{display:flex;gap:7px;flex-wrap:wrap}
      .ce-actions button{border:0;border-radius:9px;padding:9px 10px;cursor:pointer;font:inherit}.ce-photo{background:#eef2ff}.ce-share{background:#25D366;color:#fff}
      .ce-empty{text-align:center;padding:35px;color:#667085}
      .ce-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.58);display:flex;align-items:center;justify-content:center;padding:20px}
      .ce-modal{width:min(720px,100%);max-height:90vh;overflow:auto;background:#fff;border-radius:18px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
      .ce-modal-head{display:flex;justify-content:space-between;align-items:center}.ce-modal-head h2{margin:0}
      .ce-preview{margin:16px 0;border:1px solid #e5e7eb;border-radius:14px;padding:16px}
      .ce-row{display:flex;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid #edf0f3}.ce-row:last-child{border:0}
      .ce-row img,.ce-noimg{width:70px;height:70px;object-fit:contain;border-radius:10px;background:#f3f4f6;flex:0 0 70px}
      .ce-row-name{font-weight:700}.ce-row-price{font-weight:800;margin-top:3px}.ce-modal-actions{display:flex;justify-content:flex-end;gap:9px;flex-wrap:wrap}
      @media(max-width:650px){.ce-cat-tools input{width:100%;min-width:0}.ce-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.ce-img{height:150px}}
    `;
    document.head.appendChild(s);
  }

  function fixNav() {
    const links=[...document.querySelectorAll("a,button")];
    links.filter(x=>/📖?\s*(Catalog|Product Catalog)/i.test(x.textContent.trim()) && x.id!=="ce-catalog-nav").forEach(x=>x.remove());
    if(document.getElementById("ce-catalog-nav")) return;

    const payment=links.find(x=>/Payment Reminder/i.test(x.textContent.trim()));
    const db=links.find(x=>/Product Database/i.test(x.textContent.trim()));
    const target=payment||db;
    if(!target||!target.parentElement) return;

    const nav=document.createElement("a");
    nav.id="ce-catalog-nav"; nav.href="#";
    nav.className=target.className||"";
    nav.classList.add("ce-cat-nav");
    nav.innerHTML="📖 <span>Product Catalog</span>";
    nav.onclick=e=>{e.preventDefault();showCatalog();};

    target.parentElement.insertBefore(nav,target);

    const heading=document.createElement("div");
    heading.id="ce-cat-heading"; heading.className="ce-cat-heading";
    heading.textContent="SALES & CATALOG";
    target.parentElement.insertBefore(heading,nav);
  }

  function view() {
    if(document.getElementById("view-catalog")) return;
    const main=document.querySelector("main")||document.body;
    const sec=document.createElement("section");
    sec.id="view-catalog"; sec.style.display="none";
    sec.innerHTML=`
      <div class="page-header"><h1>📖 Product Catalog</h1><p>Create and share a customer-ready catalog through WhatsApp.</p></div>
      <div class="ce-cat-tools">
        <input id="ce-search" type="search" placeholder="Search product, brand or category…">
        <select id="ce-category"><option value="">All categories</option></select>
        <button id="ce-all" class="ce-cat-btn ce-light">☑ Select All</button>
        <button id="ce-clear" class="ce-cat-btn ce-light">☐ Clear</button>
        <button id="ce-preview-btn" class="ce-cat-btn ce-green">👁 Preview & Share</button>
      </div>
      <div id="ce-count" class="ce-count">0 products selected</div>
      <div id="ce-grid" class="ce-grid"></div>`;
    main.appendChild(sec);
    document.getElementById("ce-search").oninput=render;
    document.getElementById("ce-category").onchange=render;
    document.getElementById("ce-all").onclick=()=>{document.querySelectorAll("#ce-grid .ce-check").forEach(x=>x.checked=true);count();};
    document.getElementById("ce-clear").onclick=()=>{document.querySelectorAll("#ce-grid .ce-check").forEach(x=>x.checked=false);count();};
    document.getElementById("ce-preview-btn").onclick=preview;
  }

  function filtered() {
    const q=(document.getElementById("ce-search")?.value||"").toLowerCase().trim();
    const cat=document.getElementById("ce-category")?.value||"";
    return products().filter(p=>(!q||`${p.name} ${p.brand} ${p.category} ${p.description}`.toLowerCase().includes(q))&&(!cat||p.category===cat));
  }

  function render() {
    const list=products(), select=document.getElementById("ce-category"), old=select?.value||"";
    const cats=[...new Set(list.map(p=>p.category).filter(Boolean))].sort();
    if(select){select.innerHTML='<option value="">All categories</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");select.value=cats.includes(old)?old:"";}
    const data=filtered(), ph=photos(), grid=document.getElementById("ce-grid");
    if(!data.length){grid.innerHTML='<div class="ce-empty">No products found. Add products in Product Database first.</div>';count();return;}
    grid.innerHTML=data.map(p=>`
      <article class="ce-card"><div class="ce-img">
        <input class="ce-check" type="checkbox" data-id="${esc(p.id)}">
        ${ph[p.id]?`<img src="${ph[p.id]}" alt="${esc(p.name)}">`:'<div class="ce-placeholder">📦</div>'}
      </div><div class="ce-body">
        ${p.brand?`<div class="ce-brand">${esc(p.brand)}</div>`:""}
        <div class="ce-meta">${esc(p.category)}</div><h3>${esc(p.name)}</h3>
        <div class="ce-price">${money(p.price)}</div>
        <div class="ce-actions">
          <button class="ce-photo" data-photo="${esc(p.id)}">📷 ${ph[p.id]?"Change Photo":"Add Photo"}</button>
          <button class="ce-share" data-share="${esc(p.id)}">📲 Share</button>
        </div><input type="file" accept="image/*" hidden data-file="${esc(p.id)}">
      </div></article>`).join("");

    grid.querySelectorAll(".ce-check").forEach(x=>x.onchange=count);
    grid.querySelectorAll("[data-photo]").forEach(b=>b.onclick=()=>grid.querySelector(`[data-file="${CSS.escape(b.dataset.photo)}"]`)?.click());
    grid.querySelectorAll("[data-file]").forEach(i=>i.onchange=async()=>{if(!i.files?.[0])return;try{const x=ph;x[i.dataset.file]=await compress(i.files[0]);savePhotos(x);render();}catch(_){alert("Could not process the image.");}});
    grid.querySelectorAll("[data-share]").forEach(b=>b.onclick=()=>{const p=products().find(x=>x.id===b.dataset.share);if(p)share([p]);});
    count();
  }

  function count(){const n=document.querySelectorAll("#ce-grid .ce-check:checked").length;const e=document.getElementById("ce-count");if(e)e.textContent=`${n} product${n===1?"":"s"} selected`;}
  function selected(){const ids=[...document.querySelectorAll("#ce-grid .ce-check:checked")].map(x=>x.dataset.id);return products().filter(p=>ids.includes(p.id));}

  function compress(file,max=1000){
    return new Promise((resolve,reject)=>{const r=new FileReader(),img=new Image();r.onload=()=>{img.onload=()=>{const k=Math.min(1,max/Math.max(img.width,img.height)),c=document.createElement("canvas");c.width=Math.max(1,Math.round(img.width*k));c.height=Math.max(1,Math.round(img.height*k));const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);ctx.drawImage(img,0,0,c.width,c.height);resolve(c.toDataURL("image/jpeg",.8));};img.onerror=reject;img.src=r.result;};r.onerror=reject;r.readAsDataURL(file);});
  }

  function message(list){return `*CHITTAM ENTERPRISES — PRODUCT CATALOG*\\n\\n`+list.map(p=>`📦 *${p.name}*${p.brand?`\\nBrand: ${p.brand}`:""}\\nCategory: ${p.category}\\n💰 ${money(p.price)}`).join("\\n\\n")+`\\n\\n📲 Contact us for availability and order details.`;}

  function preview(){
    const list=selected();if(!list.length){alert("Select at least one product first.");return;}
    const ph=photos(),b=document.createElement("div");b.className="ce-backdrop";b.id="ce-preview-modal";
    b.innerHTML=`<div class="ce-modal"><div class="ce-modal-head"><h2>Catalog Preview</h2><button id="ce-close" class="ce-cat-btn ce-light">✕ Close</button></div>
      <div class="ce-preview">${list.map(p=>`<div class="ce-row">${ph[p.id]?`<img src="${ph[p.id]}" alt="">`:'<div class="ce-noimg" style="display:flex;align-items:center;justify-content:center">📦</div>'}<div><div class="ce-row-name">${esc(p.name)}</div><div>${esc(p.category)}</div><div class="ce-row-price">${money(p.price)}</div></div></div>`).join("")}</div>
      <div class="ce-modal-actions"><button id="ce-copy" class="ce-cat-btn ce-light">📋 Copy Message</button><button id="ce-wa" class="ce-cat-btn ce-green">📲 Share to WhatsApp</button></div></div>`;
    document.body.appendChild(b);
    document.getElementById("ce-close").onclick=()=>b.remove();
    b.onclick=e=>{if(e.target===b)b.remove();};
    const text=message(list);
    document.getElementById("ce-copy").onclick=async()=>{try{await navigator.clipboard.writeText(text);alert("Catalog message copied.");}catch(_){alert("Copy failed.");}};
    document.getElementById("ce-wa").onclick=async()=>{await share(list);b.remove();};
  }

  async function share(list){
    const text=message(list),ph=photos();
    if(navigator.share&&navigator.canShare){
      try{
        const files=[];
        for(let i=0;i<list.length;i++){if(!ph[list[i].id])continue;const blob=await(await fetch(ph[list[i].id])).blob();files.push(new File([blob],`chittam-product-${i+1}.jpg`,{type:"image/jpeg"}));}
        if(files.length&&navigator.canShare({files})){await navigator.share({title:"Chittam Enterprises Product Catalog",text,files});return;}
      }catch(e){if(e?.name==="AbortError")return;}
    }
    try{await navigator.clipboard.writeText(text);}catch(_){}
    window.open("https://wa.me/?text="+encodeURIComponent(text),"_blank");
  }

  function showCatalog(){
    view();
    document.querySelectorAll("main > section, main > div[id^='view-']").forEach(x=>{if(x.id!=="view-catalog")x.style.display="none";});
    document.getElementById("view-catalog").style.display="";
    document.getElementById("ce-catalog-nav")?.classList.add("ce-on");
    render();
  }

  function init(){
    styles();fixNav();view();
    setTimeout(fixNav,250);setTimeout(fixNav,1000);
  }

  window.ChittamCatalog={init,showCatalog,render,preview};
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init();
})();
