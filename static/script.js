// ============================================================
//  SweetManager — script.js
//  SweetManager frontend
// ============================================================

const API = window.location.origin;

// ── Helpers ─────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
    try {
        const res = await fetch(`${API}${path}`, {
            headers: { 'Content-Type': 'application/json' },
            ...options,
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            let msg = err.detail;
            if (Array.isArray(msg)) {
                msg = msg.map((e) => (typeof e === 'object' && e.msg ? e.msg : String(e))).join(' ');
            } else if (msg && typeof msg === 'object') {
                msg = JSON.stringify(msg);
            }
            throw new Error(msg || `Error ${res.status}`);
        }
        // 204 No Content
        if (res.status === 204) return null;
        return await res.json();
    } catch (e) {
        showToast(e.message, true);
        throw e;
    }
}

function getStatusClass(estado) {
    const map = { 'Pendiente': 'pendiente', 'En proceso': 'proceso', 'Entregado': 'entregado' };
    return map[estado] || 'pendiente';
}

function formatPrice(value) {
    return `$${Number(value).toLocaleString('es-CO')}`;
}

function safeText(value) {
    return value === null || value === undefined ? '' : String(value);
}

// ── Navegación ───────────────────────────────────────────────

const sectionLoaders = {
    inicio: loadDashboard,
    productos: loadProductos,
    ingredientes: loadIngredientes,
    pedidos: loadPedidos,
    clientes: loadClientes,
    reportes: loadReportes,
};

function navTo(section) {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const btn = document.querySelector(`.nav-item[data-section="${section}"]`);
    if (btn) btn.classList.add('active');
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(`${section}-section`).classList.add('active');
    const label = btn?.querySelector('.nav-label')?.textContent.trim();
    document.getElementById('pageTitle').textContent = label || section;
    if (sectionLoaders[section]) sectionLoaders[section]();
}

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        navTo(item.dataset.section);
        if (window.innerWidth < 768) document.getElementById('sidebar').classList.remove('open');
    });
});

document.getElementById('menuToggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
});

// ── DASHBOARD ────────────────────────────────────────────────

async function loadDashboard() {
    try {
        const [pedidos, clientes, productos, alertas] = await Promise.all([
            apiFetch('/pedidos'), apiFetch('/clientes'),
            apiFetch('/productos'), apiFetch('/ingredientes/alertas'),
        ]);
        const totalVentas = pedidos.filter(p => p.estado === 'Entregado')
            .reduce((acc, p) => acc + Number(p.total), 0);
        const pedidosActivos = pedidos.filter(p => p.estado !== 'Entregado').length;

        document.querySelector('.stat-card:nth-child(1) .stat-value').textContent = formatPrice(totalVentas);
        document.querySelector('.stat-card:nth-child(2) .stat-value').textContent = pedidosActivos;
        document.querySelector('.stat-card:nth-child(3) .stat-value').textContent = productos.length;
        document.querySelector('.stat-card:nth-child(4) .stat-value').textContent = clientes.length;

        renderRecentOrders(pedidos.slice(0, 4));
        renderAlertasWidget(alertas);

        const badge = document.querySelector('.notification-badge');
        badge.textContent = alertas.length;
        badge.classList.toggle('is-hidden', alertas.length === 0);
    } catch (e) {
        showToast(e.message || 'No se pudo actualizar el estado del pedido.', true);
    }
}

function renderRecentOrders(pedidos) {
    const container = document.getElementById('recentOrders');
    if (!pedidos.length) { container.innerHTML = '<p class="muted">Sin pedidos recientes.</p>'; return; }
    container.innerHTML = pedidos.map(p => `
        <div class="order-item" role="button" tabindex="0" onclick="openPedidoDetalleModal(${p.id})"
             onkeydown="if(event.key==='Enter'||event.key===' '){ event.preventDefault(); openPedidoDetalleModal(${p.id}); }">
            <div class="order-header">
                <div>
                    <div class="order-client">${p.cliente_nombre || 'Cliente'}</div>
                    <div class="order-meta">Pedido #${p.id} · ${p.fecha}</div>
                </div>
                <span class="order-status status-${getStatusClass(p.estado)}">${p.estado}</span>
            </div>
            <div class="order-footer-row order-footer-row--compact">
                <span class="order-total">${formatPrice(p.total)}</span>
                <button type="button" class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); openPedidoDetalleModal(${p.id})">Detalle</button>
            </div>
        </div>`).join('');
}

function renderAlertasWidget(alertas) {
    const el = document.getElementById('alertasWidget');
    if (!alertas.length) {
        el.innerHTML = '<p class="text-success">Inventario dentro de los límites definidos.</p>';
        return;
    }
    el.innerHTML = alertas.map(a => `
        <div class="alert-row">
            <div>
                <span class="alert-row-name">${a.nombre}</span>
                <span class="alert-row-unit">${a.unidad_medida}</span>
            </div>
            <div class="alert-row-stock">
                <span class="alert-row-val">${a.stock_actual}</span>
                <span class="alert-row-min">mín. ${a.stock_minimo}</span>
            </div>
        </div>`).join('');
}

// ── PRODUCTOS ────────────────────────────────────────────────

async function loadProductos() {
    try { renderProductos(await apiFetch('/productos')); } catch (_) {}
}

function renderProductos(productos) {
    const grid = document.getElementById('productosGrid');
    if (!productos.length) { grid.innerHTML = '<p class="muted">No hay productos registrados.</p>'; return; }
    grid.innerHTML = productos.map((p) => {
        const initial = (p.nombre || '?').charAt(0).toUpperCase();
        const thumbHtml = p.image_url
            ? `<div class="product-thumb" aria-hidden="true"><img src="${p.image_url}" alt="${p.nombre}"></div>`
            : `<div class="product-thumb" aria-hidden="true"><span>${initial}</span></div>`;
        return `
        <div class="product-card">
            ${thumbHtml}
            <div class="product-content">
                <h4 class="product-name">${p.nombre}</h4>
                <p class="product-desc">${p.descripcion || 'Sin descripción'}</p>
                <div class="product-footer">
                    <span class="product-price">${formatPrice(p.precio_venta)}</span>
                </div>
                <div class="product-actions-row">
                    <button type="button" class="btn btn-secondary btn-sm btn-flex"
                        onclick="verCostoProducto(${p.id}, '${p.nombre.replace(/'/g,"\\'")}')">Costo</button>
                    <button type="button" class="btn btn-primary btn-sm btn-flex"
                        onclick="openRecetaModal(${p.id}, '${p.nombre.replace(/'/g,"\\'")}')">Receta</button>
                </div>
                <div class="product-actions-row" style="margin-top:6px;">
                    <button type="button" class="btn btn-secondary btn-sm btn-flex"
                        onclick="openEditProductModal(${p.id}, '${p.nombre.replace(/'/g,"\\'")}', ${p.precio_venta}, '${(p.descripcion||'').replace(/'/g,"\\'")}', '${p.image_url||''}')">Editar</button>
                    <button type="button" class="btn btn-sm btn-flex btn-danger-text"
                        onclick="eliminarProducto(${p.id}, '${p.nombre.replace(/'/g,"\\'")}')">Eliminar</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

async function verCostoProducto(id, nombre) {
    try {
        const data = await apiFetch(`/productos/${id}/costo`);
        showToast(`${nombre} — Costo: ${formatPrice(data.costo_produccion)} | Margen: ${formatPrice(data.margen_ganancia)}`);
    } catch (_) {}
}

function openProductModal()  { document.getElementById('productModal').classList.add('show'); }
function closeProductModal() { document.getElementById('productModal').classList.remove('show'); }

async function saveProduct() {
    const nombre       = document.getElementById('productName').value.trim();
    const precio_venta = parseFloat(document.getElementById('productPrice').value);
    const descripcion  = document.getElementById('productDesc').value.trim();
    const imageFile    = document.getElementById('productImage').files[0];
    if (!nombre || isNaN(precio_venta)) { showToast('Nombre y precio son obligatorios.', true); return; }
    try {
        const prod = await apiFetch('/productos', { method: 'POST', body: JSON.stringify({ nombre, descripcion, precio_venta }) });
        if (imageFile && prod.id) {
            const formData = new FormData();
            formData.append('file', imageFile);
            await fetch(`${API}/productos/${prod.id}/imagen`, { method: 'POST', body: formData });
        }
        closeProductModal();
        showToast('Producto guardado.');
        ['productName','productPrice','productDesc'].forEach(id => document.getElementById(id).value = '');
        clearProductImage();
        setTimeout(() => loadProductos(), 800);
    } catch (_) {}
}

function clearProductImage() {
    document.getElementById('productImage').value = '';
    document.getElementById('productImagePreview').style.display = 'none';
    document.getElementById('productImagePreviewImg').src = '';
}

document.addEventListener('DOMContentLoaded', () => {
    const input = document.getElementById('productImage');
    if (input) {
        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('productImagePreviewImg').src = e.target.result;
                document.getElementById('productImagePreview').style.display = 'block';
            };
            reader.readAsDataURL(file);
        });
    }

    const editInput = document.getElementById('editProductImage');
    if (editInput) {
        editInput.addEventListener('change', () => {
            const file = editInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                document.getElementById('editProductImagePreviewImg').src = e.target.result;
                document.getElementById('editProductImagePreview').style.display = 'block';
            };
            reader.readAsDataURL(file);
        });
    }
});

// ── EDITAR PRODUCTO ──────────────────────────────────────────

function openEditProductModal(id, nombre, precio, descripcion, imageUrl) {
    document.getElementById('editProductId').value        = id;
    document.getElementById('editProductName').value      = nombre;
    document.getElementById('editProductPrice').value     = precio;
    document.getElementById('editProductDesc').value      = descripcion;
    document.getElementById('editProductImage').value     = '';
    if (imageUrl) {
        document.getElementById('editProductImagePreviewImg').src = imageUrl;
        document.getElementById('editProductImagePreview').style.display = 'block';
    } else {
        clearEditProductImage();
    }
    document.getElementById('editProductModal').classList.add('show');
}

function closeEditProductModal() {
    document.getElementById('editProductModal').classList.remove('show');
}

function clearEditProductImage() {
    document.getElementById('editProductImage').value = '';
    document.getElementById('editProductImagePreview').style.display = 'none';
    document.getElementById('editProductImagePreviewImg').src = '';
}

async function updateProduct() {
    const id           = document.getElementById('editProductId').value;
    const nombre       = document.getElementById('editProductName').value.trim();
    const precio_venta = parseFloat(document.getElementById('editProductPrice').value);
    const descripcion  = document.getElementById('editProductDesc').value.trim();
    const imageFile    = document.getElementById('editProductImage').files[0];
    if (!nombre || isNaN(precio_venta)) { showToast('Nombre y precio son obligatorios.', true); return; }
    try {
        await apiFetch(`/productos/${id}`, { method: 'PUT', body: JSON.stringify({ nombre, descripcion, precio_venta }) });
        if (imageFile) {
            const formData = new FormData();
            formData.append('file', imageFile);
            await fetch(`${API}/productos/${id}/imagen`, { method: 'POST', body: formData });
        }
        closeEditProductModal();
        showToast('Producto actualizado.');
        loadProductos();
    } catch (_) {}
}

async function eliminarProducto(id, nombre) {
    if (!confirm(`¿Seguro que deseas eliminar "${nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
        await apiFetch(`/productos/${id}`, { method: 'DELETE' });
        showToast('Producto eliminado.');
        loadProductos();
    } catch (_) {}
}

// ── RECETAS (RF-09) ──────────────────────────────────────────

let _recetaProductoId = null;

async function openRecetaModal(productoId, nombre) {
    _recetaProductoId = productoId;
    document.getElementById('recetaModalTitle').textContent = `Receta: ${nombre}`;
    document.getElementById('recetaModal').classList.add('show');
    await Promise.all([cargarReceta(productoId), cargarIngredientesSelect()]);
}

function closeRecetaModal() { document.getElementById('recetaModal').classList.remove('show'); }

async function cargarReceta(productoId) {
    try {
        const receta = await apiFetch(`/productos/${productoId}/receta`);
        const el = document.getElementById('recetaIngredientesList');
        if (!receta.length) {
            el.innerHTML = '<p class="muted sm">Sin ingredientes en la receta.</p>';
            return;
        }
        el.innerHTML = receta.map(r => `
            <div class="list-row">
                <span class="list-row-main">${r.ingrediente_nombre}</span>
                <div class="list-row-actions">
                    <span class="muted sm">${r.cantidad} ${r.unidad_medida || ''}</span>
                    <button type="button" class="btn-text-danger" onclick="eliminarRecetaItem(${_recetaProductoId}, ${r.ingrediente_id})">Quitar</button>
                </div>
            </div>`).join('');
    } catch (_) {
        document.getElementById('recetaIngredientesList').innerHTML =
            '<p class="muted sm">Sin ingredientes en la receta.</p>';
    }
}

async function cargarIngredientesSelect() {
    try {
        const ings = await apiFetch('/ingredientes');
        const sel = document.getElementById('recetaIngredienteId');
        sel.innerHTML = '<option value="">Selecciona ingrediente...</option>' +
            ings.map(i => `<option value="${i.id}">${i.nombre} (${i.unidad_medida})</option>`).join('');
    } catch (_) {}
}

async function agregarIngredienteReceta() {
    const ingrediente_id = parseInt(document.getElementById('recetaIngredienteId').value);
    const cantidad       = parseFloat(document.getElementById('recetaCantidad').value);
    if (!ingrediente_id || isNaN(cantidad) || cantidad <= 0) {
        showToast('Seleccione ingrediente y cantidad válidos.', true); return;
    }
    try {
        // La API espera un array de items
        await apiFetch(`/productos/${_recetaProductoId}/receta`, {
            method: 'POST',
            body: JSON.stringify([{ ingrediente_id, cantidad }]),
        });
        document.getElementById('recetaCantidad').value = '';
        document.getElementById('recetaIngredienteId').value = '';
        showToast('Ingrediente añadido a la receta.');
        await cargarReceta(_recetaProductoId);
    } catch (_) {}
}

async function eliminarRecetaItem(productoId, ingredienteId) {
    if (!confirm('¿Eliminar este ingrediente de la receta?')) return;
    try {
        await apiFetch(`/productos/${productoId}/receta/${ingredienteId}`, { method: 'DELETE' });
        showToast('Ingrediente eliminado de la receta.');
        await cargarReceta(_recetaProductoId);
    } catch (_) {}
}

// ── INGREDIENTES (RF-05, 06, 07) ─────────────────────────────

async function loadIngredientes() {
    try {
        const [ings, alertas] = await Promise.all([
            apiFetch('/ingredientes'), apiFetch('/ingredientes/alertas'),
        ]);
        renderAlertasBanner(alertas);
        renderIngredientes(ings, alertas);
    } catch (_) {}
}

function renderAlertasBanner(alertas) {
    const el = document.getElementById('alertasBanner');
    if (!alertas.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
        <div class="banner-warn" role="status">
            <div>
                <p class="banner-warn-title">Stock bajo (${alertas.length})</p>
                <p class="banner-warn-body">${alertas.map(a => a.nombre).join(', ')}</p>
            </div>
        </div>`;
}

function renderIngredientes(ings, alertas = []) {
    const el = document.getElementById('ingredientesList');
    if (!ings.length) { el.innerHTML = '<p class="muted">No hay ingredientes registrados.</p>'; return; }
    const alertaIds = new Set(alertas.map(a => a.id));
    el.innerHTML = `
        <div class="ing-grid">
            ${ings.map(i => {
                const bajo = alertaIds.has(i.id);
                return `
                <div class="ing-card ${bajo ? 'ing-card--warn' : 'ing-card--ok'}">
                    <div class="ing-card-head">
                        <div>
                            <p class="ing-card-name">${i.nombre}</p>
                            <p class="ing-card-unit">${i.unidad_medida}</p>
                        </div>
                        ${bajo ? '<span class="badge badge-warn">Bajo mínimo</span>' : '<span class="badge badge-ok">En norma</span>'}
                    </div>
                    <div class="ing-card-stats">
                        <div class="ing-stat">
                            <p class="ing-stat-label">Actual</p>
                            <p class="ing-stat-val ${bajo ? 'ing-stat-val--warn' : ''}">${i.stock_actual}</p>
                        </div>
                        <div class="ing-stat ing-stat--muted">
                            <p class="ing-stat-label">Mínimo</p>
                            <p class="ing-stat-val">${i.stock_minimo}</p>
                        </div>
                    </div>
                    <button type="button" class="btn btn-primary btn-block btn-sm"
                        onclick="openStockModal(${i.id}, '${i.nombre.replace(/'/g,"\\'")}', ${i.stock_actual}, '${i.unidad_medida}')">
                        Ajustar stock
                    </button>
                </div>`;
            }).join('')}
        </div>`;
}

// Modal ingrediente
function openIngredienteModal()  { document.getElementById('ingredienteModal').classList.add('show'); }
function closeIngredienteModal() { document.getElementById('ingredienteModal').classList.remove('show'); }

async function saveIngrediente() {
    const nombre        = document.getElementById('ingNombre').value.trim();
    const unidad_medida = document.getElementById('ingUnidad').value.trim();
    const stock         = parseFloat(document.getElementById('ingStock').value);
    const stock_minimo  = parseFloat(document.getElementById('ingMinimo').value);
    if (!nombre || !unidad_medida || isNaN(stock) || isNaN(stock_minimo)) {
        showToast('Complete todos los campos.', true); return;
    }
    try {
        await apiFetch('/ingredientes', {
            method: 'POST',
            body: JSON.stringify({ nombre, unidad_medida, stock_actual: stock, stock_minimo }),
        });
        closeIngredienteModal();
        showToast('Ingrediente registrado.');
        ['ingNombre','ingUnidad','ingStock','ingMinimo'].forEach(id => document.getElementById(id).value = '');
        loadIngredientes();
    } catch (_) {}
}

// Modal stock
let _stockIngId = null;

function openStockModal(id, nombre, stockActual, unidad) {
    _stockIngId = id;
    document.getElementById('stockModalTitle').textContent = `Actualizar stock: ${nombre}`;
    document.getElementById('stockActual').textContent = `${stockActual} ${unidad}`;
    document.getElementById('stockCantidad').value = '';
    document.getElementById('stockModal').classList.add('show');
}
function closeStockModal() { document.getElementById('stockModal').classList.remove('show'); }

async function saveStock() {
    const cantidad = parseFloat(document.getElementById('stockCantidad').value);
    if (isNaN(cantidad) || cantidad <= 0) { showToast('Indique una cantidad válida.', true); return; }
    try {
        // La API recibe cantidad como query param, no como body
        await apiFetch(`/ingredientes/${_stockIngId}/stock?cantidad=${cantidad}`, { method: 'PUT' });
        closeStockModal();
        showToast('Stock actualizado.');
        loadIngredientes();
        apiFetch('/ingredientes/alertas').then(a => {
            const badge = document.querySelector('.notification-badge');
            badge.textContent = a.length;
            badge.classList.toggle('is-hidden', a.length === 0);
        }).catch(() => {});
    } catch (_) {}
}

// ── PEDIDOS ──────────────────────────────────────────────────

async function loadPedidos() {
    try {
        renderPedidos(await apiFetch('/pedidos'));
    } catch (_) {}
}

function renderPedidos(pedidos) {
    const list = document.getElementById('pedidosList');
    if (!pedidos.length) { list.innerHTML = '<p class="muted">No hay pedidos registrados.</p>'; return; }
    const siguienteEstado = { 'Pendiente': 'En proceso', 'En proceso': 'Entregado' };
    list.innerHTML = pedidos.map(p => {
        const next = siguienteEstado[p.estado];
        const btnAvanzar = next
            ? `<button type="button" class="btn btn-primary btn-sm"
                onclick="event.stopPropagation(); cambiarEstado(${p.id}, '${next}')">Marcar: ${next}</button>`
            : `<span class="order-done">Entregado</span>`;
        return `
            <div class="order-item" role="button" tabindex="0" onclick="openPedidoDetalleModal(${p.id})"
                 onkeydown="if(event.key==='Enter'||event.key===' '){ event.preventDefault(); openPedidoDetalleModal(${p.id}); }">
                <div class="order-header">
                    <div>
                        <div class="order-client">${p.cliente_nombre || 'Cliente #' + p.cliente_id}</div>
                        <div class="order-meta">Pedido #${p.id} · ${p.fecha}</div>
                    </div>
                    <span class="order-status status-${getStatusClass(p.estado)}">${p.estado}</span>
                </div>
                <div class="order-footer-row">
                    <span class="order-total">${formatPrice(p.total)}</span>
                    <div class="order-actions" onclick="event.stopPropagation();">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="openPedidoDetalleModal(${p.id})">Detalle</button>
                        ${btnAvanzar}
                    </div>
                </div>
            </div>`;
    }).join('');
}

function closePedidoDetalleModal() {
    document.getElementById('pedidoDetalleModal').classList.remove('show');
}

async function openPedidoDetalleModal(pedidoId) {
    const modal = document.getElementById('pedidoDetalleModal');
    const titulo = document.getElementById('pedidoDetalleTitulo');
    const meta = document.getElementById('pedidoDetalleMeta');
    const tbody = document.getElementById('pedidoDetalleTbody');
    const totalEl = document.getElementById('pedidoDetalleTotal');
    titulo.textContent = `Pedido #${pedidoId}`;
    meta.innerHTML = '<p class="pedido-detalle-loading">Cargando…</p>';
    tbody.innerHTML = '';
    totalEl.textContent = '';
    modal.classList.add('show');
    try {
        const data = await apiFetch(`/pedidos/${pedidoId}/detalle`);
        const ped = data.pedido;
        titulo.textContent = `Pedido #${ped.id}`;
        meta.innerHTML = `
            <div class="pedido-detalle-meta-grid">
                <div><span class="lbl">Cliente</span><span class="val">${ped.cliente_nombre || '—'}</span></div>
                <div><span class="lbl">Fecha</span><span class="val">${ped.fecha || '—'}</span></div>
                <div><span class="lbl">Estado</span><span class="val"><span class="order-status status-${getStatusClass(ped.estado)}">${ped.estado}</span></span></div>
            </div>`;
        if (!data.lineas || !data.lineas.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="pedido-detalle-empty">Sin líneas de detalle.</td></tr>';
        } else {
            tbody.innerHTML = data.lineas
                .map(
                    (l) => `
                <tr>
                    <td>${l.producto_nombre || 'Producto'}</td>
                    <td class="num">${l.cantidad}</td>
                    <td class="num">${formatPrice(l.precio_unitario)}</td>
                    <td class="num">${formatPrice(l.subtotal)}</td>
                </tr>`
                )
                .join('');
        }
        totalEl.innerHTML = `Total <strong>${formatPrice(ped.total)}</strong>`;
    } catch (_) {
        meta.innerHTML = '<p class="pedido-detalle-error">No se pudo cargar el detalle.</p>';
    }
}

async function cambiarEstado(pedidoId, nuevoEstado) {
    try {
        await apiFetch(`/pedidos/${pedidoId}/estado?estado=${encodeURIComponent(nuevoEstado)}`, { method: 'PUT' });
        showToast(`Estado actualizado: ${nuevoEstado}.`);
        loadPedidos();
        // Si se entregó, refresca dashboard
        if (nuevoEstado === 'Entregado') loadDashboard();
    } catch (_) {}
}

// Modal nuevo pedido
let _pedidoLineas = []; // [{producto_id, nombre, precio, cantidad}]
let _productosCache = [];

async function openPedidoModal() {
    _pedidoLineas = [];
    renderLineasPedido();

    const selCliente = document.getElementById('pedidoClienteId');
    const selProducto = document.getElementById('pedidoProductoId');
    selCliente.replaceChildren(new Option('Cargando clientes...', ''));
    selProducto.replaceChildren(new Option('Cargando productos...', ''));

    try {
        const clientes = await apiFetch('/clientes');
        selCliente.replaceChildren(new Option('Selecciona un cliente...', ''));
        clientes.forEach(c => selCliente.add(new Option(c.nombre, c.id)));
    } catch (_) {
        selCliente.replaceChildren(new Option('No se pudieron cargar clientes', ''));
    }

    try {
        const productos = await apiFetch('/productos');
        _productosCache = productos.filter(p => p.id !== null && p.id !== undefined);
        selProducto.replaceChildren(new Option('Selecciona producto...', ''));
        if (!_productosCache.length) {
            productos.forEach(p => {
                const option = new Option(`${p.nombre} - sin ID`, '');
                option.disabled = true;
                selProducto.add(option);
            });
            showToast('Los productos en Supabase tienen id NULL. Corrige la columna id para crear pedidos.', true);
        } else {
            _productosCache.forEach(p => {
                const option = new Option(`${p.nombre} - ${formatPrice(p.precio_venta)}`, p.id);
                option.dataset.precio = p.precio_venta;
                selProducto.add(option);
            });
        }
    } catch (_) {
        selProducto.replaceChildren(new Option('No se pudieron cargar productos', ''));
    }

    document.getElementById('pedidoModal').classList.add('show');
    return;

    try {
        const [clientes, productos] = await Promise.all([apiFetch('/clientes'), apiFetch('/productos')]);
        _productosCache = productos;

        const selCliente = document.getElementById('pedidoClienteId');
        selCliente.innerHTML = '<option value="">Selecciona un cliente...</option>' +
            clientes.map(c => `<option value="${c.id}">${c.nombre}</option>`).join('');

        const selProducto = document.getElementById('pedidoProductoId');
        selProducto.innerHTML = '<option value="">Selecciona producto...</option>' +
            productos.map(p => `<option value="${p.id}" data-precio="${p.precio_venta}">${p.nombre} — ${formatPrice(p.precio_venta)}</option>`).join('');
    } catch (_) {}

    document.getElementById('pedidoModal').classList.add('show');
}

function closePedidoModal() { document.getElementById('pedidoModal').classList.remove('show'); }

function agregarLineaPedido() {
    const sel      = document.getElementById('pedidoProductoId');
    const id       = parseInt(sel.value);
    const cantidad = parseInt(document.getElementById('pedidoCantidad').value) || 1;
    if (!id) { showToast('Seleccione un producto.', true); return; }

    const producto = _productosCache.find(p => p.id === id);
    if (!producto) return;

    const existe = _pedidoLineas.find(l => l.producto_id === id);
    if (existe) {
        existe.cantidad += cantidad;
    } else {
        _pedidoLineas.push({ producto_id: id, nombre: producto.nombre, precio: producto.precio_venta, cantidad });
    }
    document.getElementById('pedidoCantidad').value = '1';
    sel.value = '';
    renderLineasPedido();
}

function quitarLineaPedido(idx) {
    _pedidoLineas.splice(idx, 1);
    renderLineasPedido();
}

function renderLineasPedido() {
    const el = document.getElementById('pedidoLineas');
    if (!_pedidoLineas.length) {
        el.innerHTML = '<p class="muted center pad-v">Sin líneas en el pedido.</p>';
        document.getElementById('pedidoTotal').textContent = '$0';
        return;
    }
    el.innerHTML = _pedidoLineas.map((l, i) => `
        <div class="list-row">
            <div>
                <span class="list-row-main">${l.nombre}</span>
                <span class="muted sm"> · ${l.cantidad} ud.</span>
            </div>
            <div class="list-row-actions">
                <span class="order-total-inline">${formatPrice(l.precio * l.cantidad)}</span>
                <button type="button" class="btn-text-danger" onclick="quitarLineaPedido(${i})">Quitar</button>
            </div>
        </div>`).join('');
    const total = _pedidoLineas.reduce((acc, l) => acc + l.precio * l.cantidad, 0);
    document.getElementById('pedidoTotal').textContent = formatPrice(total);
}

async function savePedido() {
    const cliente_id = parseInt(document.getElementById('pedidoClienteId').value);
    if (!cliente_id) { showToast('Seleccione un cliente.', true); return; }
    if (!_pedidoLineas.length) { showToast('Añada al menos una línea al pedido.', true); return; }

    const hoy = new Date().toISOString().split('T')[0];
    const body = {
        cliente_id,
        fecha: hoy,
        estado: 'Pendiente',
        detalles: _pedidoLineas.map(l => ({ producto_id: l.producto_id, cantidad: l.cantidad })),
    };
    try {
        await apiFetch('/pedidos', { method: 'POST', body: JSON.stringify(body) });
        closePedidoModal();
        showToast('Pedido registrado.');
        loadPedidos();
        loadDashboard();
    } catch (_) {}
}

// ── CLIENTES ─────────────────────────────────────────────────

async function loadClientes() {
    try {
        renderClientes(await apiFetch('/clientes'));
    } catch (e) {
        document.getElementById('clientesList').innerHTML = `<p class="muted">No se pudieron cargar clientes: ${e.message}</p>`;
    }
}

function renderClientes(clientes) {
    const list = document.getElementById('clientesList');
    if (!clientes.length) { list.innerHTML = '<p class="muted">No hay clientes registrados.</p>'; return; }
    list.innerHTML = clientes.map(c => `
        <div class="client-card">
            <div class="client-header">
                <div class="client-avatar">${c.nombre.charAt(0).toUpperCase()}</div>
                <div class="client-body">
                    <div class="client-name">${c.nombre}</div>
                    <div class="client-contact"><span class="client-label">Correo</span> ${c.correo || '—'}</div>
                    <div class="client-contact"><span class="client-label">Tel.</span> ${c.telefono || '—'}</div>
                </div>
                <div class="client-actions">
                    <button type="button" class="btn btn-secondary btn-sm"
                        onclick="verHistorialCliente(${c.id}, '${safeText(c.nombre).replace(/'/g,"\\'")}')">Resumen</button>
                    <button type="button" class="btn btn-secondary btn-sm"
                        onclick="openEditClientModal(${c.id}, '${safeText(c.nombre).replace(/'/g,"\\'")}', '${safeText(c.telefono).replace(/'/g,"\\'")}', '${safeText(c.correo).replace(/'/g,"\\'")}')">Editar</button>
                    <button type="button" class="btn btn-secondary btn-sm btn-danger-text"
                        onclick="eliminarCliente(${c.id})">Eliminar</button>
                </div>
            </div>
        </div>`).join('');
}

async function verHistorialCliente(id, nombre) {
    try {
        const pedidos = await apiFetch(`/pedidos/cliente/${id}`);
        if (!pedidos.length) { showToast(`${nombre} no tiene pedidos registrados.`); return; }
        const total = pedidos.reduce((acc, p) => acc + Number(p.total), 0);
        showToast(`${nombre}: ${pedidos.length} pedidos · Total: ${formatPrice(total)}`);
    } catch (_) {}
}

async function eliminarCliente(id) {
    if (!confirm('¿Seguro que deseas eliminar este cliente?')) return;
    try {
        await apiFetch(`/clientes/${id}`, { method: 'DELETE' });
        showToast('Cliente eliminado.');
        loadClientes();
    } catch (_) {}
}

// Nuevo cliente
function openClientModal()  { document.getElementById('clientModal').classList.add('show'); }
function closeClientModal() { document.getElementById('clientModal').classList.remove('show'); }

async function saveClient() {
    const nombre   = document.getElementById('clientName').value.trim();
    const telefono = document.getElementById('clientPhone').value.trim();
    const correo   = document.getElementById('clientEmail').value.trim();
    if (!nombre) { showToast('El nombre es obligatorio.', true); return; }
    try {
        await apiFetch('/clientes', { method: 'POST', body: JSON.stringify({ nombre, telefono, correo }) });
        closeClientModal();
        showToast('Cliente registrado.');
        ['clientName','clientPhone','clientEmail'].forEach(id => document.getElementById(id).value = '');
        loadClientes();
    } catch (_) {}
}

// Editar cliente (RF-03)
function openEditClientModal(id, nombre, telefono, correo) {
    document.getElementById('editClientId').value    = id;
    document.getElementById('editClientName').value  = nombre;
    document.getElementById('editClientPhone').value = telefono;
    document.getElementById('editClientEmail').value = correo;
    document.getElementById('editClientModal').classList.add('show');
}
function closeEditClientModal() { document.getElementById('editClientModal').classList.remove('show'); }

async function updateClient() {
    const id       = document.getElementById('editClientId').value;
    const nombre   = document.getElementById('editClientName').value.trim();
    const telefono = document.getElementById('editClientPhone').value.trim();
    const correo   = document.getElementById('editClientEmail').value.trim();
    if (!nombre) { showToast('El nombre es obligatorio.', true); return; }
    try {
        await apiFetch(`/clientes/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ nombre, telefono, correo }),
        });
        closeEditClientModal();
        showToast('Cliente actualizado.');
        loadClientes();
    } catch (_) {}
}

// ── REPORTES ─────────────────────────────────────────────────

async function loadReportes() {
    try {
        const [pedidos, alertas] = await Promise.all([apiFetch('/pedidos'), apiFetch('/ingredientes/alertas')]);
        const totalVentas = pedidos.filter(p => p.estado === 'Entregado').reduce((acc, p) => acc + Number(p.total), 0);
        const entregados  = pedidos.filter(p => p.estado === 'Entregado').length;
        const enProceso   = pedidos.filter(p => p.estado === 'En proceso').length;
        const pendientes  = pedidos.filter(p => p.estado === 'Pendiente').length;
        document.getElementById('reportesGrid').innerHTML = `
            <div class="stat-card-small">
                <p class="report-label">Ventas entregadas</p>
                <p class="report-value">${formatPrice(totalVentas)}</p>
            </div>
            <div class="stat-card-small">
                <p class="report-label">Pedidos registrados</p>
                <p class="report-value">${pedidos.length}</p>
            </div>
            <div class="stat-card-small">
                <p class="report-label">Por estado</p>
                <p class="report-states">
                    <span class="report-states-item report-states-ok">${entregados} entregados</span>
                    <span class="report-states-item report-states-info">${enProceso} en proceso</span>
                    <span class="report-states-item report-states-warn">${pendientes} pendientes</span>
                </p>
            </div>
            <div class="stat-card-small">
                <p class="report-label">Inventario bajo mínimo</p>
                <p class="report-value ${alertas.length > 0 ? 'report-value--danger' : 'report-value--ok'}">
                    ${alertas.length > 0 ? alertas.map(a => a.nombre).join(', ') : 'Sin alertas'}
                </p>
            </div>`;
    } catch (_) {}
}

// ── TOAST ────────────────────────────────────────────────────

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = isError ? '#D9534F' : '#2E2E2E';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
}

// ── INICIO ───────────────────────────────────────────────────

loadDashboard();
