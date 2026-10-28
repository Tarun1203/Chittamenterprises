/* Chittam Enterprises — WhatsApp Product Catalog */
"use strict";

(() => {
  const PHOTO_KEY = "ce_catalog_photos_v1";

  function getPhotos() {
    try { return JSON.parse(localStorage.getItem(PHOTO_KEY) || "{}"); }
    catch (_) { return {}; }
  }
  function savePhotos(data) {
    localStorage.setItem(PHOTO_KEY, JSON.stringify(data));
  }

  function catalogProducts() {
    return typeof getProducts === "function" ? (getProducts() || []) : [];
  }

  function money(v) {
    if (v === "" || v == null) return "Price on request";
    const n = Number(v);
    return Number.isFinite(n)
      ? "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 })
      : String(v);
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function makeMessage(p) {
    return `*Chittam Enterprises*\n\n📦 *${p.name || "Product"}*\nCategory: ${p.category || "General"}\n💰 Price: ${money(p.price)}\n\n📲 Contact us for availability and order details.`;
  }

  function openWhatsApp(text) {
    window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
  }

  function compressImage(file, max = 900) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const reader = new FileReader();
      reader.onload = () => {
        img.onload = () => {
          const scale = Math.min(1, max / Math.max(img.width, img.height));
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/jpeg", 0.78));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function addStyles() {
    if (document.getElementById("ce-catalog-styles")) return;
    const style = document.createElement("style");
    style.id = "ce-catalog-styles";
    style.textContent = `
      .ce-cat-toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
      .ce-cat-toolbar input,.ce-cat-toolbar select{min-height:42px;padding:9px 12px;border:1px solid #d8dee9;border-radius:10px}
      .ce-cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
      .ce-cat-card{border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;background:#fff;box-shadow:0 3px 12px rgba(0,0,0,.05)}
      .ce-cat-img{height:190px;background:#f4f6f8;display:flex;align-items:center;justify-content:center;position:relative}
      .ce-cat-img img{width:100%;height:100%;object-fit:contain}
      .ce-cat-placeholder{font-size:52px;opacity:.35}
      .ce-cat-body{padding:14px}
      .ce-cat-body h3{margin:0 0 6px;font-size:17px}
      .ce-cat-meta{font-size:13px;color:#667085;margin-bottom:8px}
      .ce-cat-price{font-weight:800;font-size:18px;margin-bottom:12px}
      .ce-cat-actions{display:flex;gap:8px;flex-wrap:wrap}
      .ce-cat-actions button{border:0;border-radius:9px;padding:9px 11px;cursor:pointer}
      .ce-cat-share{background:#25D366;color:#fff}
      .ce-cat-photo{background:#eef2ff}
      .ce-cat-select{position:absolute;top:10px;left:10px;width:20px;height:20px}
      .ce-cat-empty{padding:35px;text-align:center;color:#667085}
    `;
    document.head.appendChild(style);
  }

  function ensureNav() {
    const nav = document.querySelector("nav, .sidebar, .nav");
    if (!nav) return;
    if (document.getElementById("nav-catalog")) return;

    const a = document.createElement("a");
    a.id = "nav-catalog";
    a.href = "#";
    a.textContent = "📖 Catalog";
    a.addEventListener("click", e => {
      e.preventDefault();
      showCatalog();
    });
    nav.appendChild(a);
  }

  function ensureView() {
    if (document.getElementById("view-catalog")) return;
    const main = document.querySelector("main") || document.body;
    const section = document.createElement("section");
    section.id = "view-catalog";
    section.style.display = "none";
    section.innerHTML = `
      <div class="page-header">
        <h1>📖 Product Catalog</h1>
        <p>Share products with photos and prices directly through WhatsApp.</p>
      </div>
      <div class="ce-cat-toolbar">
        <input id="ce-cat-search" type="search" placeholder="Search products…">
        <select id="ce-cat-category"><option value="">All categories</option></select>
        <button id="ce-cat-share-selected" class="ce-cat-share">📲 Share Selected</button>
      </div>
      <div id="ce-cat-grid" class="ce-cat-grid"></div>
    `;
    main.appendChild(section);
    document.getElementById("ce-cat-search").addEventListener("input", render);
    document.getElementById("ce-cat-category").addEventListener("change", render);
    document.getElementById("ce-cat-share-selected").addEventListener("click", shareSelected);
  }

  function showCatalog() {
    ensureView();
    document.querySelectorAll("main > section, main > div[id^='view-']").forEach(el => {
      if (el.id !== "view-catalog") el.style.display = "none";
    });
    document.getElementById("view-catalog").style.display = "";
    render();
  }

  function render() {
    const grid = document.getElementById("ce-cat-grid");
    if (!grid) return;
    const products = catalogProducts();
    const photos = getPhotos();
    const q = (document.getElementById("ce-cat-search")?.value || "").toLowerCase();
    const cat = document.getElementById("ce-cat-category")?.value || "";

    const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();
    const select = document.getElementById("ce-cat-category");
    if (select) {
      const current = select.value;
      select.innerHTML = `<option value="">All categories</option>` +
        categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
      select.value = categories.includes(current) ? current : cat;
    }

    const filtered = products.filter(p =>
      (!q || `${p.name} ${p.category}`.toLowerCase().includes(q)) &&
      (!cat || p.category === cat)
    );

    if (!filtered.length) {
      grid.innerHTML = `<div class="ce-cat-empty">No products found. Add products in Product Database first.</div>`;
      return;
    }

    grid.innerHTML = filtered.map((p, i) => {
      const id = p.id ?? p.name ?? i;
      const photo = photos[id];
      return `
        <article class="ce-cat-card">
          <div class="ce-cat-img">
            <input class="ce-cat-select" type="checkbox" data-select="${escapeHtml(id)}" title="Select product">
            ${photo ? `<img src="${photo}" alt="${escapeHtml(p.name)}">` : `<div class="ce-cat-placeholder">📦</div>`}
          </div>
          <div class="ce-cat-body">
            <div class="ce-cat-meta">${escapeHtml(p.category || "General")}</div>
            <h3>${escapeHtml(p.name || "Product")}</h3>
            <div class="ce-cat-price">${money(p.price)}</div>
            <div class="ce-cat-actions">
              <button class="ce-cat-photo" data-photo="${escapeHtml(id)}">📷 ${photo ? "Change Photo" : "Add Photo"}</button>
              <button class="ce-cat-share" data-share="${escapeHtml(id)}">📲 Share</button>
            </div>
            <input type="file" accept="image/*" hidden data-file="${escapeHtml(id)}">
          </div>
        </article>`;
    }).join("");

    grid.querySelectorAll("[data-photo]").forEach(btn => {
      btn.onclick = () => grid.querySelector(`[data-file="${CSS.escape(btn.dataset.photo)}"]`)?.click();
    });
    grid.querySelectorAll("[data-file]").forEach(input => {
      input.onchange = async () => {
        if (!input.files?.[0]) return;
        try {
          const data = getPhotos();
          data[input.dataset.file] = await compressImage(input.files[0]);
          savePhotos(data);
          render();
        } catch (e) {
          alert("Could not process the image.");
        }
      };
    });
    grid.querySelectorAll("[data-share]").forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.share;
        const p = products.find(x => String(x.id ?? x.name) === String(id));
        if (!p) return;
        const photo = getPhotos()[id];
        const text = makeMessage(p);
        if (photo && navigator.share && navigator.canShare) {
          try {
            const blob = await (await fetch(photo)).blob();
            const file = new File([blob], "product.jpg", {type:"image/jpeg"});
            if (navigator.canShare({files:[file]})) {
              await navigator.share({text, files:[file]});
              return;
            }
          } catch (_) {}
        }
        try { await navigator.clipboard.writeText(text); } catch (_) {}
        openWhatsApp(text);
      };
    });
  }

  function shareSelected() {
    const ids = [...document.querySelectorAll("[data-select]:checked")].map(x => x.dataset.select);
    const products = catalogProducts().filter(p => ids.includes(String(p.id ?? p.name)));
    if (!products.length) {
      alert("Select at least one product.");
      return;
    }
    const text = `*CHITTAM ENTERPRISES — PRODUCT CATALOG*\n\n` +
      products.map(p => `📦 *${p.name || "Product"}* — ${money(p.price)}${p.category ? `\n   ${p.category}` : ""}`).join("\n\n") +
      `\n\n📲 Contact us for availability and order details.`;
    try { navigator.clipboard.writeText(text); } catch (_) {}
    openWhatsApp(text);
  }

  function init() {
    addStyles();
    ensureNav();
    ensureView();
  }

  window.ChittamCatalog = { init, showCatalog, render };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
