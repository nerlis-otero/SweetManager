from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import pymysql
import pymysql.cursors
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="SweetManager API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    return pymysql.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT")),
        database=os.getenv("DB_NAME"),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        cursorclass=pymysql.cursors.DictCursor
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

class RecetaItem(BaseModel):
    ingrediente_id: int
    cantidad: float

class DetallePedido(BaseModel):
    producto_id: int
    cantidad: int

class PedidoCreate(BaseModel):
    cliente_id: int
    detalles: List[DetallePedido]

@app.get("/")
def root():
    return {"mensaje": "SweetManager API funcionando!"}

@app.post("/clientes", tags=["Clientes"])
def crear_cliente(data: ClienteCreate):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO clientes (nombre, telefono, correo) VALUES (%s, %s, %s)",
        (data.nombre, data.telefono, data.correo)
    )
    db.commit()
    nuevo_id = cursor.lastrowid
    cursor.close(); db.close()
    return {"id": nuevo_id, "nombre": data.nombre, "telefono": data.telefono, "correo": data.correo}

@app.get("/clientes", tags=["Clientes"])
def listar_clientes():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM clientes ORDER BY nombre")
    clientes = cursor.fetchall()
    cursor.close(); db.close()
    return clientes

@app.get("/clientes/{cliente_id}", tags=["Clientes"])
def obtener_cliente(cliente_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM clientes WHERE id = %s", (cliente_id,))
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
        "UPDATE clientes SET nombre=%s, telefono=%s, correo=%s WHERE id=%s",
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
    cursor.execute("DELETE FROM clientes WHERE id = %s", (cliente_id,))
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
        "INSERT INTO ingredientes (nombre, unidad_medida, stock_actual, stock_minimo, costo_por_unidad) VALUES (%s,%s,%s,%s,%s)",
        (data.nombre, data.unidad_medida, data.stock_actual, data.stock_minimo, data.costo_por_unidad)
    )
    db.commit()
    nuevo_id = cursor.lastrowid
    cursor.close(); db.close()
    return {"id": nuevo_id, **data.dict()}

@app.get("/ingredientes", tags=["Ingredientes"])
def listar_ingredientes():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM ingredientes ORDER BY nombre")
    ingredientes = cursor.fetchall()
    cursor.close(); db.close()
    return ingredientes

@app.get("/ingredientes/alertas", tags=["Ingredientes"])
def alertas_stock():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM ingredientes WHERE stock_actual <= stock_minimo")
    alertas = cursor.fetchall()
    cursor.close(); db.close()
    return alertas

@app.put("/ingredientes/{ingrediente_id}/stock", tags=["Ingredientes"])
def actualizar_stock(ingrediente_id: int, cantidad: float):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "UPDATE ingredientes SET stock_actual = stock_actual + %s WHERE id = %s",
        (cantidad, ingrediente_id)
    )
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Ingrediente no encontrado")
    return {"mensaje": "Stock actualizado correctamente"}

@app.post("/productos", tags=["Productos"])
def crear_producto(data: ProductoCreate):
    db = get_db()
    cursor = db.cursor()
    cursor.execute(
        "INSERT INTO productos (nombre, descripcion, precio_venta) VALUES (%s,%s,%s)",
        (data.nombre, data.descripcion, data.precio_venta)
    )
    db.commit()
    nuevo_id = cursor.lastrowid
    cursor.close(); db.close()
    return {"id": nuevo_id, **data.dict()}

@app.get("/productos", tags=["Productos"])
def listar_productos():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("SELECT * FROM productos ORDER BY nombre")
    productos = cursor.fetchall()
    cursor.close(); db.close()
    return productos

@app.get("/productos/{producto_id}/costo", tags=["Productos"])
def calcular_costo(producto_id: int):
    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        SELECT p.nombre, p.precio_venta,
               ROUND(SUM(r.cantidad * i.costo_por_unidad), 2) AS costo_produccion
        FROM productos p
        JOIN recetas r ON r.producto_id = p.id
        JOIN ingredientes i ON i.id = r.ingrediente_id
        WHERE p.id = %s
        GROUP BY p.id
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
            "INSERT INTO recetas (producto_id, ingrediente_id, cantidad) VALUES (%s,%s,%s)",
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
        cursor.execute("SELECT precio_venta FROM productos WHERE id = %s", (item.producto_id,))
        prod = cursor.fetchone()
        if not prod:
            raise HTTPException(status_code=404, detail=f"Producto {item.producto_id} no encontrado")
        subtotal = float(prod["precio_venta"]) * item.cantidad
        total += subtotal
        detalles.append((item.producto_id, item.cantidad, subtotal))
    cursor.execute(
        "INSERT INTO pedidos (cliente_id, fecha, estado, total) VALUES (%s, CURDATE(), 'Pendiente', %s)",
        (data.cliente_id, round(total, 2))
    )
    db.commit()
    pedido_id = cursor.lastrowid
    for prod_id, cant, sub in detalles:
        cursor.execute(
            "INSERT INTO detalle_pedido (pedido_id, producto_id, cantidad, subtotal) VALUES (%s,%s,%s,%s)",
            (pedido_id, prod_id, cant, sub)
        )
    db.commit()
    cursor.close(); db.close()
    return {"id": pedido_id, "cliente_id": data.cliente_id, "total": round(total, 2), "estado": "Pendiente"}

@app.get("/pedidos", tags=["Pedidos"])
def listar_pedidos():
    db = get_db()
    cursor = db.cursor()
    cursor.execute("""
        SELECT p.*, c.nombre AS cliente_nombre
        FROM pedidos p
        JOIN clientes c ON c.id = p.cliente_id
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
    cursor.execute("SELECT * FROM pedidos WHERE cliente_id = %s ORDER BY fecha DESC", (cliente_id,))
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
        cursor.execute("""
            SELECT r.ingrediente_id, SUM(r.cantidad * dp.cantidad) AS total_usado
            FROM detalle_pedido dp
            JOIN recetas r ON r.producto_id = dp.producto_id
            WHERE dp.pedido_id = %s
            GROUP BY r.ingrediente_id
        """, (pedido_id,))
        consumos = cursor.fetchall()
        for c in consumos:
            cursor.execute(
                "UPDATE ingredientes SET stock_actual = stock_actual - %s WHERE id = %s",
                (c["total_usado"], c["ingrediente_id"])
            )
    cursor.execute("UPDATE pedidos SET estado = %s WHERE id = %s", (estado, pedido_id))
    db.commit()
    rows = cursor.rowcount
    cursor.close(); db.close()
    if rows == 0:
        raise HTTPException(status_code=404, detail="Pedido no encontrado")
    return {"mensaje": f"Estado actualizado a {estado}"}
