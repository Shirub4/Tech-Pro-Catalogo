import {
  supabase,
  supabaseInitializationError,
  assertSupabaseConfigured,
} from "./supabase-client.js?v=20260722-avisoptbr1";
import { createOrderPdf } from "./pdf.js?v=20260722-pdfgrupos1";
import {
  escapeHtml,
  formatCurrency,
  formatDate,
  formatGigabytes,
  setButtonLoading,
  showToast,
} from "./utils.js?v=20260722-avisoptbr1";

const state = {
  groups: [],
  items: [],
  orders: [],
  settings: null,
  currentOrder: null,
  authUserId: null,
  itemGalleryEntries: [],
  originalItemImagePaths: [],
};

// Metadados compatíveis com o banco atual. GB, opções de exibição e imagens
// adicionais são armazenados em marcadores invisíveis dentro de details.
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

function composeItemDetails(details = "", options = {}) {
  const cleanDetails = stripTechProMarkers(details);
  const markers = [];
  const sizeGb = Number(options.sizeGb);
  if (Number.isFinite(sizeGb) && sizeGb > 0) {
    markers.push(`[[TECHPRO_GB:${sizeGb.toFixed(2)}]]`);
  }
  markers.push(`[[TECHPRO_DISPLAY:P${options.showPrice ? 1 : 0}G${options.showGb ? 1 : 0}]]`);

  if (options.portuguese) {
    markers.push("[[TECHPRO_PTBR:1]]");
  }

  const extraPaths = [...new Set((options.extraImagePaths || []).filter(Boolean))];
  if (extraPaths.length) {
    markers.push(`[[TECHPRO_IMAGES:${encodeURIComponent(JSON.stringify(extraPaths))}]]`);
  }
  return [cleanDetails, ...markers].filter(Boolean).join("\n");
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

const sections = {
  dashboard: document.getElementById("dashboardSection"),
  groups: document.getElementById("groupsSection"),
  items: document.getElementById("itemsSection"),
  orders: document.getElementById("ordersSection"),
  settings: document.getElementById("settingsSection"),
};

const pageTitles = {
  dashboard: "Visão geral",
  groups: "Grupos",
  items: "Itens",
  orders: "Seleções recebidas",
  settings: "Configurações",
};

init();

async function init() {
  bindEvents();
  if (!supabase) {
    const message =
      supabaseInitializationError?.message ||
      "Configure o Supabase em js/config.js para acessar o painel.";
    showToast(message, "error");
    showLoginStatus(message, true);
    return;
  }

  showLoginStatus("Conexão carregada. Entre com o usuário criado no Supabase.");

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    await updateAuthView(data.session);

    // O callback do onAuthStateChange deve permanecer síncrono.
    // As consultas do painel são executadas no próximo ciclo para evitar
    // travamentos depois do login em algumas versões do Supabase JS.
    supabase.auth.onAuthStateChange((_event, session) => {
      window.setTimeout(() => {
        updateAuthView(session).catch((error) => {
          console.error("Erro ao atualizar a sessão:", error);
          showToast(error.message || "Não foi possível atualizar a sessão.", "error");
        });
      }, 0);
    });
  } catch (error) {
    console.error("Erro ao iniciar o painel:", error);
    showToast(error.message || "Não foi possível iniciar o painel.", "error");
  }
}

function showLoginStatus(message = "", isError = false) {
  const element = document.getElementById("loginStatus");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error-text", Boolean(isError));
}

function bindEvents() {
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);

  document.querySelectorAll(".nav-button").forEach((button) => {
    button.addEventListener("click", () => switchSection(button.dataset.view));
  });

  document.getElementById("groupForm").addEventListener("submit", handleGroupSave);
  document.getElementById("cancelGroupEdit").addEventListener("click", resetGroupForm);
  document.getElementById("groupsTable").addEventListener("click", handleGroupTableClick);

  document.getElementById("itemForm").addEventListener("submit", handleItemSave);
  document.getElementById("cancelItemEdit").addEventListener("click", resetItemForm);
  document.getElementById("itemsTable").addEventListener("click", handleItemTableClick);
  document.getElementById("itemsTable").addEventListener("change", handleItemTableChange);
  document.getElementById("itemImages").addEventListener("change", handleItemImageSelection);
  document.getElementById("itemGalleryPreview").addEventListener("click", handleItemGalleryPreviewClick);

  document.getElementById("settingsForm").addEventListener("submit", handleSettingsSave);
  document.getElementById("ordersTable").addEventListener("click", handleOrderTableClick);
  document.getElementById("recentOrders").addEventListener("click", handleOrderTableClick);
  document.getElementById("refreshOrdersBtn").addEventListener("click", loadOrders);

  document.getElementById("closeOrderModal").addEventListener("click", closeOrderModal);
  document.getElementById("orderModal").addEventListener("click", (event) => {
    if (event.target.id === "orderModal") closeOrderModal();
  });
  document.getElementById("adminOrderPdfBtn").addEventListener("click", downloadCurrentOrderPdf);
}

async function updateAuthView(session) {
  const loginView = document.getElementById("loginView");
  const adminView = document.getElementById("adminView");
  const nextUserId = session?.user?.id || null;

  if (session) {
    const shouldLoadData =
      state.authUserId !== nextUserId || adminView.classList.contains("hidden");

    // Exibe o painel antes de consultar as tabelas. Assim, um erro de banco
    // (por exemplo, uma coluna ainda não criada) não impede o login.
    state.authUserId = nextUserId;
    loginView.classList.add("hidden");
    adminView.classList.remove("hidden");
    document.getElementById("adminUserEmail").textContent =
      session.user.email || "Administrador";

    if (shouldLoadData) {
      window.setTimeout(() => {
        loadAllData().catch((error) => {
          console.error("Erro ao carregar os dados do painel:", error);
          showToast(translateDatabaseError(error), "error");
        });
      }, 0);
    }
  } else {
    state.authUserId = null;
    loginView.classList.remove("hidden");
    adminView.classList.add("hidden");
  }
}

async function handleLogin(event) {
  event.preventDefault();
  try {
    assertSupabaseConfigured();
    const button = event.submitter;
    setButtonLoading(button, true, "Entrando...");
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!data.session) throw new Error("O Supabase não retornou uma sessão válida.");

    // Abre o painel diretamente. O listener de autenticação fica apenas
    // responsável por manter a tela sincronizada depois disso.
    await updateAuthView(data.session);
    showLoginStatus("");
    showToast("Login realizado.");
  } catch (error) {
    console.error(error);
    const message = translateAuthError(error.message);
    showLoginStatus(message, true);
    showToast(message, "error");
  } finally {
    setButtonLoading(event.submitter, false);
  }
}

function translateAuthError(message = "") {
  if (message.toLowerCase().includes("invalid login")) return "E-mail ou senha incorretos.";
  if (message.toLowerCase().includes("email not confirmed")) return "Confirme o e-mail do administrador antes de entrar.";
  return message || "Não foi possível entrar.";
}

function translateDatabaseError(error) {
  const message = String(error?.message || error || "");
  const lower = message.toLowerCase();

  if (lower.includes("schema cache") && (lower.includes("size_gb") || lower.includes("total_gb"))) {
    return "O programa tentou usar um campo opcional de GB, mas a gravação compatível também não foi concluída. Atualize os arquivos js/admin.js e js/catalog.js para a versão mais recente.";
  }

  return message || "Erro ao acessar o banco de dados.";
}

async function handleLogout() {
  await supabase.auth.signOut();
  showToast("Sessão encerrada.");
}

function switchSection(viewName) {
  Object.entries(sections).forEach(([name, section]) => {
    section.classList.toggle("hidden", name !== viewName);
  });
  document.querySelectorAll(".nav-button").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  document.getElementById("adminPageTitle").textContent = pageTitles[viewName];
}

async function loadAllData() {
  try {
    await Promise.all([loadGroups(), loadSettings(), loadOrders(false)]);
    await loadItems();
    renderDashboard();
  } catch (error) {
    console.error(error);
    showToast(translateDatabaseError(error), "error");
  }
}

async function loadGroups() {
  const { data, error } = await supabase.from("groups").select("*").order("sort_order").order("name");
  if (error) throw error;
  state.groups = data || [];
  renderGroups();
  populateGroupSelect();
}

async function loadItems() {
  const { data, error } = await supabase
    .from("items")
    .select("*, groups(name)")
    // No painel administrativo, os itens mais recentes aparecem primeiro.
    // A ordenação do catálogo público continua sendo controlada pelo campo "Ordem".
    .order("created_at", { ascending: false })
    .order("name", { ascending: true });
  if (error) throw error;
  state.items = (data || []).map((rawItem) => {
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
  renderItems();
}

async function loadSettings() {
  const { data, error } = await supabase.from("settings").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  state.settings = data || {
    id: 1,
    brand_name: "Tech Pro",
    subtitle: "Escolha os itens e envie sua seleção",
    whatsapp_number: "5522999167083",
    whatsapp_message: "Olá! Acabei de montar uma seleção pelo catálogo da Tech Pro.",
  };
  fillSettingsForm();
}

async function loadOrders(showFeedback = true) {
  const button = document.getElementById("refreshOrdersBtn");
  if (showFeedback) setButtonLoading(button, true, "Atualizando...");
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    state.orders = data || [];
    renderOrders();
    renderDashboard();
    if (showFeedback) showToast("Seleções atualizadas.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível atualizar.", "error");
  } finally {
    if (showFeedback) setButtonLoading(button, false);
  }
}

function renderDashboard() {
  document.getElementById("groupStat").textContent = String(state.groups.length);
  document.getElementById("itemStat").textContent = String(state.items.filter((item) => item.active).length);
  document.getElementById("orderStat").textContent = String(state.orders.length);
  const total = state.orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const totalGb = state.orders.reduce((sum, order) => sum + getOrderTotalGb(order), 0);
  document.getElementById("revenueStat").textContent = formatCurrency(total);
  document.getElementById("storageStat").textContent = formatGigabytes(totalGb);

  const recent = state.orders.slice(0, 5);
  const container = document.getElementById("recentOrders");
  if (!recent.length) {
    container.innerHTML = `<div class="empty-state compact"><strong>Nenhuma seleção recebida.</strong><p>As respostas do catálogo aparecerão aqui.</p></div>`;
    return;
  }
  container.innerHTML = recent.map(renderOrderSummary).join("");
}

function renderOrderSummary(order) {
  const count = Array.isArray(order.items)
    ? order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
    : 0;
  return `
    <div class="order-summary-card">
      <div>
        <h4>${escapeHtml(order.customer_name || "Cliente")}</h4>
        <p>${formatDate(order.created_at)} • ${count} ${count === 1 ? "item" : "itens"} • ${formatCurrency(order.total)} • ${formatGigabytes(getOrderTotalGb(order))}</p>
      </div>
      <button class="small-button" type="button" data-order-action="view" data-order-id="${escapeHtml(order.id)}">Ver</button>
    </div>
  `;
}

function renderGroups() {
  const container = document.getElementById("groupsTable");
  if (!state.groups.length) {
    container.innerHTML = `<div class="empty-state compact"><strong>Nenhum grupo cadastrado.</strong></div>`;
    return;
  }
  container.innerHTML = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Grupo</th><th>Ordem</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>
          ${state.groups.map((group) => `
            <tr>
              <td><strong>${escapeHtml(group.name)}</strong></td>
              <td>${Number(group.sort_order || 0)}</td>
              <td><span class="status-badge ${group.active ? "" : "inactive"}">${group.active ? "Ativo" : "Inativo"}</span></td>
              <td><div class="table-actions">
                <button class="small-button" data-group-action="edit" data-group-id="${escapeHtml(group.id)}" type="button">Editar</button>
                <button class="small-button danger" data-group-action="delete" data-group-id="${escapeHtml(group.id)}" type="button">Excluir</button>
              </div></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function populateGroupSelect() {
  const select = document.getElementById("itemGroup");
  const selected = select.value;
  select.innerHTML = `<option value="">Selecione...</option>${state.groups
    .map((group) => `<option value="${escapeHtml(group.id)}">${escapeHtml(group.name)}</option>`)
    .join("")}`;
  if (state.groups.some((group) => String(group.id) === selected)) select.value = selected;
}

async function handleGroupSave(event) {
  event.preventDefault();
  const button = event.submitter;
  setButtonLoading(button, true, "Salvando...");
  try {
    const id = document.getElementById("groupId").value;
    const payload = {
      name: document.getElementById("groupName").value.trim(),
      sort_order: Number(document.getElementById("groupSort").value || 0),
      active: document.getElementById("groupActive").checked,
    };
    const query = id
      ? supabase.from("groups").update(payload).eq("id", id)
      : supabase.from("groups").insert(payload);
    const { error } = await query;
    if (error) throw error;
    resetGroupForm();
    await loadGroups();
    await loadItems();
    renderDashboard();
    showToast(id ? "Grupo atualizado." : "Grupo adicionado.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível salvar o grupo.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function handleGroupTableClick(event) {
  const button = event.target.closest("[data-group-action]");
  if (!button) return;
  const group = state.groups.find((entry) => String(entry.id) === button.dataset.groupId);
  if (!group) return;
  if (button.dataset.groupAction === "edit") editGroup(group);
  if (button.dataset.groupAction === "delete") deleteGroup(group);
}

function editGroup(group) {
  document.getElementById("groupId").value = group.id;
  document.getElementById("groupName").value = group.name;
  document.getElementById("groupSort").value = group.sort_order || 0;
  document.getElementById("groupActive").checked = Boolean(group.active);
  document.getElementById("cancelGroupEdit").classList.remove("hidden");
  document.getElementById("groupName").focus();
}

async function deleteGroup(group) {
  if (!window.confirm(`Excluir o grupo “${group.name}”?`)) return;
  try {
    const { error } = await supabase.from("groups").delete().eq("id", group.id);
    if (error) throw error;
    await loadGroups();
    renderDashboard();
    showToast("Grupo excluído.");
  } catch (error) {
    console.error(error);
    showToast("Não foi possível excluir. Remova ou mova os itens desse grupo primeiro.", "error");
  }
}

function resetGroupForm() {
  document.getElementById("groupForm").reset();
  document.getElementById("groupId").value = "";
  document.getElementById("groupSort").value = "0";
  document.getElementById("groupActive").checked = true;
  document.getElementById("cancelGroupEdit").classList.add("hidden");
}

function renderItemGroupOptions(selectedGroupId) {
  return state.groups
    .map((group) => `
      <option value="${escapeHtml(group.id)}" ${String(group.id) === String(selectedGroupId) ? "selected" : ""}>
        ${escapeHtml(group.name)}
      </option>`)
    .join("");
}

function renderAdminItemRow(item) {
  const priceText = Number(item.price || 0) > 0 ? formatCurrency(item.price) : "Sob consulta";
  const gbText = Number(item.size_gb || 0) > 0 ? formatGigabytes(item.size_gb) : "Não informado";
  return `
    <tr data-admin-item-row="${escapeHtml(item.id)}">
      <td>
        <div class="table-image-wrap">
          ${item.image_url ? `<img class="table-image" src="${escapeHtml(item.image_url)}" alt="" />` : `<div class="table-image"></div>`}
          ${item.gallery_paths.length > 1 ? `<span class="table-image-count">${item.gallery_paths.length} fotos</span>` : ""}
        </div>
      </td>
      <td>
        <strong>${escapeHtml(item.name)}</strong><br>
        <span class="muted-text">Ordem ${Number(item.sort_order || 0)}</span>
      </td>
      <td>
        <select class="table-group-select" data-item-group-select="${escapeHtml(item.id)}" aria-label="Alterar grupo de ${escapeHtml(item.name)}">
          ${renderItemGroupOptions(item.group_id)}
        </select>
      </td>
      <td>
        <label class="table-visibility-control">
          <input type="checkbox" data-item-visibility="price" data-item-id="${escapeHtml(item.id)}" ${item.show_price !== false ? "checked" : ""} />
          <span>Exibir</span>
        </label>
        <span class="table-value-preview ${item.show_price !== false ? "" : "is-hidden"}">${priceText}</span>
      </td>
      <td>
        <label class="table-visibility-control">
          <input type="checkbox" data-item-visibility="gb" data-item-id="${escapeHtml(item.id)}" ${item.show_gb !== false ? "checked" : ""} />
          <span>Exibir</span>
        </label>
        <span class="table-value-preview ${item.show_gb !== false ? "" : "is-hidden"}">${gbText}</span>
      </td>
      <td><span class="status-badge ${item.active ? "" : "inactive"}">${item.active ? "Ativo" : "Inativo"}</span></td>
      <td>
        <div class="table-actions">
          <button class="small-button" data-item-action="edit" data-item-id="${escapeHtml(item.id)}" type="button">Editar</button>
          <button class="small-button danger" data-item-action="delete" data-item-id="${escapeHtml(item.id)}" type="button">Excluir</button>
        </div>
      </td>
    </tr>`;
}

function renderAdminItemGroup(groupName, items, groupId = "") {
  return `
    <section class="admin-items-group" data-admin-group="${escapeHtml(groupId)}">
      <div class="admin-items-group-heading">
        <div>
          <span class="eyebrow">GRUPO</span>
          <h4>${escapeHtml(groupName)}</h4>
        </div>
        <span class="admin-items-group-count">${items.length} ${items.length === 1 ? "item" : "itens"}</span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table admin-items-table">
          <thead><tr><th>Imagem</th><th>Item</th><th>Grupo</th><th>Valor</th><th>GB</th><th>Status</th><th>Ações</th></tr></thead>
          <tbody>${items.map(renderAdminItemRow).join("")}</tbody>
        </table>
      </div>
    </section>`;
}

function renderItems() {
  const container = document.getElementById("itemsTable");
  if (!state.items.length) {
    container.innerHTML = `<div class="empty-state compact"><strong>Nenhum item cadastrado.</strong></div>`;
    return;
  }

  const knownGroupIds = new Set(state.groups.map((group) => String(group.id)));
  const sectionsHtml = state.groups
    .map((group) => {
      const groupItems = state.items.filter((item) => String(item.group_id) === String(group.id));
      return groupItems.length ? renderAdminItemGroup(group.name, groupItems, group.id) : "";
    })
    .join("");

  const ungroupedItems = state.items.filter((item) => !knownGroupIds.has(String(item.group_id)));
  container.innerHTML = `
    <div class="admin-items-toolbar-note">
      Os itens estão separados por grupo. Use as caixas de Valor e GB ou o seletor de grupo para alterar o catálogo sem abrir a edição.
    </div>
    <div class="admin-items-groups">
      ${sectionsHtml}
      ${ungroupedItems.length ? renderAdminItemGroup("Sem grupo", ungroupedItems, "ungrouped") : ""}
    </div>`;
}

async function handleItemTableChange(event) {
  const groupSelect = event.target.closest("[data-item-group-select]");
  if (groupSelect) {
    const item = state.items.find((entry) => String(entry.id) === String(groupSelect.dataset.itemGroupSelect));
    if (!item || String(item.group_id) === String(groupSelect.value)) return;
    const oldValue = item.group_id;
    groupSelect.disabled = true;
    try {
      const { error } = await supabase
        .from("items")
        .update({ group_id: groupSelect.value })
        .eq("id", item.id);
      if (error) throw error;
      await loadItems();
      showToast("Grupo do item alterado.");
    } catch (error) {
      console.error(error);
      groupSelect.value = oldValue;
      groupSelect.disabled = false;
      showToast(error.message || "Não foi possível alterar o grupo.", "error");
    }
    return;
  }

  const visibilityInput = event.target.closest("[data-item-visibility]");
  if (!visibilityInput) return;
  const item = state.items.find((entry) => String(entry.id) === String(visibilityInput.dataset.itemId));
  if (!item) return;

  const isPrice = visibilityInput.dataset.itemVisibility === "price";
  const showPrice = isPrice ? visibilityInput.checked : item.show_price !== false;
  const showGb = isPrice ? item.show_gb !== false : visibilityInput.checked;
  const previousChecked = isPrice ? item.show_price !== false : item.show_gb !== false;
  visibilityInput.disabled = true;

  try {
    const details = composeItemDetails(item.details, {
      sizeGb: item.size_gb,
      showPrice,
      showGb,
      portuguese: item.portuguese === true,
      extraImagePaths: (item.gallery_paths || []).slice(1),
    });
    const { error } = await supabase.from("items").update({ details }).eq("id", item.id);
    if (error) throw error;
    await loadItems();
    showToast(`${isPrice ? "Valor" : "GB"} ${visibilityInput.checked ? "exibido" : "ocultado"} no catálogo.`);
  } catch (error) {
    console.error(error);
    visibilityInput.checked = previousChecked;
    visibilityInput.disabled = false;
    showToast(error.message || "Não foi possível alterar a exibição.", "error");
  }
}

async function handleItemSave(event) {
  event.preventDefault();
  const button = event.submitter;
  setButtonLoading(button, true, "Salvando...");
  const uploadedPaths = [];
  try {
    const id = document.getElementById("itemId").value;
    const finalPaths = [];

    for (const entry of state.itemGalleryEntries) {
      if (entry.kind === "existing") {
        finalPaths.push(entry.path);
      } else if (entry.kind === "file") {
        const path = await uploadItemImage(entry.file);
        uploadedPaths.push(path);
        finalPaths.push(path);
      }
    }

    const priceValue = document.getElementById("itemPrice").value;
    const sizeGbValue = document.getElementById("itemSizeGb").value;
    const payload = {
      group_id: document.getElementById("itemGroup").value,
      name: document.getElementById("itemName").value.trim(),
      description: document.getElementById("itemDescription").value.trim(),
      details: composeItemDetails(document.getElementById("itemDetails").value.trim(), {
        sizeGb: sizeGbValue === "" ? null : Number(sizeGbValue),
        showPrice: document.getElementById("itemShowPrice").checked,
        showGb: document.getElementById("itemShowGb").checked,
        portuguese: document.getElementById("itemPortuguese").checked,
        extraImagePaths: finalPaths.slice(1),
      }),
      price: priceValue === "" ? null : Number(priceValue),
      size_gb: sizeGbValue === "" ? null : Number(sizeGbValue),
      sort_order: Number(document.getElementById("itemSort").value || 0),
      active: document.getElementById("itemActive").checked,
      image_path: finalPaths[0] || null,
    };

    let query = id
      ? supabase.from("items").update(payload).eq("id", id)
      : supabase.from("items").insert(payload);
    let { error } = await query;

    if (error && isMissingColumnError(error, "size_gb")) {
      const compatiblePayload = { ...payload };
      delete compatiblePayload.size_gb;
      query = id
        ? supabase.from("items").update(compatiblePayload).eq("id", id)
        : supabase.from("items").insert(compatiblePayload);
      ({ error } = await query);
    }

    if (error) throw error;

    const pathsToRemove = state.originalItemImagePaths.filter((path) => !finalPaths.includes(path));
    if (pathsToRemove.length) {
      await supabase.storage.from("item-images").remove(pathsToRemove);
    }

    resetItemForm();
    await loadItems();
    renderDashboard();
    showToast(id ? "Item atualizado." : "Item adicionado.");
  } catch (error) {
    console.error(error);
    if (uploadedPaths.length) {
      await supabase.storage.from("item-images").remove(uploadedPaths);
    }
    showToast(translateDatabaseError(error), "error");
  } finally {
    setButtonLoading(button, false);
  }
}

async function uploadItemImage(file) {
  const extension = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `items/${crypto.randomUUID()}.${extension}`;
  const { error } = await supabase.storage.from("item-images").upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type,
  });
  if (error) throw error;
  return path;
}

function getPublicImageUrl(path) {
  return path ? supabase.storage.from("item-images").getPublicUrl(path).data.publicUrl : "";
}

function clearPendingImagePreviews() {
  state.itemGalleryEntries.forEach((entry) => {
    if (entry.kind === "file" && entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  });
}

function handleItemImageSelection(event) {
  const files = [...(event.target.files || [])];
  if (!files.length) return;

  const remainingSlots = Math.max(0, 12 - state.itemGalleryEntries.length);
  if (!remainingSlots) {
    showToast("O limite é de 12 imagens por item.", "error");
    event.target.value = "";
    return;
  }

  let added = 0;
  for (const file of files.slice(0, remainingSlots)) {
    if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
      showToast(`O arquivo ${file.name} não é uma imagem JPG, PNG ou WebP.`, "error");
      continue;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast(`A imagem ${file.name} deve ter no máximo 5 MB.`, "error");
      continue;
    }
    state.itemGalleryEntries.push({
      kind: "file",
      key: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
    });
    added += 1;
  }

  if (files.length > remainingSlots) showToast("Somente as primeiras imagens até o limite de 12 foram adicionadas.", "error");
  if (added) renderItemGalleryPreview();
  event.target.value = "";
}

function handleItemGalleryPreviewClick(event) {
  const button = event.target.closest("[data-gallery-admin-action]");
  if (!button) return;
  const index = Number(button.dataset.galleryIndex);
  if (!Number.isInteger(index) || !state.itemGalleryEntries[index]) return;

  if (button.dataset.galleryAdminAction === "cover") {
    const [entry] = state.itemGalleryEntries.splice(index, 1);
    state.itemGalleryEntries.unshift(entry);
  } else if (button.dataset.galleryAdminAction === "remove") {
    const [entry] = state.itemGalleryEntries.splice(index, 1);
    if (entry?.kind === "file" && entry.previewUrl) URL.revokeObjectURL(entry.previewUrl);
  }
  renderItemGalleryPreview();
}

function renderItemGalleryPreview() {
  const container = document.getElementById("itemGalleryPreview");
  if (!container) return;
  if (!state.itemGalleryEntries.length) {
    container.innerHTML = `<div class="gallery-empty-admin">Nenhuma imagem adicionada. A primeira imagem será usada como capa.</div>`;
    return;
  }

  container.innerHTML = state.itemGalleryEntries.map((entry, index) => {
    const url = entry.kind === "existing" ? getPublicImageUrl(entry.path) : entry.previewUrl;
    const name = entry.kind === "existing" ? "Imagem salva" : entry.file.name;
    return `
      <article class="admin-gallery-item ${index === 0 ? "is-cover" : ""}">
        <img src="${escapeHtml(url)}" alt="${escapeHtml(name)}" />
        ${index === 0 ? `<span class="cover-badge">Capa</span>` : ""}
        <div class="admin-gallery-actions">
          ${index !== 0 ? `<button type="button" data-gallery-admin-action="cover" data-gallery-index="${index}">Usar como capa</button>` : ""}
          <button type="button" class="danger" data-gallery-admin-action="remove" data-gallery-index="${index}">Remover</button>
        </div>
      </article>`;
  }).join("");
}

function handleItemTableClick(event) {
  const button = event.target.closest("[data-item-action]");
  if (!button) return;
  const item = state.items.find((entry) => String(entry.id) === button.dataset.itemId);
  if (!item) return;
  if (button.dataset.itemAction === "edit") editItem(item);
  if (button.dataset.itemAction === "delete") deleteItem(item);
}

function editItem(item) {
  switchSection("items");
  document.getElementById("itemId").value = item.id;
  document.getElementById("existingImagePath").value = item.image_path || "";
  document.getElementById("itemGroup").value = item.group_id;
  document.getElementById("itemName").value = item.name || "";
  document.getElementById("itemDescription").value = item.description || "";
  document.getElementById("itemDetails").value = item.details || "";
  document.getElementById("itemPrice").value = item.price ?? "";
  document.getElementById("itemSizeGb").value = item.size_gb ?? "";
  document.getElementById("itemShowPrice").checked = item.show_price !== false;
  document.getElementById("itemShowGb").checked = item.show_gb !== false;
  document.getElementById("itemPortuguese").checked = item.portuguese === true;
  document.getElementById("itemSort").value = item.sort_order || 0;
  document.getElementById("itemActive").checked = Boolean(item.active);
  clearPendingImagePreviews();
  state.originalItemImagePaths = [...(item.gallery_paths || [])];
  state.itemGalleryEntries = state.originalItemImagePaths.map((path) => ({ kind: "existing", path }));
  renderItemGalleryPreview();
  document.getElementById("cancelItemEdit").classList.remove("hidden");
  document.getElementById("itemName").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteItem(item) {
  if (!window.confirm(`Excluir o item “${item.name}”?`)) return;
  try {
    const { error } = await supabase.from("items").delete().eq("id", item.id);
    if (error) throw error;
    if (item.gallery_paths?.length) await supabase.storage.from("item-images").remove(item.gallery_paths);
    await loadItems();
    renderDashboard();
    showToast("Item excluído.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível excluir o item.", "error");
  }
}

function resetItemForm() {
  document.getElementById("itemForm").reset();
  document.getElementById("itemId").value = "";
  document.getElementById("existingImagePath").value = "";
  document.getElementById("itemSort").value = "0";
  document.getElementById("itemShowPrice").checked = true;
  document.getElementById("itemShowGb").checked = true;
  document.getElementById("itemPortuguese").checked = false;
  document.getElementById("itemActive").checked = true;
  clearPendingImagePreviews();
  state.itemGalleryEntries = [];
  state.originalItemImagePaths = [];
  renderItemGalleryPreview();
  document.getElementById("cancelItemEdit").classList.add("hidden");
  populateGroupSelect();
}

function fillSettingsForm() {
  document.getElementById("settingBrandName").value = state.settings.brand_name || "";
  document.getElementById("settingSubtitle").value = state.settings.subtitle || "";
  document.getElementById("settingWhatsapp").value = state.settings.whatsapp_number || "";
  document.getElementById("settingWhatsappMessage").value = state.settings.whatsapp_message || "";
}

async function handleSettingsSave(event) {
  event.preventDefault();
  const button = event.submitter;
  setButtonLoading(button, true, "Salvando...");
  try {
    const payload = {
      id: 1,
      brand_name: document.getElementById("settingBrandName").value.trim(),
      subtitle: document.getElementById("settingSubtitle").value.trim(),
      whatsapp_number: document.getElementById("settingWhatsapp").value.replace(/\D/g, ""),
      whatsapp_message: document.getElementById("settingWhatsappMessage").value.trim(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("settings").upsert(payload);
    if (error) throw error;
    state.settings = payload;
    showToast("Configurações salvas.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível salvar.", "error");
  } finally {
    setButtonLoading(button, false);
  }
}

function getOrderTotalGb(order) {
  const storedTotal = Number(order?.total_gb || 0);
  if (storedTotal > 0) return storedTotal;
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.reduce(
    (sum, item) => sum + Number(item.size_gb || 0) * Number(item.quantity || 0),
    0
  );
}

function renderOrders() {
  const container = document.getElementById("ordersTable");
  if (!state.orders.length) {
    container.innerHTML = `<div class="empty-state compact"><strong>Nenhuma seleção recebida.</strong></div>`;
    return;
  }
  container.innerHTML = `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr><th>Data</th><th>Cliente</th><th>Telefone</th><th>Itens</th><th>GB</th><th>Total</th><th>Ações</th></tr></thead>
        <tbody>
          ${state.orders.map((order) => {
            const count = Array.isArray(order.items) ? order.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0) : 0;
            return `<tr>
              <td>${formatDate(order.created_at)}</td>
              <td><strong>${escapeHtml(order.customer_name || "Cliente")}</strong></td>
              <td>${escapeHtml(order.customer_phone || "—")}</td>
              <td>${count}</td>
              <td>${formatGigabytes(getOrderTotalGb(order))}</td>
              <td>${formatCurrency(order.total)}</td>
              <td><div class="table-actions">
                <button class="small-button" data-order-action="view" data-order-id="${escapeHtml(order.id)}" type="button">Ver</button>
                <button class="small-button danger" data-order-action="delete" data-order-id="${escapeHtml(order.id)}" type="button">Excluir</button>
              </div></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function handleOrderTableClick(event) {
  const button = event.target.closest("[data-order-action]");
  if (!button) return;
  const order = state.orders.find((entry) => String(entry.id) === button.dataset.orderId);
  if (!order) return;
  if (button.dataset.orderAction === "view") openOrderModal(order);
  if (button.dataset.orderAction === "delete") deleteOrder(order);
}

function openOrderModal(order) {
  state.currentOrder = order;
  const items = Array.isArray(order.items) ? order.items : [];
  document.getElementById("orderModalContent").innerHTML = `
    <div class="order-detail-grid">
      <div><span>Cliente</span><strong>${escapeHtml(order.customer_name || "—")}</strong></div>
      <div><span>Telefone</span><strong>${escapeHtml(order.customer_phone || "—")}</strong></div>
      <div><span>Data</span><strong>${formatDate(order.created_at)}</strong></div>
      <div><span>Total estimado</span><strong>${formatCurrency(order.total)}</strong></div>
      <div><span>Total acumulado em GB</span><strong>${formatGigabytes(getOrderTotalGb(order))}</strong></div>
    </div>
    <h3>Itens selecionados</h3>
    <div class="order-items-list">
      ${items.map((item) => `<div class="order-item-row"><span>${Number(item.quantity || 0)}x ${escapeHtml(item.name)}</span><strong>${Number(item.price || 0) > 0 ? formatCurrency(Number(item.price) * Number(item.quantity || 0)) : "Sob consulta"}<small>${Number(item.size_gb || 0) > 0 ? formatGigabytes(Number(item.size_gb) * Number(item.quantity || 0)) : "GB não informado"}</small></strong></div>`).join("")}
    </div>
    ${order.notes ? `<h3>Observações</h3><p>${escapeHtml(order.notes)}</p>` : ""}
  `;
  const modal = document.getElementById("orderModal");
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
}

function closeOrderModal() {
  state.currentOrder = null;
  const modal = document.getElementById("orderModal");
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
}

async function downloadCurrentOrderPdf() {
  if (!state.currentOrder) return;
  try {
    // Seleções novas já salvam a imagem exibida no preview. Para seleções antigas,
    // tenta recuperar a capa atual do item pelo ID antes de gerar o PDF.
    const enrichedOrder = {
      ...state.currentOrder,
      items: (Array.isArray(state.currentOrder.items) ? state.currentOrder.items : []).map((entry) => {
        const currentItem = state.items.find((item) => String(item.id) === String(entry.id));
        return {
          ...entry,
          image_url: entry.image_url || currentItem?.image_url || "",
        };
      }),
    };
    const { doc, filename } = await createOrderPdf(enrichedOrder, state.settings || {});
    doc.save(filename);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível gerar o PDF.", "error");
  }
}

async function deleteOrder(order) {
  if (!window.confirm(`Excluir a seleção de “${order.customer_name || "Cliente"}”?`)) return;
  try {
    const { error } = await supabase.from("orders").delete().eq("id", order.id);
    if (error) throw error;
    await loadOrders(false);
    showToast("Seleção excluída.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Não foi possível excluir.", "error");
  }
}
