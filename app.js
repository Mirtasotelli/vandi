// Log inicial para diagnóstico
console.log('app.js cargado exitosamente');

// Captura global de errores
window.addEventListener('error', function (e) {
  console.error('Error global detectado en app.js:', e.error || e.message, e.filename + ':' + e.lineno);
});

// ==========================================
// CONFIGURACIÓN INICIAL
// ==========================================
const URL_CSV_DIRECTO = "https://raw.githubusercontent.com/Mirtasotelli/RUTA3/main/productos.csv?v=" + new Date().getTime(); 
const MI_NUMERO_WHATSAPP = "5492235246285"; 

// --- INTERRUPTOR DE PROMOCIÓN MAYORISTA ---
const ACTIVAR_MAYORISTA = false; // true = Activado, false = Desactivado
const CANTIDAD_MINIMA_MAYORISTA = 5; 

// --- UMBRAL FOMO (URGENCIA DE STOCK) ---
const UMBRAL_STOCK_FOMO = 3; 

let productos = [];
let carrito = []; 
let cotizacionDolar = 1200;
let categoriaActiva = "Todas";
let productoModalActual = null;
let debounceTimeout = null;

// ==========================================
// UTILDADES DE SEGURIDAD / SANITIZACIÓN
// ==========================================
function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// ==========================================
// INICIALIZACIÓN DE LA APLICACIÓN
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    configurarInterfaz();
    CargarCSV();
    initScrollToTop();
    initBottomNav();
    configurarBuscadorDebounce();
});

function configurarInterfaz() {
    const tituloPrincipal = document.getElementById('titulo-principal');
    const bannerPromo = document.getElementById('banner-promocional');
    const textoCant = document.getElementById('texto-cantidad-mayorista');
    
    if (ACTIVAR_MAYORISTA) {
        document.title = "Catálogo Mayorista Premium";
        if (tituloPrincipal) tituloPrincipal.innerText = "CATÁLOGO MAYORISTA";
        if (bannerPromo) bannerPromo.style.display = "block"; 
        if (textoCant) textoCant.innerText = `${CANTIDAD_MINIMA_MAYORISTA} o más unidades`;
    } else {
        document.title = "Catálogo de Productos";
        if (tituloPrincipal) tituloPrincipal.innerText = "CATÁLOGO DIGITAL";
        if (bannerPromo) bannerPromo.style.display = "none"; 
    }
}

function redondearPrecioPsicologico(valor) {
    if (valor <= 0) return 0;
    
    // Si el precio en pesos es menor a $10.000, redondea de 100 en 100
    if (valor < 10000) {
        return Math.round(valor / 100) * 100;
    }
    
    // Si es mayor a $10.000, redondea de 500 en 500
    return Math.round(valor / 500) * 500;
}

// ==========================================
// 1. OBTENER DÓLAR BLUE EN TIEMPO REAL
// ==========================================
async function obtenerDolar() {
    try {
        const res = await fetch('https://dolarapi.com/v1/dolares/blue');
        const data = await res.json();
        if (data && data.venta) cotizacionDolar = data.venta;
    } catch (e) {
        console.log("Usando dólar de respaldo $1200");
    }
}

// ==========================================
// 2. CARGAR Y PROCESAR CSV (ULTRA TOLERANTE Y SIN CACHÉ)
// ==========================================
async function CargarCSV() {
    await obtenerDolar();
    
    if (typeof Papa === 'undefined') {
        console.error('PapaParse no está definido. Revisa si la CDN de PapaParse está cargada en index.html');
        const contenedor = document.getElementById('contenedor-productos');
        if (contenedor) contenedor.innerHTML = `<div class="col-span-full py-16 text-center text-red-500 font-medium">Error al cargar la librería de lectura CSV (PapaParse).</div>`;
        return;
    }

    try {
        const respuesta = await fetch(URL_CSV_DIRECTO, { cache: 'no-store' });
        if (!respuesta.ok) {
            console.error('No se pudo cargar el CSV:', respuesta.status, respuesta.statusText);
            const contenedor = document.getElementById('contenedor-productos');
            if (contenedor) contenedor.innerHTML = `<div class="col-span-full py-16 text-center text-red-500 font-medium">Error al obtener el archivo de productos.</div>`;
            return;
        }
        const textoCSV = await respuesta.text();

        Papa.parse(textoCSV, {
            header: true,
            skipEmptyLines: 'greedy',
            complete: function(results) {
                try {
                    const idsVistos = new Set();

                    let datos = results.data
                        .map((row, index) => {
                            const p = {};
                            Object.keys(row).forEach(key => {
                                if (key) {
                                    const keyLimpia = key.trim().toLowerCase();
                                    p[keyLimpia] = row[key] ? String(row[key]).trim() : '';
                                }
                            });

                            const idLimpio = p.id ? String(p.id).trim() : `prod-${index + 1}`;
                            const nombre = p.nombre || p.producto || p.articulo || p.titulo || p.descripcion || '';

                            let catLimpia = (p.categoria || 'General').trim();
                            if (catLimpia) {
                                catLimpia = catLimpia.charAt(0).toUpperCase() + catLimpia.slice(1);
                            }

                            return {
                                ...p,
                                id: idLimpio,
                                nombre: nombre.trim(),
                                categoria: catLimpia
                            };
                        })
                        .filter(p => p.nombre.length > 0)
                        .filter(p => {
                            if (idsVistos.has(p.id)) {
                                console.warn(`ID duplicado ignorado: ${p.id}`);
                                return false;
                            }
                            idsVistos.add(p.id);
                            return true;
                        });

                    datos.sort((a, b) => {
                        const obtenerValorStock = (stockTxt) => {
                            const txt = String(stockTxt || '').toLowerCase().trim();
                            const num = parseInt(txt);
                            if (!isNaN(num)) return num; 
                            if (['si', 'disponible', 'stock', 'en stock'].includes(txt)) return 9999; 
                            return 0; 
                        };
                        return obtenerValorStock(b.stock) - obtenerValorStock(a.stock);
                    });

                    productos = datos;
                    console.log(`Cargados ${productos.length} productos correctamente.`);
                    console.log('¿Existe ID 82?:', productos.some(p => p.id === '82'));

                    generarBotonesCategorias();
                    filtrarProductos();
                    verificarProductoEnURL();
                } catch (innerE) {
                    console.error('Error procesando CSV:', innerE);
                }
            }
        });
    } catch (error) {
        console.error("Error al cargar el CSV:", error);
    }
}

// ==========================================
// 3. FILTROS Y CATEGORÍAS
// ==========================================
function generarBotonesCategorias() {
    try {
        const contenedor = document.getElementById('contenedor-categorias');
        if (!contenedor) return;

        const categoriasUnicas = [...new Set(
            productos
                .map(p => p.categoria)
                .filter(cat => cat && cat.trim() !== '')
        )];

        const categorias = ["Todas", ...categoriasUnicas];

        if (!categorias.includes(categoriaActiva)) {
            categoriaActiva = "Todas";
        }

        contenedor.innerHTML = '';
        categorias.forEach(cat => {
            const btn = document.createElement('button');
            btn.className = `btn-categoria text-xs font-bold px-3.5 py-1.5 rounded-full whitespace-nowrap transition-all ${cat === categoriaActiva ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`;
            btn.textContent = cat;
            btn.addEventListener('click', () => seleccionarCategoria(cat));
            contenedor.appendChild(btn);
        });
    } catch (e) {
        console.error('Error en generarBotonesCategorias:', e);
    }
}

function seleccionarCategoria(cat) {
    categoriaActiva = cat;
    generarBotonesCategorias();
    filtrarProductos();
}

function configurarBuscadorDebounce() {
    const input = document.getElementById('input-busqueda');
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            filtrarProductos();
        }, 200);
    });
}

function filtrarProductos() {
    const texto = (document.getElementById('input-busqueda')?.value || '').toLowerCase().trim();

    const filtrados = productos.filter(p => {
        const coincideCat = categoriaActiva === "Todas" || p.categoria === categoriaActiva;
        const nombre = String(p.nombre || '').toLowerCase();
        const coincideNombre = nombre.includes(texto);
        return coincideCat && coincideNombre;
    });

    dibujarProductos(filtrados);
}

// ==========================================
// 4. RENDERIZAR PRODUCTOS EN GRILLA
// ==========================================
function dibujarProductos(lista) {
    try {
        const contenedor = document.getElementById('contenedor-productos');
        if (!contenedor) return;

        if (!Array.isArray(lista) || lista.length === 0) {
            contenedor.innerHTML = `<div class="col-span-full py-16 text-center text-slate-400 font-medium">No se encontraron artículos.</div>`;
            return;
        }

        contenedor.innerHTML = lista.map(prod => {
            const prodId = String(prod.id).trim();
            const prodNombre = escapeHTML(prod.nombre);
            const prodCategoria = escapeHTML(prod.categoria || 'General');

            const pMinUSD = parseFloat(prod.precio_minorista) || 0;
            const pMayUSD = parseFloat(prod.precio_mayorista) || 0;
            
            const pMinARS = redondearPrecioPsicologico(pMinUSD * cotizacionDolar);
            const pMayARS = redondearPrecioPsicologico(pMayUSD * cotizacionDolar);

            const stockTxt = String(prod.stock || '').toLowerCase().trim();
            const esStockNumerico = !isNaN(parseInt(stockTxt));
            const cantidadStock = esStockNumerico ? parseInt(stockTxt) : 0;
            const tieneStock = esStockNumerico ? cantidadStock > 0 : ['si', 'disponible', 'stock', 'en stock'].includes(stockTxt);

            const botonHTML = tieneStock 
                ? `<button onclick="event.stopPropagation(); agregarAlCarrito('${prodId}', 1)" class="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-xl text-xs font-bold transition-all z-20 relative">Agregar</button>`
                : `<button disabled class="bg-slate-100 text-slate-400 px-3 py-1.5 rounded-xl text-xs font-bold cursor-not-allowed z-20 relative">Agotado</button>`;

            let cartelUrgencia = '';
            if (tieneStock && esStockNumerico && cantidadStock <= UMBRAL_STOCK_FOMO) {
                const textoUrgencia = cantidadStock === 1 ? "¡Última unidad!" : "¡Últimas unidades!";
                cartelUrgencia = `
                    <div class="absolute top-3 right-3 z-20 bg-red-600 text-white text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-full shadow-md shadow-red-500/30 animate-pulse pointer-events-none">
                        ${textoUrgencia}
                    </div>
                `;
            }

            const arrayImagenes = (prod.imagen || "").split('|').map(u => u.trim());
            const img1 = arrayImagenes[0] || 'https://via.placeholder.com/300';
            const img2 = arrayImagenes.length > 1 ? arrayImagenes[1] : img1;

            let bloquePreciosGrilla = ACTIVAR_MAYORISTA ? `
                <div>
                    <p class="font-black text-emerald-600 text-sm">$${pMayARS.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                    <p class="precio-usd-grilla">USD ${pMayUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                    <p class="text-[10px] line-through text-slate-400 mt-1">$${pMinARS.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                    <p class="text-[10px] text-slate-300">USD ${pMinUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                </div>
            ` : `
                <div>
                    <p class="font-black text-emerald-600 text-sm">$${pMinARS.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                    <p class="precio-usd-grilla">USD ${pMinUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                </div>
            `;

            return `
                <div onclick="abrirModal('${prodId}')" class="relative bg-white p-3.5 sm:p-4 rounded-2xl shadow-sm border border-slate-200/80 flex flex-col justify-between cursor-pointer hover:shadow-md transition-all group overflow-hidden">
                    ${cartelUrgencia}
                    <div>
                        <div class="relative overflow-hidden rounded-xl bg-slate-50 mb-3 h-48 sm:h-56 p-2 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
                            <img src="${img2}" class="w-full h-full object-contain max-h-full max-w-full p-2" onerror="this.src='https://via.placeholder.com/300'">
                            <img src="${img1}" class="absolute inset-0 w-full h-full object-contain max-h-full max-w-full p-2 hover-img bg-slate-50" onerror="this.src='https://via.placeholder.com/300'">
                        </div>
                        <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">${prodCategoria}</span>
                        <h3 class="font-bold text-slate-900 text-xs sm:text-sm leading-snug mb-2 group-hover:text-emerald-600 transition-colors line-clamp-2">${prodNombre}</h3>
                    </div>
                    <div class="flex justify-between items-end border-t border-slate-100 pt-2.5 mt-2">
                        ${bloquePreciosGrilla}
                        ${botonHTML}
                    </div>
                </div>
            `;
        }).join('');
    } catch (e) {
        console.error('Error en dibujarProductos:', e);
    }
}

// ==========================================
// 5. POPUP MODAL
// ==========================================
function abrirModal(id) {
    try {
        const prod = productos.find(p => String(p.id).trim() === String(id).trim());
        if (!prod) return;

        productoModalActual = prod;

        const pMinUSD = parseFloat(prod.precio_minorista) || 0;
        const pMayUSD = parseFloat(prod.precio_mayorista) || 0;

        const pMinARS = redondearPrecioPsicologico(pMinUSD * cotizacionDolar);
        const pMayARS = redondearPrecioPsicologico(pMayUSD * cotizacionDolar);

        const stockTxt = String(prod.stock || '').toLowerCase().trim();
        const esStockNumerico = !isNaN(parseInt(stockTxt));
        const cantidadStock = esStockNumerico ? parseInt(stockTxt) : 0;
        const tieneStock = esStockNumerico ? cantidadStock > 0 : ['si', 'disponible', 'stock', 'en stock'].includes(stockTxt);

        const arrayImagenes = (prod.imagen || "").split('|').map(u => u.trim());
        
        const fotoPrincipal = document.getElementById('modal-imagen');
        if (fotoPrincipal) {
            fotoPrincipal.src = arrayImagenes[0] || 'https://via.placeholder.com/300';
            fotoPrincipal.className = "w-full h-64 sm:h-96 object-contain max-h-[80vh] mx-auto rounded-xl bg-slate-50 p-3 transition-opacity duration-200";
        }
        
        const galeriaContenedor = document.getElementById('modal-galeria');
        if (galeriaContenedor) galeriaContenedor.innerHTML = ""; 
        
        if (arrayImagenes.length > 1 && galeriaContenedor) {
            galeriaContenedor.classList.remove('hidden');
            arrayImagenes.forEach((imgSrc) => {
                const btnThumb = document.createElement('button');
                btnThumb.className = "w-14 h-14 shrink-0 rounded-lg overflow-hidden border-2 border-slate-100 hover:border-slate-900 focus:border-slate-900 transition-all bg-slate-50 p-1";
                btnThumb.innerHTML = `<img src="${imgSrc}" class="w-full h-full object-contain">`;
                btnThumb.onclick = () => cambiarFotoModal(imgSrc);
                galeriaContenedor.appendChild(btnThumb);
            });
        } else if (galeriaContenedor) {
            galeriaContenedor.classList.add('hidden'); 
        }

        const modalCategoriaEl = document.getElementById('modal-categoria');
        if (modalCategoriaEl) modalCategoriaEl.innerText = prod.categoria || 'Producto';
        const modalNombreEl = document.getElementById('modal-nombre');
        if (modalNombreEl) modalNombreEl.innerText = prod.nombre;
        
        const elDesc = document.getElementById('modal-descripcion');
        if (elDesc) elDesc.innerText = prod.descripcion || 'Sin descripción disponible.';

        const contenedorPreciosModal = document.getElementById('contenedor-precios-modal');
        if (contenedorPreciosModal) {
            if (ACTIVAR_MAYORISTA) {
                contenedorPreciosModal.className = "grid grid-cols-2 gap-2 my-2";
                contenedorPreciosModal.innerHTML = `
                    <div class="border-r border-slate-200/60 pr-2">
                        <p class="text-[10px] text-slate-400 font-semibold uppercase">Minorista</p>
                        <p class="text-sm font-bold text-slate-500 line-through">$${pMinARS.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                        <p class="precio-usd-modal text-xs text-slate-400">USD ${pMinUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                    </div>
                    <div class="pl-2">
                        <p class="text-[10px] text-emerald-600 font-bold uppercase">Mayorista</p>
                        <p class="text-lg font-black text-emerald-600">$${pMayARS.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                        <p class="precio-usd-modal text-xs text-emerald-600">USD ${pMayUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                    </div>
                `;
            } else {
                contenedorPreciosModal.className = "flex justify-center text-center flex-col my-2";
                contenedorPreciosModal.innerHTML = `
                    <div>
                        <p class="text-[10px] text-emerald-600 font-bold uppercase">Precio Unitario</p>
                        <p class="text-2xl font-black text-emerald-600">$${pMinARS.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                        <p class="precio-usd-modal text-xs text-slate-400 mt-1">USD ${pMinUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                    </div>
                `;
            }
        }

        const inputCant = document.getElementById('modal-cantidad');
        if (inputCant) inputCant.value = 1;

        const badgeContainer = document.getElementById('modal-stock-badge');
        const btnContainer = document.getElementById('modal-btn-container');

        if (tieneStock) {
            if (esStockNumerico && cantidadStock <= UMBRAL_STOCK_FOMO) {
                const textoModalUrgencia = cantidadStock === 1 ? "🔥 ¡Solo queda 1 unidad!" : `🔥 ¡Solo quedan ${cantidadStock} unidades!`;
                if (badgeContainer) badgeContainer.innerHTML = `<span class="inline-block bg-red-100 text-red-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-red-200 animate-pulse">${textoModalUrgencia}</span>`;
            } else if (badgeContainer) {
                badgeContainer.innerHTML = `<span class="inline-block bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-emerald-200">● En Stock</span>`;
            }
            if (btnContainer) btnContainer.innerHTML = `<button onclick="confirmarAgregarModal()" class="w-full bg-slate-900 text-white py-2.5 rounded-xl font-bold text-xs hover:bg-slate-800 transition-all">Agregar al Carrito</button>`;
        } else {
            if (badgeContainer) badgeContainer.innerHTML = `<span class="inline-block bg-red-50 text-red-700 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-red-200">● Agotado</span>`;
            if (btnContainer) btnContainer.innerHTML = `<button disabled class="w-full bg-slate-100 text-slate-400 py-2.5 rounded-xl font-bold text-xs cursor-not-allowed">Sin Stock</button>`;
        }

        const modalDetalle = document.getElementById('modal-detalle');
        if (modalDetalle) {
            modalDetalle.classList.remove('hidden');
            document.body.classList.add('overflow-hidden');
        }

    } catch (e) {
        console.error('Error en abrirModal:', e);
    }
}

function cambiarFotoModal(url) {
    const fotoPrincipal = document.getElementById('modal-imagen');
    if (!fotoPrincipal) return;
    fotoPrincipal.style.opacity = '0.5'; 
    setTimeout(() => {
        fotoPrincipal.src = url;
        fotoPrincipal.style.opacity = '1';
    }, 150);
}

function cambiarCantidadModal(delta) {
    const inputCant = document.getElementById('modal-cantidad');
    if (!inputCant) return;

    let actual = parseInt(inputCant.value) || 1;
    if (actual + delta >= 1) {
        inputCant.value = actual + delta;
    }
}

function validarCantidadInputModal(input) {
    let val = parseInt(input.value);
    if (isNaN(val) || val < 1) {
        input.value = 1;
    }
}

function confirmarAgregarModal() {
    const inputCant = document.getElementById('modal-cantidad');
    const cantidad = parseInt(inputCant?.value) || 1;

    if (productoModalActual) {
        agregarAlCarrito(productoModalActual.id, cantidad);
        cerrarModal();
    }
}

function cerrarModal() {
    const modalDetalle = document.getElementById('modal-detalle');
    if (modalDetalle) {
        modalDetalle.classList.add('hidden');
        document.body.classList.remove('overflow-hidden');
    }
}

document.getElementById('modal-detalle')?.addEventListener('click', function(e) {
    if (e.target === this) cerrarModal();
});

// ==========================================
// 6. LÓGICA CARRITO Y WHATSAPP
// ==========================================
function agregarAlCarrito(id, cantidad = 1) {
    const prod = productos.find(p => String(p.id).trim() === String(id).trim());
    if (!prod) return;

    const itemExistente = carrito.find(item => String(item.producto.id).trim() === String(id).trim());

    if (itemExistente) {
        itemExistente.cantidad += cantidad;
    } else {
        carrito.push({ producto: prod, cantidad: cantidad });
    }

    actualizarCarrito();
}

function refreshNavBadge() {
    const badge = document.getElementById('mnav-badge');
    if (!badge) return;
    const totalUnidades = carrito.reduce((acc, item) => acc + item.cantidad, 0);
    if (totalUnidades > 0) {
        badge.innerText = totalUnidades;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

function actualizarCarrito() {
    try {
        const lista = document.getElementById('lista-carrito');
        const totalEl = document.getElementById('total-precio');
        const totalMobile = document.getElementById('total-precio-mobile');
        const cantMobile = document.getElementById('cant-items-mobile');
        const badgeTotalItems = document.getElementById('badge-total-items');
        const avisoEl = document.getElementById('aviso-mayorista');
        
        if (!lista) return;
        lista.innerHTML = "";

        const totalUnidades = carrito.reduce((acc, item) => acc + item.cantidad, 0);
        const aplicaMayorista = ACTIVAR_MAYORISTA && (totalUnidades >= CANTIDAD_MINIMA_MAYORISTA);
        let totalARS = 0;
        let totalUSD = 0;

        carrito.forEach((item, idx) => {
            const prod = item.producto;
            const pUSD = aplicaMayorista ? parseFloat(prod.precio_mayorista) : parseFloat(prod.precio_minorista);
            const pARS = redondearPrecioPsicologico(pUSD * cotizacionDolar);
            const subtotal = pARS * item.cantidad;
            const subtotalUSD = pUSD * item.cantidad;
            totalARS += subtotal;
            totalUSD += subtotalUSD;

            lista.innerHTML += `
                <div class="flex items-center justify-between bg-slate-50 p-2 rounded-xl text-xs border border-slate-100">
                    <div class="pr-2 truncate flex-1">
                        <p class="font-bold text-slate-800 truncate">${escapeHTML(prod.nombre)}</p>
                        <p class="text-[10px] text-slate-400">$${pARS.toLocaleString('es-AR', {minimumFractionDigits: 2})}</p>
                        <p class="precio-usd-carrito text-[10px] text-slate-400">USD ${pUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})} c/u</p>
                    </div>
                    <div class="flex items-center gap-2 shrink-0">
                        <div class="flex items-center border bg-white rounded-lg px-1">
                            <button onclick="modificarCantidadCarrito(${idx}, -1)" class="px-1 text-slate-500 font-bold">-</button>
                            <span class="px-1.5 font-bold text-slate-900">${item.cantidad}</span>
                            <button onclick="modificarCantidadCarrito(${idx}, 1)" class="px-1 text-slate-500 font-bold">+</button>
                        </div>
                        <button onclick="eliminarDelCarrito(${idx})" class="text-red-500 font-bold hover:text-red-700 text-xs px-1">✕</button>
                    </div>
                </div>
            `;
        });

        if (totalEl) {
            totalEl.innerHTML = `<div class="text-2xl font-black text-slate-900">$${totalARS.toLocaleString('es-AR', {minimumFractionDigits: 2})}</div><div class="total-usd-desktop mt-1 text-xs text-slate-400">USD ${totalUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}</div>`;
        }
        
        if (totalMobile) {
            totalMobile.innerHTML = `${totalARS.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;
        }
        
        if (cantMobile) cantMobile.innerText = totalUnidades;
        if (badgeTotalItems) badgeTotalItems.innerText = `${totalUnidades} item${totalUnidades !== 1 ? 's' : ''}`;

        if (avisoEl) {
            if (!ACTIVAR_MAYORISTA) {
                avisoEl.style.display = 'none'; 
            } else {
                avisoEl.style.display = 'block';
                if (aplicaMayorista) {
                    avisoEl.innerText = "¡Precios mayoristas aplicados!";
                    avisoEl.className = "text-xs font-bold text-emerald-700 mb-4 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200 text-center";
                } else {
                    const faltantes = CANTIDAD_MINIMA_MAYORISTA - totalUnidades;
                    avisoEl.innerText = `Llevá ${faltantes} un. más para precio mayorista.`;
                    avisoEl.className = "text-xs font-semibold text-amber-800 mb-4 bg-amber-50 p-2.5 rounded-xl border border-amber-200 text-center";
                }
            }
        }

        refreshNavBadge();

    } catch (e) {
        console.error('Error en actualizarCarrito:', e);
    }
}

function modificarCantidadCarrito(idx, delta) {
    if (carrito[idx]) {
        carrito[idx].cantidad += delta;
        if (carrito[idx].cantidad <= 0) {
            carrito.splice(idx, 1);
        }
        actualizarCarrito();
    }
}

function eliminarDelCarrito(idx) {
    carrito.splice(idx, 1);
    actualizarCarrito();
}

function enviarWhatsApp() {
    if (carrito.length === 0) return alert("El carrito está vacío");

    const nombre = document.getElementById('cliente-nombre')?.value.trim();
    const direccion = document.getElementById('cliente-direccion')?.value.trim();
    const nota = document.getElementById('cliente-nota')?.value.trim();

    if (!nombre || !direccion) return alert("Por favor, completá Nombre y Dirección.");

    let msj = ACTIVAR_MAYORISTA ? "📦 *NUEVO PEDIDO MAYORISTA*\n\n" : "📦 *NUEVO PEDIDO*\n\n";
    msj += `👤 *Cliente:* ${nombre}\n📍 *Dirección:* ${direccion}\n`;
    if (nota) msj += `📝 *Nota:* ${nota}\n`;
    msj += "\n--------------------------------\n\n🛒 *Detalle del Pedido:*\n";

    const totalUnidades = carrito.reduce((acc, item) => acc + item.cantidad, 0);
    const aplicaMayorista = ACTIVAR_MAYORISTA && (totalUnidades >= CANTIDAD_MINIMA_MAYORISTA);
    let totalARS = 0;
    let totalUSD = 0;

    carrito.forEach(item => {
        const prod = item.producto;
        const pUSD = aplicaMayorista ? parseFloat(prod.precio_mayorista) : parseFloat(prod.precio_minorista);
        const pARS = redondearPrecioPsicologico(pUSD * cotizacionDolar);
        const subtotal = pARS * item.cantidad;
        const subtotalUSD = pUSD * item.cantidad;
        totalARS += subtotal;
        totalUSD += subtotalUSD;

        msj += `• ${item.cantidad}x ${prod.nombre}\n   $${subtotal.toLocaleString('es-AR', {minimumFractionDigits: 2})} / USD ${subtotalUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}\n`;
    });

    msj += `\n--------------------------------\n💰 *TOTAL:*\n$${totalARS.toLocaleString('es-AR', {minimumFractionDigits: 2})} ARS\nUSD ${totalUSD.toLocaleString('es-AR', {minimumFractionDigits: 2})}`;

    window.open(`https://wa.me/${MI_NUMERO_WHATSAPP}?text=${encodeURIComponent(msj)}`, '_blank');
}

// ==========================================
// 8. CERRAR MODAL BIENVENIDA
// ==========================================
function cerrarBienvenida() {
    const modal = document.getElementById('modal-bienvenida');
    if (modal) {
        modal.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => {
            modal.style.display = 'none';
        }, 300);
    }
    // Habilita el scroll en la página
    document.body.classList.remove('overflow-hidden');
}

// ===== Botón Subir al Inicio (Desktop) =====
function initScrollToTop() {
    if (document.getElementById('btn-scroll-top')) return;

    const html = `
        <button id="btn-scroll-top" class="fixed bottom-6 right-6 z-40 hidden lg:flex items-center justify-center w-12 h-12 bg-slate-900 hover:bg-slate-800 text-white rounded-full shadow-lg transition-all opacity-0 pointer-events-none" onclick="window.scrollTo({ top: 0, behavior: 'smooth' })" title="Subir al inicio">
            <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24"><path d="M7 14l5-5 5 5z"></path></svg>
        </button>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
    
    const btn = document.getElementById('btn-scroll-top');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 300) {
            btn.classList.remove('opacity-0', 'pointer-events-none');
            btn.classList.add('opacity-100');
        } else {
            btn.classList.add('opacity-0', 'pointer-events-none');
            btn.classList.remove('opacity-100');
        }
    });
}

// ===== Navegación inferior móvil =====
function initBottomNav() {
    if (document.getElementById('mnav')) return;

    const html = `
    <nav id="mnav" class="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-white/90 backdrop-blur-sm border-t border-slate-200/60">
      <div class="max-w-4xl mx-auto flex justify-between items-center px-2 py-2">
        <button id="mnav-home" class="mnav-item flex flex-col items-center text-slate-600 text-xs px-2 py-1 rounded-md active:scale-95">
          <svg class="w-5 h-5 mb-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M3 10.5L12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10.5z"/></svg>
          <span class="block text-[10px]">Inicio</span>
        </button>

        <button id="mnav-search" class="mnav-item flex flex-col items-center text-slate-600 text-xs px-2 py-1 rounded-md active:scale-95">
          <svg class="w-5 h-5 mb-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M21 20l-5.6-5.6A7 7 0 1 0 9 16a7 7 0 0 0 6.4-3.4L21 20zM11 16a5 5 0 1 1 0-10 5 5 0 0 0 6.4-3.4L21 20zM11 16a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/></svg>
          <span class="block text-[10px]">Buscar</span>
        </button>

        <button id="mnav-cats" class="mnav-item flex flex-col items-center text-slate-600 text-xs px-2 py-1 rounded-md active:scale-95">
          <svg class="w-5 h-5 mb-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M3 13h8V3H3v10zm10 8h8v-6h-8v6zM3 21h8v-6H3v6zm10-18v6h8V3h-8z"/></svg>
          <span class="block text-[10px]">Categorías</span>
        </button>

        <button id="mnav-cart" class="mnav-item relative flex flex-col items-center text-slate-600 text-xs px-2 py-1 rounded-md active:scale-95">
          <svg class="w-5 h-5 mb-0.5" viewBox="0 0 24 24" fill="currentColor"><path d="M7 18c-1.1 0-1.99.9-1.99 2S5.9 22 7 22s2-.9 2-2-.9-2-2-2zM1 2v2h2l3.6 7.59-1.35 2.45c-.16.28-.25.61-.25.96 0 1.1.9 2 2 2h12v-2H7.42c-.14 0-.25-.11-.25-.25l.03-.12.9-1.63h7.45c.75 0 1.41-.41 1.75-1.03l3.58-6.49c.08-.14.12-.31.12-.48 0-.55-.45-1-1-1H5.21l-.94-2H1zm16 16c-1.1 0-1.99.9-1.99 2s.89 2 1.99 2 2-.9 2-2-.9-2-2-2z"/></svg>
          <span id="mnav-badge" class="hidden absolute -top-1 right-3 min-w-[18px] text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 leading-none">0</span>
          <span class="block text-[10px]">Carrito</span>
        </button>
      </div>
    </nav>
    `;

    document.body.insertAdjacentHTML('beforeend', html);

    const btnHome = document.getElementById('mnav-home');
    const btnSearch = document.getElementById('mnav-search');
    const btnCats = document.getElementById('mnav-cats');
    const btnCart = document.getElementById('mnav-cart');

    function clearActive() {
        document.querySelectorAll('#mnav .mnav-item').forEach(el => {
            el.classList.remove('text-white', 'bg-slate-900');
            el.classList.add('text-slate-600');
        });
    }

    function setActive(el) {
        clearActive();
        el.classList.remove('text-slate-600');
        el.classList.add('text-white', 'bg-slate-900');
    }

    btnHome?.addEventListener('click', () => {
        setActive(btnHome);
        seleccionarCategoria('Todas');
        const inp = document.getElementById('input-busqueda');
        if (inp) { inp.value = ''; }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    btnSearch?.addEventListener('click', () => {
        setActive(btnSearch);
        const inp = document.getElementById('input-busqueda');
        if (inp) {
            inp.focus();
            inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    btnCats?.addEventListener('click', () => {
        setActive(btnCats);
        const catsEl = document.getElementById('contenedor-categorias');
        if (catsEl) {
            catsEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });

    btnCart?.addEventListener('click', () => {
        setActive(btnCart);
        const cartEl = document.getElementById('lista-carrito');
        if (cartEl) {
            cartEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    });
}

// ==========================================
// 7. LÓGICA COMPARTIR PRODUCTO & DEEP LINKING
// ==========================================

function verificarProductoEnURL() {
    const params = new URLSearchParams(window.location.search);
    const prodId = params.get('prod');
    if (prodId && productos.length > 0) {
        setTimeout(() => abrirModal(prodId), 100);
    }
}

function obtenerUrlProductoActual() {
    if (!productoModalActual) return window.location.href;
    const urlBase = window.location.origin + window.location.pathname;
    return `${urlBase}?prod=${encodeURIComponent(productoModalActual.id)}`;
}

async function compartirProducto(redSocial) {
    if (!productoModalActual) return;

    const prod = productoModalActual;
    const urlProducto = obtenerUrlProductoActual();
    
    const pMinUSD = parseFloat(prod.precio_minorista) || 0;
    const pARS = redondearPrecioPsicologico(pMinUSD * cotizacionDolar);
    const precioTexto = `$${pARS.toLocaleString('es-AR', {minimumFractionDigits: 2})} ARS (USD ${pMinUSD})`;

    const textoMensaje = `¡Mirá este producto en nuestro catálogo! 🛍️\n\n*${prod.nombre}*\n💰 Precio: ${precioTexto}\n\n👉 Ver detalle aquí:`;

    switch (redSocial) {
        case 'whatsapp': {
            const urlWA = `https://wa.me/?text=${encodeURIComponent(textoMensaje + "\n" + urlProducto)}`;
            window.open(urlWA, '_blank');
            break;
        }

        case 'facebook': {
            const urlFB = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(urlProducto)}`;
            window.open(urlFB, '_blank');
            break;
        }

        case 'instagram': {
            try {
                await navigator.clipboard.writeText(urlProducto);
                alert("📋 ¡Enlace copiado al portapapeles!\n\nPodés pegarlo en tu Historia de Instagram usando el sticker de 'Enlace' o enviarlo por mensaje privado (DM).");
            } catch (err) {
                prompt("Copia este enlace para pegarlo en Instagram:", urlProducto);
            }
            break;
        }

        case 'nativo':
        default: {
            if (navigator.share) {
                try {
                    await navigator.share({
                        title: prod.nombre,
                        text: `Mira ${prod.nombre} en el catálogo`,
                        url: urlProducto
                    });
                } catch (err) {
                    // Cancelado por el usuario
                }
            } else {
                try {
                    await navigator.clipboard.writeText(urlProducto);
                    alert("🔗 Enlace del producto copiado al portapapeles.");
                } catch (err) {
                    prompt("Copia este enlace directo al producto:", urlProducto);
                }
            }
            break;
        }
    }
}
