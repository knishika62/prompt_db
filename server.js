const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// Configuration
let config = {
  imageFolder: process.env.IMAGE_FOLDER || '/home/knishika/AI/ComfyUI/output',
  dbPath: path.join(__dirname, 'prompt_db.sqlite'),
  host: '0.0.0.0'
};

// Supported image extensions
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

// Initialize database
let db;

function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(config.dbPath, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }

      console.log('Database connected:', config.dbPath);

      // Create tables
      db.serialize(() => {
        // Images table - store file paths instead of blobs
        db.run(`CREATE TABLE IF NOT EXISTS images (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL,
          file_path TEXT NOT NULL UNIQUE,
          relative_path TEXT NOT NULL,
          positive_prompt TEXT,
          negative_prompt TEXT,
          model TEXT,
          seed TEXT,
          steps TEXT,
          cfg TEXT,
          sampler TEXT,
          size TEXT,
          metadata_text TEXT,
          file_size INTEGER,
          folder_id INTEGER,
          file_created_at DATETIME,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Folders table
        db.run(`CREATE TABLE IF NOT EXISTS folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Tags table
        db.run(`CREATE TABLE IF NOT EXISTS image_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          image_id INTEGER NOT NULL,
          tag_name TEXT NOT NULL,
          category TEXT,
          FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        )`);

        // Custom tags
        db.run(`CREATE TABLE IF NOT EXISTS custom_tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT NOT NULL,
          tag_name TEXT NOT NULL,
          UNIQUE(category, tag_name)
        )`);

        // Custom categories
        db.run(`CREATE TABLE IF NOT EXISTS custom_categories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          icon TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Settings table for storing configuration
        db.run(`CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Indices for performance
        db.run(`CREATE INDEX IF NOT EXISTS idx_images_updated ON images(updated_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_images_created ON images(created_at DESC)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_images_folder ON images(folder_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_image_tags_image_id ON image_tags(image_id)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_image_tags_tag_name ON image_tags(tag_name)`);

        // Additional indices for search performance
        db.run(`CREATE INDEX IF NOT EXISTS idx_images_filename ON images(filename)`);
        db.run(`CREATE INDEX IF NOT EXISTS idx_images_model ON images(model)`);

        // Add file_created_at column if it doesn't exist (migration)
        db.all(`PRAGMA table_info(images)`, (err, columns) => {
          if (err) {
            console.error('Error checking table structure:', err);
            resolve();
            return;
          }

          const hasFileCreatedAt = columns.some(col => col.name === 'file_created_at');

          if (!hasFileCreatedAt) {
            console.log('Adding file_created_at column to images table...');
            db.run(`ALTER TABLE images ADD COLUMN file_created_at DATETIME`, (err) => {
              if (err) {
                console.error('Error adding file_created_at column:', err);
              } else {
                console.log('file_created_at column added successfully');
              }

              // Create index after adding column
              db.run(`CREATE INDEX IF NOT EXISTS idx_images_file_created ON images(file_created_at DESC)`, (err) => {
                if (err) {
                  console.error('Error creating file_created_at index:', err);
                }

                console.log('Database tables initialized');

                // Load saved folder path from DB
                db.get('SELECT value FROM settings WHERE key = ?', ['imageFolder'], (err, row) => {
                  if (!err && row) {
                    config.imageFolder = row.value;
                    console.log('Loaded saved folder path:', config.imageFolder);
                  } else {
                    console.log('Using default folder path:', config.imageFolder);
                  }
                  resolve();
                });
              });
            });
          } else {
            // Column already exists, just create index
            db.run(`CREATE INDEX IF NOT EXISTS idx_images_file_created ON images(file_created_at DESC)`);

            console.log('Database tables initialized');

            // Load saved folder path from DB
            db.get('SELECT value FROM settings WHERE key = ?', ['imageFolder'], (err, row) => {
              if (!err && row) {
                config.imageFolder = row.value;
                console.log('Loaded saved folder path:', config.imageFolder);
              } else {
                console.log('Using default folder path:', config.imageFolder);
              }
              resolve();
            });
          }
        });
      });
    });
  });
}

// Full metadata extraction from the original HTML
async function extractText(buffer) {
  const view = new DataView(buffer.buffer || buffer);
  let fullText = "";

  try {
    if (view.getUint32(0) === 0x89504E47) {
      // PNG file - extract text chunks
      let offset = 8;
      while (offset < view.byteLength) {
        if (offset + 4 > view.byteLength) break;
        const len = view.getUint32(offset);
        const type = String.fromCharCode(
          view.getUint8(offset + 4),
          view.getUint8(offset + 5),
          view.getUint8(offset + 6),
          view.getUint8(offset + 7)
        );
        if (offset + 8 + len > view.byteLength) break;
        const data = buffer.slice(offset + 8, offset + 8 + len);

        if (type === 'tEXt' || type === 'iTXt') {
          try {
            fullText += data.toString('utf-8').replace(/\0/g, '') + "\n";
          } catch(e) {
            fullText += data.toString('latin1').replace(/\0/g, '') + "\n";
          }
        }

        offset += len + 12;
        if (type === 'IEND') break;
      }
    } else if (view.getUint32(0) === 0x52494646 || view.getUint16(0) === 0xFFD8) {
      // JPEG or WebP - try UTF-8 decode
      fullText = buffer.toString('utf-8', 0, Math.min(buffer.length, 100000));

      // Also try UTF-16LE for SwarmUI JPEGs
      const utf16Text = buffer.toString('utf16le', 0, Math.min(buffer.length, 100000));
      if (utf16Text.includes('sui_image_params') || utf16Text.includes('prompt')) {
        fullText += '\n' + utf16Text;
      }
    }
  } catch(e) {
    console.warn('Metadata extraction error:', e);
  }

  // Clean up null bytes
  fullText = fullText.replace(/\0/g, '').replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');
  return fullText;
}

function extractJSON(str, startPos = 0) {
  const start = str.indexOf('{', startPos);
  if (start === -1) return null;
  let count = 0, end = -1;
  for (let i = start; i < str.length; i++) {
    if (str[i] === '{') count++;
    else if (str[i] === '}') count--;
    if (count === 0) { end = i; break; }
  }
  if (end !== -1) {
    try {
      return {json: JSON.parse(str.substring(start, end + 1)), end: end + 1};
    } catch(e) {
      return null;
    }
  }
  return null;
}

// ComfyUI parser
function parseComfy(json) {
  let pos = "", neg = "", meta = {model: "?", size: "?", seed: "?", steps: "?", cfg: "?", sampler: "?"};
  let nodes = [];
  let nodeMap = {};

  if (json.nodes && Array.isArray(json.nodes)) {
    nodes = json.nodes.map(n => {
      const node = {
        class_type: n.type || n.data?.class_type || "",
        inputs: n.inputs || n.data?.inputs || {}
      };
      if (n.id !== undefined) nodeMap[n.id] = node;
      return node;
    });
  } else {
    const vals = Object.values(json);
    nodes = vals.filter(n => n && typeof n === 'object' && (n.class_type || n.inputs));
    vals.forEach((n, i) => {
      if (n && typeof n === 'object' && (n.class_type || n.inputs)) {
        const key = Object.keys(json)[i];
        if (key && !isNaN(key)) nodeMap[key] = n;
      }
    });
  }

  const findUpstreamText = (l, d = 0) => {
    if (d > 10 || !l || !Array.isArray(l)) return "";
    let n = null;
    if (typeof l[0] === 'string' || typeof l[0] === 'number') {
      n = json[l[0]] || nodeMap[l[0]];
    } else if (typeof l[0] === 'object') {
      n = l[0];
    }
    if (!n) return "";
    const inputs = n.inputs || {};
    let t = "";

    if (Array.isArray(n.widgets_values) && n.widgets_values.length > 0) {
      t += n.widgets_values[0];
    }
    if (typeof inputs.text === 'string') {
      t += (t ? ", " : "") + inputs.text;
    } else if (Array.isArray(inputs.text)) {
      const r = findUpstreamText(inputs.text, d + 1);
      if (r) t += (t ? ", " : "") + r;
    }

    return t;
  };

  const findUpstreamModel = (l, d = 0) => {
    if (d > 10 || !l || !Array.isArray(l)) return "";
    let n = null;
    if (typeof l[0] === 'string' || typeof l[0] === 'number') {
      n = json[l[0]] || nodeMap[l[0]];
    }
    if (!n) return "";
    const inputs = n.inputs || {};
    if (inputs.ckpt_name) return inputs.ckpt_name;
    if (inputs.unet_name) return inputs.unet_name;
    if (inputs.model) return findUpstreamModel(inputs.model, d + 1);
    return "";
  };

  const samplerTypes = ["KSampler", "KSamplerAdvanced", "SamplerCustom"];
  const ksampler = nodes.find(n => n.class_type && samplerTypes.some(type => n.class_type.includes(type)));

  if (ksampler) {
    const inputs = ksampler.inputs || {};
    meta.seed = inputs.seed || inputs.noise_seed || "?";
    meta.steps = inputs.steps || "?";
    meta.cfg = inputs.cfg || "?";
    meta.sampler = inputs.sampler_name || ksampler.class_type || "?";
    if (inputs.scheduler) meta.sampler += " " + inputs.scheduler;
    if (inputs.positive) pos = findUpstreamText(inputs.positive);
    if (inputs.negative) neg = findUpstreamText(inputs.negative);
    if (inputs.model) meta.model = findUpstreamModel(inputs.model).replace(/\.(safetensors|ckpt)$/, "");
  }

  return {pos, neg, meta};
}

// A1111 parser
function parseA1111(text) {
  let pos = "", neg = "";
  let meta = { model: "?", size: "?", seed: "?", steps: "?", cfg: "?", sampler: "?" };

  text = text.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F]/g, '');

  const negIdx = text.indexOf('Negative prompt:');
  const stepsIdx = text.indexOf('Steps:');

  if (negIdx !== -1 && stepsIdx !== -1 && negIdx < stepsIdx) {
    pos = text.substring(0, negIdx).replace(/parameters\s*/i, "").trim();
    neg = text.substring(negIdx + 'Negative prompt:'.length, stepsIdx).trim();
  } else if (stepsIdx !== -1) {
    pos = text.substring(0, stepsIdx).replace(/parameters\s*/i, "").trim();
  } else if (negIdx !== -1) {
    pos = text.substring(0, negIdx).replace(/parameters\s*/i, "").trim();
    neg = text.substring(negIdx + 'Negative prompt:'.length).trim();
  } else {
    pos = text.trim();
  }

  if (stepsIdx !== -1) {
    const block = text.substring(stepsIdx);

    const getParam = (patterns) => {
      for (const pattern of patterns) {
        const match = block.match(new RegExp(pattern, 'i'));
        if (match && match[1]) return match[1].trim();
      }
      return "?";
    };

    meta.steps = getParam(["Steps:\\s*([0-9]+)", "Steps\\s+([0-9]+)"]);
    meta.sampler = getParam(["Sampler:\\s*([^,\\n]+)", "Sampler\\s+([^,\\n]+)"]);
    meta.cfg = getParam(["CFG\\s+scale:\\s*([0-9.]+)", "CFG\\s*:\\s*([0-9.]+)"]);
    meta.seed = getParam(["Seed:\\s*([0-9]+)", "Seed\\s+([0-9]+)"]);
    meta.size = getParam(["Size:\\s*([0-9xX]+)", "Size\\s+([0-9xX]+)"]);
    meta.model = getParam(["Model:\\s*([^,\\n]+)", "Model\\s+([^,\\n]+)"]);
  }

  return {pos, neg, meta};
}

// SwarmUI parser
function parseSwarmUI(json) {
  let pos = "", neg = "";
  let meta = { model: "?", size: "?", seed: "?", steps: "?", cfg: "?", sampler: "?" };

  const params = json.sui_image_params || {};

  if (params.prompt) pos = params.prompt;
  if (params.negativeprompt) neg = params.negativeprompt;

  if (params.model) {
    meta.model = params.model.replace(/^diffusion_models\//, '').replace(/\.(safetensors|ckpt)$/, '');
  }
  if (params.seed) meta.seed = String(params.seed);
  if (params.steps) meta.steps = String(params.steps);
  if (params.cfgscale) meta.cfg = String(params.cfgscale);
  if (params.sampler) {
    meta.sampler = params.sampler;
    if (params.scheduler) meta.sampler += " " + params.scheduler;
  }
  if (params.width && params.height) {
    meta.size = `${params.width}x${params.height}`;
  }

  return { pos, neg, meta };
}

// Main metadata parser
function parseMetadata(text) {
  let comfyResult = null;

  // Check for SwarmUI format
  if (text.includes('sui_image_params')) {
    let pos = 0;
    while (true) {
      const result = extractJSON(text, pos);
      if (!result) break;
      const json = result.json;
      pos = result.end;
      if (json && json.sui_image_params) {
        const parsed = parseSwarmUI(json);
        if (parsed && (parsed.pos || parsed.meta.model !== "?")) {
          return parsed;
        }
      }
    }
  }

  // Check for ComfyUI format
  if (text.includes('"class_type"') && text.includes('"inputs"')) {
    let pos = 0;
    while (true) {
      const result = extractJSON(text, pos);
      if (!result) break;
      const json = result.json;
      pos = result.end;
      if (json && (json.class_type || json.nodes || Object.values(json).some(v => v && typeof v === 'object' && (v.class_type || v.type)))) {
        const parsed = parseComfy(json);
        if (parsed && (parsed.pos || parsed.meta.model !== "?")) {
          comfyResult = parsed;
          break;
        }
      }
    }
  }

  if (comfyResult) return comfyResult;
  return parseA1111(text);
}

// Scan folder for images and add to database
async function scanAndIndexImages(folderPath) {
  console.log(`[SCAN] Starting scan of folder: ${folderPath}`);

  let addedCount = 0;
  let skippedCount = 0;

  async function scanDir(dirPath) {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) {
          const relativePath = path.relative(folderPath, fullPath);

          // Check if already in database
          const existing = await new Promise((resolve, reject) => {
            db.get('SELECT id FROM images WHERE file_path = ?', [fullPath], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          });

          if (existing) {
            skippedCount++;
            continue;
          }

          try {
            const stats = await fs.stat(fullPath);
            const buffer = await fs.readFile(fullPath);
            const metadataText = await extractText(buffer);
            const parsed = parseMetadata(metadataText);

            // Use file's birthtime (creation time) or mtime (modification time) as fallback
            const fileCreatedAt = stats.birthtime || stats.mtime;
            const fileCreatedAtISO = fileCreatedAt.toISOString().replace('T', ' ').substring(0, 19);

            await new Promise((resolve, reject) => {
              db.run(`INSERT INTO images
                (filename, file_path, relative_path, positive_prompt, negative_prompt,
                 model, seed, steps, cfg, sampler, size, metadata_text, file_size,
                 file_created_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
                [entry.name, fullPath, relativePath, parsed.pos, parsed.neg,
                 parsed.meta.model, parsed.meta.seed, parsed.meta.steps,
                 parsed.meta.cfg, parsed.meta.sampler, parsed.meta.size,
                 metadataText, stats.size, fileCreatedAtISO],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });

            addedCount++;
            if (addedCount % 100 === 0) {
              console.log(`[SCAN] Progress: ${addedCount} images indexed...`);
            }
          } catch (err) {
            console.warn(`Failed to process ${entry.name}:`, err.message);
          }
        }
      }
    }
  }

  await scanDir(folderPath);
  console.log(`[SCAN] Complete: ${addedCount} added, ${skippedCount} skipped`);

  return { addedCount, skippedCount };
}

// API Endpoints

// Initialize database endpoint
app.post('/api/init-db', async (req, res) => {
  try {
    await initDatabase();
    res.json({ success: true, message: 'Database initialized' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all images with pagination
app.get('/api/images', (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 100;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  const modelFilter = req.query.model || ''; // New: model filter
  const sortBy = req.query.sortBy || 'file_created_at';
  const sortOrder = req.query.sortOrder || 'DESC';

  let whereClause = 'WHERE 1=1';
  const params = [];

  // Model filter
  if (modelFilter === '__no_model__') {
    // Special filter for images without model data
    whereClause += ` AND (model IS NULL OR model = '' OR model = '?')`;
  } else if (modelFilter) {
    // Filter by specific model
    whereClause += ` AND model = ?`;
    params.push(modelFilter);
  }

  if (search) {
    // Parse search query: comma-separated = OR, space-separated = AND
    if (search.includes(',')) {
      // OR search: "cat, dog" = images with "cat" OR "dog"
      const orTerms = search.split(',').map(term => term.trim()).filter(term => term);
      const orConditions = orTerms.map(() =>
        '(positive_prompt LIKE ? OR negative_prompt LIKE ? OR filename LIKE ? OR model LIKE ?)'
      ).join(' OR ');
      whereClause += ` AND (${orConditions})`;
      orTerms.forEach(term => {
        const pattern = `%${term}%`;
        params.push(pattern, pattern, pattern, pattern);
      });
    } else if (search.includes(' ')) {
      // AND search: "cat dog" = images with both "cat" AND "dog"
      const andTerms = search.split(/\s+/).filter(term => term);
      const andConditions = andTerms.map(() =>
        '(positive_prompt LIKE ? OR negative_prompt LIKE ? OR filename LIKE ? OR model LIKE ?)'
      ).join(' AND ');
      whereClause += ` AND (${andConditions})`;
      andTerms.forEach(term => {
        const pattern = `%${term}%`;
        params.push(pattern, pattern, pattern, pattern);
      });
    } else {
      // Single term search
      whereClause += ` AND (positive_prompt LIKE ? OR negative_prompt LIKE ? OR filename LIKE ? OR model LIKE ?)`;
      const searchPattern = `%${search}%`;
      params.push(searchPattern, searchPattern, searchPattern, searchPattern);
    }
  }

  // Build queries
  const query = `SELECT id, filename, file_path, relative_path, positive_prompt, negative_prompt,
                  model, seed, steps, cfg, sampler, size, file_created_at, updated_at
                  FROM images ${whereClause} ORDER BY ${sortBy} ${sortOrder} LIMIT ? OFFSET ?`;
  const countQuery = `SELECT COUNT(*) as total FROM images ${whereClause}`;

  // Execute both queries in parallel
  const countParams = params.slice(); // Copy params for count query
  params.push(limit, offset);

  db.get(countQuery, countParams, (err, countRow) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    // If no results, return empty immediately
    if (countRow.total === 0) {
      return res.json({
        success: true,
        images: [],
        pagination: {
          page,
          limit,
          total: 0,
          totalPages: 0
        }
      });
    }

    db.all(query, params, (err, rows) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      res.json({
        success: true,
        images: rows,
        pagination: {
          page,
          limit,
          total: countRow.total,
          totalPages: Math.ceil(countRow.total / limit)
        }
      });
    });
  });
});

// Get list of all unique models
app.get('/api/models', (req, res) => {
  const sql = `
    SELECT DISTINCT model, COUNT(*) as count
    FROM images
    WHERE model IS NOT NULL AND model != '' AND model != '?'
    GROUP BY model
    ORDER BY count DESC
  `;

  db.all(sql, [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    res.json({
      success: true,
      models: rows
    });
  });
});

// Get single image details
app.get('/api/images/:id', (req, res) => {
  const id = req.params.id;

  db.get('SELECT * FROM images WHERE id = ?', [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    if (!row) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    // Get tags for this image
    db.all('SELECT * FROM image_tags WHERE image_id = ?', [id], (err, tags) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }

      row.tags = tags;
      res.json({ success: true, image: row });
    });
  });
});

// Serve image file by ID
app.get('/api/image/:id', async (req, res) => {
  const id = req.params.id;

  db.get('SELECT file_path FROM images WHERE id = ?', [id], async (err, row) => {
    if (err || !row) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    try {
      await fs.access(row.file_path);
      res.sendFile(row.file_path);
    } catch (error) {
      res.status(404).json({ error: 'Image file not found on disk' });
    }
  });
});

// Serve image file by path (legacy support)
app.get('/api/image-path/*', async (req, res) => {
  try {
    const relativePath = req.params[0];
    const imagePath = path.join(config.imageFolder, relativePath);

    const resolvedPath = path.resolve(imagePath);
    const resolvedBase = path.resolve(config.imageFolder);

    if (!resolvedPath.startsWith(resolvedBase)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.access(imagePath);
    res.sendFile(imagePath);
  } catch (error) {
    res.status(404).json({ error: 'Image not found' });
  }
});

// Scan and index images
app.post('/api/scan', async (req, res) => {
  try {
    const { imageFolder } = req.body;
    let newFolder = imageFolder || config.imageFolder;

    // Verify folder exists
    if (newFolder) {
      await fs.access(newFolder);
    }

    // Check if folder path has changed
    const savedFolder = await new Promise((resolve, reject) => {
      db.get('SELECT value FROM settings WHERE key = ?', ['imageFolder'], (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.value : null);
      });
    });

    const folderChanged = savedFolder && savedFolder !== newFolder;

    if (folderChanged) {
      console.log(`[SCAN] Folder changed from ${savedFolder} to ${newFolder}`);
      console.log(`[SCAN] Clearing all existing data...`);

      // Clear all images
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM images', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Clear all tags
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM image_tags', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      console.log(`[SCAN] Database cleared. Starting fresh scan...`);
    }

    // Save new folder path
    config.imageFolder = newFolder;
    await new Promise((resolve, reject) => {
      db.run(`INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`,
        ['imageFolder', newFolder],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    console.log(`[API] Scan request for folder: ${config.imageFolder}`);
    const result = await scanAndIndexImages(config.imageFolder);

    res.json({
      success: true,
      message: folderChanged
        ? `Folder changed. Database cleared and rescanned: ${result.addedCount} images added`
        : `Scan complete: ${result.addedCount} images added, ${result.skippedCount} skipped`,
      folderChanged,
      ...result
    });
  } catch (error) {
    console.error('[API ERROR] Scan failed:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update - scan for new images only
app.post('/api/update', async (req, res) => {
  try {
    if (!config.imageFolder) {
      return res.status(400).json({
        success: false,
        error: 'No folder has been scanned yet. Please use "Scan Folder" first.'
      });
    }

    // Check if folder still exists
    try {
      await fs.access(config.imageFolder);
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: `Folder not accessible: ${config.imageFolder}`
      });
    }

    console.log(`[API] Update request for folder: ${config.imageFolder}`);
    console.log(`[UPDATE] Scanning for new images only...`);

    const result = await scanAndIndexImages(config.imageFolder);

    res.json({
      success: true,
      message: `Update complete: ${result.addedCount} new images added, ${result.skippedCount} existing images skipped`,
      ...result
    });
  } catch (error) {
    console.error('[API ERROR] Update failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete selected images
app.post('/api/images/delete', async (req, res) => {
  try {
    const { imageIds } = req.body;

    if (!imageIds || !Array.isArray(imageIds) || imageIds.length === 0) {
      return res.status(400).json({ success: false, error: 'No image IDs provided' });
    }

    console.log(`[API] Deleting ${imageIds.length} images`);

    // First, collect all file paths
    const imagesToDelete = [];
    for (const imageId of imageIds) {
      const imageInfo = await new Promise((resolve, reject) => {
        db.get('SELECT id, file_path FROM images WHERE id = ?', [imageId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (imageInfo) {
        imagesToDelete.push(imageInfo);
      }
    }

    // Delete files first (before DB transaction)
    let fileDeletedCount = 0;
    let fileDeleteErrors = [];

    for (const image of imagesToDelete) {
      if (image.file_path) {
        try {
          await fs.unlink(image.file_path);
          fileDeletedCount++;
          console.log(`[DELETE] File deleted: ${image.file_path}`);
        } catch (fileErr) {
          console.warn(`[DELETE WARNING] Could not delete file ${image.file_path}:`, fileErr.message);
          fileDeleteErrors.push({ id: image.id, path: image.file_path, error: fileErr.message });
        }
      }
    }

    // Then delete from database in a single operation
    let deletedCount = 0;
    if (imagesToDelete.length > 0) {
      const placeholders = imagesToDelete.map(() => '?').join(',');
      const ids = imagesToDelete.map(img => img.id);

      await new Promise((resolve, reject) => {
        db.run(`DELETE FROM images WHERE id IN (${placeholders})`, ids, function(err) {
          if (err) {
            console.error(`[DELETE ERROR] Failed to delete images from DB:`, err);
            reject(err);
          } else {
            deletedCount = this.changes;
            resolve();
          }
        });
      });
    }

    console.log(`[DELETE] Successfully deleted ${deletedCount} DB records and ${fileDeletedCount} files`);

    const response = {
      success: true,
      deletedCount,
      fileDeletedCount,
      message: `${deletedCount} image${deletedCount !== 1 ? 's' : ''} deleted from database, ${fileDeletedCount} file${fileDeletedCount !== 1 ? 's' : ''} deleted from disk`
    };

    if (fileDeleteErrors.length > 0) {
      response.fileDeleteErrors = fileDeleteErrors;
      response.warning = `${fileDeleteErrors.length} file${fileDeleteErrors.length !== 1 ? 's' : ''} could not be deleted from disk`;
    }

    res.json(response);

  } catch (error) {
    console.error('[API ERROR] Delete failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reset database - delete all images and tags
app.post('/api/reset', async (req, res) => {
  try {
    console.log(`[API] Database reset requested`);

    // Clear all images
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM images', (err) => {
        if (err) {
          console.error('[RESET ERROR] Failed to delete images:', err);
          reject(err);
        } else {
          console.log('[RESET] Images deleted');
          resolve();
        }
      });
    });

    // Clear all tags
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM image_tags', (err) => {
        if (err) {
          console.error('[RESET ERROR] Failed to delete tags:', err);
          reject(err);
        } else {
          console.log('[RESET] Tags deleted');
          resolve();
        }
      });
    });

    // Vacuum database to reclaim space
    await new Promise((resolve, reject) => {
      db.run('VACUUM', (err) => {
        if (err) {
          console.error('[RESET WARNING] VACUUM failed:', err);
          // Don't reject - VACUUM failure is not critical
        } else {
          console.log('[RESET] Database vacuumed');
        }
        resolve();
      });
    });

    console.log(`[RESET] Database cleared successfully`);

    res.json({
      success: true,
      message: 'Database reset successfully. All images and tags have been deleted.'
    });
  } catch (error) {
    console.error('[API ERROR] Reset failed:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update image
app.put('/api/images/:id', (req, res) => {
  const id = req.params.id;
  const { positive_prompt, negative_prompt, model, seed, steps, cfg, sampler, size } = req.body;

  db.run(`UPDATE images SET
    positive_prompt = ?, negative_prompt = ?, model = ?, seed = ?,
    steps = ?, cfg = ?, sampler = ?, size = ?, updated_at = datetime('now')
    WHERE id = ?`,
    [positive_prompt, negative_prompt, model, seed, steps, cfg, sampler, size, id],
    (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ success: true, message: 'Image updated' });
    }
  );
});

// Delete image
app.delete('/api/images/:id', (req, res) => {
  const id = req.params.id;

  db.run('DELETE FROM images WHERE id = ?', [id], (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json({ success: true, message: 'Image deleted' });
  });
});

// Add tag to image
app.post('/api/images/:id/tags', (req, res) => {
  const id = req.params.id;
  const { tag_name, category } = req.body;

  db.run('INSERT INTO image_tags (image_id, tag_name, category) VALUES (?, ?, ?)',
    [id, tag_name, category],
    (err) => {
      if (err) {
        res.status(500).json({ error: err.message });
        return;
      }
      res.json({ success: true, message: 'Tag added' });
    }
  );
});

// Get server info
app.get('/api/info', (req, res) => {
  const networkInterfaces = require('os').networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }

  res.json({
    port: PORT,
    addresses: addresses,
    urls: addresses.map(addr => `http://${addr}:${PORT}`),
    dbPath: config.dbPath,
    imageFolder: config.imageFolder
  });
});

// ============================================
// MCP (Model Context Protocol) Endpoints
// ============================================

// MCP Tools Definition
const mcpTools = [
  {
    name: 'search_images',
    description: 'Search for AI-generated images by prompt, model, or filename. Supports AND (space-separated) and OR (comma-separated) search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query. Use spaces for AND search (e.g., "cat dog"), commas for OR search (e.g., "cat, dog")',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 10, max: 100)',
          default: 10,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_image_details',
    description: 'Get detailed metadata for a specific image by ID',
    inputSchema: {
      type: 'object',
      properties: {
        image_id: {
          type: 'number',
          description: 'The ID of the image',
        },
      },
      required: ['image_id'],
    },
  },
  {
    name: 'list_recent_images',
    description: 'List the most recently added/updated images',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of images to return (default: 20, max: 100)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'list_models',
    description: 'List all unique AI models found in the database',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'search_by_model',
    description: 'Find images generated with a specific model',
    inputSchema: {
      type: 'object',
      properties: {
        model_name: {
          type: 'string',
          description: 'Name of the AI model (can be partial match)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 20)',
          default: 20,
        },
      },
      required: ['model_name'],
    },
  },
  {
    name: 'get_database_stats',
    description: 'Get statistics about the image database',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// Helper functions for MCP
function queryDBPromise(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function getDBPromise(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

async function handleMCPToolCall(name, args) {
  try {
    switch (name) {
      case 'search_images': {
        const { query, limit = 10 } = args;
        const searchLimit = Math.min(limit, 100);

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (query) {
          if (query.includes(',')) {
            const orTerms = query.split(',').map(term => term.trim()).filter(term => term);
            const orConditions = orTerms.map(() =>
              '(positive_prompt LIKE ? OR negative_prompt LIKE ? OR filename LIKE ? OR model LIKE ?)'
            ).join(' OR ');
            whereClause += ` AND (${orConditions})`;
            orTerms.forEach(term => {
              const pattern = `%${term}%`;
              params.push(pattern, pattern, pattern, pattern);
            });
          } else if (query.includes(' ')) {
            const andTerms = query.split(/\s+/).filter(term => term);
            const andConditions = andTerms.map(() =>
              '(positive_prompt LIKE ? OR negative_prompt LIKE ? OR filename LIKE ? OR model LIKE ?)'
            ).join(' AND ');
            whereClause += ` AND (${andConditions})`;
            andTerms.forEach(term => {
              const pattern = `%${term}%`;
              params.push(pattern, pattern, pattern, pattern);
            });
          } else {
            whereClause += ` AND (positive_prompt LIKE ? OR negative_prompt LIKE ? OR filename LIKE ? OR model LIKE ?)`;
            const pattern = `%${query}%`;
            params.push(pattern, pattern, pattern, pattern);
          }
        }

        params.push(searchLimit);

        const sql = `
          SELECT id, filename, positive_prompt, negative_prompt, model, seed, steps, cfg, sampler, size, file_created_at, updated_at
          FROM images ${whereClause}
          ORDER BY file_created_at DESC
          LIMIT ?
        `;

        const results = await queryDBPromise(sql, params);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: results.length,
                images: results,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_image_details': {
        const { image_id } = args;

        const sql = 'SELECT * FROM images WHERE id = ?';
        const result = await getDBPromise(sql, [image_id]);

        if (!result) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  success: false,
                  error: 'Image not found',
                }),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                image: result,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_recent_images': {
        const { limit = 20 } = args;
        const searchLimit = Math.min(limit, 100);

        const sql = `
          SELECT id, filename, positive_prompt, negative_prompt, model, seed, steps, cfg, sampler, size, file_created_at, updated_at
          FROM images
          ORDER BY file_created_at DESC
          LIMIT ?
        `;

        const results = await queryDBPromise(sql, [searchLimit]);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: results.length,
                images: results,
              }, null, 2),
            },
          ],
        };
      }

      case 'list_models': {
        const sql = `
          SELECT DISTINCT model, COUNT(*) as count
          FROM images
          WHERE model IS NOT NULL AND model != '?'
          GROUP BY model
          ORDER BY count DESC
        `;

        const results = await queryDBPromise(sql);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: results.length,
                models: results,
              }, null, 2),
            },
          ],
        };
      }

      case 'search_by_model': {
        const { model_name, limit = 20 } = args;
        const searchLimit = Math.min(limit, 100);

        const sql = `
          SELECT id, filename, positive_prompt, negative_prompt, model, seed, steps, cfg, sampler, size, file_created_at, updated_at
          FROM images
          WHERE model LIKE ?
          ORDER BY file_created_at DESC
          LIMIT ?
        `;

        const results = await queryDBPromise(sql, [`%${model_name}%`, searchLimit]);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                count: results.length,
                model: model_name,
                images: results,
              }, null, 2),
            },
          ],
        };
      }

      case 'get_database_stats': {
        const totalSql = 'SELECT COUNT(*) as total FROM images';
        const modelsSql = 'SELECT COUNT(DISTINCT model) as models FROM images WHERE model IS NOT NULL AND model != "?"';
        const sizeSql = 'SELECT SUM(file_size) as total_size FROM images';

        const [totalResult, modelsResult, sizeResult] = await Promise.all([
          getDBPromise(totalSql),
          getDBPromise(modelsSql),
          getDBPromise(sizeSql),
        ]);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: true,
                stats: {
                  total_images: totalResult.total,
                  unique_models: modelsResult.models,
                  total_file_size: sizeResult.total_size,
                  total_file_size_mb: Math.round(sizeResult.total_size / 1024 / 1024),
                },
              }, null, 2),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: `Unknown tool: ${name}`,
              }),
            },
          ],
        };
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
      isError: true,
    };
  }
}

// MCP Endpoints
app.get('/mcp/tools', (req, res) => {
  res.json({ tools: mcpTools });
});

app.post('/mcp/call-tool', async (req, res) => {
  const { name, arguments: args } = req.body;

  try {
    const result = await handleMCPToolCall(name, args);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: error.message,
          }),
        },
      ],
      isError: true,
    });
  }
});

// MCP Health check
app.get('/mcp/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'prompt-db-mcp',
    version: '1.0.0',
  });
});

// Serve the main HTML file
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize database and start server
initDatabase().then(() => {
  app.listen(PORT, config.host, () => {
    const networkInterfaces = require('os').networkInterfaces();
    console.log('\n=================================');
    console.log('Prompt DB Server Started!');
    console.log('=================================\n');
    console.log(`Local: http://localhost:${PORT}`);

    for (const name of Object.keys(networkInterfaces)) {
      for (const net of networkInterfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          console.log(`LAN:   http://${net.address}:${PORT}`);
        }
      }
    }

    console.log(`\nDatabase: ${config.dbPath}`);
    console.log(`Image Folder: ${config.imageFolder}`);
    console.log('\nMCP Endpoints:');
    console.log('- GET  /mcp/health       - Health check');
    console.log('- GET  /mcp/tools        - List available tools');
    console.log('- POST /mcp/call-tool    - Call a tool');
    console.log('\nAccess from other devices on the same network using the LAN URL');
    console.log('=================================\n');
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
