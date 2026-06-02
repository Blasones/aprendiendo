/**
 * Módulo de Seguridad y Autenticación
 * Gestión de PIN con hash SHA-256 y bloqueo temporal
 * @module security/auth
 */

import { Preferences } from '@capacitor/preferences';

// Constantes de seguridad
const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 6;
const MAX_INTENTOS = 3;
const BLOQUEO_TIEMPO_MS = 5 * 60 * 1000; // 5 minutos

// Claves para Preferences
const KEYS = {
  PIN_HASH: 'tcp_pin_hash',
  INTENTOS_FALLIDOS: 'tcp_intentos_fallidos',
  TIEMPO_BLOQUEO: 'tcp_tiempo_bloqueo',
  SESION_ACTIVA: 'tcp_sesion_activa',
  TIEMPO_SESION: 'tcp_tiempo_sesion'
};

/**
 * Genera hash SHA-256 de un string
 * Usa Web Crypto API nativa del navegador
 * @param {string} texto - Texto a hashear
 * @returns {Promise<string>} Hash en hexadecimal
 */
async function generarSHA256(texto) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(texto);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  } catch (error) {
    console.error('Error generando SHA-256:', error);
    throw new Error('No se pudo generar el hash de seguridad');
  }
}

/**
 * Inicializa el PIN de acceso por primera vez
 * @param {string} pin - PIN de 4-6 dígitos
 * @returns {Promise<Object>} {success: boolean, message: string}
 */
export async function inicializarPIN(pin) {
  try {
    // Validar formato del PIN
    if (!/^\d+$/.test(pin)) {
      return {
        success: false,
        message: 'El PIN solo debe contener números'
      };
    }

    if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
      return {
        success: false,
        message: `El PIN debe tener entre ${PIN_MIN_LENGTH} y ${PIN_MAX_LENGTH} dígitos`
      };
    }

    // Generar hash SHA-256
    const pinHash = await generarSHA256(pin);

    // Guardar en Preferences
    await Preferences.set({
      key: KEYS.PIN_HASH,
      value: pinHash
    });

    // Resetear contadores
    await Preferences.set({
      key: KEYS.INTENTOS_FALLIDOS,
      value: '0'
    });

    await Preferences.remove({ key: KEYS.TIEMPO_BLOQUEO });

    return {
      success: true,
      message: 'PIN configurado exitosamente'
    };

  } catch (error) {
    console.error('Error en inicializarPIN:', error);
    return {
      success: false,
      message: `Error al configurar PIN: ${error.message}`
    };
  }
}

/**
 * Verifica si el PIN ingresado es correcto
 * Implementa bloqueo tras 3 intentos fallidos
 * @param {string} pinIntentado - PIN a verificar
 * @returns {Promise<Object>} {success: boolean, bloqueado: boolean, message: string}
 */
export async function verificarPIN(pinIntentado) {
  try {
    // Verificar si está bloqueado
    const bloqueoResult = await verificarBloqueo();
    
    if (bloqueoResult.bloqueado) {
      return {
        success: false,
        bloqueado: true,
        tiempoRestante: bloqueoResult.tiempoRestante,
        message: `Demasiados intentos fallidos. Intente en ${Math.ceil(bloqueoResult.tiempoRestante / 60000)} minutos`
      };
    }

    // Obtener PIN hash guardado
    const { value: pinHashGuardado } = await Preferences.get({ key: KEYS.PIN_HASH });

    if (!pinHashGuardado) {
      return {
        success: false,
        mensajeConfiguracion: true,
        message: 'No hay PIN configurado. Debe inicializar la aplicación.'
      };
    }

    // Generar hash del PIN intentado
    const pinHashIntentado = await generarSHA256(pinIntentado);

    // Comparar hashes
    if (pinHashGuardado === pinHashIntentado) {
      // PIN correcto: resetear intentos fallidos
      await Preferences.set({
        key: KEYS.INTENTOS_FALLIDOS,
        value: '0'
      });

      // Registrar sesión activa
      await Preferences.set({
        key: KEYS.SESION_ACTIVA,
        value: 'true'
      });

      await Preferences.set({
        key: KEYS.TIEMPO_SESION,
        value: Date.now().toString()
      });

      return {
        success: true,
        message: 'PIN correcto. Bienvenido.'
      };
    } else {
      // PIN incorrecto: incrementar contador
      const { value: intentosStr } = await Preferences.get({ key: KEYS.INTENTOS_FALLIDOS });
      const intentosFallidos = parseInt(intentosStr || '0') + 1;

      await Preferences.set({
        key: KEYS.INTENTOS_FALLIDOS,
        value: intentosFallidos.toString()
      });

      // Verificar si alcanzó máximo de intentos
      if (intentosFallidos >= MAX_INTENTOS) {
        // Activar bloqueo
        const tiempoBloqueo = Date.now() + BLOQUEO_TIEMPO_MS;
        
        await Preferences.set({
          key: KEYS.TIEMPO_BLOQUEO,
          value: tiempoBloqueo.toString()
        });

        return {
          success: false,
          bloqueado: true,
          tiempoBloqueo: BLOQUEO_TIEMPO_MS,
          message: `Demasiados intentos fallidos. Sistema bloqueado por ${BLOQUEO_TIEMPO_MS / 60000} minutos.`
        };
      }

      return {
        success: false,
        intentosRestantes: MAX_INTENTOS - intentosFallidos,
        message: `PIN incorrecto. Le quedan ${MAX_INTENTOS - intentosFallidos} intento(s).`
      };
    }

  } catch (error) {
    console.error('Error en verificarPIN:', error);
    return {
      success: false,
      message: `Error al verificar PIN: ${error.message}`
    };
  }
}

/**
 * Verifica si el sistema está bloqueado y calcula tiempo restante
 * @returns {Promise<Object>} {bloqueado: boolean, tiempoRestante: number}
 */
async function verificarBloqueo() {
  try {
    const { value: tiempoBloqueoStr } = await Preferences.get({ key: KEYS.TIEMPO_BLOQUEO });

    if (!tiempoBloqueoStr) {
      return { bloqueado: false, tiempoRestante: 0 };
    }

    const tiempoBloqueo = parseInt(tiempoBloqueoStr);
    const ahora = Date.now();
    const tiempoRestante = tiempoBloqueo - ahora;

    if (tiempoRestante <= 0) {
      // El bloqueo expiró, limpiar
      await Preferences.remove({ key: KEYS.TIEMPO_BLOQUEO });
      await Preferences.set({
        key: KEYS.INTENTOS_FALLIDOS,
        value: '0'
      });

      return { bloqueado: false, tiempoRestante: 0 };
    }

    return {
      bloqueado: true,
      tiempoRestante: tiempoRestante
    };

  } catch (error) {
    console.error('Error en verificarBloqueo:', error);
    return { bloqueado: false, tiempoRestante: 0 };
  }
}

/**
 * Cierra la sesión actual
 * Limpia datos temporales de sesión
 * @returns {Promise<Object>} {success: boolean, message: string}
 */
export async function cerrarSesion() {
  try {
    await Preferences.remove({ key: KEYS.SESION_ACTIVA });
    await Preferences.remove({ key: KEYS.TIEMPO_SESION });

    return {
      success: true,
      message: 'Sesión cerrada correctamente'
    };

  } catch (error) {
    console.error('Error en cerrarSesion:', error);
    return {
      success: false,
      message: `Error al cerrar sesión: ${error.message}`
    };
  }
}

/**
 * Verifica si hay una sesión activa válida
 * @returns {Promise<Object>} {activa: boolean, expired: boolean}
 */
export async function verificarSesionActiva() {
  try {
    const { value: sesionActiva } = await Preferences.get({ key: KEYS.SESION_ACTIVA });
    const { value: tiempoSesionStr } = await Preferences.get({ key: KEYS.TIEMPO_SESION });

    if (sesionActiva !== 'true') {
      return { activa: false, expirada: false };
    }

    // Verificar si la sesión expiró (opcional: implementar timeout de sesión)
    // Por ahora, la sesión persiste hasta cerrar manualmente
    return {
      activa: true,
      expirada: false
    };

  } catch (error) {
    console.error('Error en verificarSesionActiva:', error);
    return { activa: false, expirada: false };
  }
}

/**
 * Cambia el PIN actual por uno nuevo
 * Requiere conocer el PIN actual
 * @param {string} pinActual - PIN actual
 * @param {string} pinNuevo - Nuevo PIN
 * @returns {Promise<Object>} {success: boolean, message: string}
 */
export async function cambiarPIN(pinActual, pinNuevo) {
  try {
    // Verificar PIN actual
    const verificacion = await verificarPIN(pinActual);

    if (!verificacion.success) {
      return {
        success: false,
        message: 'PIN actual incorrecto'
      };
    }

    // Establecer nuevo PIN
    const resultado = await inicializarPIN(pinNuevo);

    return resultado;

  } catch (error) {
    console.error('Error en cambiarPIN:', error);
    return {
      success: false,
      message: `Error al cambiar PIN: ${error.message}`
    };
  }
}

/**
 * Restablece el PIN (solo para recuperación de emergencia)
 * En producción, esto debería requerir pregunta de seguridad o backup
 * @param {string} pinNuevo - Nuevo PIN
 * @returns {Promise<Object>} {success: boolean, message: string}
 */
export async function restablecerPIN(pinNuevo) {
  try {
    // Advertencia: Esto borra el PIN anterior sin verificación
    console.warn('ALERTA: Restablecimiento de PIN sin verificación previa');
    
    const resultado = await inicializarPIN(pinNuevo);
    
    return resultado;

  } catch (error) {
    console.error('Error en restablecerPIN:', error);
    return {
      success: false,
      message: `Error al restablecer PIN: ${error.message}`
    };
  }
}

/**
 * Obtiene información del estado de seguridad actual
 * @returns {Promise<Object>} Estado completo de seguridad
 */
export async function obtenerEstadoSeguridad() {
  try {
    const { value: pinHash } = await Preferences.get({ key: KEYS.PIN_HASH });
    const { value: intentosStr } = await Preferences.get({ key: KEYS.INTENTOS_FALLIDOS });
    const bloqueo = await verificarBloqueo();
    const sesion = await verificarSesionActiva();

    return {
      pinConfigurado: !!pinHash,
      intentosFallidos: parseInt(intentosStr || '0'),
      bloqueado: bloqueo.bloqueado,
      tiempoRestanteBloqueo: bloqueo.tiempoRestante,
      sesionActiva: sesion.activa,
      maxIntentos: MAX_INTENTOS,
      tiempoBloqueoMinutos: BLOQUEO_TIEMPO_MS / 60000
    };

  } catch (error) {
    console.error('Error en obtenerEstadoSeguridad:', error);
    return {
      error: error.message
    };
  }
}
