from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from collections import deque
import psycopg2
import psycopg2.extras
import os
import uuid
import httpx
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="SweetManager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    return psycopg2.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT")),
        dbname=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        sslmode=os.getenv("DB_SSLMODE", "require"),
        connect_timeout=int(os.getenv("DB_CONNECT_TIMEOUT", "10")),
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


TABLE_CLIENTES = "public._clientes"
TABLE_INGREDIENTES = "public._ingredientes"
TABLE_PRODUCTOS = "public._productos"
TABLE_RECETAS = "public._recetas"
TABLE_PEDIDOS = "public._pedidos"
TABLE_DETALLE_PEDIDO = "public._detalle_pedido"


@app.exception_handler(psycopg2.OperationalError)
def database_connection_error(_: Request, exc: psycopg2.OperationalError):
    return JSONResponse(
        status_code=503,
        content={
            "detail": (
                "No se pudo conectar con Supabase/PostgreSQL. "
                "Revisa DB_HOST, DB_PORT, DB_USER, DB_PASSWORD y si tu red requiere el pooler IPv4 de Supabase. "
                f"Detalle tecnico: {exc}"
            )
        },
    )

class ClienteCreate(BaseModel):
    nombre: str
    telefono: Optional[str] = None
    correo: Optional[str] = None

class IngredienteCreate(BaseModel):
    nombre: str
    unidad_medida: str
    stock_actual: float = 0
    stock_minimo: float = 0
    costo_por_unidad: float = 0

class ProductoCreate(BaseModel):
    nombre: str
    descripcion: Optional[str] = None
    precio_venta: float

class ProductoImagenUpdate(BaseModel):
    image_url: str

class RecetaItem(BaseModel):
    ingrediente_id: int
    cantidad: float

class DetallePedido(BaseModel):
    producto_id: int
    cantidad: int

class PedidoCreate(BaseModel):
    cliente_id: int
    detalles: List[DetallePedido]


def _serializar_pedido_row(p: Dict[str, Any]) -> Dict[str, Any]:
    if p.get("fecha"):
        p = {**p, "fecha": str(p["fecha"])}
    return p


def construir_cola_produccion(cursor) -> deque:
    """
    Cola FIFO de pedidos pendientes: primero en entrar, primero en preparar.
    Estructura: collections.deque — O(1) en extremos para encolar/desencolar.
    Orden: fecha ascendente, luego id (empate mismo día).
    """
    cursor.execute(
        """
        SELECT p.id, p.cliente_id, p.fecha, p.estado, p.total, c.nombre AS cliente_nombre
        FROM public._pedidos p
        JOIN public._clientes c ON c.id = p.cliente_id
        WHERE p.estado = 'Pendiente'
        ORDER BY p.fecha ASC, p.id ASC
        """
    )
    filas = cursor.fetchall() or []
    return deque(_serializar_pedido_row(dict(row)) for row in filas)


@app.get("/")
@app.get("/api/health")
def root():
    return {"mensaje": "SweetManager API funcionando!"}

@app.post("/clientes", tags=["Clientes"])
def crear_cliente(data: ClienteCreate):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO public._clientes (nombre, telefono, correo) VALUES (%s, %s, %s) RETURNING id",
        (data.nombre, data.telefono, data.correo)
    )
    nuevo_id = cursor.fetchone()["id"]
    db.commit()
    cursor.close(); db.close()
    return {"id": nuevo_id, "nombre": data.nombre, "telefono": data.telefono, "correo": data.correo}

@app.get("/clientes", tags=["Clientes"])
def listar_clientes():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM public._clientes ORDER BY nombre")
    clientes = cursor.fetchall()
    cursor.close(); db.close()
    return clientes

@app.get("/clientes/{cliente_id}", tags=["Clientes"])
def obtener_cliente(cliente_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM public._clientes WHERE id = %s", (cliente_id,))
    cliente = cursor.fetchone()
    cursor.close(); db.close()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return cliente

@app.put("/clientes/{cliente_id}", tags=["Clientes"])
def actualizar_cliente(cliente_id: int, data: ClienteCreate):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE public._clientes SET nombre=%s, telefono=%s, correo=%s WHERE id=%s",
        (data.nombre, data.telefono, data.correo, cliente_id)
    )
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return {"mensaje": "Cliente actualizado correctamente"}

@app.delete("/clientes/{cliente_id}", tags=["Clientes"])
def eliminar_cliente(cliente_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("DELETE FROM public._clientes WHERE id = %s", (cliente_id,))
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return {"mensaje": "Cliente eliminado correctamente"}

@app.post("/ingredientes", tags=["Ingredientes"])
def crear_ingrediente(data: IngredienteCreate):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO public._ingredientes (nombre, unidad_medida, stock_actual, stock_minimo, costo_por_unidad) VALUES (%s,%s,%s,%s,%s) RETURNING id",
        (data.nombre, data.unidad_medida, data.stock_actual, data.stock_minimo, data.costo_por_unidad)
    )
    nuevo_id = cursor.fetchone()["id"]
    db.commit()
    cursor.close(); db.close()
    return {"id": nuevo_id, **data.dict()}

@app.get("/ingredientes", tags=["Ingredientes"])
def listar_ingredientes():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM public._ingredientes ORDER BY nombre")
    ingredientes = cursor.fetchall()
    cursor.close(); db.close()
    return ingredientes

@app.get("/ingredientes/alertas", tags=["Ingredientes"])
def alertas_stock():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM public._ingredientes WHERE stock_actual <= stock_minimo")
    alertas = cursor.fetchall()
    cursor.close(); db.close()
    return alertas

@app.put("/ingredientes/{ingrediente_id}", tags=["Ingredientes"])
def actualizar_ingrediente(ingrediente_id: int, data: IngredienteCreate):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE public._ingredientes SET nombre=%s, unidad_medida=%s, stock_actual=%s, stock_minimo=%s, costo_por_unidad=%s WHERE id=%s",
        (data.nombre, data.unidad_medida, data.stock_actual, data.stock_minimo, data.costo_por_unidad, ingrediente_id)
    )
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")
    return {"mensaje": "Ingrediente actualizado correctamente"}

@app.put("/ingredientes/{ingrediente_id}/stock", tags=["Ingredientes"])
def actualizar_stock(ingrediente_id: int, cantidad: float):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE public._ingredientes SET stock_actual = stock_actual + %s WHERE id = %s",
        (cantidad, ingrediente_id)
    )
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")
    return {"mensaje": "Stock actualizado correctamente"}

@app.delete("/ingredientes/{ingrediente_id}", tags=["Ingredientes"])
def eliminar_ingrediente(ingrediente_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("DELETE FROM public._recetas WHERE ingrediente_id = %s", (ingrediente_id,))
    cursor.execute("DELETE FROM public._ingredientes WHERE id = %s", (ingrediente_id,))
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")
    return {"mensaje": "Ingrediente eliminado correctamente"}

@app.post("/productos", tags=["Productos"])
def crear_producto(data: ProductoCreate):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO public._productos (nombre, descripcion, precio_venta) VALUES (%s,%s,%s) RETURNING id",
        (data.nombre, data.descripcion, data.precio_venta)
    )
    nuevo_id = cursor.fetchone()["id"]
    db.commit()
    cursor.close(); db.close()
    return {"id": nuevo_id, **data.dict()}

@app.get("/productos", tags=["Productos"])
def listar_productos():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM public._productos ORDER BY nombre")
    productos = cursor.fetchall()
    cursor.close(); db.close()
    return productos

@app.put("/productos/{producto_id}", tags=["Productos"])
def actualizar_producto(producto_id: int, data: ProductoCreate):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE public._productos SET nombre=%s, descripcion=%s, precio_venta=%s WHERE id=%s",
        (data.nombre, data.descripcion, data.precio_venta, producto_id)
    )
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return {"mensaje": "Producto actualizado correctamente"}

@app.put("/productos/{producto_id}/imagen-url", tags=["Productos"])
def actualizar_imagen_producto(producto_id: int, data: ProductoImagenUpdate):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE public._productos SET image_url = %s WHERE id = %s",
        (data.image_url, producto_id)
    )
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return {"image_url": data.image_url}

@app.delete("/productos/{producto_id}", tags=["Productos"])
def eliminar_producto(producto_id: int):
    db = get_db()
    cursor = db.cursor()
    # Eliminar recetas asociadas primero
    cursor.execute("DELETE FROM public._recetas WHERE producto_id = %s", (producto_id,))
    cursor.execute("DELETE FROM public._productos WHERE id = %s", (producto_id,))
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return {"mensaje": "Producto eliminado correctamente"}

@app.get("/productos/{producto_id}/receta", tags=["Productos"])
def obtener_receta(producto_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        SELECT r.ingrediente_id, r.cantidad, i.nombre AS ingrediente_nombre, i.unidad_medida
        FROM public._recetas r
        JOIN public._ingredientes i ON i.id = r.ingrediente_id
        WHERE r.producto_id = %s
    """, (producto_id,))
    receta = cursor.fetchall()
    cursor.close(); db.close()
    return receta

@app.delete("/productos/{producto_id}/receta/{ingrediente_id}", tags=["Productos"])
def eliminar_receta_item(producto_id: int, ingrediente_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "DELETE FROM public._recetas WHERE producto_id = %s AND ingrediente_id = %s",
        (producto_id, ingrediente_id)
    )
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado en la receta")
    return {"mensaje": "Ingrediente eliminado de la receta"}

@app.get("/productos/{producto_id}/costo", tags=["Productos"])
def calcular_costo(producto_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        SELECT p.nombre, p.precio_venta,
               ROUND((SUM(r.cantidad * i.costo_por_unidad))::numeric, 2) AS costo_produccion
        FROM public._productos p
        JOIN public._recetas r ON r.producto_id = p.id
        JOIN public._ingredientes i ON i.id = r.ingrediente_id
        WHERE p.id = %s
        GROUP BY p.id, p.nombre, p.precio_venta
    """, (producto_id,))
    resultado = cursor.fetchone()
    cursor.close(); db.close()
    if not resultado:
        raise HTTPException(status_code=404, detail="Producto no encontrado o sin receta")
    resultado["margen_ganancia"] = round(float(resultado["precio_venta"]) - float(resultado["costo_produccion"]), 2)
    return resultado

@app.post("/productos/{producto_id}/receta", tags=["Productos"])
def agregar_receta(producto_id: int, items: List[RecetaItem]):
    db = get_db()
    cursor = db.cursor()
    for item in items:
        cursor.execute(
            "INSERT INTO public._recetas (producto_id, ingrediente_id, cantidad) VALUES (%s,%s,%s)",
            (producto_id, item.ingrediente_id, item.cantidad)
        )
    db.commit()
    cursor.close(); db.close()
    return {"mensaje": "Receta guardada correctamente"}

@app.post("/pedidos", tags=["Pedidos"])
def crear_pedido(data: PedidoCreate):
    db = get_db()
    cursor = db.cursor()
    total = 0.0
    detalles = []
    for item in data.detalles:
        cursor.execute("SELECT precio_venta FROM public._productos WHERE id = %s", (item.producto_id,))
        prod = cursor.fetchone()
        if not prod:
            raise HTTPException(status_code=404, detail=f"Producto {item.producto_id} no encontrado")
        subtotal = float(prod["precio_venta"]) * item.cantidad
        total += subtotal
        detalles.append((item.producto_id, item.cantidad, subtotal))
    cursor.execute(
        "INSERT INTO public._pedidos (cliente_id, fecha, estado, total) VALUES (%s, CURRENT_DATE, 'Pendiente', %s) RETURNING id",
        (data.cliente_id, round(total, 2))
    )
    pedido_id = cursor.fetchone()["id"]
    db.commit()
    for prod_id, cant, sub in detalles:
        cursor.execute(
            "INSERT INTO public._detalle_pedido (pedido_id, producto_id, cantidad, subtotal) VALUES (%s,%s,%s,%s)",
            (pedido_id, prod_id, cant, sub)
        )
    db.commit()
    cursor.close(); db.close()
    return {"id": pedido_id, "cliente_id": data.cliente_id, "total": round(total, 2), "estado": "Pendiente"}

@app.get("/pedidos/cola/produccion", tags=["Pedidos"])
def cola_produccion():
    """
    Vista de cola para cocina: pedidos Pendientes en orden FIFO (deque).
    Incluye el siguiente a preparar (frente de cola) y la posición de cada ítem.
    """
    db = get_db()
    cursor = db.cursor()
    cola = construir_cola_produccion(cursor)
    cursor.close()
    db.close()
    lista = list(cola)
    for i, item in enumerate(lista):
        item["posicion"] = i + 1
    siguiente = lista[0] if lista else None
    return {
        "estructura": "collections.deque (FIFO)",
        "tamano": len(lista),
        "siguiente": siguiente,
        "cola": lista,
    }


@app.get("/pedidos/{pedido_id}/posicion-cola", tags=["Pedidos"])
def posicion_en_cola(pedido_id: int):
    """Posición 1-based en la cola de pendientes, o null si no aplica."""
    db = get_db()
    cursor = db.cursor()
    cola = construir_cola_produccion(cursor)
    cursor.close()
    db.close()
    ids = [p["id"] for p in cola]
    try:
        pos = ids.index(pedido_id) + 1
    except ValueError:
        return {"pedido_id": pedido_id, "en_cola": False, "posicion": None}
    return {"pedido_id": pedido_id, "en_cola": True, "posicion": pos, "total_en_cola": len(ids)}


@app.get("/pedidos/{pedido_id}/detalle", tags=["Pedidos"])
def detalle_pedido(pedido_id: int):
    """Cabecera del pedido + líneas (producto, cantidad, subtotal)."""
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        """
        SELECT p.id, p.cliente_id, p.fecha, p.estado, p.total, c.nombre AS cliente_nombre
        FROM public._pedidos p
        JOIN public._clientes c ON c.id = p.cliente_id
        WHERE p.id = %s
        """,
        (pedido_id,),
    )
    pedido = cursor.fetchone()
    if not pedido:
        cursor.close()
        db.close()
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    cursor.execute(
        """
        SELECT dp.producto_id, pr.nombre AS producto_nombre, dp.cantidad, dp.subtotal
        FROM public._detalle_pedido dp
        JOIN public._productos pr ON pr.id = dp.producto_id
        WHERE dp.pedido_id = %s
        ORDER BY dp.producto_id ASC
        """,
        (pedido_id,),
    )
    lineas = cursor.fetchall()
    cursor.close()
    db.close()
    if pedido.get("fecha"):
        pedido["fecha"] = str(pedido["fecha"])
    out_lineas = []
    for row in lineas:
        r = dict(row)
        cant = float(r["cantidad"])
        sub = float(r["subtotal"])
        r["precio_unitario"] = round(sub / cant, 2) if cant else 0.0
        out_lineas.append(r)
    return {"pedido": pedido, "lineas": out_lineas}


@app.get("/pedidos", tags=["Pedidos"])
def listar_pedidos():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        SELECT p.*, c.nombre AS cliente_nombre
        FROM public._pedidos p
        JOIN public._clientes c ON c.id = p.cliente_id
        ORDER BY p.fecha DESC
    """)
    pedidos = cursor.fetchall()
    cursor.close(); db.close()
    for p in pedidos:
        if p.get("fecha"):
            p["fecha"] = str(p["fecha"])
    return pedidos

@app.get("/pedidos/cliente/{cliente_id}", tags=["Pedidos"])
def historial_cliente(cliente_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM public._pedidos WHERE cliente_id = %s ORDER BY fecha DESC", (cliente_id,))
    pedidos = cursor.fetchall()
    cursor.close(); db.close()
    for p in pedidos:
        if p.get("fecha"):
            p["fecha"] = str(p["fecha"])
    return pedidos

@app.put("/pedidos/{pedido_id}/estado", tags=["Pedidos"])
def cambiar_estado(pedido_id: int, estado: str):
    estados_validos = ["Pendiente", "En proceso", "Entregado"]
    if estado not in estados_validos:
        raise HTTPException(status_code=400, detail=f"Estado invalido. Usa: {estados_validos}")
    db = get_db()
    cursor = db.cursor()
    if estado == "Entregado":
        cursor.execute(
            """
            SELECT r.ingrediente_id, i.nombre AS ingrediente_nombre, i.stock_actual,
                   SUM(r.cantidad * dp.cantidad) AS total_usado
            FROM public._detalle_pedido dp
            JOIN public._recetas r ON r.producto_id = dp.producto_id
            JOIN public._ingredientes i ON i.id = r.ingrediente_id
            WHERE dp.pedido_id = %s
            GROUP BY r.ingrediente_id, i.nombre, i.stock_actual
            """,
            (pedido_id,),
        )
        consumos = cursor.fetchall()
        faltantes = []
        for c in consumos:
            necesario = float(c["total_usado"])
            disponible = float(c["stock_actual"])
            if disponible + 1e-9 < necesario:
                nom = c.get("ingrediente_nombre") or f"ID {c['ingrediente_id']}"
                faltantes.append(f"{nom}: hay {disponible}, se necesitan {necesario}")
        if faltantes:
            cursor.close()
            db.close()
            raise HTTPException(
                status_code=400,
                detail="No hay suficiente insumo para marcar este pedido como entregado. "
                + " | ".join(faltantes),
            )
        for c in consumos:
            cursor.execute(
                "UPDATE public._ingredientes SET stock_actual = stock_actual - %s WHERE id = %s",
                (c["total_usado"], c["ingrediente_id"]),
            )
    cursor.execute("UPDATE public._pedidos SET estado = %s WHERE id = %s", (estado, pedido_id))
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return {"mensaje": f"Estado actualizado a {estado}"}

@app.post("/productos/{producto_id}/imagen", tags=["Productos"])
async def subir_imagen_producto(producto_id: int, file: UploadFile = File(...)):
    SUPABASE_URL = os.getenv("SUPABASE_URL")
    SUPABASE_KEY = os.getenv("SUPABASE_KEY")
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(status_code=500, detail="Supabase no configurado en variables de entorno")

    ext = (file.filename or "img").rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png", "webp", "gif"):
        raise HTTPException(status_code=400, detail="Formato no permitido. Usa JPG, PNG, WEBP o GIF.")

    file_name = f"{producto_id}_{uuid.uuid4().hex}.{ext}"
    content = await file.read()

    upload_url = f"{SUPABASE_URL}/storage/v1/object/product-images/{file_name}"
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": file.content_type or "application/octet-stream",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(upload_url, content=content, headers=headers)
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Error al subir imagen a Supabase: {resp.text}")

    public_url = f"{SUPABASE_URL}/storage/v1/object/public/product-images/{file_name}"

    db = get_db()
    cursor = db.cursor()
    cursor.execute("UPDATE public._productos SET image_url = %s WHERE id = %s", (public_url, producto_id))
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return {"image_url": public_url}


app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/app")
def frontend():
    return FileResponse("static/index.html")
