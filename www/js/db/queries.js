/**
 * queries.js - Operaciones CRUD para la base de datos contable TCP Cuba
 * 
 * Propósito: Proveer funciones de consulta y manipulación de datos con validación
 * contable (partida doble: debe === haber) y transacciones atómicas.
 * 
 * @module db/queries
 */

import { getDatabase } from './init.js';

/**
 * Valida que un comprobante esté cuadrado (suma debe === suma haber)
 * @param {Array} asientos - Array de objetos {debe, haber}
 * @returns {Object} {valido: boolean, diferencia: number}
 */
function validarCuadreContable(asientos) {
    const totalDebe = asientos.reduce((sum, asiento) => sum + (asiento.debe || 0), 0);
    const totalHaber = asientos.reduce((sum, asiento) => sum + (asiento.haber || 0), 0);
    
    // Usamos precisión de 2 decimales para comparación monetaria
    const diferencia = Math.round((totalDebe - totalHaber) * 100) / 100;
    
    return {
        valido: Math.abs(diferencia) < 0.01,
        diferencia,
        totalDebe,
        totalHaber
    };
}

/**
 * Inserta un nuevo comprobante con sus asientos en transacción atómica
 * Valida que el comprobante esté cuadrado antes de guardar
 * 
 * @param {Object} comprobante - {fecha, numero, descripcion, tipo, estado}
 * @param {Array} asientos - Array de {cuenta_codigo, debe, haber, moneda, tasa_bcc_usada}
 * @returns {Promise<number>} ID del comprobante insertado
 * @throws {Error} Si el comprobante no está cuadrado o falla la transacción
 */
export async function insertComprobante(comprobante, asientos) {
    const db = getDatabase();
    
    // Validar cuadre contable antes de proceder
    const cuadre = validarCuadreContable(asientos);
    if (!cuadre.valido) {
        throw new Error(
            `Comprobante no cuadrado. Diferencia: ${cuadre.diferencia} ` +
            `(Debe: ${cuadre.totalDebe}, Haber: ${cuadre.totalHaber})`
        );
    }
    
    try {
        await db.run('BEGIN TRANSACTION;');
        
        // Insertar comprobante
        const insertComprobanteSQL = `
            INSERT INTO comprobantes (fecha, numero, descripcion, tipo, estado)
            VALUES (?, ?, ?, ?, ?)
        `;
        
        const result = await db.run(insertComprobanteSQL, [
            comprobante.fecha,
            comprobante.numero,
            comprobante.descripcion || null,
            comprobante.tipo,
            comprobante.estado || 'activo'
        ]);
        
        const comprobanteId = result.changes.lastInsertRowId;
        
        // Insertar asientos asociados
        const insertAsientoSQL = `
            INSERT INTO asientos (comprobante_id, cuenta_codigo, debe, haber, moneda, tasa_bcc_usada)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        for (const asiento of asientos) {
            await db.run(insertAsientoSQL, [
                comprobanteId,
                asiento.cuenta_codigo,
                asiento.debe || 0,
                asiento.haber || 0,
                asiento.moneda || 'CUP',
                asiento.tasa_bcc_usada || 1
            ]);
        }
        
        await db.run('COMMIT;');
        
        console.log(`Comprobante #${comprobanteId} insertado exitosamente`);
        return comprobanteId;
        
    } catch (error) {
        await db.run('ROLLBACK;');
        console.error('Error al insertar comprobante:', error);
        throw new Error(`Fallo al insertar comprobante: ${error.message}`);
    }
}

/**
 * Inserta múltiples asientos directamente (para operaciones especiales)
 * Valida que los asientos proporcionados estén cuadrados
 * 
 * @param {number} comprobanteId - ID del comprobante padre
 * @param {Array} asientos - Array de {cuenta_codigo, debe, haber, moneda, tasa_bcc_usada}
 * @returns {Promise<Array>} IDs de los asientos insertados
 */
export async function insertAsientos(comprobanteId, asientos) {
    const db = getDatabase();
    
    const cuadre = validarCuadreContable(asientos);
    if (!cuadre.valido) {
        throw new Error(
            `Asientos no cuadrados. Diferencia: ${cuadre.diferencia}`
        );
    }
    
    try {
        const insertSQL = `
            INSERT INTO asientos (comprobante_id, cuenta_codigo, debe, haber, moneda, tasa_bcc_usada)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        
        const insertedIds = [];
        
        for (const asiento of asientos) {
            const result = await db.run(insertSQL, [
                comprobanteId,
                asiento.cuenta_codigo,
                asiento.debe || 0,
                asiento.haber || 0,
                asiento.moneda || 'CUP',
                asiento.tasa_bcc_usada || 1
            ]);
            insertedIds.push(result.changes.lastInsertRowId);
        }
        
        return insertedIds;
        
    } catch (error) {
        console.error('Error al insertar asientos:', error);
        throw error;
    }
}

/**
 * Obtiene todos los asientos de una fecha específica o rango de fechas
 * Incluye información del comprobante y cuenta asociada
 * 
 * @param {string} fechaInicio - Fecha inicio formato YYYY-MM-DD
 * @param {string} fechaFin - Fecha fin formato YYYY-MM-DD (opcional, default = fechaInicio)
 * @returns {Promise<Array>} Array de asientos con datos relacionados
 */
export async function getAsientosByDate(fechaInicio, fechaFin = null) {
    const db = getDatabase();
    
    const endDate = fechaFin || fechaInicio;
    
    const query = `
        SELECT 
            a.id,
            a.comprobante_id,
            c.fecha,
            c.numero,
            c.descripcion,
            c.tipo,
            c.estado,
            a.cuenta_codigo,
            cu.nombre AS cuenta_nombre,
            cu.tipo AS cuenta_tipo,
            a.debe,
            a.haber,
            a.moneda,
            a.tasa_bcc_usada
        FROM asientos a
        INNER JOIN comprobantes c ON a.comprobante_id = c.id
        LEFT JOIN cuentas cu ON a.cuenta_codigo = cu.codigo
        WHERE c.fecha BETWEEN ? AND ?
        ORDER BY c.fecha, c.numero, a.id
    `;
    
    try {
        const result = await db.query(query, [fechaInicio, endDate]);
        return result.values || [];
    } catch (error) {
        console.error('Error al consultar asientos por fecha:', error);
        throw error;
    }
}

/**
 * Obtiene el balance (saldo) de una cuenta específica
 * Calcula: Saldo = Suma(DEBE) - Suma(HABER) para cuentas deudoras
 *          Saldo = Suma(HABER) - Suma(DEBE) para cuentas acreedoras
 * 
 * @param {string} cuentaCodigo - Código de la cuenta (ej: '100', '110.10')
 * @param {string} fechaInicio - Fecha inicio para filtro (opcional)
 * @param {string} fechaFin - Fecha fin para filtro (opcional)
 * @returns {Promise<Object>} {cuenta, tipo, totalDebe, totalHaber, saldo}
 */
export async function getBalanceCuenta(cuentaCodigo, fechaInicio = null, fechaFin = null) {
    const db = getDatabase();
    
    // Obtener información de la cuenta
    const cuentaQuery = 'SELECT codigo, nombre, tipo FROM cuentas WHERE codigo = ?';
    const cuentaResult = await db.query(cuentaQuery, [cuentaCodigo]);
    
    if (!cuentaResult.values || cuentaResult.values.length === 0) {
        throw new Error(`Cuenta ${cuentaCodigo} no encontrada`);
    }
    
    const cuenta = cuentaResult.values[0];
    
    // Construir consulta de movimientos
    let movimientoQuery = `
        SELECT 
            SUM(debe) AS total_debe,
            SUM(haber) AS total_haber
        FROM asientos
        WHERE cuenta_codigo = ?
    `;
    
    const params = [cuentaCodigo];
    
    if (fechaInicio && fechaFin) {
        movimientoQuery += `
            AND comprobante_id IN (
                SELECT id FROM comprobantes WHERE fecha BETWEEN ? AND ?
            )
        `;
        params.push(fechaInicio, fechaFin);
    } else if (fechaInicio) {
        movimientoQuery += `
            AND comprobante_id IN (
                SELECT id FROM comprobantes WHERE fecha >= ?
            )
        `;
        params.push(fechaInicio);
    }
    
    const movimientoResult = await db.query(movimientoQuery, params);
    const movimientos = movimientoResult.values[0] || { total_debe: 0, total_haber: 0 };
    
    const totalDebe = movimientos.total_debe || 0;
    const totalHaber = movimientos.total_haber || 0;
    
    // Calcular saldo según tipo de cuenta
    let saldo;
    if (['activo', 'nominal_deudor'].includes(cuenta.tipo)) {
        saldo = totalDebe - totalHaber;
    } else if (['pasivo', 'patrimonio', 'nominal_acreedor'].includes(cuenta.tipo)) {
        saldo = totalHaber - totalDebe;
    } else {
        saldo = totalDebe - totalHaber;
    }
    
    return {
        cuenta: cuentaCodigo,
        nombre: cuenta.nombre,
        tipo: cuenta.tipo,
        totalDebe: Math.round(totalDebe * 100) / 100,
        totalHaber: Math.round(totalHaber * 100) / 100,
        saldo: Math.round(saldo * 100) / 100
    };
}

/**
 * Exporta la base de datos completa a un archivo JSON
 * Útil para backup y recuperación
 * 
 * @returns {Promise<string>} Contenido JSON de la BD
 */
export async function exportDBToFile() {
    const db = getDatabase();
    
    const tablas = [
        'configuracion',
        'cuentas',
        'comprobantes',
        'asientos',
        'activos_fijos',
        'trabajadores_contratados',
        'tasas_cambio',
        'reservas_utilidades',
        'registro_control_ingresos_gastos'
    ];
    
    const exportData = {
        version: 1,
        exportFecha: new Date().toISOString(),
        tablas: {}
    };
    
    try {
        for (const tabla of tablas) {
            const query = `SELECT * FROM ${tabla}`;
            const result = await db.query(query);
            exportData.tablas[tabla] = result.values || [];
        }
        
        return JSON.stringify(exportData, null, 2);
        
    } catch (error) {
        console.error('Error al exportar BD:', error);
        throw error;
    }
}

/**
 * Importa datos desde un archivo JSON previamente exportado
 * Restaura todas las tablas en una transacción atómica
 * 
 * @param {string} jsonData - Contenido JSON de la exportación
 * @returns {Promise<boolean>} True si la importación fue exitosa
 */
export async function importDBFromFile(jsonData) {
    const db = getDatabase();
    
    try {
        const data = JSON.parse(jsonData);
        
        if (!data.tablas) {
            throw new Error('Formato de archivo inválido: falta propiedad "tablas"');
        }
        
        await db.run('BEGIN TRANSACTION;');
        
        // Limpiar tablas existentes (en orden inverso a las FK)
        await db.run('DELETE FROM registro_control_ingresos_gastos;');
        await db.run('DELETE FROM reservas_utilidades;');
        await db.run('DELETE FROM tasas_cambio;');
        await db.run('DELETE FROM trabajadores_contratados;');
        await db.run('DELETE FROM activos_fijos;');
        await db.run('DELETE FROM asientos;');
        await db.run('DELETE FROM comprobantes;');
        await db.run('DELETE FROM configuracion;');
        // No limpiamos 'cuentas' para preservar el nomenclador
        
        // Insertar datos importados
        for (const [tabla, registros] of Object.entries(data.tablas)) {
            if (registros.length === 0) continue;
            
            if (tabla === 'cuentas') continue; // Saltar nomenclador
            
            const columnas = Object.keys(registros[0]);
            const placeholders = columnas.map(() => '?').join(', ');
            
            const insertSQL = `
                INSERT OR REPLACE INTO ${tabla} (${columnas.join(', ')})
                VALUES (${placeholders})
            `;
            
            for (const registro of registros) {
                const valores = columnas.map(col => registro[col]);
                await db.run(insertSQL, valores);
            }
        }
        
        await db.run('COMMIT;');
        
        console.log('Importación completada exitosamente');
        return true;
        
    } catch (error) {
        await db.run('ROLLBACK;');
        console.error('Error al importar BD:', error);
        throw new Error(`Fallo al importar: ${error.message}`);
    }
}

/**
 * Obtiene el próximo número de comprobante disponible
 * 
 * @param {string} tipo - Tipo de comprobante (ingreso, gasto, ajuste, cierre)
 * @returns {Promise<number>} Próximo número disponible
 */
export async function getNextComprobanteNumero(tipo = null) {
    const db = getDatabase();
    
    let query = 'SELECT MAX(numero) AS max_numero FROM comprobantes';
    const params = [];
    
    if (tipo) {
        query += ' WHERE tipo = ?';
        params.push(tipo);
    }
    
    const result = await db.query(query, params);
    const maxNumero = result.values?.[0]?.max_numero || 0;
    
    return maxNumero + 1;
}

/**
 * Actualiza el estado de un comprobante (activo, anulado, cerrado)
 * 
 * @param {number} comprobanteId - ID del comprobante
 * @param {string} estado - Nuevo estado
 * @returns {Promise<boolean>} True si se actualizó correctamente
 */
export async function updateComprobanteEstado(comprobanteId, estado) {
    const db = getDatabase();
    
    const estadosValidos = ['activo', 'anulado', 'cerrado'];
    if (!estadosValidos.includes(estado)) {
        throw new Error(`Estado inválido. Debe ser uno de: ${estadosValidos.join(', ')}`);
    }
    
    const query = 'UPDATE comprobantes SET estado = ? WHERE id = ?';
    
    try {
        await db.run(query, [estado, comprobanteId]);
        return true;
    } catch (error) {
        console.error('Error al actualizar estado:', error);
        throw error;
    }
}

/**
 * Elimina un comprobante y sus asientos asociados (cascade)
 * 
 * @param {number} comprobanteId - ID del comprobante a eliminar
 * @returns {Promise<boolean>} True si se eliminó correctamente
 */
export async function deleteComprobante(comprobanteId) {
    const db = getDatabase();
    
    try {
        // Los asientos se eliminan por CASCADE, pero verificamos primero
        const checkQuery = 'SELECT COUNT(*) AS count FROM asientos WHERE comprobante_id = ?';
        const checkResult = await db.query(checkQuery, [comprobanteId]);
        
        const deleteQuery = 'DELETE FROM comprobantes WHERE id = ?';
        await db.run(deleteQuery, [comprobanteId]);
        
        return true;
    } catch (error) {
        console.error('Error al eliminar comprobante:', error);
        throw error;
    }
}

export default {
    insertComprobante,
    insertAsientos,
    getAsientosByDate,
    getBalanceCuenta,
    exportDBToFile,
    importDBFromFile,
    getNextComprobanteNumero,
    updateComprobanteEstado,
    deleteComprobante,
    validarCuadreContable
};

/**
 * Obtiene un comprobante por su ID
 * @param {number} id - ID del comprobante
 * @returns {Promise<Object|null>} Comprobante o null
 */
export async function getComprobanteById(id) {
  try {
    const db = await SQLiteConnection.getDatabase('contabilidad_tcp');
    const result = await db.query('SELECT * FROM comprobantes WHERE id = ?', [id]);
    return result.values?.[0] || null;
  } catch (error) {
    console.error('Error obteniendo comprobante:', error);
    return null;
  }
}

/**
 * Obtiene todas las cuentas del nomenclador
 * @returns {Promise<Array>} Lista de cuentas
 */
export async function getAllCuentas() {
  try {
    const db = await SQLiteConnection.getDatabase('contabilidad_tcp');
    const result = await db.query('SELECT * FROM cuentas ORDER BY codigo');
    return result.values || [];
  } catch (error) {
    console.error('Error obteniendo cuentas:', error);
    return [];
  }
}

/**
 * Obtiene una cuenta por su código
 * @param {string} codigo - Código de la cuenta
 * @returns {Promise<Object|null>} Cuenta o null
 */
export async function getCuentaByCodigo(codigo) {
  try {
    const db = await SQLiteConnection.getDatabase('contabilidad_tcp');
    const result = await db.query('SELECT * FROM cuentas WHERE codigo = ?', [codigo]);
    return result.values?.[0] || null;
  } catch (error) {
    console.error('Error obteniendo cuenta:', error);
    return null;
  }
}

/**
 * Obtiene todas las tasas de cambio registradas
 * @returns {Promise<Array>} Lista de tasas
 */
export async function getAllTasasCambio() {
  try {
    const db = await SQLiteConnection.getDatabase('contabilidad_tcp');
    const result = await db.query('SELECT * FROM tasas_cambio ORDER BY fecha DESC');
    return result.values || [];
  } catch (error) {
    console.error('Error obteniendo tasas de cambio:', error);
    return [];
  }
}

/**
 * Obtiene todos los activos fijos
 * @returns {Promise<Array>} Lista de activos
 */
export async function getActivosFijos() {
  try {
    const db = await SQLiteConnection.getDatabase('contabilidad_tcp');
    const result = await db.query('SELECT * FROM activos_fijos ORDER BY id');
    return result.values || [];
  } catch (error) {
    console.error('Error obteniendo activos fijos:', error);
    return [];
  }
}

/**
 * Actualiza un activo fijo
 * @param {number} id - ID del activo
 * @param {Object} datos - Datos a actualizar
 * @returns {Promise<Object>} Resultado de la operación
 */
export async function updateActivoFijo(id, datos) {
  try {
    const db = await SQLiteConnection.getDatabase('contabilidad_tcp');
    
    const campos = Object.keys(datos).map(k => `${k} = ?`).join(', ');
    const valores = [...Object.values(datos), id];
    
    await db.run(`UPDATE activos_fijos SET ${campos} WHERE id = ?`, valores);
    
    return { success: true, message: 'Activo actualizado correctamente' };
  } catch (error) {
    console.error('Error actualizando activo:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Obtiene la configuración de la empresa
 * @returns {Promise<Object|null>} Configuración o null
 */
export async function getConfiguracion() {
  try {
    const db = await SQLiteConnection.getDatabase('contabilidad_tcp');
    const result = await db.query('SELECT * FROM configuracion LIMIT 1');
    return result.values?.[0] || null;
  } catch (error) {
    console.error('Error obteniendo configuración:', error);
    return null;
  }
}

/**
 * Obtiene registros de control de ingresos y gastos
 * @param {string} fechaInicio - Fecha inicio YYYY-MM-DD
 * @param {string} fechaFin - Fecha fin YYYY-MM-DD
 * @returns {Promise<Array>} Lista de registros
 */
export async function getRegistroControl(fechaInicio, fechaFin) {
  try {
    const db = await SQLiteConnection.getDatabase('contabilidad_tcp');
    const result = await db.query(
      'SELECT * FROM registro_control_ingresos_gastos WHERE fecha BETWEEN ? AND ? ORDER BY fecha',
      [fechaInicio, fechaFin]
    );
    return result.values || [];
  } catch (error) {
    console.error('Error obteniendo registro de control:', error);
    return [];
  }
}

/**
 * Obtiene todos los trabajadores contratados
 * @returns {Promise<Array>} Lista de trabajadores
 */
export async function getTrabajadoresContratados() {
  try {
    const db = await SQLiteConnection.getDatabase('contabilidad_tcp');
    const result = await db.query('SELECT * FROM trabajadores_contratados ORDER BY apellidos, nombres');
    return result.values || [];
  } catch (error) {
    console.error('Error obteniendo trabajadores:', error);
    return [];
  }
}
