/**
 * Motor Contable TCP Cuba
 * Implementa partida doble, depreciación, cierre anual y conversión de monedas
 * @module accounting/engine
 */

import { 
  insertComprobante, 
  insertAsientos, 
  getBalanceCuenta, 
  getAsientosByDate,
  getComprobanteById,
  getCuentaByCodigo,
  getAllTasasCambio,
  getActivosFijos,
  updateActivoFijo 
} from '../db/queries.js';

/**
 * Valida que un comprobante esté cuadrado (partida doble)
 * @param {Array} asientos - Array de objetos {debe, haber}
 * @returns {Object} {valido: boolean, diferencia: number}
 */
export function validarCuadreContable(asientos) {
  const totalDebe = asientos.reduce((sum, a) => sum + (parseFloat(a.debe) || 0), 0);
  const totalHaber = asientos.reduce((sum, a) => sum + (parseFloat(a.haber) || 0), 0);
  const diferencia = Math.abs(totalDebe - totalHaber);
  
  return {
    valido: diferencia < 0.01,
    diferencia: diferencia,
    totalDebe: totalDebe,
    totalHaber: totalHaber
  };
}

/**
 * Registra un comprobante completo con sus asientos
 * Valida partida doble antes de guardar
 * @param {Object} comprobanteData - {fecha, numero, descripcion, tipo}
 * @param {Array} asientos - [{cuenta_codigo, debe, haber, moneda, tasa_bcc_usada}]
 * @returns {Promise<Object>} {success: boolean, comprobanteId: number, message: string}
 */
export async function registrarAsientoComprobante(comprobanteData, asientos) {
  try {
    // Validación de partida doble
    const cuadre = validarCuadreContable(asientos);
    
    if (!cuadre.valido) {
      return {
        success: false,
        message: `El comprobante no está cuadrado. Diferencia: ${cuadre.diferencia.toFixed(2)}. Debe: ${cuadre.totalDebe.toFixed(2)}, Haber: ${cuadre.totalHaber.toFixed(2)}`
      };
    }

    // Insertar comprobante
    const comprobanteResult = await insertComprobante(comprobanteData);
    
    if (!comprobanteResult.success) {
      return {
        success: false,
        message: `Error al crear comprobante: ${comprobanteResult.error}`
      };
    }

    const comprobanteId = comprobanteResult.id;

    // Añadir comprobante_id a cada asiento
    const asientosConId = asientos.map(asiento => ({
      ...asiento,
      comprobante_id: comprobanteId
    }));

    // Insertar asientos
    const asientosResult = await insertAsientos(asientosConId);

    if (!asientosResult.success) {
      // Rollback manual: marcar comprobante como inactivo
      // En producción se usaría transacción real
      return {
        success: false,
        message: `Error al crear asientos: ${asientosResult.error}. Comprobante creado pero sin asientos.`
      };
    }

    return {
      success: true,
      comprobanteId: comprobanteId,
      message: `Comprobante #${comprobanteData.numero} registrado exitosamente`
    };

  } catch (error) {
    console.error('Error en registrarAsientoComprobante:', error);
    return {
      success: false,
      message: `Error inesperado: ${error.message}`
    };
  }
}

/**
 * Calcula la depreciación mensual de un activo fijo usando método lineal
 * Según Res. 346/2021: 10% anual por defecto
 * @param {number} activoId - ID del activo en la tabla activos_fijos
 * @returns {Promise<Object>} {success: boolean, depreciacionMensual: number, message: string}
 */
export async function calcularDepreciacionMensual(activoId) {
  try {
    const activos = await getActivosFijos();
    const activo = activos.find(a => a.id === activoId);

    if (!activo) {
      return {
        success: false,
        message: 'Activo no encontrado'
      };
    }

    // Método lineal: (Valor inicial - Valor residual) / Vida útil
    // Por simplicidad, valor residual = 0 si no se especifica
    const tasaAnual = activo.tasa_anual || 0.10; // 10% por defecto
    const tasaMensual = tasaAnual / 12;
    
    const valorInicial = activo.valor_inicial || 0;
    const depreciacionMensual = valorInicial * tasaMensual;

    // Actualizar depreciación acumulada y valor neto
    const nuevaDepreciacionAcumulada = (activo.depreciacion_acumulada || 0) + depreciacionMensual;
    const nuevoValorNeto = valorInicial - nuevaDepreciacionAcumulada;

    // Actualizar en BD
    const updateResult = await updateActivoFijo(activoId, {
      depreciacion_acumulada: nuevaDepreciacionAcumulada,
      valor_neto: nuevoValorNeto
    });

    if (!updateResult.success) {
      return {
        success: false,
        message: `Error al actualizar activo: ${updateResult.error}`
      };
    }

    return {
      success: true,
      depreciacionMensual: depreciacionMensual,
      depreciacionAcumulada: nuevaDepreciacionAcumulada,
      valorNeto: nuevoValorNeto,
      message: `Depreciación mensual calculada: ${depreciacionMensual.toFixed(2)} CUP`
    };

  } catch (error) {
    console.error('Error en calcularDepreciacionMensual:', error);
    return {
      success: false,
      message: `Error inesperado: ${error.message}`
    };
  }
}

/**
 * Ejecuta el cierre contable anual
 * Transfiere saldos de cuentas nominales (900, 800, 810, 820) a resultado (999)
 * Luego transfiere 999 a 610 (utilidad) o 620 (pérdida)
 * @param {number} anio - Año a cerrar (ej: 2024)
 * @returns {Promise<Object>} {success: boolean, comprobanteId: number, utilidad: number}
 */
export async function ejecutarCierreAnual(anio) {
  try {
    const fechaCierre = `${anio}-12-31`;
    
    // Obtener saldos de todas las cuentas nominales
    // 900: Ingresos (saldo acreedor)
    // 800, 810, 820: Gastos (saldo deudor)
    
    const saldoIngresos = await getBalanceCuenta('900');
    const saldoGastos800 = await getBalanceCuenta('800');
    const saldoGastos810 = await getBalanceCuenta('810');
    const saldoGastos820 = await getBalanceCuenta('820');

    const totalIngresos = Math.abs(saldoIngresos.saldo || 0);
    const totalGastos = Math.abs(saldoGastos800.saldo || 0) + 
                        Math.abs(saldoGastos810.saldo || 0) + 
                        Math.abs(saldoGastos820.saldo || 0);
    
    const utilidadBruta = totalIngresos - totalGastos;

    // Crear comprobante de cierre
    const comprobanteData = {
      fecha: fechaCierre,
      numero: 9999, // Número especial para cierre
      descripcion: `Cierre anual ${anio}`,
      tipo: 'cierre'
    };

    const asientos = [];

    // Asiento 1: Cancelar ingresos (debitar 900)
    if (totalIngresos > 0) {
      asientos.push({
        cuenta_codigo: '900',
        debe: totalIngresos,
        haber: 0,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    }

    // Asiento 2: Cancelar gastos (acreeditar 800, 810, 820)
    if (saldoGastos800.saldo > 0) {
      asientos.push({
        cuenta_codigo: '800',
        debe: 0,
        haber: Math.abs(saldoGastos800.saldo),
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    }
    if (saldoGastos810.saldo > 0) {
      asientos.push({
        cuenta_codigo: '810',
        debe: 0,
        haber: Math.abs(saldoGastos810.saldo),
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    }
    if (saldoGastos820.saldo > 0) {
      asientos.push({
        cuenta_codigo: '820',
        debe: 0,
        haber: Math.abs(saldoGastos820.saldo),
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    }

    // Asiento 3: Registrar resultado en 999
    if (utilidadBruta >= 0) {
      // Utilidad: acreditar 999
      asientos.push({
        cuenta_codigo: '999',
        debe: 0,
        haber: utilidadBruta,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    } else {
      // Pérdida: debitar 999
      asientos.push({
        cuenta_codigo: '999',
        debe: Math.abs(utilidadBruta),
        haber: 0,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    }

    // Registrar primer comprobante de cierre parcial
    const resultadoParcial = await registrarAsientoComprobante(comprobanteData, asientos);
    
    if (!resultadoParcial.success) {
      return resultadoParcial;
    }

    // Segundo comprobante: Transferir 999 a 610 o 620
    const comprobanteFinal = {
      fecha: fechaCierre,
      numero: 9998,
      descripcion: `Transferencia resultado a patrimonio ${anio}`,
      tipo: 'cierre'
    };

    const asientosFinales = [];

    if (utilidadBruta >= 0) {
      // Utilidad: debitar 999, acreditar 610
      asientosFinales.push({
        cuenta_codigo: '999',
        debe: utilidadBruta,
        haber: 0,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
      asientosFinales.push({
        cuenta_codigo: '610',
        debe: 0,
        haber: utilidadBruta,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    } else {
      // Pérdida: acreditar 999, debitar 620
      const perdida = Math.abs(utilidadBruta);
      asientosFinales.push({
        cuenta_codigo: '999',
        debe: 0,
        haber: perdida,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
      asientosFinales.push({
        cuenta_codigo: '620',
        debe: perdida,
        haber: 0,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    }

    const resultadoFinal = await registrarAsientoComprobante(comprobanteFinal, asientosFinales);

    if (!resultadoFinal.success) {
      return resultadoFinal;
    }

    return {
      success: true,
      comprobanteId: resultadoFinal.comprobanteId,
      utilidad: utilidadBruta,
      message: `Cierre anual ${anio} completado. Resultado: ${utilidadBruta >= 0 ? 'Utilidad' : 'Pérdida'} de ${Math.abs(utilidadBruta).toFixed(2)} CUP`
    };

  } catch (error) {
    console.error('Error en ejecutarCierreAnual:', error);
    return {
      success: false,
      message: `Error inesperado: ${error.message}`
    };
  }
}

/**
 * Convierte un monto entre monedas usando la tasa de cambio de una fecha específica
 * @param {number} monto - Monto a convertir
 * @param {string} monedaOrigen - 'CUP' o 'MLE'
 * @param {string} monedaDestino - 'CUP' o 'MLE'
 * @param {string} fecha - Fecha en formato YYYY-MM-DD
 * @returns {Promise<Object>} {success: boolean, montoConvertido: number, tasaUsada: number}
 */
export async function convertirMoneda(monto, monedaOrigen, monedaDestino, fecha) {
  try {
    if (monedaOrigen === monedaDestino) {
      return {
        success: true,
        montoConvertido: monto,
        tasaUsada: 1,
        message: 'Misima moneda, no se requiere conversión'
      };
    }

    // Obtener tasas de cambio de la BD
    const tasas = await getAllTasasCambio();
    
    // Buscar la tasa más cercana a la fecha solicitada
    const tasaDelDia = tasas.find(t => t.fecha === fecha) || 
                       tasas.reduce((prev, curr) => {
                         return (Math.abs(new Date(curr.fecha) - new Date(fecha)) < 
                                 Math.abs(new Date(prev.fecha) - new Date(fecha))) ? curr : prev;
                       }, tasas[0]);

    if (!tasaDelDia) {
      return {
        success: false,
        message: 'No hay tasas de cambio registradas para esta fecha'
      };
    }

    // Usar tasa de venta para comprar MLE, tasa de compra para vender MLE
    // Simplificación: usamos el promedio para conversiones internas
    const tasaPromedio = (tasaDelDia.tasa_compra_bcc + tasaDelDia.tasa_venta_bcc) / 2;

    let montoConvertido;
    let tasaUsada;

    if (monedaOrigen === 'MLE' && monedaDestino === 'CUP') {
      // MLE a CUP: multiplicar por tasa
      tasaUsada = tasaPromedio;
      montoConvertido = monto * tasaUsada;
    } else if (monedaOrigen === 'CUP' && monedaDestino === 'MLE') {
      // CUP a MLE: dividir por tasa
      tasaUsada = tasaPromedio;
      montoConvertido = monto / tasaUsada;
    }

    return {
      success: true,
      montoConvertido: parseFloat(montoConvertido.toFixed(2)),
      tasaUsada: tasaUsada,
      fechaTasa: tasaDelDia.fecha,
      message: `${monto.toFixed(2)} ${monedaOrigen} = ${montoConvertido.toFixed(2)} ${monedaDestino}`
    };

  } catch (error) {
    console.error('Error en convertirMoneda:', error);
    return {
      success: false,
      message: `Error inesperado: ${error.message}`
    };
  }
}

/**
 * Calcula y registra diferencias cambiarias por operaciones en MLE
 * Se usa al momento de liquidar operaciones pendientes
 * @param {number} comprobanteId - ID del comprobante original
 * @param {number} montoOriginal - Monto original en MLE
 * @param {number} tasaOriginal - Tasa usada originalmente
 * @param {string} nuevaFecha - Fecha de liquidación
 * @returns {Promise<Object>} {success: boolean, diferencia: number, comprobanteId: number}
 */
export async function registrarDiferenciaCambiaria(comprobanteId, montoOriginal, tasaOriginal, nuevaFecha) {
  try {
    // Obtener comprobante original
    const comprobanteOriginal = await getComprobanteById(comprobanteId);
    
    if (!comprobanteOriginal) {
      return {
        success: false,
        message: 'Comprobante original no encontrado'
      };
    }

    // Obtener nueva tasa
    const conversion = await convertirMoneda(montoOriginal, 'MLE', 'CUP', nuevaFecha);
    
    if (!conversion.success) {
      return conversion;
    }

    const nuevoValorCUP = conversion.montoConvertido;
    const valorOriginalCUP = montoOriginal * tasaOriginal;
    const diferencia = nuevoValorCUP - valorOriginalCUP;

    // Si la diferencia es insignificante, no hacer nada
    if (Math.abs(diferencia) < 0.01) {
      return {
        success: true,
        diferencia: 0,
        message: 'Diferencia cambiaria insignificante'
      };
    }

    // Crear comprobante de ajuste por diferencia cambiaria
    const comprobanteAjuste = {
      fecha: nuevaFecha,
      numero: Math.floor(Date.now() / 1000), // Número único basado en timestamp
      descripcion: `Ajuste por diferencia cambiaria (Ref: Comp #${comprobanteId})`,
      tipo: 'ajuste'
    };

    const asientos = [];

    if (diferencia > 0) {
      // Ganancia cambiaria: debitar cuenta de activo/pasivo, acreditar 900 (ingreso)
      asientos.push({
        cuenta_codigo: '110', // Banco u otra cuenta afectada
        debe: diferencia,
        haber: 0,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
      asientos.push({
        cuenta_codigo: '900',
        debe: 0,
        haber: diferencia,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    } else {
      // Pérdida cambiaria: debitar 800 (gasto), acreditar cuenta de activo/pasivo
      const perdida = Math.abs(diferencia);
      asientos.push({
        cuenta_codigo: '800',
        debe: perdida,
        haber: 0,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
      asientos.push({
        cuenta_codigo: '110',
        debe: 0,
        haber: perdida,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    }

    const resultado = await registrarAsientoComprobante(comprobanteAjuste, asientos);

    return {
      success: resultado.success,
      diferencia: diferencia,
      comprobanteId: resultado.comprobanteId,
      message: resultado.message
    };

  } catch (error) {
    console.error('Error en registrarDiferenciaCambiaria:', error);
    return {
      success: false,
      message: `Error inesperado: ${error.message}`
    };
  }
}

/**
 * Obtiene el balance de comprobación completo
 * @returns {Promise<Array>} Array de objetos {codigo, nombre, saldoDeudor, saldoAcreedor}
 */
export async function obtenerBalanceComprobacion() {
  try {
    // Esta función requeriría una query SQL compleja en queries.js
    // Por ahora, retornamos estructura básica
    return {
      success: true,
      message: 'Funcionalidad pendiente de implementar en queries.js'
    };
  } catch (error) {
    console.error('Error en obtenerBalanceComprobacion:', error);
    return {
      success: false,
      message: `Error inesperado: ${error.message}`
    };
  }
}
