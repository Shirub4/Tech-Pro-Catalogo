import { formatCurrency, formatDate, formatGigabytes, slugify } from "./utils.js?v=20260721-gb4";

let pdfLibrariesPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-pdf-library="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") resolve();
      else existing.addEventListener("load", resolve, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.pdfLibrary = src;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error("Não foi possível carregar a biblioteca de PDF.")), { once: true });
    document.head.appendChild(script);
  });
}

async function ensurePdfLibraries() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API.autoTable) return;
  if (!pdfLibrariesPromise) {
    pdfLibrariesPromise = (async () => {
      if (!window.jspdf?.jsPDF) {
        await loadScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js");
      }
      if (!window.jspdf?.jsPDF?.API?.autoTable) {
        await loadScript("https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js");
      }
    })();
  }
  await pdfLibrariesPromise;
  if (!window.jspdf?.jsPDF || !window.jspdf.jsPDF.API.autoTable) {
    throw new Error("A biblioteca de PDF não foi carregada corretamente.");
  }
}

function getPreviewImageUrl(entry = {}) {
  if (entry.image_url) return String(entry.image_url);
  if (entry.preview_image_url) return String(entry.preview_image_url);
  if (Array.isArray(entry.image_urls) && entry.image_urls.length) {
    return String(entry.image_urls[0] || "");
  }
  return "";
}

function loadHtmlImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", () => reject(new Error("Imagem inválida.")), { once: true });
    image.src = src;
  });
}

async function preparePdfPreviewImage(url) {
  if (!url) return null;

  try {
    const response = await fetch(url, { cache: "force-cache", mode: "cors" });
    if (!response.ok) throw new Error(`Falha ao carregar imagem (${response.status}).`);

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    try {
      const image = await loadHtmlImage(objectUrl);
      const canvas = document.createElement("canvas");
      // Proporção 7:10 e resolução reduzida para manter o PDF leve.
      canvas.width = 280;
      canvas.height = 400;
      const context = canvas.getContext("2d");
      if (!context) return null;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);

      const sourceWidth = image.naturalWidth || image.width;
      const sourceHeight = image.naturalHeight || image.height;
      const scale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
      const width = sourceWidth * scale;
      const height = sourceHeight * scale;
      const x = (canvas.width - width) / 2;
      const y = (canvas.height - height) / 2;
      context.drawImage(image, x, y, width, height);

      return canvas.toDataURL("image/jpeg", 0.84);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } catch (error) {
    // Uma imagem indisponível não impede a geração do restante do PDF.
    console.warn("Não foi possível adicionar uma imagem ao PDF:", url, error);
    return null;
  }
}

async function prepareItemImages(items) {
  return Promise.all(items.map((entry) => preparePdfPreviewImage(getPreviewImageUrl(entry))));
}

function groupItemsForPdf(items, itemImages) {
  const grouped = new Map();

  items.forEach((entry, index) => {
    const groupName = String(entry.group_name || "Outros itens").trim() || "Outros itens";
    const groupKey = String(entry.group_id || groupName.toLocaleLowerCase("pt-BR"));
    const explicitPosition = Number(entry.group_sort_order);
    const hasExplicitPosition = Number.isFinite(explicitPosition);

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        name: groupName,
        sortPosition: hasExplicitPosition ? explicitPosition : Number.MAX_SAFE_INTEGER,
        firstIndex: index,
        entries: [],
      });
    }

    const group = grouped.get(groupKey);
    if (hasExplicitPosition) {
      group.sortPosition = Math.min(group.sortPosition, explicitPosition);
    }
    group.entries.push({ entry, imageData: itemImages[index] || null });
  });

  return [...grouped.values()].sort((first, second) => {
    if (first.sortPosition !== second.sortPosition) {
      return first.sortPosition - second.sortPosition;
    }
    if (first.firstIndex !== second.firstIndex) {
      return first.firstIndex - second.firstIndex;
    }
    return first.name.localeCompare(second.name, "pt-BR", { sensitivity: "base" });
  });
}

function buildPdfItemRow(entry, hasImage) {
  const unitPrice = Number(entry.price || 0);
  const sizeGb = Number(entry.size_gb || 0);
  const quantity = Number(entry.quantity || 0);
  const itemText = [entry.name || "Item", entry.description || ""]
    .filter(Boolean)
    .join("\n");

  return [
    hasImage ? "" : "-",
    itemText,
    String(quantity),
    sizeGb > 0 ? formatGigabytes(sizeGb) : "-",
    sizeGb > 0 ? formatGigabytes(sizeGb * quantity) : "-",
    unitPrice > 0 ? formatCurrency(unitPrice) : "Sob consulta",
    unitPrice > 0 ? formatCurrency(unitPrice * quantity) : "-",
  ];
}

export async function createOrderPdf(order, settings = {}) {
  await ensurePdfLibraries();
  const jsPDF = window.jspdf.jsPDF;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const brandName = settings.brand_name || "Tech Pro";
  const subtitle = settings.subtitle || "Seleção de itens";
  const items = Array.isArray(order.items) ? order.items : [];
  const itemImages = await prepareItemImages(items);
  const itemGroups = groupItemsForPdf(items, itemImages);

  doc.setFillColor(7, 26, 51);
  doc.rect(0, 0, 210, 38, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text(brandName, 15, 17);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(subtitle, 15, 25);
  doc.text(`Seleção nº ${String(order.id || "prévia").slice(0, 8)}`, 195, 17, { align: "right" });
  doc.text(formatDate(order.created_at || new Date().toISOString()), 195, 25, { align: "right" });

  doc.setTextColor(20, 32, 48);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("Dados do cliente", 15, 50);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Nome: ${order.customer_name || "Não informado"}`, 15, 58);
  doc.text(`Telefone: ${order.customer_phone || "Não informado"}`, 15, 64);

  let cursorY = 73;

  if (!itemGroups.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(90, 100, 112);
    doc.text("Nenhum item selecionado.", 15, cursorY);
    cursorY += 12;
  }

  itemGroups.forEach((group) => {
    // Evita deixar o título do grupo sozinho no fim da página.
    if (cursorY > 238) {
      doc.addPage();
      cursorY = 18;
    }

    const groupQuantity = group.entries.reduce(
      (sum, { entry }) => sum + Number(entry.quantity || 0),
      0
    );

    doc.setFillColor(228, 239, 251);
    doc.setDrawColor(190, 211, 234);
    doc.roundedRect(15, cursorY, 180, 9, 2, 2, "FD");
    doc.setTextColor(13, 79, 147);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10.5);
    doc.text(group.name, 19, cursorY + 6);
    doc.setFontSize(8.5);
    doc.text(
      `${groupQuantity} ${groupQuantity === 1 ? "item" : "itens"}`,
      191,
      cursorY + 6,
      { align: "right" }
    );

    cursorY += 11;
    const rows = group.entries.map(({ entry, imageData }) => buildPdfItemRow(entry, Boolean(imageData)));

    doc.autoTable({
      startY: cursorY,
      margin: { left: 15, right: 15, bottom: 18 },
      head: [["Imagem", "Item", "Qtd.", "GB un.", "GB total", "Valor un.", "Subtotal"]],
      body: rows,
      styles: {
        font: "helvetica",
        fontSize: 8.3,
        cellPadding: 2.2,
        minCellHeight: 29,
        valign: "middle",
      },
      headStyles: {
        fillColor: [13, 79, 147],
        textColor: 255,
        minCellHeight: 9,
        valign: "middle",
      },
      alternateRowStyles: { fillColor: [242, 246, 251] },
      columnStyles: {
        0: { cellWidth: 22, halign: "center" },
        1: { cellWidth: 50 },
        2: { cellWidth: 12, halign: "center" },
        3: { cellWidth: 18, halign: "right" },
        4: { cellWidth: 20, halign: "right" },
        5: { cellWidth: 28, halign: "right" },
        6: { cellWidth: 30, halign: "right" },
      },
      didDrawCell(data) {
        if (data.section !== "body" || data.column.index !== 0) return;
        const imageData = group.entries[data.row.index]?.imageData;
        if (!imageData) return;

        const imageWidth = 17.5;
        const imageHeight = 25;
        const x = data.cell.x + (data.cell.width - imageWidth) / 2;
        const y = data.cell.y + (data.cell.height - imageHeight) / 2;
        doc.addImage(imageData, "JPEG", x, y, imageWidth, imageHeight, undefined, "FAST");
      },
    });

    cursorY = doc.lastAutoTable.finalY + 8;
  });

  const calculatedTotalGb = items.reduce(
    (sum, entry) => sum + Number(entry.size_gb || 0) * Number(entry.quantity || 0),
    0
  );
  const totalGb = Number(order.total_gb || 0) || calculatedTotalGb;

  let y = cursorY + 2;
  if (y > 266) {
    doc.addPage();
    y = 22;
  }

  doc.setTextColor(20, 32, 48);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Total estimado: ${formatCurrency(order.total)}`, 195, y, { align: "right" });
  y += 7;
  doc.text(`Total acumulado em GB: ${formatGigabytes(totalGb)}`, 195, y, { align: "right" });

  if (order.notes) {
    y += 12;
    if (y > 260) {
      doc.addPage();
      y = 20;
    }
    doc.setFontSize(11);
    doc.text("Observações", 15, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    const noteLines = doc.splitTextToSize(order.notes, 180);
    doc.text(noteLines, 15, y);
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setTextColor(110, 120, 132);
    doc.text(
      `${brandName} • Documento gerado pelo catálogo online • Página ${page}/${pageCount}`,
      105,
      290,
      { align: "center" }
    );
  }

  const filename = `selecao-${slugify(order.customer_name || "cliente")}-${Date.now()}.pdf`;
  const blob = doc.output("blob");
  return { doc, blob, filename };
}
