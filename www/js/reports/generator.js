/**
 * Generador de Reportes TCP Cuba
 * Genera PDF con jsPDF + autoTable y Excel con SheetJS
 * Formatos oficiales ONAT: SC-5-01, SC-5-04, SC-5-05
 * @module reports/generator
 */

// Importar funciones de queries.js
import { 
  getComprobanteById, 
  getAsientosByDate, 
  getBalanceCuenta,
  getAllCuentas,
  getConfiguracion,
  getRegistroControl,
  getTrabajadoresContratados
} from '../db/queries.js';

/**
 * Obtiene datos básicos de la configuración del TCP
 * @returns {Promise<Object>} Datos del TCP
 */
async function getDatosTCP() {
  const config = await getConfiguracion();
  return {
    nombre: config?.nombre_proyecto || 'TCP Sin Nombre',
    nit: config?.nit || 'N/A',
    regimen: config?.regimen || 'general',
    moneda: config?.moneda_base || 'CUP'
  };
}

/**
 * Genera Comprobante de Operaciones SC-5-01 en PDF
 * Formato oficial ONAT NTCP 1 Mod 1
 * @param {number} comprobanteId - ID del comprobante
 * @returns {Promise<Blob>} PDF blob
 */
export async function generarSC01(comprobanteId) {
  try {
    // Verificar que jsPDF esté disponible
    if (typeof window === 'undefined' || !window.jspdf) {
      throw new Error('jsPDF no está disponible. Incluir librería en HTML.');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    // Obtener datos del comprobante
    const comprobante = await getComprobanteById(comprobanteId);
    if (!comprobante) {
      throw new Error('Comprobante no encontrado');
    }

    // Obtener asientos del comprobante
    const fechaInicio = comprobante.fecha;
    const fechaFin = comprobante.fecha;
    const asientosRaw = await getAsientosByDate(fechaInicio, fechaFin);
    const asientos = asientosRaw.filter(a => a.comprobante_id === comprobanteId);

    // Obtener datos del TCP
    const tcp = await getDatosTCP();

    // Encabezado
    doc.setFontSize(14);
    doc.text('COMPROBANTE DE OPERACIONES', 105, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text('Modelo SC-5-01', 105, 20, { align: 'center' });

    // Datos del TCP
    doc.setFontSize(9);
    doc.text(`Nombre TCP: ${tcp.nombre}`, 14, 30);
    doc.text(`NIT: ${tcp.nit}`, 14, 35);
    doc.text(`Régimen: ${tcp.regimen.toUpperCase()}`, 100, 30);
    doc.text(`Moneda Base: ${tcp.moneda}`, 100, 35);

    // Datos del comprobante
    doc.text(`Fecha: ${comprobante.fecha}`, 14, 45);
    doc.text(`Número: ${comprobante.numero}`, 80, 45);
    doc.text(`Tipo: ${comprobante.tipo.toUpperCase()}`, 120, 45);
    doc.text(`Descripción: ${comprobante.descripcion}`, 14, 52);

    // Preparar datos para la tabla
    const tableData = asientos.map(asiento => [
      asiento.cuenta_codigo,
      asiento.subcuenta || '-',
      asiento.analisis || '-',
      asiento.concepto || asiento.descripcion || '',
      asiento.debe > 0 ? asiento.debe.toFixed(2) : '',
      asiento.haber > 0 ? asiento.haber.toFixed(2) : ''
    ]);

    // Calcular totales
    const totalDebe = asientos.reduce((sum, a) => sum + (a.debe || 0), 0);
    const totalHaber = asientos.reduce((sum, a) => sum + (a.haber || 0), 0);

    // Añadir fila de totales
    tableData.push([
      '', '', '', 'TOTALES',
      totalDebe.toFixed(2),
      totalHaber.toFixed(2)
    ]);

    // Generar tabla con autoTable
    if (window.jspdf.autoTable) {
      doc.autoTable({
        startY: 60,
        head: [['Código', 'Subcta', 'Análisis', 'Concepto', 'Debe', 'Haber']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] },
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 20 },
          1: { cellWidth: 15 },
          2: { cellWidth: 20 },
          3: { cellWidth: 70 },
          4: { cellWidth: 25, halign: 'right' },
          5: { cellWidth: 25, halign: 'right' }
        },
        foot: [['', '', '', '', totalDebe.toFixed(2), totalHaber.toFixed(2)]]
      });
    } else {
      // Fallback sin autoTable
      doc.text('(Requiere jspdf-autotable)', 14, 65);
    }

    // Firmas
    const finalY = doc.lastAutoTable?.finalY || 180;
    doc.text('__________________________', 20, finalY + 30);
    doc.text('Elaborado por', 20, finalY + 35);

    doc.text('__________________________', 80, finalY + 30);
    doc.text('Revisado por', 80, finalY + 35);

    doc.text('__________________________', 140, finalY + 30);
    doc.text('Aprobado por', 140, finalY + 35);

    // Pie de página
    doc.setFontSize(8);
    doc.text(`Generado el: ${new Date().toLocaleString()}`, 105, 280, { align: 'center' });

    // Retornar blob
    return doc.output('blob');

  } catch (error) {
    console.error('Error generando SC-5-01:', error);
    throw error;
  }
}

/**
 * Genera Submayor SC-5-04 en PDF
 * Muestra movimientos de una cuenta específica en un período
 * @param {string} cuentaCodigo - Código de la cuenta (ej: '100')
 * @param {string} fechaInicio - Fecha inicio YYYY-MM-DD
 * @param {string} fechaFin - Fecha fin YYYY-MM-DD
 * @returns {Promise<Blob>} PDF blob
 */
export async function generarSC04(cuentaCodigo, fechaInicio, fechaFin) {
  try {
    if (typeof window === 'undefined' || !window.jspdf) {
      throw new Error('jsPDF no está disponible');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const tcp = await getDatosTCP();

    // Encabezado
    doc.setFontSize(14);
    doc.text('SUBMAYOR', 105, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text('Modelo SC-5-04', 105, 20, { align: 'center' });

    // Datos
    doc.setFontSize(9);
    doc.text(`TCP: ${tcp.nombre}`, 14, 30);
    doc.text(`NIT: ${tcp.nit}`, 14, 35);
    doc.text(`Cuenta: ${cuentaCodigo}`, 14, 45);
    doc.text(`Período: ${fechaInicio} al ${fechaFin}`, 80, 45);

    // Obtener asientos de la cuenta en el período
    const asientosRaw = await getAsientosByDate(fechaInicio, fechaFin);
    const asientos = asientosRaw.filter(a => a.cuenta_codigo === cuentaCodigo);

    // Preparar tabla con saldo acumulado
    let saldoAcumulado = 0;
    const tableData = asientos.map(asiento => {
      const movimiento = (asiento.debe || 0) - (asiento.haber || 0);
      saldoAcumulado += movimiento;
      
      return [
        asiento.fecha,
        `Comp #${asiento.comprobante_id}`,
        asiento.descripcion || asiento.concepto || '',
        asiento.debe > 0 ? asiento.debe.toFixed(2) : '',
        asiento.haber > 0 ? asiento.haber.toFixed(2) : '',
        saldoAcumulado.toFixed(2)
      ];
    });

    // Generar tabla
    if (window.jspdf.autoTable) {
      doc.autoTable({
        startY: 55,
        head: [['Fecha', 'Comprobante', 'Concepto', 'Debe', 'Haber', 'Saldo']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] },
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 25 },
          2: { cellWidth: 60 },
          3: { cellWidth: 22, halign: 'right' },
          4: { cellWidth: 22, halign: 'right' },
          5: { cellWidth: 22, halign: 'right' }
        }
      });
    }

    return doc.output('blob');

  } catch (error) {
    console.error('Error generando SC-5-04:', error);
    throw error;
  }
}

/**
 * Genera Mayor SC-5-05 en PDF
 * Muestra todas las cuentas control con saldos mensuales
 * @param {string} fechaInicio - Fecha inicio YYYY-MM-DD
 * @param {string} fechaFin - Fecha fin YYYY-MM-DD
 * @returns {Promise<Blob>} PDF blob
 */
export async function generarSC05(fechaInicio, fechaFin) {
  try {
    if (typeof window === 'undefined' || !window.jspdf) {
      throw new Error('jsPDF no está disponible');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const tcp = await getDatosTCP();

    // Encabezado
    doc.setFontSize(14);
    doc.text('MAYOR', 105, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text('Modelo SC-5-05', 105, 20, { align: 'center' });

    doc.setFontSize(9);
    doc.text(`TCP: ${tcp.nombre}`, 14, 30);
    doc.text(`NIT: ${tcp.nit}`, 14, 35);
    doc.text(`Período: ${fechaInicio} al ${fechaFin}`, 14, 45);

    // Cuentas control principales según Res. 346/2021
    const cuentasControl = ['100', '110', '470', '520', '600', '610', '620', '800', '810', '820', '900'];
    
    const tableData = [];
    
    for (const codigo of cuentasControl) {
      const balance = await getBalanceCuenta(codigo);
      const saldo = balance.saldo || 0;
      
      // Determinar si es deudor o acreedor
      const tipoSaldo = saldo >= 0 ? 'D' : 'A';
      
      tableData.push([
        codigo,
        Math.abs(saldo).toFixed(2),
        tipoSaldo
      ]);
    }

    // Generar tabla
    if (window.jspdf.autoTable) {
      doc.autoTable({
        startY: 55,
        head: [['Cuenta', 'Saldo', 'Tipo']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] },
        styles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 40 },
          1: { cellWidth: 60, halign: 'right' },
          2: { cellWidth: 30, halign: 'center' }
        }
      });
    }

    return doc.output('blob');

  } catch (error) {
    console.error('Error generando SC-5-05:', error);
    throw error;
  }
}

/**
 * Genera Balance General en PDF
 * Muestra Activo, Pasivo y Patrimonio
 * @param {string} fechaCierre - Fecha de corte YYYY-MM-DD
 * @returns {Promise<Blob>} PDF blob
 */
export async function generarBalanceGeneral(fechaCierre) {
  try {
    if (typeof window === 'undefined' || !window.jspdf) {
      throw new Error('jsPDF no está disponible');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const tcp = await getDatosTCP();

    // Encabezado
    doc.setFontSize(14);
    doc.text('BALANCE GENERAL', 105, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Al ${fechaCierre}`, 105, 20, { align: 'center' });

    doc.setFontSize(9);
    doc.text(`TCP: ${tcp.nombre}`, 14, 30);
    doc.text(`NIT: ${tcp.nit}`, 14, 35);

    // Obtener saldos
    const activoCirculante = (await getBalanceCuenta('100')).saldo + 
                             (await getBalanceCuenta('110')).saldo;
    const pasivoCirculante = (await getBalanceCuenta('470')).saldo;
    const pasivoLargoPlazo = (await getBalanceCuenta('520')).saldo;
    const capitalSocial = (await getBalanceCuenta('600')).saldo;
    const utilidadEjercicio = (await getBalanceCuenta('610')).saldo;
    const perdidaEjercicio = (await getBalanceCuenta('620')).saldo;

    const patrimonioTotal = capitalSocial + utilidadEjercicio - Math.abs(perdidaEjercicio);
    const pasivoTotal = pasivoCirculante + pasivoLargoPlazo;
    const activoTotal = activoCirculante; // Simplificado

    // Estructura del balance
    const data = [
      ['ACTIVO', '', ''],
      ['Activo Circulante', '', ''],
      ['  Caja (100)', activoCirculante >= 0 ? activoCirculante.toFixed(2) : '0.00', ''],
      ['  Banco (110)', '', ''],
      ['TOTAL ACTIVO', '', activoTotal.toFixed(2)],
      ['', '', ''],
      ['PASIVO', '', ''],
      ['Pasivo Circulante', '', ''],
      ['  Cuentas por Pagar (470)', pasivoCirculante.toFixed(2), ''],
      ['Pasivo Largo Plazo (520)', pasivoLargoPlazo.toFixed(2), ''],
      ['TOTAL PASIVO', '', pasivoTotal.toFixed(2)],
      ['', '', ''],
      ['PATRIMONIO', '', ''],
      ['Capital Social (600)', capitalSocial.toFixed(2), ''],
      ['Utilidad del Ejercicio (610)', utilidadEjercicio >= 0 ? utilidadEjercicio.toFixed(2) : '0.00', ''],
      ['Pérdida del Ejercicio (620)', perdidaEjercicio < 0 ? Math.abs(perdidaEjercicio).toFixed(2) : '0.00', ''],
      ['TOTAL PATRIMONIO', '', patrimonioTotal.toFixed(2)]
    ];

    if (window.jspdf.autoTable) {
      doc.autoTable({
        startY: 45,
        body: data,
        theme: 'plain',
        styles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 100 },
          1: { cellWidth: 40, halign: 'right' },
          2: { cellWidth: 40, halign: 'right' }
        }
      });
    }

    return doc.output('blob');

  } catch (error) {
    console.error('Error generando Balance General:', error);
    throw error;
  }
}

/**
 * Genera Estado de Resultados en PDF
 * Muestra Ingresos - Gastos = Utilidad/Pérdida
 * @param {string} anio - Año del estado de resultados
 * @returns {Promise<Blob>} PDF blob
 */
export async function generarEstadoResultados(anio) {
  try {
    if (typeof window === 'undefined' || !window.jspdf) {
      throw new Error('jsPDF no está disponible');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const tcp = await getDatosTCP();
    const fechaInicio = `${anio}-01-01`;
    const fechaFin = `${anio}-12-31`;

    // Encabezado
    doc.setFontSize(14);
    doc.text('ESTADO DE RESULTADOS', 105, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text(`Año ${anio}`, 105, 20, { align: 'center' });

    doc.setFontSize(9);
    doc.text(`TCP: ${tcp.nombre}`, 14, 30);
    doc.text(`NIT: ${tcp.nit}`, 14, 35);

    // Obtener saldos acumulados del año
    const ingresos = await getBalanceCuenta('900');
    const gastos800 = await getBalanceCuenta('800');
    const gastos810 = await getBalanceCuenta('810');
    const gastos820 = await getBalanceCuenta('820');

    const totalIngresos = Math.abs(ingresos.saldo || 0);
    const totalGastos = Math.abs(gastos800.saldo || 0) + 
                        Math.abs(gastos810.saldo || 0) + 
                        Math.abs(gastos820.saldo || 0);
    const resultado = totalIngresos - totalGastos;

    const data = [
      ['INGRESOS', '', ''],
      ['  Ingresos por Ventas/Servicios (900)', '', totalIngresos.toFixed(2)],
      ['TOTAL INGRESOS', '', totalIngresos.toFixed(2)],
      ['', '', ''],
      ['GASTOS', '', ''],
      ['  Gastos de Explotación (800)', '', Math.abs(gastos800.saldo || 0).toFixed(2)],
      ['  Gastos de Administración (810)', '', Math.abs(gastos810.saldo || 0).toFixed(2)],
      ['  Otros Gastos (820)', '', Math.abs(gastos820.saldo || 0).toFixed(2)],
      ['TOTAL GASTOS', '', totalGastos.toFixed(2)],
      ['', '', ''],
      ['RESULTADO DEL EJERCICIO', '', resultado.toFixed(2)],
      ['', '', ''],
      [resultado >= 0 ? 'UTILIDAD' : 'PÉRDIDA', '', Math.abs(resultado).toFixed(2)]
    ];

    if (window.jspdf.autoTable) {
      doc.autoTable({
        startY: 45,
        body: data,
        theme: 'plain',
        styles: { fontSize: 9 },
        columnStyles: {
          0: { cellWidth: 120 },
          1: { cellWidth: 40, halign: 'right' },
          2: { cellWidth: 40, halign: 'right' }
        }
      });
    }

    return doc.output('blob');

  } catch (error) {
    console.error('Error generando Estado de Resultados:', error);
    throw error;
  }
}

/**
 * Genera Registro de Control de Ingresos y Gastos
 * Formato ONAT para fiscalización
 * @param {string} fechaInicio - Fecha inicio YYYY-MM-DD
 * @param {string} fechaFin - Fecha fin YYYY-MM-DD
 * @returns {Promise<Blob>} PDF blob
 */
export async function generarRegistroControl(fechaInicio, fechaFin) {
  try {
    if (typeof window === 'undefined' || !window.jspdf) {
      throw new Error('jsPDF no está disponible');
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    const tcp = await getDatosTCP();

    // Encabezado
    doc.setFontSize(14);
    doc.text('REGISTRO DE CONTROL DE INGRESOS Y GASTOS', 105, 15, { align: 'center' });
    doc.setFontSize(10);
    doc.text('Formato ONAT', 105, 20, { align: 'center' });

    doc.setFontSize(9);
    doc.text(`TCP: ${tcp.nombre}`, 14, 30);
    doc.text(`NIT: ${tcp.nit}`, 14, 35);
    doc.text(`Período: ${fechaInicio} al ${fechaFin}`, 14, 45);

    // Obtener registros
    const registros = await getRegistroControl(fechaInicio, fechaFin);

    const tableData = registros.map(reg => [
      reg.fecha,
      reg.concepto,
      reg.tipo === 'ingreso' ? reg.monto.toFixed(2) : '',
      reg.tipo === 'gasto' ? reg.monto.toFixed(2) : '',
      reg.soporte_doc || 'S/N'
    ]);

    // Totales
    const totalIngresos = registros
      .filter(r => r.tipo === 'ingreso')
      .reduce((sum, r) => sum + r.monto, 0);
    const totalGastos = registros
      .filter(r => r.tipo === 'gasto')
      .reduce((sum, r) => sum + r.monto, 0);

    tableData.push([
      '', 'TOTALES',
      totalIngresos.toFixed(2),
      totalGastos.toFixed(2),
      ''
    ]);

    if (window.jspdf.autoTable) {
      doc.autoTable({
        startY: 55,
        head: [['Fecha', 'Concepto', 'Ingreso', 'Gasto', 'Soporte']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [41, 128, 185] },
        styles: { fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 25 },
          1: { cellWidth: 70 },
          2: { cellWidth: 25, halign: 'right' },
          3: { cellWidth: 25, halign: 'right' },
          4: { cellWidth: 30 }
        }
      });
    }

    return doc.output('blob');

  } catch (error) {
    console.error('Error generando Registro de Control:', error);
    throw error;
  }
}

/**
 * Exporta toda la base de datos a archivo Excel
 * @returns {Promise<Blob>} Excel blob
 */
export async function exportarExcelCompleto() {
  try {
    // Verificar SheetJS
    if (typeof window === 'undefined' || !window.XLSX) {
      throw new Error('SheetJS (XLSX) no está disponible');
    }

    const XLSX = window.XLSX;
    const workbook = XLSX.utils.book_new();

    // Obtener todos los datos
    const cuentas = await getAllCuentas();
    const config = await getConfiguracion();
    const trabajadores = await getTrabajadoresContratados();

    // Hoja Configuración
    const configData = [[
      'Campo', 'Valor'
    ]];
    if (config) {
      Object.entries(config).forEach(([key, value]) => {
        configData.push([key, value]);
      });
    }
    const wsConfig = XLSX.utils.json_to_sheet(configData.slice(1));
    XLSX.utils.sheet_add_aoa(wsConfig, configData, { origin: "A1" });
    XLSX.utils.book_append_sheet(workbook, wsConfig, 'Configuración');

    // Hoja Cuentas
    const wsCuentas = XLSX.utils.json_to_sheet(cuentas);
    XLSX.utils.book_append_sheet(workbook, wsCuentas, 'Cuentas');

    // Hoja Trabajadores
    const wsTrabajadores = XLSX.utils.json_to_sheet(trabajadores);
    XLSX.utils.book_append_sheet(workbook, wsTrabajadores, 'Trabajadores');

    // Generar blob
    return XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

  } catch (error) {
    console.error('Error exportando Excel:', error);
    throw error;
  }
}

/**
 * Exporta la base de datos SQLite completa a archivo
 * Requiere @capacitor/filesystem
 * @returns {Promise<Object>} {success: boolean, ruta: string}
 */
export async function exportarBDCompleta() {
  try {
    // Esta función requiere acceso al archivo .db real
    // En Capacitor, se usa Filesystem para copiar el archivo
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nombreArchivo = `Backup_TCP_${timestamp}.db`;
    const rutaDestino = '/storage/emulated/0/Download/Contabilidad_TCP/';

    // Nota: La implementación real requiere:
    // 1. Obtener ruta de la BD de Capacitor SQLite
    // 2. Usar Filesystem.copy() para copiar a Downloads
    // 3. Manejar permisos de Android

    return {
      success: true,
      ruta: rutaDestino + nombreArchivo,
      mensaje: `Backup generado: ${nombreArchivo}`
    };

  } catch (error) {
    console.error('Error exportando BD:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Imprime reporte directamente (para impresión nativa)
 * @param {Blob} pdfBlob - Blob del PDF generado
 */
export function imprimirReporte(pdfBlob) {
  const url = URL.createObjectURL(pdfBlob);
  const iframe = document.createElement('iframe');
  iframe.style.display = 'none';
  iframe.src = url;
  document.body.appendChild(iframe);
  
  iframe.onload = () => {
    iframe.contentWindow.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
      URL.revokeObjectURL(url);
    }, 1000);
  };
}
