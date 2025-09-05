// Headers.gs

/***************************************************
 * Headers.gs
 * Mapa de pestañas y encabezados de la hoja + helpers
 ***************************************************/
const Headers = (function () {
  /** Claves lógicas -> nombres de pestañas (tal cual en tu Sheets) */
  const SHEETS = {
    PLANTAS: 'Plantas',
    RECETAS: 'Recetas',
    INGREDIENTES_RECETA: 'Ingredientes_Receta',
    PASOS_RECETA: 'Pasos_Receta',
    INVENTARIO: 'Inventario',
    LISTA_COMPRA: 'Lista_Compra',
    TAREAS: 'Tareas',
    DEFAULT_TIME: 'Default_time'
  };

  /** Encabezados esperados (deben coincidir exactamente) */
  const HEADERS = {
    PLANTAS: [
      'ID_Planta','Nombre','Nombre_Comp','Tipo','Fecha_Compra/Siembra',
      'Ubicación','Estado','Riego_Frecuencia','Last_Riego','Next_Riego','Cosecha','Notas'
    ],
    RECETAS: [
      'ID_Receta','Nombre','Categoría','Dificultad','Tiempo_Total','Raciones','Fuente'
    ],
    INGREDIENTES_RECETA: [
      'ID_Ingrediente','Nombre_Ingrediente','Cantidad','Unidad','ID_Receta'
    ],
    PASOS_RECETA: [
      'Paso_Nº','Instrucción','Tiempo','ID_Receta'
    ],
    INVENTARIO: [
      'ID','Item','Cantidad','Unidad','Fecha entrada','Caduca','Categoría','Ubicación','Fecha_Última_Actualización'
    ],
    LISTA_COMPRA: [
      'ID_Item','Nombre_Ingrediente','Cantidad_Necesaria','Unidad','Prioridad','Estado','Fecha'
    ],
    TAREAS: [
      'ID_Tarea','Nombre_Tarea','Categoría','Frecuencia','Última_Realización','Próxima_Realización',
      'Responsable','Notas','Estado','Tiempo_Estimado_min'
    ],
    DEFAULT_TIME: [
      'Item Key','Nombre','Categoria','Frigorifico_dias','Congelador_meses','Next_action','Notas'
    ]
  };

  /** === NUEVO: abrir SIEMPRE por ID, no getActive() === */
  function getSpreadsheet_() {
    const id = PropertiesService.getScriptProperties().getProperty('DB_SHEET_ID');
    if (!id) {
      throw new Error('Falta DB_SHEET_ID en Script Properties. Guarda el ID de tu hoja antes de usar las funciones.');
    }
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error('DB_SHEET_ID inválido o sin permisos. Revisa el ID y el acceso compartido. ID=' + id);
    }
  }

  /** Helpers de acceso/validación (sin cambios salvo getSheet) */
  function getSheetName(key) {
    const k = String(key).toUpperCase();
    const name = SHEETS[k];
    if (!name) throw new Error(`Headers: clave de hoja desconocida "${key}"`);
    return name;
  }

  function getSheet(key) {
    const name = getSheetName(key);
    const ss = getSpreadsheet_();                          // <-- ABRIR POR ID
    const s = ss.getSheetByName(name);
    if (!s) throw new Error(`Headers: no existe la pestaña "${name}" en la hoja con ID ${ss.getId()}`);
    return s;
  }

  /** Lee headers de la fila 1 y construye el mapa header->colIndex (1-based) */
  function getHeadersAndMap(key) {
    const sheet = getSheet(key);
    const lastCol = Math.max(1, sheet.getLastColumn());
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());
    const map = {};
    headers.forEach((h, i) => { map[h] = i + 1; });
    return { sheet, headers, map };
  }

  /** Verifica headers respecto a los esperados; útil para diagnósticos */
  function verifyHeaders(key) {
    const expected = HEADERS[String(key).toUpperCase()] || [];
    const { headers } = getHeadersAndMap(key);
    const missing = expected.filter(h => !headers.includes(h));
    const extra = headers.filter(h => !expected.includes(h));
    return { ok: missing.length === 0, missing, extra, found: headers.slice() };
  }

  /** Devuelve {sheet, map} asegurando que están todos los headers esperados */
  function getSheetAndMap(key) {
    const { sheet, headers, map } = getHeadersAndMap(key);
    const expected = HEADERS[String(key).toUpperCase()] || [];
    const missing = expected.filter(h => !(h in map));
    if (missing.length) {
      throw new Error(
        `Faltan columnas en "${sheet.getName()}": ${missing.join(', ')}.\n` +
        `Encontrados: ${headers.join(' | ')}`
      );
    }
    return { sheet, map };
  }

  return { SHEETS, HEADERS, getSheetName, getSheet, getHeadersAndMap, verifyHeaders, getSheetAndMap };
})();
