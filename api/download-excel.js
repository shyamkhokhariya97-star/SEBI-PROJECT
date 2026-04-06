const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

function loadJSONFile(filepath) {
  const content = fs.readFileSync(filepath, 'utf8');
  return JSON.parse(content);
}

function getRecordKey(record) {
  if (!record || typeof record !== 'object') return '';
  const registration = record['Registration No.'] || record['Registration No'] || record['RegNo'];
  if (registration && typeof registration === 'string' && registration.trim()) {
    return registration.trim().toLowerCase();
  }
  const name = record['Name'];
  return typeof name === 'string' ? name.trim().toLowerCase() : JSON.stringify(record);
}

function createRecordIndex(records) {
  const index = new Map();
  records.forEach((rec) => {
    const key = getRecordKey(rec);
    if (key && !index.has(key)) {
      index.set(key, rec);
    }
  });
  return index;
}

function resolveDataFile(rootDir, name) {
  const filename = path.basename(String(name || ''));
  if (!filename.toLowerCase().endsWith('.json')) {
    throw new Error('Only .json files are allowed');
  }
  const filepath = path.join(rootDir, filename);
  if (!fs.existsSync(filepath)) {
    throw new Error(`File not found: ${filename}`);
  }
  return { filename, filepath };
}

function normalizeRecords(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  return null;
}

function getAddedRecords(rootDir, oldName, newName) {
  const old = resolveDataFile(rootDir, oldName);
  const neu = resolveDataFile(rootDir, newName);

  const rawOldContent = loadJSONFile(old.filepath);
  const rawNewContent = loadJSONFile(neu.filepath);

  const oldContent = normalizeRecords(rawOldContent);
  const newContent = normalizeRecords(rawNewContent);

  if (!Array.isArray(oldContent) || !Array.isArray(newContent)) {
    throw new Error('Both JSON files must contain either a root array or a top-level "data" array.');
  }

  const oldIndex = createRecordIndex(oldContent);
  const added = [];
  newContent.forEach((record) => {
    const key = getRecordKey(record);
    const oldRecord = oldIndex.get(key);
    if (!oldRecord) added.push(record);
  });

  return { added, oldFile: old.filename, newFile: neu.filename };
}

async function generateExcelBuffer(addedRecords) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Added Records');

  if (!addedRecords || addedRecords.length === 0) {
    return await workbook.xlsx.writeBuffer();
  }

  const allFields = new Set();
  addedRecords.forEach((record) => {
    Object.keys(record || {}).forEach((field) => allFields.add(field));
  });
  const fieldNames = Array.from(allFields).sort();

  worksheet.columns = fieldNames.map((field) => ({
    header: field,
    key: field,
    width: Math.max(field.length, 15)
  }));

  addedRecords.forEach((record) => {
    const rowData = {};
    fieldNames.forEach((field) => {
      rowData[field] = record?.[field] ?? '';
    });
    worksheet.addRow(rowData);
  });

  worksheet.getRow(1).font = { bold: true };
  worksheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE6E6FA' }
  };

  return await workbook.xlsx.writeBuffer();
}

module.exports = async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const oldFile = url.searchParams.get('oldFile');
    const newFile = url.searchParams.get('newFile');
    if (!oldFile || !newFile) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ error: 'oldFile and newFile query parameters are required' }));
      return;
    }

    const rootDir = path.resolve(__dirname, '..');
    const { added, oldFile: oldName, newFile: newName } = getAddedRecords(rootDir, oldFile, newFile);

    const buffer = await generateExcelBuffer(added);
    const filename = `sebi_added_records_${Date.now()}_${oldName}_to_${newName}.xlsx`.replace(/[^\w.\-]+/g, '_');

    res.statusCode = 200;
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(buffer));
  } catch (error) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ error: error?.message || 'Failed to generate Excel' }));
  }
};
