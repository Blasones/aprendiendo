/**
 * Calculadora Fiscal TCP Cuba
 * Implementa Res. 345/2021 para cálculo de tributos
 * @module tax/calculator
 */

/**
 * Calcula el Impuesto sobre Ventas y Servicios (IVS)
 * Según Res. 345/2021: 10% sobre ingresos brutos mensuales
 * @param {number} ingresosMensuales - Total de ingresos del mes en CUP
 * @returns {Object} {monto: number, porcentaje: number, base: number}
 */
export function calcularIVSMensual(ingresosMensuales) {
  const base = parseFloat(ingresosMensuales) || 0;
  const porcentaje = 0.10; // 10%
  const monto = base * porcentaje;

  return {
    monto: parseFloat(monto.toFixed(2)),
    porcentaje: porcentaje * 100,
    base: base,
    descripcion: 'Impuesto sobre Ventas y Servicios (IVS) - 10%'
  };
}

/**
 * Calcula el anticipo mensual del Impuesto sobre Ingresos Personales (IIP)
 * Según Res. 345/2021: 5% sobre ingresos brutos como anticipo
 * @param {number} ingresosMensuales - Total de ingresos del mes en CUP
 * @returns {Object} {monto: number, porcentaje: number, base: number}
 */
export function calcularAnticipoIIPMensual(ingresosMensuales) {
  const base = parseFloat(ingresosMensuales) || 0;
  const porcentaje = 0.05; // 5%
  const monto = base * porcentaje;

  return {
    monto: parseFloat(monto.toFixed(2)),
    porcentaje: porcentaje * 100,
    base: base,
    descripcion: 'Anticipo IIP mensual - 5%'
  };
}

/**
 * Calcula la contribución a la Seguridad Social
 * Según escala de la Res. 345/2021: 20% sobre base seleccionada (2000-9500 CUP)
 * El TCP elige su base de cotización dentro del rango
 * @param {number} baseSeleccionada - Base de cotización elegida (2000-9500 CUP)
 * @returns {Object} {monto: number, porcentaje: number, base: number, valido: boolean}
 */
export function calcularContribucionSS(baseSeleccionada) {
  const base = parseFloat(baseSeleccionada) || 0;
  
  // Validar rango permitido
  const baseMinima = 2000;
  const baseMaxima = 9500;
  
  if (base < baseMinima || base > baseMaxima) {
    return {
      monto: 0,
      porcentaje: 0.20,
      base: base,
      valido: false,
      error: `La base debe estar entre ${baseMinima} y ${baseMaxima} CUP`,
      descripcion: 'Contribución Seguridad Social - 20%'
    };
  }

  const porcentaje = 0.20; // 20%
  const monto = base * porcentaje;

  return {
    monto: parseFloat(monto.toFixed(2)),
    porcentaje: porcentaje * 100,
    base: base,
    valido: true,
    descripcion: 'Contribución Seguridad Social - 20%'
  };
}

/**
 * Calcula la retención de IIP para trabajadores contratados
 * Según escala progresiva Res. 345/2021:
 * - Exento hasta 3260 CUP
 * - 3% sobre exceso de 3260 hasta 9510 CUP
 * - 5% sobre exceso de 9510 CUP
 * @param {number} salarioMensual - Salario mensual del trabajador en CUP
 * @returns {Object} {monto: number, desglose: Object, base: number}
 */
export function calcularRetencionIIPContratado(salarioMensual) {
  const salario = parseFloat(salarioMensual) || 0;
  
  const exento = 3260;
  const tramo1Limite = 9510;
  const tasaTramo1 = 0.03; // 3%
  const tasaTramo2 = 0.05; // 5%

  let retencion = 0;
  const desglose = {
    exento: 0,
    tramo1: 0,
    tramo2: 0
  };

  if (salario <= exento) {
    // No hay retención
    desglose.exento = salario;
    retencion = 0;
  } else if (salario <= tramo1Limite) {
    // Solo primer tramo (3%)
    desglose.exento = exento;
    desglose.tramo1 = salario - exento;
    retencion = desglose.tramo1 * tasaTramo1;
  } else {
    // Ambos tramos
    desglose.exento = exento;
    desglose.tramo1 = tramo1Limite - exento; // 6250 CUP al 3%
    desglose.tramo2 = salario - tramo1Limite;
    retencion = (desglose.tramo1 * tasaTramo1) + (desglose.tramo2 * tasaTramo2);
  }

  return {
    monto: parseFloat(retencion.toFixed(2)),
    salarioBruto: salario,
    salarioNeto: parseFloat((salario - retencion).toFixed(2)),
    desglose: {
      exento: desglose.exento,
      tramo1Base: desglose.tramo1,
      tramo1Tasa: tasaTramo1 * 100,
      tramo2Base: desglose.tramo2,
      tramo2Tasa: tasaTramo2 * 100
    },
    descripcion: 'Retención IIP trabajador contratado (escala progresiva)'
  };
}

/**
 * Calcula el impuesto para régimen simplificado
 * Según Res. 345/2021: 20% sobre (ingreso neto - 3260)
 * Aplica solo si ingreso > 3260 CUP
 * @param {number} ingresoNetoMensual - Ingreso neto del mes en CUP
 * @returns {Object} {monto: number, base: number, aplicable: boolean}
 */
export function calcularRegimenSimplificado(ingresoNetoMensual) {
  const ingreso = parseFloat(ingresoNetoMensual) || 0;
  const deduccion = 3260; // Deducción mínima vital
  const porcentaje = 0.20; // 20%

  if (ingreso <= deduccion) {
    return {
      monto: 0,
      base: 0,
      aplicable: false,
      ingreso: ingreso,
      descripcion: 'No aplica: ingreso por debajo del mínimo exento'
    };
  }

  const baseImponible = ingreso - deduccion;
  const monto = baseImponible * porcentaje;

  return {
    monto: parseFloat(monto.toFixed(2)),
    base: parseFloat(baseImponible.toFixed(2)),
    aplicable: true,
    ingreso: ingreso,
    deduccion: deduccion,
    porcentaje: porcentaje * 100,
    descripcion: 'Régimen simplificado: 20% sobre (ingreso - 3260)'
  };
}

/**
 * Genera resumen completo de tributos mensuales
 * Combina todos los cálculos según el régimen del TCP
 * @param {string} regimen - 'general' o 'simplificado'
 * @param {number} ingresos - Ingresos brutos del mes
 * @param {number} baseSS - Base de cotización a la SS
 * @param {Array} salarioContratados - Array de salarios de trabajadores contratados
 * @returns {Object} Resumen completo de tributos
 */
export function generarResumenTributosMensual(regimen, ingresos, baseSS, salarioContratados = []) {
  const resultado = {
    regimen: regimen,
    periodo: new Date().toISOString().slice(0, 7), // YYYY-MM
    ingresos: parseFloat(ingresos) || 0,
    tributos: [],
    total: 0
  };

  if (regimen === 'general') {
    // IVS: 10%
    const ivs = calcularIVSMensual(ingresos);
    resultado.tributos.push({
      concepto: 'IVS',
      ...ivs
    });

    // Anticipo IIP: 5%
    const anticipoIIP = calcularAnticipoIIPMensual(ingresos);
    resultado.tributos.push({
      concepto: 'Anticipo IIP',
      ...anticipoIIP
    });

    // Seguridad Social: 20%
    const ss = calcularContribucionSS(baseSS);
    if (ss.valido) {
      resultado.tributos.push({
        concepto: 'Seguridad Social',
        ...ss
      });
    } else {
      resultado.error = ss.error;
    }

    // Retenciones a trabajadores contratados
    let totalRetenciones = 0;
    const retencionesDetalle = [];

    salarioContratados.forEach((salario, index) => {
      const retencion = calcularRetencionIIPContratado(salario);
      retencionesDetalle.push({
        trabajador: index + 1,
        ...retencion
      });
      totalRetenciones += retencion.monto;
    });

    if (totalRetenciones > 0) {
      resultado.tributos.push({
        concepto: 'Retenciones IIP Contratados',
        monto: parseFloat(totalRetenciones.toFixed(2)),
        detalle: retencionesDetalle,
        descripcion: 'Suma de retenciones a trabajadores contratados'
      });
    }

  } else if (regimen === 'simplificado') {
    // Régimen simplificado: 20% sobre (ingreso - 3260)
    const impuestoSimplificado = calcularRegimenSimplificado(ingresos);
    resultado.tributos.push({
      concepto: 'Impuesto Simplificado',
      ...impuestoSimplificado
    });

    // Seguridad Social también aplica
    const ss = calcularContribucionSS(baseSS);
    if (ss.valido) {
      resultado.tributos.push({
        concepto: 'Seguridad Social',
        ...ss
      });
    }
  }

  // Calcular total
  resultado.total = parseFloat(resultado.tributos
    .filter(t => t.monto && !t.error)
    .reduce((sum, t) => sum + t.monto, 0).toFixed(2));

  return resultado;
}

/**
 * Calcula el IIP anual con liquidación definitiva
 * Según escala progresiva anual Res. 345/2021
 * @param {number} ingresosAnuales - Total de ingresos del año
 * @param {number} deducciones - Deducciones permitidas (SS, gastos documentados)
 * @returns {Object} {impuestoAnual: number, anticiposPagados: number, saldoFavorContra: number}
 */
export function calcularLiquidacionAnualIIP(ingresosAnuales, deducciones = 0) {
  const ingresoNeto = parseFloat(ingresosAnuales) - parseFloat(deducciones);
  
  // Escala progresiva anual (simplificada, valores referenciales)
  // En producción, usar tabla completa de la resolución
  let impuesto = 0;
  
  if (ingresoNeto <= 0) {
    return {
      ingresoNeto: 0,
      impuestoAnual: 0,
      mensaje: 'Sin ingresos netos gravables'
    };
  }

  // Escala simplificada (ajustar según resolución oficial completa)
  const escalones = [
    { limite: 39120, tasa: 0 },           // Exento anual (3260 × 12)
    { limite: 114120, tasa: 0.03 },       // 3% hasta 9510 × 12
    { limite: Infinity, tasa: 0.05 }      // 5% exceso
  ];

  let restante = ingresoNeto;
  let limiteAnterior = 0;

  for (const escalon of escalones) {
    if (restante <= 0) break;

    const baseEnEscalon = Math.min(restante, escalon.limite - limiteAnterior);
    
    if (baseEnEscalon > 0 && escalon.tasa > 0) {
      impuesto += baseEnEscalon * escalon.tasa;
    }

    restante -= baseEnEscalon;
    limiteAnterior = escalon.limite;
  }

  return {
    ingresoNeto: parseFloat(ingresoNeto.toFixed(2)),
    impuestoAnual: parseFloat(impuesto.toFixed(2)),
    descripcion: 'Liquidación anual IIP (escala progresiva)'
  };
}

/**
 * Valida si un TCP cumple con los límites del régimen simplificado
 * Según Res. 345/2021: máximo 150,000 CUP anuales
 * @param {number} ingresosAnuales - Ingresos anuales proyectados
 * @returns {Object} {apto: boolean, mensaje: string}
 */
export function validarLimiteRegimenSimplificado(ingresosAnuales) {
  const limiteAnual = 150000;
  const ingreso = parseFloat(ingresosAnuales) || 0;

  if (ingreso <= limiteAnual) {
    return {
      apto: true,
      mensaje: `Apto para régimen simplificado (ingresos: ${ingreso.toFixed(2)} CUP ≤ ${limiteAnual} CUP)`
    };
  } else {
    return {
      apto: false,
      mensaje: `Supera límite régimen simplificado. Debe pasar a régimen general (ingresos: ${ingreso.toFixed(2)} CUP > ${limiteAnual} CUP)`
    };
  }
}
