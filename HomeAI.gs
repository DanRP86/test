/*********************************************
 * HomeAI.gs
 * Lógica de negocio + /help + lectores
 *********************************************/
const IAHome = (function () {
  const TIMEZONE = Session.getScriptTimeZone();
  const DATE_FMT = 'yyyy-MM-dd';

  /** --------- Utilidades --------- */
  function fmtDateISO(date) { return Utilities.formatDate(date, TIMEZONE, DATE_FMT); }

  /** Date | number(serial Excel) | string(YYYY-MM-DD | DD/MM/YYYY) -> Date */
  function toDate(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'number') {
      const base = new Date(Date.UTC(1899, 11, 30)); // 1899-12-30
      return new Date(base.getTime() + value * 86400000);
    }
    if (typeof value === 'string') {
      const s = value.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const [y, m, d] = s.split('-').map(Number);
        return new Date(y, m - 1, d);
      }
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
        const [d, m, y] = s.split('/').map(Number);
        return new Date(y, m - 1, d);
      }
      const parsed = new Date(s);
      if (!isNaN(parsed)) return parsed;
    }
    throw new Error(`toDate(): no se pudo interpretar la fecha: ${value}`);
  }

  function addDays(date, days) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + (days || 0));
    return d;
  }

  function freqToDays(freq) {
    if (!freq) return 7;
    const f = String(freq).toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
    if (f.includes('diario')) return 1;
    if (f.includes('semanal')) return 7;
    const m = f.match(/cada\s+(\d+)\s*d[ií]as/);
    if (m) return Math.max(1, parseInt(m[1], 10));
    if (f.includes('2 veces/semana')) return 3;
    if (f.includes('quincenal')) return 14;
    if (f.includes('mensual')) return 30;
    return 7;
  }

  function nextId(sheetKey, idHeader, prefix, pad) {
    const { sheet, map } = Headers.getSheetAndMap(sheetKey);
    const idCol = map[idHeader];
    const rows = Math.max(0, sheet.getLastRow() - 1);
    if (rows === 0) return `${prefix}${String(1).padStart(pad || 3, '0')}`;
    const values = sheet.getRange(2, idCol, rows, 1).getValues().flat();
    let maxNum = 0;
    const re = new RegExp('^' + prefix + '(\\d+)$', 'i');
    values.forEach(v => {
      const m = String(v || '').match(re);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
    return `${prefix}${String(maxNum + 1).padStart(pad || 3, '0')}`;
  }

  function appendRow(sheetKey, rowObj) {
    const { sheet, map } = Headers.getSheetAndMap(sheetKey);
    const headers = Object.keys(map);
    const row = headers.map(h => (h in rowObj ? rowObj[h] : ''));
    sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
  }

  /** --------- Acciones MVP --------- */

  function addPlant(nombre, tipo, ubicacion, riegoFrecuencia, nombreComp, fechaCompraSiembra) {
    const id = nextId('PLANTAS', 'ID_Planta', 'P', 3);
    const hoy = new Date();
    const fechaCompra = fechaCompraSiembra ? toDate(fechaCompraSiembra) : hoy;
    const dias = freqToDays(riegoFrecuencia);
    const nextRiego = addDays(hoy, dias);
    const estado = String(tipo || '').toLowerCase().includes('decorativa') ? 'Madura' : 'Germinación';

    const row = {
      'ID_Planta': id,
      'Nombre': nombre || '',
      'Nombre_Comp': nombreComp || '',
      'Tipo': tipo || '',
      'Fecha_Compra/Siembra': fmtDateISO(fechaCompra),
      'Ubicación': ubicacion || '',
      'Estado': estado,
      'Riego_Frecuencia': riegoFrecuencia || 'Semanal',
      'Last_Riego': fmtDateISO(hoy),
      'Next_Riego': fmtDateISO(nextRiego),
      'Cosecha': '',
      'Notas': ''
    };
    appendRow('PLANTAS', row);
    return `✅ Planta añadida: ${row['ID_Planta']} - ${row['Nombre']} (próximo riego ${row['Next_Riego']})`;
  }

  function waterPlantByName(nombrePlanta) {
    if (!nombrePlanta) throw new Error('Debes indicar el nombre de la planta');
    const { sheet, map } = Headers.getSheetAndMap('PLANTAS');
    const lastCol = sheet.getLastColumn();
    const rows = Math.max(0, sheet.getLastRow() - 1);
    if (rows === 0) throw new Error('No hay plantas registradas');

    const data = sheet.getRange(2, 1, rows, lastCol).getValues();
    const idxNombre = map['Nombre'] - 1;
    const idxFreq = map['Riego_Frecuencia'] - 1;
    const idxLast = map['Last_Riego'] - 1;
    const idxNext = map['Next_Riego'] - 1;

    const hoyISO = fmtDateISO(new Date());
    let updatedRowIndex = -1;

    for (let r = 0; r < data.length; r++) {
      const row = data[r];
      if (String(row[idxNombre]).trim().toLowerCase() === String(nombrePlanta).trim().toLowerCase()) {
        const dias = freqToDays(row[idxFreq]);
        row[idxLast] = hoyISO;
        row[idxNext] = fmtDateISO(addDays(new Date(), dias));
        data[r] = row;
        updatedRowIndex = r;
        break;
      }
    }
    if (updatedRowIndex === -1) throw new Error(`No encontré la planta "${nombrePlanta}"`);

    sheet.getRange(2, 1, rows, lastCol).setValues(data);
    return `💧 Riego registrado para "${nombrePlanta}". Próximo riego: ${data[updatedRowIndex][idxNext]}`;
  }

  function addRecipeLight(nombre, categoria, tiempoTotal, raciones, dificultad) {
    const id = nextId('RECETAS', 'ID_Receta', 'R', 3);
    const row = {
      'ID_Receta': id,
      'Nombre': nombre || '',
      'Categoría': categoria || '',
      'Dificultad': dificultad || 'Media',
      'Tiempo_Total': tiempoTotal || '',
      'Raciones': raciones || '',
      'Fuente': ''
    };
    appendRow('RECETAS', row);
    return `🍳 Receta añadida: ${row['ID_Receta']} - ${row['Nombre']}`;
  }

  function addShoppingItem(nombreIngrediente, cantidadNecesaria, unidad, prioridad) {
    const id = nextId('LISTA_COMPRA', 'ID_Item', 'LC', 3);
    const row = {
      'ID_Item': id,
      'Nombre_Ingrediente': nombreIngrediente || '',
      'Cantidad_Necesaria': cantidadNecesaria || '',
      'Unidad': unidad || '',
      'Prioridad': prioridad || 'Media',
      'Estado': 'Pendiente',
      'Fecha': fmtDateISO(new Date())
    };
    appendRow('LISTA_COMPRA', row);
    return `🛒 Añadido a compra: ${row['Nombre_Ingrediente']} (${row['Cantidad_Necesaria']} ${row['Unidad']}) [${row['Prioridad']}]`;
  }

  /** --------- Lectores para V2 (estado) --------- */

  function readInventoryIndex() {
    const { sheet, map } = Headers.getSheetAndMap('INVENTARIO');
    const rows = Math.max(0, sheet.getLastRow() - 1);
    if (rows === 0) return [];
    const values = sheet.getRange(2, 1, rows, sheet.getLastColumn()).getValues();
    return values.map(r => ({
      id: r[map['ID'] - 1],
      item: r[map['Item'] - 1],
      cantidad: Number(r[map['Cantidad'] - 1] || 0),
      unidad: r[map['Unidad'] - 1],
      fechaEntradaISO: safeIso_(r[map['Fecha entrada'] - 1]),
      caducaISO: safeIso_(r[map['Caduca'] - 1]),
      categoria: r[map['Categoría'] - 1],
      ubicacion: r[map['Ubicación'] - 1]
    }));
  }

  function readPlantsIndex() {
    const { sheet, map } = Headers.getSheetAndMap('PLANTAS');
    const rows = Math.max(0, sheet.getLastRow() - 1);
    if (rows === 0) return [];
    const values = sheet.getRange(2, 1, rows, sheet.getLastColumn()).getValues();
    return values.map(r => ({
      id: r[map['ID_Planta'] - 1],
      nombre: r[map['Nombre'] - 1],
      tipo: r[map['Tipo'] - 1],
      ubicacion: r[map['Ubicación'] - 1],
      riegoFrecuencia: r[map['Riego_Frecuencia'] - 1],
      nextRiegoISO: safeIso_(r[map['Next_Riego'] - 1])
    }));
  }

  function readRecipesIndex() {
    const { sheet, map } = Headers.getSheetAndMap('RECETAS');
    const rows = Math.max(0, sheet.getLastRow() - 1);
    if (rows === 0) return [];
    const values = sheet.getRange(2, 1, rows, sheet.getLastColumn()).getValues();
    return values.map(r => ({
      id: r[map['ID_Receta'] - 1],
      nombre: r[map['Nombre'] - 1],
      categoria: r[map['Categoría'] - 1],
      tiempoTotal: Number(r[map['Tiempo_Total'] - 1] || 0),
      raciones: Number(r[map['Raciones'] - 1] || 0)
    }));
  }

  function readShoppingList() {
    const { sheet, map } = Headers.getSheetAndMap('LISTA_COMPRA');
    const rows = Math.max(0, sheet.getLastRow() - 1);
    if (rows === 0) return [];
    const values = sheet.getRange(2, 1, rows, sheet.getLastColumn()).getValues();
    return values.map(r => ({
      idItem: r[map['ID_Item'] - 1],
      nombreIngrediente: r[map['Nombre_Ingrediente'] - 1],
      cantidadNecesaria: Number(r[map['Cantidad_Necesaria'] - 1] || 0),
      unidad: r[map['Unidad'] - 1],
      prioridad: r[map['Prioridad'] - 1],
      estado: r[map['Estado'] - 1],
      fechaISO: safeIso_(r[map['Fecha'] - 1])
    }));
  }

  function safeIso_(v) {
    try { return v ? fmtDateISO(toDate(v)) : ''; } catch (_) { return ''; }
  }

  /** --------- Ayuda (HTML) --------- */
  function helpMessage() {
    return (
      '<b>🤖 IA Home — Ayuda (V1 comandos)</b>\n\n' +
      'Usa el separador <code>|</code> en algunos comandos:\n\n' +
      '<b>1) Regar planta</b>\n' +
      '<code>/water NombrePlanta</code>\n' +
      'Ej.: <code>/water Albahaca</code>\n\n' +
      '<b>2) Añadir planta</b>\n' +
      '<code>/addplant Nombre|Tipo|Ubicacion|Frecuencia|[Nombre_Comp]|[Fecha]</code>\n' +
      'Ej.: <code>/addplant Albahaca|Huerto|Semillero|Diario|Ocimum basilicum|2025-08-23</code>\n\n' +
      '<b>3) Añadir receta (ligera)</b>\n' +
      '<code>/addrecipe Nombre|Categoria|TiempoMin|Raciones|[Dificultad]</code>\n' +
      'Ej.: <code>/addrecipe Arroz moruno|Arroz|50|4|Media</code>\n\n' +
      '<b>4) Añadir a compra</b>\n' +
      '<code>/buy Nombre|Cantidad|Unidad|[Prioridad]</code>\n' +
      'Ej.: <code>/buy Pimientos|2|pieza|Alta</code>\n\n' +
      '<b>Notas:</b>\n' +
      '• Frecuencia: <i>Diario</i>, <i>Semanal</i>, <i>Cada X días</i>, <i>Quincenal</i>, <i>Mensual</i>.\n' +
      '• Fecha: <code>YYYY-MM-DD</code>, <code>DD/MM/YYYY</code> o serial de Excel.\n' +
      '• Próxima versión: entenderé texto libre (NLU) y haré varias acciones a la vez.'
    );
  }

  return {
    addPlant, waterPlantByName, addRecipeLight, addShoppingItem,
    readInventoryIndex, readPlantsIndex, readRecipesIndex, readShoppingList,
    // utilidades que quizá quieras usar desde otros módulos
    utils: { fmtDateISO, toDate, addDays, freqToDays, nextId },
    helpMessage
  };
})();
