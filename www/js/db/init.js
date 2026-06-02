/**
 * init.js - Inicialización de base de datos SQLite para app contable TCP Cuba
 * 
 * Propósito: Crear esquema de BD, índices y seed inicial del nomenclador contable
 * según Resolución 346/2021. Maneja versionado y migraciones futuras.
 * 
 * @module db/init
 */

import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';
import { Capacitor } from '@capacitor/core';

const DB_NAME = 'contable_tcp_db';
const DB_VERSION = 1;

let sqliteConnection;
let db;

/**
 * Inicializa la conexión con SQLite y crea la base de datos
 * @returns {Promise<Object>} Instancia de la base de datos
 */
export async function initDatabase() {
    try {
        sqliteConnection = new SQLiteConnection(CapacitorSQLite);
        
        // Crear/abrir base de datos
        db = await sqliteConnection.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
        
        await db.open();
        
        console.log('BD abierta exitosamente:', DB_NAME);
        
        // Ejecutar creación de tablas en transacción
        await createTables();
        
        // Ejecutar seed inicial
        await seedNomenclador();
        
        return db;
    } catch (error) {
        console.error('Error al inicializar BD:', error);
        throw new Error(`Fallo inicialización BD: ${error.message}`);
    }
}

/**
 * Crea todas las tablas del esquema contable con constraints e índices
 * Usa transacción explícita para garantizar atomicidad
 */
async function createTables() {
    const createTableStatements = `
        -- Tabla 1: Configuración general del proyecto
        CREATE TABLE IF NOT EXISTS configuracion (
            id INTEGER PRIMARY KEY,
            nombre_proyecto TEXT NOT NULL,
            nit TEXT UNIQUE NOT NULL,
            regimen TEXT CHECK(regimen IN ('general','simplificado')) NOT NULL,
            base_ss INTEGER DEFAULT 0,
            tasa_bcc REAL DEFAULT 0,
            pin_hash TEXT,
            moneda_base TEXT DEFAULT 'CUP',
            creado_en DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        -- Tabla 2: Plan de cuentas (nomenclador)
        CREATE TABLE IF NOT EXISTS cuentas (
            codigo TEXT PRIMARY KEY,
            nombre TEXT NOT NULL,
            tipo TEXT CHECK(tipo IN ('activo','pasivo','patrimonio','nominal_deudor','nominal_acreedor')) NOT NULL,
            subcuenta TEXT,
            analisis TEXT
        );

        -- Tabla 3: Comprobantes de diario
        CREATE TABLE IF NOT EXISTS comprobantes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha DATE NOT NULL,
            numero INTEGER NOT NULL,
            descripcion TEXT,
            tipo TEXT CHECK(tipo IN ('ingreso','gasto','ajuste','cierre')) NOT NULL,
            estado TEXT DEFAULT 'activo'
        );

        -- Tabla 4: Asientos contables (partidas dobles)
        CREATE TABLE IF NOT EXISTS asientos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            comprobante_id INTEGER NOT NULL,
            cuenta_codigo TEXT NOT NULL,
            debe REAL DEFAULT 0,
            haber REAL DEFAULT 0,
            moneda TEXT CHECK(moneda IN ('CUP','MLE')) DEFAULT 'CUP',
            tasa_bcc_usada REAL DEFAULT 1,
            FOREIGN KEY(comprobante_id) REFERENCES comprobantes(id) ON DELETE CASCADE,
            FOREIGN KEY(cuenta_codigo) REFERENCES cuentas(codigo) ON DELETE RESTRICT
        );

        -- Tabla 5: Activos fijos
        CREATE TABLE IF NOT EXISTS activos_fijos (
            id INTEGER PRIMARY KEY,
            descripcion TEXT NOT NULL,
            fecha_adquisicion DATE NOT NULL,
            valor_inicial REAL NOT NULL,
            vida_util_anos REAL NOT NULL,
            metodo TEXT DEFAULT 'lineal',
            tasa_anual REAL DEFAULT 0.10,
            depreciacion_acumulada REAL DEFAULT 0,
            valor_neto REAL
        );

        -- Tabla 6: Trabajadores contratados
        CREATE TABLE IF NOT EXISTS trabajadores_contratados (
            ci TEXT PRIMARY KEY,
            nombres TEXT NOT NULL,
            apellidos TEXT NOT NULL,
            fecha_contrato DATE NOT NULL,
            salario_mensual REAL NOT NULL,
            retenciones_mes REAL DEFAULT 0
        );

        -- Tabla 7: Tasas de cambio BCC
        CREATE TABLE IF NOT EXISTS tasas_cambio (
            fecha TEXT PRIMARY KEY,
            moneda TEXT NOT NULL,
            tasa_compra_bcc REAL NOT NULL,
            tasa_venta_bcc REAL NOT NULL,
            fuente TEXT
        );

        -- Tabla 8: Reservas de utilidades
        CREATE TABLE IF NOT EXISTS reservas_utilidades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            periodo TEXT NOT NULL,
            reserva_perdidas_pct REAL DEFAULT 0,
            anticipos_socio REAL DEFAULT 0,
            utilidades_distribuidas REAL DEFAULT 0,
            utilidad_retenida REAL DEFAULT 0
        );

        -- Tabla 9: Registro de control de ingresos y gastos
        CREATE TABLE IF NOT EXISTS registro_control_ingresos_gastos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fecha DATE NOT NULL,
            concepto TEXT NOT NULL,
            monto REAL NOT NULL,
            tipo TEXT CHECK(tipo IN ('ingreso','gasto')) NOT NULL,
            soporte_doc TEXT
        );

        -- Índices para optimización de consultas
        CREATE INDEX IF NOT EXISTS idx_asientos_comprobante ON asientos(comprobante_id);
        CREATE INDEX IF NOT EXISTS idx_asientos_cuenta ON asientos(cuenta_codigo);
        CREATE INDEX IF NOT EXISTS idx_comprobantes_fecha ON comprobantes(fecha);
        CREATE INDEX IF NOT EXISTS idx_tasas_cambio_fecha ON tasas_cambio(fecha);
    `;

    try {
        await db.execute(createTableStatements);
        console.log('Tablas e índices creados exitosamente');
    } catch (error) {
        console.error('Error al crear tablas:', error);
        throw error;
    }
}

/**
 * Inserta el nomenclador contable obligatorio según Res. 346/2021
 * Cuentas principales: 100, 110, 470, 520, 600, 610, 620, 800, 810, 820, 900, 999
 */
async function seedNomenclador() {
    const nomenclador = [
        // Cuenta 100: Efectivo en Caja
        { codigo: '100', nombre: 'Efectivo en Caja', tipo: 'activo', subcuenta: null, analisis: null },
        { codigo: '100.10', nombre: 'Caja Principal', tipo: 'activo', subcuenta: '10', analisis: null },
        { codigo: '100.20', nombre: 'Caja Chica', tipo: 'activo', subcuenta: '20', analisis: null },
        { codigo: '100.30', nombre: 'Caja en MLE', tipo: 'activo', subcuenta: '30', analisis: null },
        { codigo: '100.40', nombre: 'Valores en Caja', tipo: 'activo', subcuenta: '40', analisis: null },
        { codigo: '100.50', nombre: 'Otros Efectivos', tipo: 'activo', subcuenta: '50', analisis: null },

        // Cuenta 110: Depósitos Bancarios
        { codigo: '110', nombre: 'Depósitos Bancarios', tipo: 'activo', subcuenta: null, analisis: null },
        { codigo: '110.10', nombre: 'Banco Popular de Ahorro', tipo: 'activo', subcuenta: '10', analisis: null },
        { codigo: '110.20', nombre: 'Banco Metropolitano', tipo: 'activo', subcuenta: '20', analisis: null },
        { codigo: '110.30', nombre: 'Banco de Crédito y Comercio', tipo: 'activo', subcuenta: '30', analisis: null },
        { codigo: '110.40', nombre: 'Cuenta en MLE', tipo: 'activo', subcuenta: '40', analisis: null },
        { codigo: '110.50', nombre: 'Otros Bancos', tipo: 'activo', subcuenta: '50', analisis: null },

        // Cuenta 470: Proveedores
        { codigo: '470', nombre: 'Proveedores', tipo: 'pasivo', subcuenta: null, analisis: null },
        { codigo: '470.10', nombre: 'Proveedores Nacionales', tipo: 'pasivo', subcuenta: '10', analisis: null },
        { codigo: '470.20', nombre: 'Proveedores Extranjeros', tipo: 'pasivo', subcuenta: '20', analisis: null },
        { codigo: '470.30', nombre: 'Anticipos a Proveedores', tipo: 'pasivo', subcuenta: '30', analisis: null },
        { codigo: '470.40', nombre: 'Retenciones por Pagar', tipo: 'pasivo', subcuenta: '40', analisis: null },
        { codigo: '470.50', nombre: 'Otros Proveedores', tipo: 'pasivo', subcuenta: '50', analisis: null },

        // Cuenta 520: Obligaciones con el Presupuesto del Estado
        { codigo: '520', nombre: 'Obligaciones con el Presupuesto del Estado', tipo: 'pasivo', subcuenta: null, analisis: null },
        { codigo: '520.10', nombre: 'Impuesto sobre Utilidades', tipo: 'pasivo', subcuenta: '10', analisis: null },
        { codigo: '520.20', nombre: 'Contribución a la Seguridad Social', tipo: 'pasivo', subcuenta: '20', analisis: null },
        { codigo: '520.30', nombre: 'Impuesto sobre Ventas y Servicios', tipo: 'pasivo', subcuenta: '30', analisis: null },
        { codigo: '520.40', nombre: 'Impuesto Especial', tipo: 'pasivo', subcuenta: '40', analisis: null },
        { codigo: '520.50', nombre: 'Otras Obligaciones', tipo: 'pasivo', subcuenta: '50', analisis: null },

        // Cuenta 600: Gastos por Elementos
        { codigo: '600', nombre: 'Gastos por Elementos', tipo: 'nominal_deudor', subcuenta: null, analisis: null },
        { codigo: '600.10', nombre: 'Gastos de Personal', tipo: 'nominal_deudor', subcuenta: '10', analisis: null },
        { codigo: '600.20', nombre: 'Gastos de Materiales', tipo: 'nominal_deudor', subcuenta: '20', analisis: null },
        { codigo: '600.30', nombre: 'Gastos de Servicios', tipo: 'nominal_deudor', subcuenta: '30', analisis: null },
        { codigo: '600.40', nombre: 'Gastos de Depreciación', tipo: 'nominal_deudor', subcuenta: '40', analisis: null },
        { codigo: '600.50', nombre: 'Otros Gastos', tipo: 'nominal_deudor', subcuenta: '50', analisis: null },

        // Cuenta 610: Gastos de Administración
        { codigo: '610', nombre: 'Gastos de Administración', tipo: 'nominal_deudor', subcuenta: null, analisis: null },

        // Cuenta 620: Gastos de Comercialización
        { codigo: '620', nombre: 'Gastos de Comercialización', tipo: 'nominal_deudor', subcuenta: null, analisis: null },

        // Cuenta 800: Ingresos
        { codigo: '800', nombre: 'Ingresos por Actividades', tipo: 'nominal_acreedor', subcuenta: null, analisis: null },
        { codigo: '800.11000', nombre: 'Venta de Productos', tipo: 'nominal_acreedor', subcuenta: null, analisis: '11000' },
        { codigo: '800.30000', nombre: 'Prestación de Servicios Técnicos', tipo: 'nominal_acreedor', subcuenta: null, analisis: '30000' },
        { codigo: '800.40000', nombre: 'Arrendamiento de Locales', tipo: 'nominal_acreedor', subcuenta: null, analisis: '40000' },
        { codigo: '800.50000', nombre: 'Elaboración y Venta de Comida', tipo: 'nominal_acreedor', subcuenta: null, analisis: '50000' },
        { codigo: '800.70000', nombre: 'Servicios Culturales y Recreativos', tipo: 'nominal_acreedor', subcuenta: null, analisis: '70000' },
        { codigo: '800.80000', nombre: 'Otros Ingresos', tipo: 'nominal_acreedor', subcuenta: null, analisis: '80000' },

        // Cuenta 810: Otros Ingresos
        { codigo: '810', nombre: 'Otros Ingresos', tipo: 'nominal_acreedor', subcuenta: null, analisis: null },
        { codigo: '810.10', nombre: 'Intereses Bancarios', tipo: 'nominal_acreedor', subcuenta: '10', analisis: null },
        { codigo: '810.20', nombre: 'Diferencias de Cambio', tipo: 'nominal_acreedor', subcuenta: '20', analisis: null },
        { codigo: '810.30', nombre: 'Subvenciones', tipo: 'nominal_acreedor', subcuenta: '30', analisis: null },
        { codigo: '810.40', nombre: 'Ingresos Diversos', tipo: 'nominal_acreedor', subcuenta: '40', analisis: null },

        // Cuenta 820: Gastos Financieros
        { codigo: '820', nombre: 'Gastos Financieros', tipo: 'nominal_deudor', subcuenta: null, analisis: null },

        // Cuenta 900: Resultado del Ejercicio
        { codigo: '900', nombre: 'Resultado del Ejercicio', tipo: 'patrimonio', subcuenta: null, analisis: null },

        // Cuenta 999: Cuenta Transitoria
        { codigo: '999', nombre: 'Cuenta Transitoria', tipo: 'patrimonio', subcuenta: null, analisis: null }
    ];

    try {
        const insertStatement = `INSERT OR IGNORE INTO cuentas (codigo, nombre, tipo, subcuenta, analisis) VALUES (?, ?, ?, ?, ?);`;
        
        for (const cuenta of nomenclador) {
            await db.run(insertStatement, [
                cuenta.codigo,
                cuenta.nombre,
                cuenta.tipo,
                cuenta.subcuenta,
                cuenta.analisis
            ]);
        }
        
        console.log(`Seed completado: ${nomenclador.length} cuentas insertadas`);
    } catch (error) {
        console.error('Error al insertar nomenclador:', error);
        throw error;
    }
}

/**
 * Obtiene la instancia de la base de datos
 * @returns {Object} Instancia de db
 */
export function getDatabase() {
    if (!db) {
        throw new Error('BD no inicializada. Llame a initDatabase() primero.');
    }
    return db;
}

/**
 * Cierra la conexión con la base de datos
 */
export async function closeDatabase() {
    if (db) {
        await db.close();
        console.log('BD cerrada exitosamente');
    }
}

export default {
    initDatabase,
    getDatabase,
    closeDatabase
};
