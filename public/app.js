const state = {
  status: "pending",
  direction: "debito",
  currentMovement: null,
  selectedContact: null,
  bankAccounts: [],
  costCenters: [],
};

const fmtMoney = (n) => (n === null || n === undefined ? "-" : Number(n).toLocaleString("en-US", { style: "currency", currency: "USD" }));

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Error ${res.status}`);
  }
  return res.json();
}

async function loadMovements() {
  const params = new URLSearchParams();
  if (state.status) params.set("status", state.status);
  if (state.direction) params.set("direction", state.direction);
  const rows = await api(`/api/movements?${params}`);

  const tbody = document.getElementById("movements-body");
  tbody.innerHTML = "";
  document.getElementById("empty-hint").hidden = rows.length > 0;

  for (const row of rows) {
    const amount = row.direction === "debito" ? row.debito : row.credito;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${row.fecha}</td>
      <td>${row.descripcion ?? ""}</td>
      <td>${fmtMoney(amount)}</td>
      <td><span class="badge ${row.status}">${row.status}</span></td>
      <td>${row.alegra_contact_name ?? "-"}</td>
      <td></td>
    `;
    const actionsCell = tr.querySelector("td:last-child");
    if (row.status === "pending") {
      const matchBtn = document.createElement("button");
      matchBtn.className = "small";
      matchBtn.textContent = "Procesar";
      matchBtn.onclick = () => openModal(row);

      const ignoreBtn = document.createElement("button");
      ignoreBtn.className = "small secondary";
      ignoreBtn.textContent = "Ignorar";
      ignoreBtn.style.marginLeft = "6px";
      ignoreBtn.onclick = async () => {
        await api(`/api/movements/${row.id}/ignore`, { method: "POST" });
        loadMovements();
      };

      actionsCell.append(matchBtn, ignoreBtn);
    }
    tbody.appendChild(tr);
  }
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    state.status = tab.dataset.status;
    state.direction = tab.dataset.direction;
    loadMovements();
  });
});

document.getElementById("import-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fileInput = document.getElementById("file-input");
  const resultEl = document.getElementById("import-result");
  if (!fileInput.files.length) return;

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);
  resultEl.textContent = "Importando...";
  try {
    const res = await fetch("/api/movements/import", { method: "POST", body: formData });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    resultEl.textContent = `Importados ${body.inserted} nuevos de ${body.total} (duplicados: ${body.duplicates}).`;
    loadMovements();
  } catch (err) {
    resultEl.textContent = `Error: ${err.message}`;
  }
});

// ---------- Modal ----------

function openModal(row) {
  state.currentMovement = row;
  state.selectedContact = null;
  document.getElementById("modal-backdrop").hidden = false;
  document.getElementById("modal-title").textContent =
    row.direction === "debito" ? "Registrar pago a proveedor" : "Registrar cobro de cliente";
  const amount = row.direction === "debito" ? row.debito : row.credito;
  document.getElementById("modal-movement-desc").textContent = `${row.fecha} · ${row.descripcion ?? ""} · ${fmtMoney(amount)}`;
  document.getElementById("contact-search").value = "";
  document.getElementById("contact-results").innerHTML = "";
  document.getElementById("contact-selected").textContent = "";
  document.getElementById("documents-section").hidden = true;
  document.getElementById("documents-body").innerHTML = "";
  document.getElementById("observations-input").value = "";
  document.getElementById("modal-error").textContent = "";

  loadSelectOptions();
}

document.getElementById("modal-close").onclick = () => {
  document.getElementById("modal-backdrop").hidden = true;
};

async function loadSelectOptions() {
  if (!state.bankAccounts.length) {
    try {
      state.bankAccounts = await api("/api/alegra/bank-accounts");
    } catch (err) {
      state.bankAccounts = [];
    }
  }
  if (!state.costCenters.length) {
    try {
      state.costCenters = await api("/api/alegra/cost-centers");
    } catch (err) {
      state.costCenters = [];
    }
  }
  const bankSelect = document.getElementById("bank-account-select");
  bankSelect.innerHTML = state.bankAccounts.map((b) => `<option value="${b.id}">${b.name}</option>`).join("");
  const costSelect = document.getElementById("cost-center-select");
  costSelect.innerHTML =
    `<option value="">(ninguno)</option>` + state.costCenters.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
}

let searchTimeout;
document.getElementById("contact-search").addEventListener("input", (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  if (q.length < 2) {
    document.getElementById("contact-results").innerHTML = "";
    return;
  }
  searchTimeout = setTimeout(async () => {
    try {
      const contacts = await api(`/api/alegra/contacts?q=${encodeURIComponent(q)}`);
      const list = document.getElementById("contact-results");
      list.innerHTML = "";
      for (const c of contacts) {
        const li = document.createElement("li");
        li.textContent = c.name;
        li.onclick = () => selectContact(c);
        list.appendChild(li);
      }
    } catch (err) {
      document.getElementById("modal-error").textContent = err.message;
    }
  }, 300);
});

async function selectContact(contact) {
  state.selectedContact = contact;
  document.getElementById("contact-selected").textContent = `Seleccionado: ${contact.name}`;
  document.getElementById("contact-results").innerHTML = "";
  document.getElementById("contact-search").value = contact.name;

  const row = state.currentMovement;
  const endpoint = row.direction === "debito" ? "bills" : "invoices";
  let docs = [];
  try {
    docs = await api(`/api/alegra/contacts/${contact.id}/${endpoint}`);
  } catch (err) {
    document.getElementById("modal-error").textContent = err.message;
  }

  const section = document.getElementById("documents-section");
  const tbody = document.getElementById("documents-body");
  tbody.innerHTML = "";
  section.hidden = false;

  const totalAmount = row.direction === "debito" ? row.debito : row.credito;
  let remaining = totalAmount;

  for (const doc of docs) {
    const applied = Math.min(doc.balance, Math.max(remaining, 0));
    remaining -= applied;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><input type="checkbox" class="doc-check" ${applied > 0 ? "checked" : ""} /></td>
      <td>${doc.numberTemplate ?? doc.id}</td>
      <td>${doc.date ?? ""}</td>
      <td>${fmtMoney(doc.balance)}</td>
      <td><input type="number" class="doc-amount" step="0.01" value="${applied.toFixed(2)}" data-id="${doc.id}" data-max="${doc.balance}" /></td>
    `;
    tbody.appendChild(tr);
  }
}

document.getElementById("submit-match").addEventListener("click", async () => {
  const errorEl = document.getElementById("modal-error");
  errorEl.textContent = "";

  if (!state.selectedContact) {
    errorEl.textContent = "Selecciona un contacto de Alegra.";
    return;
  }

  const rows = [...document.querySelectorAll("#documents-body tr")];
  const applications = [];
  for (const tr of rows) {
    const checked = tr.querySelector(".doc-check").checked;
    const amountInput = tr.querySelector(".doc-amount");
    const amount = Number(amountInput.value);
    if (checked && amount > 0) {
      applications.push({ id: amountInput.dataset.id, amount });
    }
  }

  if (!applications.length) {
    errorEl.textContent = "Selecciona al menos una factura y un monto a aplicar.";
    return;
  }

  const row = state.currentMovement;
  const body = {
    contactId: state.selectedContact.id,
    contactName: state.selectedContact.name,
    contactType: row.direction === "debito" ? "proveedor" : "cliente",
    bankAccountId: document.getElementById("bank-account-select").value,
    paymentMethod: document.getElementById("payment-method-select").value,
    currencyCode: document.getElementById("currency-select").value,
    costCenterId: document.getElementById("cost-center-select").value || undefined,
    observations: document.getElementById("observations-input").value || undefined,
    applications,
  };

  try {
    const result = await api(`/api/movements/${row.id}/match`, { method: "POST", body: JSON.stringify(body) });
    if (result.dryRun) {
      errorEl.style.color = "#8a6100";
      errorEl.textContent = "DRY_RUN activo: no se envió nada a Alegra. Revisa los logs del servidor para ver el payload.";
    } else {
      document.getElementById("modal-backdrop").hidden = true;
    }
    loadMovements();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

loadMovements();
