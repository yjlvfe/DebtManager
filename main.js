const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { initDatabase, getDb, getDbPath } = require('./database');

// Set App User Model ID for Windows taskbar integration (must be called early)
if (process.platform === 'win32') {
  app.setAppUserModelId('com.debtmanager.app');
}

let mainWindow;
let db;

// Helper: Smart focus management - only restore focus when needed (e.g., after modal closes)
let shouldRestoreFocus = false;

function requestFocusRestore() {
  shouldRestoreFocus = true;
}

function restoreFocusIfNeeded() {
  if (shouldRestoreFocus && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.focus();
    mainWindow.focus();
    shouldRestoreFocus = false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'مدير الديون',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
  });

  mainWindow.loadFile('index.html');
}

// ========== IPC Handlers ==========

// --- Clients ---
ipcMain.handle('clients:getAll', () => {
  const stmt = db.prepare(`
    SELECT 
      c.*,
      COALESCE(SUM(CASE WHEN t.direction = 'له' THEN t.converted_amount ELSE 0 END), 0) as total_debt_owed,
      COALESCE(SUM(CASE WHEN t.direction = 'عليه' THEN t.converted_amount ELSE 0 END), 0) as total_debt_to_pay,
      COALESCE(SUM(CASE WHEN t.direction = 'عليه' THEN t.converted_amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN t.direction = 'له' THEN t.converted_amount ELSE 0 END), 0) as net_balance,
      MAX(t.created_at) as last_modified
    FROM clients c
    LEFT JOIN transactions t ON c.id = t.client_id
    GROUP BY c.id
  `);
  return stmt.all();
});

ipcMain.handle('clients:search', (event, searchTerm) => {
  const stmt = db.prepare(`
    SELECT 
      c.*,
      COALESCE(SUM(CASE WHEN t.direction = 'له' THEN t.converted_amount ELSE 0 END), 0) as total_debt_owed,
      COALESCE(SUM(CASE WHEN t.direction = 'عليه' THEN t.converted_amount ELSE 0 END), 0) as total_debt_to_pay,
      COALESCE(SUM(CASE WHEN t.direction = 'عليه' THEN t.converted_amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN t.direction = 'له' THEN t.converted_amount ELSE 0 END), 0) as net_balance,
      MAX(t.created_at) as last_modified
    FROM clients c
    LEFT JOIN transactions t ON c.id = t.client_id
    WHERE c.name LIKE ? OR c.phone LIKE ?
    GROUP BY c.id
  `);
  return stmt.all(`%${searchTerm}%`, `%${searchTerm}%`);
});

ipcMain.handle('clients:getAllSorted', (event, { sortBy, sortDir }) => {
  let orderBy = 'c.name ASC';
  if (sortBy === 'modified') {
    orderBy = `last_modified ${sortDir === 'asc' ? 'ASC' : 'DESC'}`;
  } else if (sortBy === 'net') {
    orderBy = `net_balance ${sortDir === 'asc' ? 'ASC' : 'DESC'}`;
  } else {
    orderBy = `c.name ${sortDir === 'asc' ? 'ASC' : 'DESC'}`;
  }
  const stmt = db.prepare(`
    SELECT 
      c.*,
      COALESCE(SUM(CASE WHEN t.direction = 'له' THEN t.converted_amount ELSE 0 END), 0) as total_debt_owed,
      COALESCE(SUM(CASE WHEN t.direction = 'عليه' THEN t.converted_amount ELSE 0 END), 0) as total_debt_to_pay,
      COALESCE(SUM(CASE WHEN t.direction = 'عليه' THEN t.converted_amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN t.direction = 'له' THEN t.converted_amount ELSE 0 END), 0) as net_balance,
      MAX(t.created_at) as last_modified
    FROM clients c
    LEFT JOIN transactions t ON c.id = t.client_id
    GROUP BY c.id
    ORDER BY ${orderBy}
  `);
  return stmt.all();
});

ipcMain.handle('dashboard:dayDetails', (event, day) => {
  try {
    const stmt = db.prepare(`
      SELECT c.name, t.direction, SUM(t.converted_amount) as total
      FROM transactions t
      JOIN clients c ON t.client_id = c.id
      WHERE DATE(t.created_at) = ?
      GROUP BY c.id, t.direction
      ORDER BY c.name ASC
    `);
    return stmt.all(day);
  } catch (err) {
    return [];
  }
});

ipcMain.handle('clients:add', (event, { name, phone }) => {
  // Check for existing client with same name
  const existingByName = db.prepare('SELECT id, name, phone FROM clients WHERE name = ?').get(name);
  // Check for existing client with same phone (if phone provided)
  const existingByPhone = phone ? db.prepare('SELECT id, name, phone FROM clients WHERE phone = ?').get(phone) : null;
  
  if (existingByName || existingByPhone) {
    const existing = existingByName || existingByPhone;
    const matchType = existingByName && existingByPhone ? 'both' : (existingByName ? 'name' : 'phone');
    return { 
      duplicate: true, 
      matchType,
      existingClient: existing 
    };
  }
  
  const stmt = db.prepare('INSERT INTO clients (name, phone) VALUES (?, ?)');
  const result = stmt.run(name, phone || null);
  return { id: result.lastInsertRowid };
});

ipcMain.handle('clients:delete', (event, id) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  return { success: true };
});

ipcMain.handle('clients:update', (event, { id, name, phone }) => {
  try {
    db.prepare('UPDATE clients SET name = ?, phone = ? WHERE id = ?').run(name, phone || null, id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('clients:getById', (event, id) => {
  const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
  // Get total debt info using saved converted_amount
  const debts = db.prepare(`
    SELECT 
      COALESCE(SUM(CASE WHEN direction = 'له' THEN converted_amount ELSE 0 END), 0) as total_owed,
      COALESCE(SUM(CASE WHEN direction = 'عليه' THEN converted_amount ELSE 0 END), 0) as total_to_pay,
      COALESCE(SUM(CASE WHEN direction = 'عليه' THEN converted_amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN direction = 'له' THEN converted_amount ELSE 0 END), 0) as net_balance
    FROM transactions WHERE client_id = ?
  `).get(id);
  return { ...client, ...debts };
});

// --- Transactions ---
ipcMain.handle('transactions:getByClient', (event, clientId) => {
  const stmt = db.prepare(`
    SELECT * FROM transactions 
    WHERE client_id = ? 
    ORDER BY created_at DESC
  `);
  return stmt.all(clientId);
});

ipcMain.handle('transactions:add', (event, { client_id, item_name, amount, currency, direction }) => {
  try {
    // Get exchange rates
    const usdRateSetting = db.prepare("SELECT value FROM settings WHERE key = 'usd_to_yer'").get();
    const sarRateSetting = db.prepare("SELECT value FROM settings WHERE key = 'sar_to_yer'").get();
    const usdRate = parseFloat(usdRateSetting.value);
    const sarRate = parseFloat(sarRateSetting.value);

    let convertedAmount = parseFloat(amount);
    let rateAtTime = 0;
    if (currency === 'USD') {
      rateAtTime = usdRate;
      convertedAmount = amount * usdRate;
    } else if (currency === 'SAR') {
      rateAtTime = sarRate;
      convertedAmount = amount * sarRate;
    } else {
      rateAtTime = 1;
      convertedAmount = amount;
    }

    const stmt = db.prepare(`
      INSERT INTO transactions (client_id, item_name, amount, currency, direction, converted_amount, rate_at_time)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(client_id, item_name, amount, currency, direction, convertedAmount, rateAtTime);
    return { id: result.lastInsertRowid };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('transactions:update', (event, { id, item_name, amount, currency, direction }) => {
  try {
    // Get current exchange rates
    const usdRateSetting = db.prepare("SELECT value FROM settings WHERE key = 'usd_to_yer'").get();
    const sarRateSetting = db.prepare("SELECT value FROM settings WHERE key = 'sar_to_yer'").get();
    const usdRate = parseFloat(usdRateSetting.value);
    const sarRate = parseFloat(sarRateSetting.value);

    let convertedAmount = parseFloat(amount);
    let rateAtTime = 0;
    if (currency === 'USD') {
      rateAtTime = usdRate;
      convertedAmount = amount * usdRate;
    } else if (currency === 'SAR') {
      rateAtTime = sarRate;
      convertedAmount = amount * sarRate;
    } else {
      rateAtTime = 1;
      convertedAmount = amount;
    }

    const stmt = db.prepare(`
      UPDATE transactions 
      SET item_name = ?, amount = ?, currency = ?, direction = ?, converted_amount = ?, rate_at_time = ?
      WHERE id = ?
    `);
    stmt.run(item_name, amount, currency, direction, convertedAmount, rateAtTime, id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('transactions:delete', (event, id) => {
  try {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- Settings ---
ipcMain.handle('settings:getAll', () => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = {};
  rows.forEach(row => { settings[row.key] = row.value; });
  return settings;
});

ipcMain.handle('settings:set', (event, { key, value }) => {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  return { success: true };
});

// --- Dashboard ---
ipcMain.handle('dashboard:summary', () => {
  try {
    // Total in YER for "له" (you give client - negative) using saved converted_amount
    const owedRaw = db.prepare(`
      SELECT 
        COALESCE(SUM(converted_amount), 0) as total_yer,
        COALESCE(SUM(CASE WHEN currency = 'USD' THEN amount ELSE 0 END), 0) as total_usd,
        COALESCE(SUM(CASE WHEN currency = 'SAR' THEN amount ELSE 0 END), 0) as total_sar,
        COALESCE(SUM(CASE WHEN currency = 'YER' THEN amount ELSE 0 END), 0) as total_yer_only
      FROM transactions WHERE direction = 'له'
    `).get();

    // Total in YER for "عليه" (client gives you - positive) using saved converted_amount
    const toPayRaw = db.prepare(`
      SELECT 
        COALESCE(SUM(converted_amount), 0) as total_yer,
        COALESCE(SUM(CASE WHEN currency = 'USD' THEN amount ELSE 0 END), 0) as total_usd,
        COALESCE(SUM(CASE WHEN currency = 'SAR' THEN amount ELSE 0 END), 0) as total_sar,
        COALESCE(SUM(CASE WHEN currency = 'YER' THEN amount ELSE 0 END), 0) as total_yer_only
      FROM transactions WHERE direction = 'عليه'
    `).get();

    const clientCount = db.prepare('SELECT COUNT(*) as count FROM clients').get().count;

    // Last 7 days - daily totals
    const last7Days = db.prepare(`
      SELECT 
        DATE(t.created_at) as day,
        SUM(CASE WHEN t.direction = 'عليه' THEN t.converted_amount ELSE 0 END) -
        SUM(CASE WHEN t.direction = 'له' THEN t.converted_amount ELSE 0 END) as daily_net
      FROM transactions t
      WHERE t.created_at >= datetime('now', '-7 days')
      GROUP BY DATE(t.created_at)
      ORDER BY day ASC
    `).all();
  return {
      owed: owedRaw,
      toPay: toPayRaw,
      net: toPayRaw.total_yer - owedRaw.total_yer,
      clientCount,
      last7: last7Days
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- PDF Export for Client Statement ---
ipcMain.handle('client:exportPdf', async (event, clientId) => {
  try {
    const PDFDocument = require('pdfkit');
    // Register fontkit to support custom TTF fonts
    const fontkit = require('fontkit');
    PDFDocument.fontkit = fontkit;
    const fs = require('fs');
    const path = require('path');
    const { dialog } = require('electron');

    // Get client data
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    if (!client) {
      return { success: false, error: 'العميل غير موجود' };
    }

    // Get transactions
    const transactions = db.prepare(`
      SELECT * FROM transactions
      WHERE client_id = ?
      ORDER BY created_at ASC
    `).all(clientId);

    // Get settings for exchange rates
    const settings = db.prepare('SELECT * FROM settings').all();
    const settingsObj = {};
    settings.forEach(row => { settingsObj[row.key] = row.value; });
    const usdRate = parseFloat(settingsObj.usd_to_yer) || 2500;
    const sarRate = parseFloat(settingsObj.sar_to_yer) || 666;

    // Calculate totals
    let totalOwed = 0; // له - ديون عليك (salary)
    let totalToPay = 0; // عليه - ديون لك (positive)
    const transactionsWithDetails = transactions.map(t => {
      const converted = t.converted_amount || 0;
      if (t.direction === 'له') {
        totalOwed += converted;
      } else {
        totalToPay += converted;
      }
      return {
        ...t,
        currencySymbol: t.currency === 'YER' ? 'ر.ي' : (t.currency === 'SAR' ? 'ر.س' : '$'),
        rateDisplay: t.currency !== 'YER' ? ` (${t.amount} ${t.currency} × ${t.rate_at_time} = ${converted.toLocaleString('en-US', {minimumFractionDigits: 2})} ر.ي)` : ''
      };
    });

    const netBalance = totalToPay - totalOwed;

    // Ask user where to save
    const savePath = await dialog.showSaveDialog(mainWindow, {
      title: 'حفظ كشف الحساب',
      defaultPath: `كشف_حساب_${client.name}_${new Date().toISOString().split('T')[0]}.pdf`,
      filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (savePath.canceled || !savePath.filePath) {
      return { success: false, error: 'تم الإلغاء' };
    }

    // Create PDF with Arabic font support
    const doc = new PDFDocument({
      layout: 'portrait',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });

    // Register Arabic font (Amiri - supports Arabic RTL)
    // Handle both development and packaged (production) modes
    const isPackaged = app.isPackaged;
    let fontPath;
    if (isPackaged) {
      // In packaged app, extraResources are at process.resourcesPath
      fontPath = path.join(process.resourcesPath, 'assets', 'fonts', 'Amiri-Regular.ttf');
    } else {
      // In development
      fontPath = path.join(__dirname, 'assets', 'fonts', 'Amiri-Regular.ttf');
    }
    doc.registerFont('Amiri', fontPath);
    doc.font('Amiri');

    const stream = fs.createWriteStream(savePath.filePath);
    doc.pipe(stream);

    // Helper for formatting numbers
    const formatNum = (num) => {
      return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const formatDate = (dateStr) => {
      const d = new Date(dateStr);
      // Return DD-MM-YYYY format
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      return `${day}-${month}-${year}`;
    };

    // RTL helper - reverse WORD order (not characters) for proper RTL display in PDFKit
    // Amiri font handles Arabic shaping; we just need words to flow right-to-left
    const rtl = (str) => {
      if (!str) return '';
      // Reverse word order so Arabic reads right-to-left
      // Split by spaces, reverse array, join with spaces
      return str.split(' ').reverse().join(' ');
    };

    // ========== PDF CONTENT ==========

    // Header - Company/App name
    doc.fontSize(24).fillColor('#1a1a2e').text(rtl('مدير الديون'), { align: 'center' });
    doc.fontSize(14).fillColor('#6366f1').text(rtl('كشف حساب عميل'), { align: 'center' });
    doc.moveDown(0.5);
    doc.strokeColor('#6366f1').lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(1);

    // Client Info Box
    doc.fontSize(12).fillColor('#1a1a2e');
    doc.font('Amiri').text(rtl('معلومات العميل:'), { align: 'right' });
    doc.fontSize(11);
    doc.text(rtl(`الاسم: ${client.name}`), { align: 'right' });
    if (client.phone) {
      doc.text(rtl(`رقم التلفون: ${client.phone}`), { align: 'right' });
    }
    doc.moveDown(0.5);

    // Table Header
    const tableTop = doc.y;
    const colWidths = { date: 80, item: 100, amount: 70, currency: 50, converted: 80, direction: 70 };
    const colX = { date: 50, item: 130, amount: 230, currency: 300, converted: 350, direction: 430 };

    doc.fontSize(9).fillColor('#ffffff');
    doc.rect(50, tableTop, 495, 25).fill('#6366f1');

    doc.fillColor('#ffffff');
    doc.text(rtl('التاريخ'), colX.date, tableTop + 7, { width: colWidths.date, align: 'center' });
    doc.text(rtl('الصنف'), colX.item, tableTop + 7, { width: colWidths.item, align: 'center' });
    doc.text(rtl('المبلغ'), colX.amount, tableTop + 7, { width: colWidths.amount, align: 'center' });
    doc.text(rtl('العملة'), colX.currency, tableTop + 7, { width: colWidths.currency, align: 'center' });
    doc.text(rtl('باليمني'), colX.converted, tableTop + 7, { width: colWidths.converted, align: 'center' });
    doc.text(rtl('الاتجاه'), colX.direction, tableTop + 7, { width: colWidths.direction, align: 'center' });

    doc.moveDown(1.5);

    // Transactions rows
    doc.fontSize(8.5);
    let rowY = doc.y;
    let rowIndex = 0;

    for (const t of transactionsWithDetails) {
      // Check if we need a new page (estimate row height)
      if (rowY > 680) {
        doc.addPage();
        rowY = 50;
        // Redraw header on new page
        doc.fontSize(9).fillColor('#ffffff');
        doc.rect(50, rowY, 495, 25).fill('#6366f1');
        doc.fillColor('#ffffff');
        doc.text(rtl('التاريخ'), colX.date, rowY + 7, { width: colWidths.date, align: 'center' });
        doc.text(rtl('الصنف'), colX.item, rowY + 7, { width: colWidths.item, align: 'center' });
        doc.text(rtl('المبلغ'), colX.amount, rowY + 7, { width: colWidths.amount, align: 'center' });
        doc.text(rtl('العملة'), colX.currency, rowY + 7, { width: colWidths.currency, align: 'center' });
        doc.text(rtl('باليمني'), colX.converted, rowY + 7, { width: colWidths.converted, align: 'center' });
        doc.text(rtl('الاتجاه'), colX.direction, rowY + 7, { width: colWidths.direction, align: 'center' });
        doc.moveDown(1.5);
        rowY = doc.y;
        doc.fontSize(8.5);
      }

      // Alternate row colors - draw after we know row height
      const rowStartY = rowY;
      
      doc.fillColor(t.direction === 'له' ? '#ef4444' : '#22c55e');
      const directionText = t.direction === 'له' ? 'دين عليك' : 'دين لك';

      doc.fillColor('#1a1a2e');

      // Date
      doc.text(rtl(formatDate(t.created_at)), colX.date, rowY, { width: colWidths.date, align: 'center' });
      
      // Item name - with text wrapping (save y before, check after)
      const itemNameY = rowY;
      doc.text(rtl(t.item_name), colX.item, itemNameY, { width: colWidths.item, align: 'center' });
      const itemNameEndY = doc.y;
      
      // Other columns (single line)
      doc.text(rtl(formatNum(t.amount)), colX.amount, rowY, { width: colWidths.amount, align: 'center' });
      doc.text(rtl(t.currency), colX.currency, rowY, { width: colWidths.currency, align: 'center' });
      doc.text(rtl(formatNum(t.converted_amount) + ' ر.ي'), colX.converted, rowY, { width: colWidths.converted, align: 'center' });
      doc.text(rtl(directionText), colX.direction, rowY, { width: colWidths.direction, align: 'center' });

      // Row height is determined by the tallest cell (usually item name)
      const rowHeight = Math.max(22, itemNameEndY - itemNameY + 4);
      
      // Draw row background after knowing height
      if (rowIndex % 2 === 0) {
        doc.fillColor('#f8fafc').rect(50, rowStartY - 3, 495, rowHeight).fill();
        // Redraw text on top of background (since rect covers text)
        doc.fillColor('#1a1a2e');
        doc.text(rtl(formatDate(t.created_at)), colX.date, rowStartY, { width: colWidths.date, align: 'center' });
        doc.text(rtl(t.item_name), colX.item, itemNameY, { width: colWidths.item, align: 'center' });
        doc.text(rtl(formatNum(t.amount)), colX.amount, rowStartY, { width: colWidths.amount, align: 'center' });
        doc.text(rtl(t.currency), colX.currency, rowStartY, { width: colWidths.currency, align: 'center' });
        doc.text(rtl(formatNum(t.converted_amount) + ' ر.ي'), colX.converted, rowStartY, { width: colWidths.converted, align: 'center' });
        doc.text(rtl(directionText), colX.direction, rowStartY, { width: colWidths.direction, align: 'center' });
      }

      rowY = rowStartY + rowHeight;
      rowIndex++;
    }

    doc.y = rowY + 10;

    // Totals Section - Simplified
    doc.moveDown(1);
    doc.strokeColor('#6366f1').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    doc.fontSize(11).fillColor('#ef4444');
    doc.text(rtl(`له : ${formatNum(totalOwed)} ر.ي`), { align: 'right' });

    doc.fontSize(11).fillColor('#22c55e');
    doc.text(rtl(`عليه : ${formatNum(totalToPay)} ر.ي`), { align: 'right' });

    doc.moveDown(0.5);
    doc.strokeColor('#6366f1').lineWidth(2).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown(0.5);

    const netColor = netBalance >= 0 ? '#22c55e' : '#ef4444';
    // netBalance = totalToPay - totalOwed
    // If positive: they owe us more (عليه) - net is in our favor
    // If negative: we owe them more (له) - net is against us
    const netLabel = netBalance >= 0 ? 'عليه' : 'له';
    doc.fontSize(14).fillColor(netColor);
    doc.text(rtl(`الصافي : ${formatNum(Math.abs(netBalance))} ر.ي - ${netLabel}`), { align: 'right' });

    doc.moveDown(1.5);

    // Finalize
    doc.end();

    // Wait for stream to finish
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    return { success: true, path: savePath.filePath };
  } catch (err) {
    console.error('PDF Export Error:', err);
    return { success: false, error: err.message };
  }
});

// --- Ping (check DB responsiveness) ---
ipcMain.handle('db:ping', () => {
  try {
    db.prepare('SELECT 1').get();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Focus restoration - call when modal closes to restore input focus
ipcMain.handle('window:restoreFocus', () => {
  requestFocusRestore();
  // Restore on next tick to allow modal to fully close first
  setTimeout(restoreFocusIfNeeded, 0);
  return { success: true };
});

// --- Folder Selection ---
ipcMain.handle('dialog:selectFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'ملفات قاعدة البيانات', extensions: ['db'] }]
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// --- Backup ---
function makeBackupTimestamp() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
}

function writeBackupFile(backupDir) {
  // The DB runs in WAL mode: recent commits live in the -wal file, so copying
  // the .db alone can silently lose the latest transactions. Checkpoint first.
  db.pragma('wal_checkpoint(TRUNCATE)');
  const backupFullPath = path.join(backupDir, `debt-backup-${makeBackupTimestamp()}.db`);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  fs.copyFileSync(getDbPath(), backupFullPath);
  return backupFullPath;
}

ipcMain.handle('backup:create', async () => {
  const settings = db.prepare('SELECT * FROM settings').all();
  const settingsObj = {};
  settings.forEach(row => { settingsObj[row.key] = row.value; });
  const backupPath = settingsObj.backup_path;
  if (!backupPath) {
    return { success: false, error: 'لم يتم تعيين مسار النسخ الاحتياطي' };
  }
  try {
    const backupFullPath = writeBackupFile(backupPath);
    return { success: true, path: backupFullPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('backup:restore', (event, filePath) => {
  const dbPath = getDbPath();
  try {
    db.close();
    // Remove stale WAL/SHM files so leftovers from the old DB can't
    // override or corrupt the restored file when it is reopened.
    for (const suffix of ['-wal', '-shm']) {
      try { fs.rmSync(dbPath + suffix, { force: true }); } catch (e) { /* ignore */ }
    }
    fs.copyFileSync(filePath, dbPath);
    db = initDatabase();
    return { success: true };
  } catch (err) {
    // Never leave the app with a closed DB — reopen the current one
    try { db = initDatabase(); } catch (e) { /* DB truly unavailable */ }
    return { success: false, error: err.message };
  }
});

// ========== App Lifecycle ==========
app.whenReady().then(() => {
  db = initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (db) {
    // Auto backup if enabled
    try {
      const autoBackupSetting = db.prepare("SELECT value FROM settings WHERE key = 'auto_backup'").get();
      const backupPathSetting = db.prepare("SELECT value FROM settings WHERE key = 'backup_path'").get();
      if (autoBackupSetting && backupPathSetting && autoBackupSetting.value === 'true' && backupPathSetting.value) {
        writeBackupFile(backupPathSetting.value);
      }
    } catch (e) {
      // Silently fail on auto-backup
    }
    db.close();
  }
});
