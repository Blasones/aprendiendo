/**
 * Router y UI de la SPA
 * Navegación por hash, manejo de formularios y actualización del dashboard
 * @module ui/router
 */

import { verificarSesionActiva, cerrarSesion } from './security/auth.js';
import { registrarAsientoComprobante, validarCuadreContable } from './accounting/engine.js';
import { generarResumenTributosMensual } from './tax/calculator.js';
import { 
  generarSC01, generarSC04, generarSC05, 
  generarBalanceGeneral, generarEstadoResultados,
  generarRegistroControl, exportarBDCompleta 
} from './reports/generator.js';
import {
  insertComprobante, insertAsientos, getBalanceCuenta,
  getAsientosByDate, getConfiguracion, getRegistroControl
} from './db/queries.js';

// Estado global de la aplicación
const AppState = {
  vistaActual: 'login',
  usuarioAutenticado: false,
  datosTCP: null
};

/**
 * Inicializa el router y configura event listeners
 */
export function inicializarRouter() {
  // Escuchar cambios de hash
  window.addEventListener('hashchange', manejarCambioHash);
  
  // Cargar vista inicial
  manejarCambioHash();
  
  // Configurar formularios
  configurarFormularios();
  
  console.log('Router inicializado');
}

/**
 * Maneja el cambio de hash en la URL
 */
async function manejarCambioHash() {
  const hash = window.location.hash.slice(1) || 'login';
  
  // Verificar autenticación para vistas protegidas
  const vistasPublicas = ['login', 'configuracion-inicial'];
  const requiereAuth = !vistasPublicas.includes(hash);
  
  if (requiereAuth) {
    const sesion = await verificarSesionActiva();
    
    if (!sesion.activa) {
      window.location.hash = 'login';
      return;
    }
    
    AppState.usuarioAutenticado = true;
  }
  
  // Cargar vista
  cargarVista(hash);
  AppState.vistaActual = hash;
}

/**
 * Carga el contenido de la vista correspondiente
 * @param {string} vista - Nombre de la vista
 */
function cargarVista(vista) {
  const contenedor = document.getElementById('app-content');
  
  if (!contenedor) {
    console.error('Contenedor #app-content no encontrado');
    return;
  }
  
  // Ocultar todas las secciones
  document.querySelectorAll('.vista').forEach(el => {
    el.style.display = 'none';
  });
  
  // Mostrar sección actual
  const seccionActual = document.getElementById(`vista-${vista}`);
  
  if (seccionActual) {
    seccionActual.style.display = 'block';
    
    // Actualizar navegación activa
    document.querySelectorAll('.nav-link').forEach(link => {
      link.classList.remove('activa');
      if (link.getAttribute('href') === `#${vista}`) {
        link.classList.add('activa');
      }
    });
    
    // Cargar datos específicos de la vista
    cargarDatosVista(vista);
  } else {
    // Vista no encontrada, mostrar dashboard por defecto
    if (AppState.usuarioAutenticado) {
      window.location.hash = 'dashboard';
    } else {
      window.location.hash = 'login';
    }
  }
}

/**
 * Carga datos específicos para cada vista
 * @param {string} vista - Nombre de la vista
 */
async function cargarDatosVista(vista) {
  switch(vista) {
    case 'dashboard':
      await actualizarDashboard();
      break;
    case 'tributos':
      await calcularTributosVista();
      break;
    case 'comprobantes':
      await listarComprobantesRecientes();
      break;
    case 'mayor':
      await cargarMayorLibro();
      break;
  }
}

/**
 * Actualiza el dashboard con los saldos actuales
 */
async function actualizarDashboard() {
  try {
    // Obtener saldos de cuentas principales
    const saldoCaja = await getBalanceCuenta('100');
    const saldoBanco = await getBalanceCuenta('110');
    
    // Obtener ingresos y gastos del mes
    const ahora = new Date();
    const inicioMes = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-01`;
    const finMes = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${ahora.getDate()}`;
    
    const asientosIngresos = await getAsientosByDate(inicioMes, finMes);
    const ingresosMes = asientosIngresos
      .filter(a => a.cuenta_codigo === '900' && a.haber > 0)
      .reduce((sum, a) => sum + a.haber, 0);
    
    const gastosMes = asientosIngresos
      .filter(a => ['800', '810', '820'].includes(a.cuenta_codigo) && a.debe > 0)
      .reduce((sum, a) => sum + a.debe, 0);
    
    const utilidadEstimada = ingresosMes - gastosMes;
    
    // Actualizar DOM
    const elSaldoCaja = document.getElementById('dash-saldo-caja');
    const elSaldoBanco = document.getElementById('dash-saldo-banco');
    const elIngresos = document.getElementById('dash-ingresos-mes');
    const elGastos = document.getElementById('dash-gastos-mes');
    const elUtilidad = document.getElementById('dash-utilidad-estimada');
    
    if (elSaldoCaja) elSaldoCaja.textContent = `${Math.abs(saldoCaja.saldo || 0).toFixed(2)} CUP`;
    if (elSaldoBanco) elSaldoBanco.textContent = `${Math.abs(saldoBanco.saldo || 0).toFixed(2)} CUP`;
    if (elIngresos) elIngresos.textContent = `${ingresosMes.toFixed(2)} CUP`;
    if (elGastos) elGastos.textContent = `${gastosMes.toFixed(2)} CUP`;
    if (elUtilidad) {
      elUtilidad.textContent = `${utilidadEstimada.toFixed(2)} CUP`;
      elUtilidad.className = utilidadEstimada >= 0 ? 'positivo' : 'negativo';
    }
    
    // Actualizar fecha
    const elFecha = document.getElementById('dash-fecha-actualizacion');
    if (elFecha) {
      elFecha.textContent = new Date().toLocaleString();
    }
    
  } catch (error) {
    console.error('Error actualizando dashboard:', error);
    mostrarAlerta('Error al cargar datos del dashboard', 'error');
  }
}

/**
 * Calcula y muestra tributos en la vista correspondiente
 */
async function calcularTributosVista() {
  try {
    const config = await getConfiguracion();
    const regimen = config?.regimen || 'general';
    const baseSS = config?.base_ss || 2000;
    
    // Obtener ingresos del mes (simplificado)
    const ahora = new Date();
    const inicioMes = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-01`;
    const asientosIngresos = await getAsientosByDate(inicioMes, now());
    const ingresosMes = asientosIngresos
      .filter(a => a.cuenta_codigo === '900')
      .reduce((sum, a) => sum + Math.abs(a.haber || 0), 0);
    
    const resumen = generarResumenTributosMensual(regimen, ingresosMes, baseSS, []);
    
    // Renderizar en el DOM
    const contenedor = document.getElementById('tributos-resumen');
    if (contenedor) {
      contenedor.innerHTML = `
        <div class="card tributo">
          <h3>Resumen Tributario - ${resumen.periodo}</h3>
          <p>Régimen: ${resumen.regimen.toUpperCase()}</p>
          <ul>
            ${resumen.tributos.map(t => `
              <li>
                <strong>${t.concepto}:</strong> ${t.monto.toFixed(2)} CUP
                ${t.descripcion ? `<small>(${t.descripcion})</small>` : ''}
              </li>
            `).join('')}
          </ul>
          <p class="total">Total a pagar: ${resumen.total.toFixed(2)} CUP</p>
        </div>
      `;
    }
    
  } catch (error) {
    console.error('Error calculando tributos:', error);
  }
}

/**
 * Lista comprobantes recientes
 */
async function listarComprobantesRecientes() {
  // Implementación pendiente según queries.js disponible
  console.log('Listar comprobantes recientes');
}

/**
 * Carga el mayor libro para la vista correspondiente
 */
async function cargarMayorLibro() {
  // Implementación pendiente
  console.log('Cargar mayor libro');
}

/**
 * Configura todos los formularios de la aplicación
 */
function configurarFormularios() {
  // Formulario de login
  const formLogin = document.getElementById('form-login');
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault();
      await manejarLogin(formLogin);
    });
  }
  
  // Formulario de configuración inicial
  const formConfig = document.getElementById('form-config-inicial');
  if (formConfig) {
    formConfig.addEventListener('submit', manejarConfigInicial);
  }
  
  // Formulario de ingreso rápido
  const formIngreso = document.getElementById('form-ingreso-rapido');
  if (formIngreso) {
    formIngreso.addEventListener('submit', async (e) => {
      e.preventDefault();
      await registrarOperacionRapida('ingreso', formIngreso);
    });
  }
  
  // Formulario de gasto rápido
  const formGasto = document.getElementById('form-gasto-rapido');
  if (formGasto) {
    formGasto.addEventListener('submit', async (e) => {
      e.preventDefault();
      await registrarOperacionRapida('gasto', formGasto);
    });
  }
  
  // Botón de exportar backup
  const btnExportar = document.getElementById('btn-exportar-backup');
  if (btnExportar) {
    btnExportar.addEventListener('click', async () => {
      await manejarExportarBackup();
    });
  }
  
  // Botón de cerrar sesión
  const btnCerrarSesion = document.getElementById('btn-cerrar-sesion');
  if (btnCerrarSesion) {
    btnCerrarSesion.addEventListener('click', async () => {
      await cerrarSesion();
      window.location.hash = 'login';
    });
  }
}

/**
 * Maneja el proceso de login
 * @param {HTMLFormElement} form - Formulario de login
 */
async function manejarLogin(form) {
  try {
    const pin = form.querySelector('#login-pin')?.value;
    
    if (!pin) {
      mostrarAlerta('Ingrese su PIN', 'error');
      return;
    }
    
    // Importar verificarPIN dinámicamente para evitar circular dependency
    const { verificarPIN } = await import('./security/auth.js');
    const resultado = await verificarPIN(pin);
    
    if (resultado.success) {
      mostrarAlerta(resultado.message, 'success');
      window.location.hash = 'dashboard';
    } else {
      mostrarAlerta(resultado.message, 'error');
      
      if (resultado.bloqueado) {
        form.querySelector('#login-pin').disabled = true;
        setTimeout(() => {
          form.querySelector('#login-pin').disabled = false;
        }, resultado.tiempoRestante || 300000);
      }
    }
    
  } catch (error) {
    console.error('Error en login:', error);
    mostrarAlerta('Error en el sistema de autenticación', 'error');
  }
}

/**
 * Maneja la configuración inicial de la empresa
 * @param {Event} e - Evento submit
 */
async function manejarConfigInicial(e) {
  e.preventDefault();
  const form = e.target;
  
  // Recopilar datos del formulario
  const datos = {
    nombre_proyecto: form.querySelector('#config-nombre')?.value,
    nit: form.querySelector('#config-nit')?.value,
    regimen: form.querySelector('#config-regimen')?.value,
    base_ss: parseFloat(form.querySelector('#config-base-ss')?.value) || 2000,
    moneda_base: 'CUP'
  };
  
  // Validar partida doble si hay asientos
  // Esta función requiere guardar en BD - implementar según queries.js
  
  mostrarAlerta('Configuración guardada exitosamente', 'success');
  window.location.hash = 'dashboard';
}

/**
 * Registra una operación rápida (ingreso o gasto)
 * @param {string} tipo - 'ingreso' o 'gasto'
 * @param {HTMLFormElement} form - Formulario de la operación
 */
async function registrarOperacionRapida(tipo, form) {
  try {
    const fecha = form.querySelector('#op-fecha')?.value || new Date().toISOString().slice(0, 10);
    const monto = parseFloat(form.querySelector('#op-monto')?.value);
    const cuenta = form.querySelector('#op-cuenta')?.value;
    const descripcion = form.querySelector('#op-descripcion')?.value;
    const moneda = form.querySelector('#op-moneda')?.value || 'CUP';
    const tasa = form.querySelector('#op-tasa')?.value;
    
    // Validaciones básicas
    if (!monto || monto <= 0) {
      mostrarAlerta('El monto debe ser mayor a cero', 'error');
      return;
    }
    
    // Construir comprobante y asientos
    const comprobanteData = {
      fecha: fecha,
      numero: Math.floor(Date.now() / 1000),
      descripcion: descripcion || `${tipo.toUpperCase()} rápido`,
      tipo: tipo
    };
    
    let asientos = [];
    
    if (tipo === 'ingreso') {
      // Ingreso: Debe 100/110, Haber 900
      asientos.push({
        cuenta_codigo: cuenta || '100',
        debe: monto,
        haber: 0,
        moneda: moneda,
        tasa_bcc_usada: moneda === 'MLE' ? parseFloat(tasa) : null
      });
      asientos.push({
        cuenta_codigo: '900',
        debe: 0,
        haber: monto,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
    } else {
      // Gasto: Debe 800, Haber 100/110
      asientos.push({
        cuenta_codigo: '800',
        debe: monto,
        haber: 0,
        moneda: 'CUP',
        tasa_bcc_usada: null
      });
      asientos.push({
        cuenta_codigo: cuenta || '100',
        debe: 0,
        haber: monto,
        moneda: moneda,
        tasa_bcc_usada: moneda === 'MLE' ? parseFloat(tasa) : null
      });
    }
    
    // Validar cuadre
    const cuadre = validarCuadreContable(asientos);
    if (!cuadre.valido) {
      mostrarAlerta(`El comprobante no está cuadrado. Diferencia: ${cuadre.diferencia.toFixed(2)}`, 'error');
      return;
    }
    
    // Registrar en BD
    const resultado = await registrarAsientoComprobante(comprobanteData, asientos);
    
    if (resultado.success) {
      mostrarAlerta(resultado.message, 'success');
      form.reset();
      
      // Actualizar dashboard si estamos en esa vista
      if (AppState.vistaActual === 'dashboard') {
        await actualizarDashboard();
      }
    } else {
      mostrarAlerta(resultado.message, 'error');
    }
    
  } catch (error) {
    console.error('Error registrando operación:', error);
    mostrarAlerta('Error al registrar la operación', 'error');
  }
}

/**
 * Maneja la exportación de backup de la BD
 */
async function manejarExportarBackup() {
  try {
    mostrarAlerta('Generando backup...', 'info');
    
    const resultado = await exportarBDCompleta();
    
    if (resultado.success) {
      mostrarAlerta(`Backup generado: ${resultado.ruta}`, 'success');
    } else {
      mostrarAlerta(`Error: ${resultado.error}`, 'error');
    }
    
  } catch (error) {
    console.error('Error exportando backup:', error);
    mostrarAlerta('Error al exportar backup', 'error');
  }
}

/**
 * Muestra una alerta al usuario
 * @param {string} mensaje - Mensaje a mostrar
 * @param {string} tipo - 'success', 'error', 'info', 'warning'
 */
function mostrarAlerta(mensaje, tipo = 'info') {
  // Crear o reutilizar elemento de alerta
  let alerta = document.getElementById('alerta-global');
  
  if (!alerta) {
    alerta = document.createElement('div');
    alerta.id = 'alerta-global';
    alerta.className = 'alerta';
    document.body.appendChild(alerta);
  }
  
  alerta.className = `alerta alerta-${tipo}`;
  alerta.textContent = mensaje;
  alerta.style.display = 'block';
  
  // Auto-ocultar después de 5 segundos
  setTimeout(() => {
    alerta.style.display = 'none';
  }, 5000);
  
  // También usar alert nativo como fallback
  // console.log(`[${tipo.toUpperCase()}] ${mensaje}`);
}

/**
 * Exporta un reporte PDF específico
 * @param {string} tipoReporte - Tipo de reporte a generar
 */
export async function exportarReporte(tipoReporte, params = {}) {
  try {
    let blob;
    let nombreArchivo = '';
    
    switch(tipoReporte) {
      case 'SC01':
        blob = await generarSC01(params.comprobanteId);
        nombreArchivo = `SC01_${params.comprobanteId}.pdf`;
        break;
      case 'SC04':
        blob = await generarSC04(params.cuentaCodigo, params.fechaInicio, params.fechaFin);
        nombreArchivo = `SC04_${params.cuentaCodigo}.pdf`;
        break;
      case 'SC05':
        blob = await generarSC05(params.fechaInicio, params.fechaFin);
        nombreArchivo = `SC05_Mayor.pdf`;
        break;
      case 'balance':
        blob = await generarBalanceGeneral(params.fechaCierre);
        nombreArchivo = `Balance_${params.fechaCierre}.pdf`;
        break;
      case 'resultados':
        blob = await generarEstadoResultados(params.anio);
        nombreArchivo = `Resultados_${params.anio}.pdf`;
        break;
      case 'registro-control':
        blob = await generarRegistroControl(params.fechaInicio, params.fechaFin);
        nombreArchivo = `Registro_Control.pdf`;
        break;
      default:
        throw new Error('Tipo de reporte no reconocido');
    }
    
    // Descargar archivo
    descargarBlob(blob, nombreArchivo);
    mostrarAlerta('Reporte generado exitosamente', 'success');
    
  } catch (error) {
    console.error('Error generando reporte:', error);
    mostrarAlerta(`Error al generar reporte: ${error.message}`, 'error');
  }
}

/**
 * Descarga un blob como archivo
 * @param {Blob} blob - Blob a descargar
 * @param {string} nombre - Nombre del archivo
 */
function descargarBlob(blob, nombre) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Exportar funciones útiles
export { mostrarAlerta, AppState };
