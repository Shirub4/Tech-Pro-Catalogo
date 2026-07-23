import { supabase } from "./supabase-client.js?v=20260722-avisoptbr1";
import { createOrderPdf } from "./pdf.js?v=20260722-pdfgrupos1";
import {
  escapeHtml,
  formatCurrency,
  formatGigabytes,
  sanitizePhone,
  setButtonLoading,
  showToast,
} from "./utils.js?v=20260722-avisoptbr1";

const DEFAULT_SETTINGS = {
  id: 1,
  brand_name: "Tech Pro",
  subtitle: "Escolha os itens e envie sua seleção",
  whatsapp_number: "5522999167083",
  whatsapp_message: "Olá! Acabei de montar uma seleção pelo catálogo da Tech Pro.",
};

const GB_MARKER_REGEX = /\[\[TECHPRO_GB:([0-9]+(?:[.,][0-9]+)?)\]\]/i;
const DISPLAY_MARKER_REGEX = /\[\[TECHPRO_DISPLAY:P([01])G([01])\]\]/i;
const IMAGES_MARKER_REGEX = /\[\[TECHPRO_IMAGES:([^\]]*)\]\]/i;
const PORTUGUESE_MARKER_REGEX = /\[\[TECHPRO_PTBR:([01])\]\]/i;
const LEGACY_PORTUGUESE_NOTICE_REGEX = /JOGO\s+DUBLADO\s+OU\s+LEGENDADO\s+EM\s+PORTUGU[ÊE]S/gi;

function stripTechProMarkers(details = "") {
  return String(details || "")
    .replace(/\n?\[\[TECHPRO_GB:[^\]]*\]\]/gi, "")
    .replace(/\n?\[\[TECHPRO_DISPLAY:[^\]]*\]\]/gi, "")
    .replace(/\n?\[\[TECHPRO_IMAGES:[^\]]*\]\]/gi, "")
    .replace(/\n?\[\[TECHPRO_PTBR:[^\]]*\]\]/gi, "")
    .replace(LEGACY_PORTUGUESE_NOTICE_REGEX, "")
    .replace(/^[\s•\-–—,;:.]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractGbFromDetails(details = "") {
  const match = String(details || "").match(GB_MARKER_REGEX);
  if (!match) return 0;
  const value = Number(String(match[1]).replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function extractDisplayOptions(details = "") {
  const match = String(details || "").match(DISPLAY_MARKER_REGEX);
  return {
    show_price: match ? match[1] === "1" : true,
    show_gb: match ? match[2] === "1" : true,
  };
}

function extractPortugueseOption(details = "") {
  const value = String(details || "");
  const marker = value.match(PORTUGUESE_MARKER_REGEX);
  if (marker) return marker[1] === "1";
  return /JOGO\s+DUBLADO\s+OU\s+LEGENDADO\s+EM\s+PORTUGU[ÊE]S/i.test(value);
}

function extractExtraImagePaths(details = "") {
  const match = String(details || "").match(IMAGES_MARKER_REGEX);
  if (!match || !match[1]) return [];
  try {
    const value = JSON.parse(decodeURIComponent(match[1]));
    return Array.isArray(value)
      ? [...new Set(value.map((path) => String(path || "").trim()).filter(Boolean))]
      : [];
  } catch {
    return [];
  }
}

function normalizeItemMetadata(item) {
  const columnValue = Number(item?.size_gb);
  const markerValue = extractGbFromDetails(item?.details);
  const display = extractDisplayOptions(item?.details);
  const extraImagePaths = extractExtraImagePaths(item?.details);
  const portuguese = extractPortugueseOption(item?.details);
  const galleryPaths = [...new Set([item?.image_path, ...extraImagePaths].filter(Boolean))];
  return {
    ...item,
    details: stripTechProMarkers(item?.details),
    size_gb: Number.isFinite(columnValue) && columnValue > 0 ? columnValue : markerValue,
    show_price: display.show_price,
    show_gb: display.show_gb,
    portuguese,
    gallery_paths: galleryPaths,
  };
}

function isMissingColumnError(error, columnName) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    message.includes(columnName.toLowerCase()) &&
    (message.includes("schema cache") || message.includes("could not find") || error?.code === "PGRST204")
  );
}

function translateCatalogDatabaseError(error) {
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();
  if (lower.includes("schema cache") && (lower.includes("size_gb") || lower.includes("total_gb"))) {
    return "O navegador ainda está usando uma versão antiga do catálogo. Atualize a página com Ctrl + F5.";
  }
  return message || "Não foi possível registrar a seleção.";
}

const DEMO_GROUPS = [
  { id: "demo-1", name: "Videogames", sort_order: 1, active: true },
  { id: "demo-2", name: "Acessórios", sort_order: 2, active: true },
  { id: "demo-3", name: "Serviços", sort_order: 3, active: true },
];

const DEMO_ITEMS = [
  {
    id: "item-1",
    group_id: "demo-1",
    group_name: "Videogames",
    name: "PlayStation 3 Slim",
    description: "Console revisado e testado, pronto para uso.",
    details: "Desbloqueado HEN/CFW\n3 meses de garantia",
    price: 899,
    size_gb: 25.4,
    active: true,
    sort_order: 1,
  },
  {
    id: "item-2",
    group_id: "demo-2",
    group_name: "Acessórios",
    name: "Controle sem fio",
    description: "Controle compatível com videogame, com teste completo.",
    details: "Consulte cores e disponibilidade.",
    price: 129.9,
    size_gb: null,
    active: true,
    sort_order: 2,
  },
  {
    id: "item-3",
    group_id: "demo-3",
    group_name: "Serviços",
    name: "Manutenção preventiva",
    description: "Limpeza, revisão e troca de pasta térmica.",
    details: "O valor final depende do aparelho.",
    price: null,
    size_gb: 0,
    active: true,
    sort_order: 3,
  },
];


function ensureSelectionDock() {
  let dock = document.querySelector(".selection-dock");
  let openButton = document.getElementById("openSelectionBtn");
  let countBadge = document.getElementById("selectionCount");

  if (!dock) {
    dock = document.createElement("div");
    dock.id = "techProSelectionDock";
    dock.className = "selection-dock";
    dock.setAttribute("aria-label", "Resumo da escolha");

    const valueMetric = document.createElement("div");
    valueMetric.className = "selection-dock-metric";
    valueMetric.innerHTML = '<span>Valor</span><strong id="floatingSelectionValue">R$ 0,00</strong>';

    const gbMetric = document.createElement("div");
    gbMetric.className = "selection-dock-metric";
    gbMetric.innerHTML = '<span>GB</span><strong id="floatingSelectionGb">0 GB</strong>';

    if (!openButton) {
      openButton = document.createElement("button");
      openButton.id = "openSelectionBtn";
      openButton.type = "button";
    }

    openButton.classList.add("primary-button", "cart-button", "selection-dock-button");
    openButton.innerHTML = 'Minha escolha <span id="selectionCount" class="count-badge">0</span>';

    dock.append(valueMetric, gbMetric, openButton);
    document.body.appendChild(dock);
  } else {
    dock.id = dock.id || "techProSelectionDock";

    if (!document.getElementById("floatingSelectionValue")) {
      const valueMetric = document.createElement("div");
      valueMetric.className = "selection-dock-metric";
      valueMetric.innerHTML = '<span>Valor</span><strong id="floatingSelectionValue">R$ 0,00</strong>';
      dock.prepend(valueMetric);
    }

    if (!document.getElementById("floatingSelectionGb")) {
      const gbMetric = document.createElement("div");
      gbMetric.className = "selection-dock-metric";
      gbMetric.innerHTML = '<span>GB</span><strong id="floatingSelectionGb">0 GB</strong>';
      const valueMetric = document.getElementById("floatingSelectionValue")?.closest(".selection-dock-metric");
      valueMetric?.after(gbMetric);
    }

    if (!openButton) {
      openButton = document.createElement("button");
      openButton.id = "openSelectionBtn";
      openButton.type = "button";
      openButton.className = "primary-button cart-button selection-dock-button";
      openButton.innerHTML = 'Minha escolha <span id="selectionCount" class="count-badge">0</span>';
      dock.appendChild(openButton);
    } else if (!dock.contains(openButton)) {
      openButton.classList.add("selection-dock-button");
      dock.appendChild(openButton);
    }

    countBadge = document.getElementById("selectionCount");
    if (!countBadge) {
      countBadge = document.createElement("span");
      countBadge.id = "selectionCount";
      countBadge.className = "count-badge";
      countBadge.textContent = "0";
      openButton.append(" ", countBadge);
    }
  }

  if (!document.getElementById("techProSelectionDockStyles")) {
    const style = document.createElement("style");
    style.id = "techProSelectionDockStyles";
    style.textContent = `
      .selection-dock {
        position: fixed !important;
        right: 22px !important;
        bottom: 22px !important;
        left: auto !important;
        z-index: 2147483000 !important;
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        align-items: stretch !important;
        gap: 8px !important;
        padding: 8px !important;
        border: 1px solid rgba(255,255,255,.15) !important;
        border-radius: 17px !important;
        background: rgba(7,26,51,.97) !important;
        color: #fff !important;
        box-shadow: 0 18px 45px rgba(4,14,28,.38) !important;
        transform: none !important;
      }
      .selection-dock.selection-dock-hidden {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      .selection-dock-metric {
        min-width: 98px !important;
        padding: 7px 11px !important;
        display: flex !important;
        flex-direction: column !important;
        justify-content: center !important;
        border-radius: 11px !important;
        background: rgba(255,255,255,.08) !important;
      }
      .selection-dock-metric span {
        color: #b7c9df !important;
        font-size: .66rem !important;
        font-weight: 700 !important;
        text-transform: uppercase !important;
        letter-spacing: .07em !important;
      }
      .selection-dock-metric strong {
        margin-top: 2px !important;
        color: #fff !important;
        font-size: .92rem !important;
        white-space: nowrap !important;
      }
      .selection-dock-button {
        min-height: 52px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        white-space: nowrap !important;
      }
      @media (max-width: 760px) {
        .selection-dock {
          right: 10px !important;
          bottom: 10px !important;
          left: 10px !important;
        }
        .selection-dock-metric { flex: 1 !important; min-width: 0 !important; }
      }
      @media (max-width: 500px) {
        .selection-dock { gap: 5px !important; padding: 6px !important; }
        .selection-dock-metric { padding: 5px 7px !important; }
        .selection-dock-metric strong { font-size: .78rem !important; }
        .selection-dock-button { min-height: 48px !important; padding-inline: 11px !important; font-size: .76rem !important; }
      }
    `;
    document.head.appendChild(style);
  }
}

ensureSelectionDock();

function ensureItemDetailsModal() {
  if (document.getElementById("itemDetailsOverlay")) return;
  const overlay = document.createElement("div");
  overlay.id = "itemDetailsOverlay";
  overlay.className = "item-detail-overlay hidden";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = `
    <section class="item-detail-modal" role="dialog" aria-modal="true" aria-labelledby="itemDetailTitle">
      <button id="closeItemDetailsBtn" class="item-detail-close" type="button" aria-label="Fechar detalhes">×</button>
      <div id="itemDetailsContent"></div>
    </section>`;
  document.body.appendChild(overlay);
}

ensureItemDetailsModal();

const state = {
  settings: { ...DEFAULT_SETTINGS },
  groups: [],
  items: [],
  selectedGroup: "all",
  search: "",
  quantities: new Map(),
  cardImageIndexes: new Map(),
  detailItemId: null,
  detailImageIndex: 0,
};

const elements = {
  brandName: document.getElementById("brandName"),
  brandSubtitle: document.getElementById("brandSubtitle"),
  groupFilters: document.getElementById("groupFilters"),
  catalogGrid: document.getElementById("catalogGrid"),
  catalogTitle: document.getElementById("catalogTitle"),
  resultCount: document.getElementById("itemsResultCount"),
  emptyCatalog: document.getElementById("emptyCatalog"),
  searchInput: document.getElementById("searchInput"),
  selectionCount: document.getElementById("selectionCount"),
  floatingSelectionValue: document.getElementById("floatingSelectionValue"),
  floatingSelectionGb: document.getElementById("floatingSelectionGb"),
  selectionOverlay: document.getElementById("selectionOverlay"),
  openSelectionBtn: document.getElementById("openSelectionBtn"),
  closeSelectionBtn: document.getElementById("closeSelectionBtn"),
  selectionList: document.getElementById("selectionList"),
  emptySelection: document.getElementById("emptySelection"),
  selectionTotal: document.getElementById("selectionTotal"),
  selectionGbTotal: document.getElementById("selectionGbTotal"),
  orderForm: document.getElementById("orderForm"),
  sendOrderBtn: document.getElementById("sendOrderBtn"),
  downloadPdfBtn: document.getElementById("downloadPdfBtn"),
  itemDetailsOverlay: document.getElementById("itemDetailsOverlay"),
  itemDetailsContent: document.getElementById("itemDetailsContent"),
  closeItemDetailsBtn: document.getElementById("closeItemDetailsBtn"),
};

init();

async function init() {
  bindEvents();
  await loadCatalog();
  applySettings();
  renderFilters();
  renderCatalog();
  renderSelection();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim().toLowerCase();
    renderCatalog();
  });

  elements.groupFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-group]");
    if (!button) return;
    state.selectedGroup = button.dataset.group;
    renderFilters();
    renderCatalog();
  });

  elements.catalogGrid.addEventListener("click", (event) => {
    const quantityButton = event.target.closest("[data-quantity-action]");
    if (quantityButton) {
      changeQuantity(quantityButton.dataset.itemId, quantityButton.dataset.quantityAction);
      return;
    }

    const galleryButton = event.target.closest("[data-card-gallery-action]");
    if (galleryButton) {
      cycleCardImage(galleryButton.dataset.itemId, galleryButton.dataset.cardGalleryAction);
      return;
    }

    const detailsTrigger = event.target.closest("[data-open-item]");
    if (detailsTrigger) openItemDetails(detailsTrigger.dataset.openItem);
  });

  elements.selectionList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quantity-action]");
    if (!button) return;
    changeQuantity(button.dataset.itemId, button.dataset.quantityAction);
  });

  elements.openSelectionBtn.addEventListener("click", openSelection);
  elements.closeSelectionBtn.addEventListener("click", closeSelection);
  elements.selectionOverlay.addEventListener("click", (event) => {
    if (event.target === elements.selectionOverlay) closeSelection();
  });

  elements.closeItemDetailsBtn.addEventListener("click", closeItemDetails);
  elements.itemDetailsOverlay.addEventListener("click", (event) => {
    if (event.target === elements.itemDetailsOverlay) {
      closeItemDetails();
      return;
    }
    const quantityButton = event.target.closest("[data-quantity-action]");
    if (quantityButton) {
      changeQuantity(quantityButton.dataset.itemId, quantityButton.dataset.quantityAction);
      return;
    }
    const galleryButton = event.target.closest("[data-detail-gallery-action]");
    if (galleryButton) {
      cycleDetailImage(galleryButton.dataset.detailGalleryAction);
      return;
    }
    const thumbnail = event.target.closest("[data-detail-thumbnail]");
    if (thumbnail) {
      state.detailImageIndex = Number(thumbnail.dataset.detailThumbnail) || 0;
      renderItemDetails();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeSelection();
      closeItemDetails();
    }
    if (!elements.itemDetailsOverlay.classList.contains("hidden")) {
      if (event.key === "ArrowLeft") cycleDetailImage("previous");
      if (event.key === "ArrowRight") cycleDetailImage("next");
    }
  });

  elements.orderForm.addEventListener("submit", handleOrderSubmit);
  elements.downloadPdfBtn.addEventListener("click", handlePdfDownload);
}

async function loadCatalog() {
  if (!supabase) {
    state.groups = DEMO_GROUPS;
    state.items = DEMO_ITEMS;
    showToast("Modo de demonstração: configure o Supabase em js/config.js.", "error");
    return;
  }

  try {
    const [settingsResult, groupsResult, itemsResult] = await Promise.all([
      supabase.from("settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("groups").select("*").eq("active", true).order("sort_order").order("name"),
      supabase
        .from("items")
        .select("*, groups(name)")
        .eq("active", true)
        .order("sort_order")
        .order("name"),
    ]);

    if (settingsResult.error) throw settingsResult.error;
    if (groupsResult.error) throw groupsResult.error;
    if (itemsResult.error) throw itemsResult.error;

    state.settings = { ...DEFAULT_SETTINGS, ...(settingsResult.data || {}) };
    state.groups = groupsResult.data || [];
    state.items = (itemsResult.data || []).map((rawItem) => {
      const item = normalizeItemMetadata(rawItem);
      const imageUrls = item.gallery_paths.map(
        (path) => supabase.storage.from("item-images").getPublicUrl(path).data.publicUrl
      );
      return {
        ...item,
        group_name: item.groups?.name || "Sem grupo",
        image_urls: imageUrls,
        image_url: imageUrls[0] || "",
      };
    });
  } catch (error) {
    console.error(error);
    state.groups = DEMO_GROUPS;
    state.items = DEMO_ITEMS;
    showToast("Não foi possível carregar o banco. Exibindo itens de demonstração.", "error");
  }
}

function applySettings() {
  elements.brandName.textContent = state.settings.brand_name;
  elements.brandSubtitle.textContent = state.settings.subtitle;
  document.title = `Catálogo | ${state.settings.brand_name}`;
}

function renderFilters() {
  const buttons = [
    `<button class="filter-chip ${state.selectedGroup === "all" ? "active" : ""}" type="button" data-group="all">Todos</button>`,
    ...state.groups.map(
      (group) =>
        `<button class="filter-chip ${state.selectedGroup === String(group.id) ? "active" : ""}" type="button" data-group="${escapeHtml(group.id)}">${escapeHtml(group.name)}</button>`
    ),
  ];
  elements.groupFilters.innerHTML = buttons.join("");
}

function getFilteredItems() {
  return state.items.filter((item) => {
    const matchesGroup = state.selectedGroup === "all" || String(item.group_id) === state.selectedGroup;
    const haystack = `${item.name} ${item.description || ""} ${item.details || ""} ${item.group_name || ""}`.toLowerCase();
    return matchesGroup && haystack.includes(state.search);
  });
}

function renderCatalog() {
  const items = getFilteredItems();
  const group = state.groups.find((entry) => String(entry.id) === state.selectedGroup);
  elements.catalogTitle.textContent = group?.name || "Todos os itens";
  elements.resultCount.textContent = `${items.length} ${items.length === 1 ? "item" : "itens"}`;
  elements.emptyCatalog.classList.toggle("hidden", items.length > 0);

  elements.catalogGrid.innerHTML = items.map(renderItemCard).join("");
}

function getItemImages(item) {
  const images = Array.isArray(item.image_urls) ? item.image_urls.filter(Boolean) : [];
  return images.length ? images : (item.image_url ? [item.image_url] : []);
}

function getCardImageIndex(item) {
  const images = getItemImages(item);
  if (!images.length) return 0;
  const current = Number(state.cardImageIndexes.get(String(item.id)) || 0);
  return Math.min(Math.max(current, 0), images.length - 1);
}

function cycleCardImage(itemId, action) {
  const item = state.items.find((entry) => String(entry.id) === String(itemId));
  if (!item) return;
  const images = getItemImages(item);
  if (images.length < 2) return;
  const current = getCardImageIndex(item);
  const next = action === "previous"
    ? (current - 1 + images.length) % images.length
    : (current + 1) % images.length;
  state.cardImageIndexes.set(String(item.id), next);
  renderCatalog();
}

function renderCardGallery(item) {
  const images = getItemImages(item);
  if (!images.length) {
    return `<div class="item-image item-image-gallery" data-open-item="${escapeHtml(item.id)}"><div class="item-placeholder">Sem imagem</div></div>`;
  }
  const index = getCardImageIndex(item);
  const controls = images.length > 1 ? `
    <button class="card-gallery-arrow previous" type="button" data-item-id="${escapeHtml(item.id)}" data-card-gallery-action="previous" aria-label="Imagem anterior">‹</button>
    <button class="card-gallery-arrow next" type="button" data-item-id="${escapeHtml(item.id)}" data-card-gallery-action="next" aria-label="Próxima imagem">›</button>
    <span class="card-gallery-count">${index + 1}/${images.length}</span>` : "";
  return `
    <div class="item-image item-image-gallery" data-open-item="${escapeHtml(item.id)}" role="button" tabindex="0" aria-label="Abrir detalhes de ${escapeHtml(item.name)}">
      <img src="${escapeHtml(images[index])}" alt="${escapeHtml(item.name)} — imagem ${index + 1}" loading="lazy" />
      ${controls}
    </div>`;
}

function renderItemCard(item) {
  const quantity = state.quantities.get(String(item.id)) || 0;
  const languageNotice = item.portuguese
    ? `<div class="item-language-badge"><span aria-hidden="true">✓</span><strong>Jogo dublado ou legendado em português</strong></div>`
    : "";
  const stats = [];
  if (item.show_price !== false) {
    stats.push(Number(item.price || 0) > 0
      ? `<div class="item-stat"><small>Valor unitário</small><strong>${formatCurrency(item.price)}</strong></div>`
      : `<div class="item-stat"><small>Valor</small><strong>Sob consulta</strong></div>`);
  }
  if (item.show_gb !== false) {
    stats.push(Number(item.size_gb || 0) > 0
      ? `<div class="item-stat"><small>GB</small><strong>${formatGigabytes(item.size_gb)}</strong></div>`
      : `<div class="item-stat"><small>GB</small><strong>Não informado</strong></div>`);
  }

  return `
    <article class="item-card" data-item-card="${escapeHtml(item.id)}">
      ${renderCardGallery(item)}
      <div class="item-body">
        <span class="item-group">${escapeHtml(item.group_name)}</span>
        <h3 data-open-item="${escapeHtml(item.id)}">${escapeHtml(item.name)}</h3>
        ${languageNotice}
        <button class="item-details-button" type="button" data-open-item="${escapeHtml(item.id)}">Ver detalhes e fotos</button>
        <div class="item-footer ${stats.length ? "" : "without-stats"}">
          ${stats.length ? `<div class="item-stats">${stats.join("")}</div>` : ""}
          ${renderQuantityControl(item.id, quantity)}
        </div>
      </div>
    </article>
  `;
}

function renderQuantityControl(itemId, quantity) {
  return `
    <div class="quantity-control" aria-label="Quantidade">
      <button type="button" data-item-id="${escapeHtml(itemId)}" data-quantity-action="decrease" aria-label="Diminuir">−</button>
      <span>${quantity}</span>
      <button type="button" data-item-id="${escapeHtml(itemId)}" data-quantity-action="increase" aria-label="Aumentar">+</button>
    </div>
  `;
}

function changeQuantity(itemId, action) {
  const key = String(itemId);
  const current = state.quantities.get(key) || 0;
  const next = action === "increase" ? Math.min(current + 1, 99) : Math.max(current - 1, 0);
  if (next === 0) state.quantities.delete(key);
  else state.quantities.set(key, next);
  renderCatalog();
  renderSelection();
  if (state.detailItemId === key) renderItemDetails();
}

function getSelectedItems() {
  return state.items
    .filter((item) => (state.quantities.get(String(item.id)) || 0) > 0)
    .map((item) => ({ ...item, quantity: state.quantities.get(String(item.id)) }));
}

function getVisibleItemSummary(item) {
  const parts = [escapeHtml(item.group_name)];
  if (item.show_price !== false) {
    parts.push(Number(item.price || 0) > 0 ? formatCurrency(item.price) : "Sob consulta");
  }
  if (item.show_gb !== false) {
    parts.push(Number(item.size_gb || 0) > 0
      ? `${formatGigabytes(item.size_gb)} cada · ${formatGigabytes(Number(item.size_gb) * item.quantity)} selecionados`
      : "GB não informado");
  }
  return parts.join(" • ");
}

function renderSelection() {
  const selectedItems = getSelectedItems();
  const count = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const total = selectedItems.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);
  const totalGb = selectedItems.reduce((sum, item) => sum + Number(item.size_gb || 0) * item.quantity, 0);
  elements.selectionCount.textContent = String(count);
  elements.selectionTotal.textContent = formatCurrency(total);
  elements.selectionGbTotal.textContent = formatGigabytes(totalGb);
  elements.floatingSelectionValue.textContent = formatCurrency(total);
  elements.floatingSelectionGb.textContent = formatGigabytes(totalGb);
  elements.emptySelection.classList.toggle("hidden", selectedItems.length > 0);
  elements.selectionList.classList.toggle("hidden", selectedItems.length === 0);
  elements.sendOrderBtn.disabled = selectedItems.length === 0;
  elements.downloadPdfBtn.disabled = selectedItems.length === 0;

  const groupedItems = new Map();
  selectedItems.forEach((item) => {
    const key = String(item.group_id || item.group_name || "sem-grupo");
    if (!groupedItems.has(key)) {
      groupedItems.set(key, {
        name: item.group_name || "Outros itens",
        items: [],
      });
    }
    groupedItems.get(key).items.push(item);
  });

  const groupPosition = new Map(
    state.groups.map((group, index) => [String(group.id), Number(group.sort_order ?? index)])
  );

  const groups = [...groupedItems.entries()]
    .sort(([firstKey, firstGroup], [secondKey, secondGroup]) => {
      const firstPosition = groupPosition.has(firstKey) ? groupPosition.get(firstKey) : Number.MAX_SAFE_INTEGER;
      const secondPosition = groupPosition.has(secondKey) ? groupPosition.get(secondKey) : Number.MAX_SAFE_INTEGER;
      if (firstPosition !== secondPosition) return firstPosition - secondPosition;
      return firstGroup.name.localeCompare(secondGroup.name, "pt-BR", { sensitivity: "base" });
    });

  elements.selectionList.innerHTML = groups
    .map(([, group]) => {
      const groupQuantity = group.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      return `
        <section class="selection-group" aria-label="${escapeHtml(group.name)}">
          <div class="selection-group-header">
            <h3>${escapeHtml(group.name)}</h3>
            <span>${groupQuantity} ${groupQuantity === 1 ? "item" : "itens"}</span>
          </div>
          <div class="selection-group-items">
            ${group.items.map((item) => `
              <div class="selection-row">
                <div>
                  <h4>${escapeHtml(item.name)}</h4>
                  <p>${getVisibleItemSummary(item)}</p>
                </div>
                ${renderQuantityControl(item.id, item.quantity)}
              </div>
            `).join("")}
          </div>
        </section>`;
    })
    .join("");
}

function openItemDetails(itemId) {
  const item = state.items.find((entry) => String(entry.id) === String(itemId));
  if (!item) return;
  state.detailItemId = String(item.id);
  state.detailImageIndex = getCardImageIndex(item);
  renderItemDetails();
  elements.itemDetailsOverlay.classList.remove("hidden");
  elements.itemDetailsOverlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeItemDetails() {
  if (!elements.itemDetailsOverlay || elements.itemDetailsOverlay.classList.contains("hidden")) return;
  elements.itemDetailsOverlay.classList.add("hidden");
  elements.itemDetailsOverlay.setAttribute("aria-hidden", "true");
  state.detailItemId = null;
  state.detailImageIndex = 0;
  if (elements.selectionOverlay.classList.contains("hidden")) document.body.style.overflow = "";
}

function cycleDetailImage(action) {
  const item = state.items.find((entry) => String(entry.id) === String(state.detailItemId));
  if (!item) return;
  const images = getItemImages(item);
  if (images.length < 2) return;
  state.detailImageIndex = action === "previous"
    ? (state.detailImageIndex - 1 + images.length) % images.length
    : (state.detailImageIndex + 1) % images.length;
  renderItemDetails();
}

function renderItemDetails() {
  const item = state.items.find((entry) => String(entry.id) === String(state.detailItemId));
  if (!item || !elements.itemDetailsContent) return;
  const images = getItemImages(item);
  const index = images.length ? Math.min(state.detailImageIndex, images.length - 1) : 0;
  state.detailImageIndex = index;
  const quantity = state.quantities.get(String(item.id)) || 0;
  const mainImage = images.length
    ? `<img src="${escapeHtml(images[index])}" alt="${escapeHtml(item.name)} — imagem ${index + 1}" />`
    : `<div class="item-placeholder">Sem imagem</div>`;
  const galleryControls = images.length > 1 ? `
    <button class="detail-gallery-arrow previous" type="button" data-detail-gallery-action="previous" aria-label="Imagem anterior">‹</button>
    <button class="detail-gallery-arrow next" type="button" data-detail-gallery-action="next" aria-label="Próxima imagem">›</button>
    <span class="detail-gallery-count">${index + 1} de ${images.length}</span>` : "";
  const thumbnails = images.length > 1 ? `
    <div class="detail-thumbnails">
      ${images.map((url, imageIndex) => `
        <button type="button" class="detail-thumbnail ${imageIndex === index ? "active" : ""}" data-detail-thumbnail="${imageIndex}" aria-label="Ver imagem ${imageIndex + 1}">
          <img src="${escapeHtml(url)}" alt="" />
        </button>`).join("")}
    </div>` : "";
  const stats = [];
  if (item.show_price !== false) {
    stats.push(`<div><span>Valor</span><strong>${Number(item.price || 0) > 0 ? formatCurrency(item.price) : "Sob consulta"}</strong></div>`);
  }
  if (item.show_gb !== false) {
    stats.push(`<div><span>Tamanho</span><strong>${Number(item.size_gb || 0) > 0 ? formatGigabytes(item.size_gb) : "Não informado"}</strong></div>`);
  }

  elements.itemDetailsContent.innerHTML = `
    <div class="item-detail-layout">
      <div class="item-detail-gallery-column">
        <div class="item-detail-main-image">
          ${mainImage}
          ${galleryControls}
        </div>
        ${thumbnails}
      </div>
      <div class="item-detail-info">
        <span class="item-group">${escapeHtml(item.group_name)}</span>
        <h2 id="itemDetailTitle">${escapeHtml(item.name)}</h2>
        ${item.portuguese ? `<div class="item-language-badge item-language-badge-detail"><span aria-hidden="true">✓</span><strong>Jogo dublado ou legendado em português</strong></div>` : ""}
        ${item.description ? `<p class="item-detail-description">${escapeHtml(item.description)}</p>` : ""}
        ${item.details ? `<div class="item-details item-detail-extra">${escapeHtml(item.details)}</div>` : ""}
        ${stats.length ? `<div class="item-detail-stats">${stats.join("")}</div>` : ""}
        <div class="item-detail-selection">
          <div><span>Quantidade desejada</span><strong>${quantity}</strong></div>
          ${renderQuantityControl(item.id, quantity)}
        </div>
      </div>
    </div>`;
}

function setSelectionDockHidden(hidden) {
  const dock = document.querySelector(".selection-dock");
  if (!dock) return;
  dock.classList.toggle("selection-dock-hidden", Boolean(hidden));
  dock.setAttribute("aria-hidden", hidden ? "true" : "false");
}

function openSelection() {
  setSelectionDockHidden(true);
  elements.selectionOverlay.classList.remove("hidden");
  elements.selectionOverlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeSelection() {
  elements.selectionOverlay.classList.add("hidden");
  elements.selectionOverlay.setAttribute("aria-hidden", "true");
  setSelectionDockHidden(false);
  document.body.style.overflow = "";
}

function buildOrder() {
  const selectedItems = getSelectedItems();
  const customerName = document.getElementById("customerName").value.trim();
  const customerPhone = document.getElementById("customerPhone").value.trim();
  const notes = document.getElementById("customerNotes").value.trim();
  const items = selectedItems.map((item) => {
    const previewImages = getItemImages(item);
    const previewIndex = getCardImageIndex(item);
    return {
      id: item.id,
      name: item.name,
      group_id: item.group_id,
      group_name: item.group_name,
      group_sort_order: (() => {
        const groupIndex = state.groups.findIndex((group) => String(group.id) === String(item.group_id));
        const group = groupIndex >= 0 ? state.groups[groupIndex] : null;
        const configuredOrder = Number(group?.sort_order);
        return Number.isFinite(configuredOrder) ? configuredOrder : (groupIndex >= 0 ? groupIndex : 999999);
      })(),
      price: Number(item.price || 0),
      size_gb: Number(item.size_gb || 0),
      quantity: item.quantity,
      description: item.description || "",
      // Guarda exatamente a imagem exibida no preview no momento da finalização.
      // Assim ela continua disponível no PDF baixado depois pelo painel.
      image_url: previewImages[previewIndex] || item.image_url || "",
    };
  });
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const totalGb = items.reduce((sum, item) => sum + item.size_gb * item.quantity, 0);
  return {
    customer_name: customerName,
    customer_phone: customerPhone,
    notes,
    items,
    total,
    total_gb: totalGb,
    status: "new",
    created_at: new Date().toISOString(),
  };
}

async function saveOrder(order) {
  if (!supabase) return { ...order, id: `demo-${Date.now()}` };

  let { data, error } = await supabase.from("orders").insert(order).select("*").single();

  // Compatibilidade com bancos antigos sem a coluna total_gb. O total continua
  // salvo dentro do JSON dos itens e é recalculado no painel e no PDF.
  if (error && isMissingColumnError(error, "total_gb")) {
    const compatibleOrder = { ...order };
    delete compatibleOrder.total_gb;
    ({ data, error } = await supabase
      .from("orders")
      .insert(compatibleOrder)
      .select("*")
      .single());
  }

  if (error) throw error;
  return { ...order, ...(data || {}), total_gb: order.total_gb };
}

async function handleOrderSubmit(event) {
  event.preventDefault();
  const selectedItems = getSelectedItems();
  if (!selectedItems.length) {
    showToast("Adicione pelo menos um item.", "error");
    return;
  }
  if (!elements.orderForm.reportValidity()) return;

  setButtonLoading(elements.sendOrderBtn, true, "Gerando PDF...");
  try {
    const order = await saveOrder(buildOrder());
    const pdf = await createOrderPdf(order, state.settings);
    await sharePdfOrOpenWhatsapp(pdf, order);
    showToast("PDF gerado com sucesso.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível gerar a seleção.", "error");
  } finally {
    setButtonLoading(elements.sendOrderBtn, false);
  }
}

async function handlePdfDownload() {
  if (!getSelectedItems().length) {
    showToast("Adicione pelo menos um item.", "error");
    return;
  }
  const order = { ...buildOrder(), id: `previa-${Date.now()}` };
  const pdf = await createOrderPdf(order, state.settings);
  downloadBlob(pdf.blob, pdf.filename);
  showToast("PDF baixado.");
}

async function sharePdfOrOpenWhatsapp(pdf, order) {
  const file = new File([pdf.blob], pdf.filename, { type: "application/pdf" });
  const shareData = {
    files: [file],
    title: `Seleção - ${state.settings.brand_name}`,
    text: `${state.settings.whatsapp_message}\nCliente: ${order.customer_name}`,
  };

  if (navigator.share && (!navigator.canShare || navigator.canShare(shareData))) {
    try {
      await navigator.share(shareData);
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
      console.warn("Compartilhamento de arquivo indisponível:", error);
    }
  }

  downloadBlob(pdf.blob, pdf.filename);
  const phone = sanitizePhone(state.settings.whatsapp_number);
  const summary = order.items
    .map((item) => `• ${item.quantity}x ${item.name}${Number(item.size_gb || 0) > 0 ? ` — ${formatGigabytes(Number(item.size_gb) * Number(item.quantity || 0))}` : ""}`)
    .join("\n");
  const text = `${state.settings.whatsapp_message}\n\nCliente: ${order.customer_name}\n\n${summary}\n\nTotal estimado: ${formatCurrency(order.total)}\nTotal acumulado em GB: ${formatGigabytes(order.total_gb)}\n\nO PDF foi baixado no aparelho. Anexe-o nesta conversa.`;
  const url = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.location.href = url;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
