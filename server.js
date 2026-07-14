const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_PASSCODE = process.env.DASHBOARD_PASSCODE || 'Praveen';

// Detect if running on Vercel serverless environment
const isVercel = process.env.VERCEL || process.env.NOW_BUILDER;
const baseDir = isVercel ? '/tmp' : __dirname;

// Enable CORS and body parsing
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure required writeable directories exist in baseDir
const dirs = [
  path.join(baseDir, 'uploads'),
  path.join(baseDir, 'uploads/temp'),
  path.join(baseDir, 'data')
];
dirs.forEach(dirPath => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
});

const membersPath = path.join(__dirname, 'data', 'members.json');
const adminsPath = path.join(__dirname, 'data', 'admins.json');
const metadataPath = path.join(baseDir, 'data', 'metadata.json');

// Initialize metadata file in /tmp if not exists (Vercel support)
if (!fs.existsSync(metadataPath)) {
  const committedMetadata = path.join(__dirname, 'data', 'metadata.json');
  if (fs.existsSync(committedMetadata)) {
    fs.copyFileSync(committedMetadata, metadataPath);
  } else {
    fs.writeFileSync(metadataPath, '[]', 'utf8');
  }
}

// Asynchronous, Non-Blocking, Concurrency-Safe Metadata Read/Write helpers
let metadataWriteQueue = Promise.resolve();

async function readMetadataSafe() {
  try {
    if (!fs.existsSync(metadataPath)) return [];
    const content = await fs.promises.readFile(metadataPath, 'utf8');
    return JSON.parse(content);
  } catch (err) {
    console.error('Error reading metadata:', err);
    return [];
  }
}

function writeMetadataSafe(data) {
  metadataWriteQueue = metadataWriteQueue.then(async () => {
    try {
      await fs.promises.writeFile(metadataPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('Error writing metadata:', err);
    }
  });
  return metadataWriteQueue;
}

// Initialize Supabase Client if env variables are available
const supabaseUrl = process.env.SUPABASE_URL ? process.env.SUPABASE_URL.trim() : '';
const supabaseKey = (process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
let isSupabaseConfigured = false;
let supabase = null;

console.log('--- SUPABASE CONFIGURATION DIAGNOSTICS ---');
console.log('process.env.SUPABASE_URL exists:', !!process.env.SUPABASE_URL, process.env.SUPABASE_URL ? `(Length: ${process.env.SUPABASE_URL.length})` : '');
console.log('process.env.SUPABASE_KEY exists:', !!process.env.SUPABASE_KEY);
console.log('process.env.SUPABASE_SERVICE_ROLE_KEY exists:', !!process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('Computed supabaseUrl:', supabaseUrl ? `(starts with: ${supabaseUrl.slice(0, 15)}...)` : 'empty');
console.log('Computed supabaseKey:', supabaseKey ? `(Length: ${supabaseKey.length})` : 'empty');

if (supabaseUrl && supabaseKey) {
  try {
    if (supabaseUrl.startsWith('http://') || supabaseUrl.startsWith('https://')) {
      supabase = createClient(supabaseUrl, supabaseKey);
      isSupabaseConfigured = true;
      console.log('Supabase client successfully initialized.');
    } else {
      console.warn('Supabase URL is not a valid HTTP/HTTPS URL. Falling back to local database.');
    }
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err.message);
    isSupabaseConfigured = false;
    supabase = null;
  }
}

if (!isSupabaseConfigured) {
  console.log('Running in Local Fallback Database Mode.');
}
console.log('------------------------------------------');

// Initialize member folders from members.json on startup
if (fs.existsSync(membersPath)) {
  try {
    const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
    members.forEach(member => {
      const memberDir = path.join(baseDir, 'uploads', member.id);
      if (!fs.existsSync(memberDir)) {
        fs.mkdirSync(memberDir, { recursive: true });
      }
    });
  } catch (err) {
    console.error('Error creating member directories on startup:', err);
  }
}

// Unified Authentication & Session Middleware
const checkAuth = (req, res, next) => {
  const role = req.headers['x-user-role'];
  const userId = req.headers['x-user-id'];
  const token = req.headers['x-auth-token'];

  if (!role || !token) {
    return res.status(401).json({ error: 'Unauthorized: No credentials provided' });
  }

  if (role === 'admin') {
    try {
      if (fs.existsSync(adminsPath)) {
        const admins = JSON.parse(fs.readFileSync(adminsPath, 'utf8'));
        const admin = admins.find(a => a.username.toLowerCase() === userId.toLowerCase() && a.password === token);
        if (admin) {
          req.user = { role: 'admin', id: admin.username, name: admin.name };
          return next();
        }
      }
    } catch (e) {
      return res.status(500).json({ error: 'Database read error' });
    }
  } else if (role === 'operator') {
    try {
      const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
      const member = members.find(m => m.id === userId && m.password === token);
      if (member) {
        req.user = { role: 'operator', id: member.id, name: member.name };
        return next();
      }
    } catch (e) {
      return res.status(500).json({ error: 'Database read error' });
    }
  }
  
  return res.status(401).json({ error: 'Unauthorized: Session expired or invalid passcode' });
};

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Serve uploaded files dynamically (checking local disk first, then falling back to Supabase if configured)
app.get('/uploads/:memberId/:filename', async (req, res) => {
  try {
    const { memberId, filename } = req.params;
    
    // Check if the file exists locally
    const localPath = path.join(baseDir, 'uploads', memberId, filename);
    if (fs.existsSync(localPath)) {
      return res.sendFile(localPath);
    }

    // Fall back to Supabase cloud download if configured
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.storage
        .from('field-files')
        .download(`${memberId}/${filename}`);

      if (error || !data) {
        return res.status(404).send('File not found');
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      res.setHeader('Content-Type', data.type || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      return res.send(buffer);
    }

    res.status(404).send('File not found');
  } catch (err) {
    console.error('Dynamic file preview error:', err);
    res.status(500).send('Internal Server Error');
  }
});

// Diagnostics route to check storage configuration status
app.get('/api/storage-status', (req, res) => {
  res.json({
    supabaseActive: isSupabaseConfigured,
    localFallbackActive: !isSupabaseConfigured,
    message: isSupabaseConfigured 
      ? 'Database & storage are fully running on Supabase Cloud!' 
      : 'Supabase credentials not found in environment. Running in Local Fallback Mode.'
  });
});

app.get('/api/env-debug', (req, res) => {
  res.json({
    supabaseUrlExists: !!process.env.SUPABASE_URL,
    supabaseKeyExists: !!process.env.SUPABASE_KEY,
    supabaseServiceRoleKeyExists: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    isVercelEnv: !!process.env.VERCEL,
    loadedKeys: Object.keys(process.env).filter(k => k.includes('SUPABASE'))
  });
});

// Serve uploaded files statically for fallback/development
app.use('/uploads', express.static(path.join(baseDir, 'uploads')));

// 1. Verify Login Credentials API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Check Admins first
  try {
    if (fs.existsSync(adminsPath)) {
      const admins = JSON.parse(fs.readFileSync(adminsPath, 'utf8'));
      const admin = admins.find(a => a.username.toLowerCase() === username.toLowerCase());
      
      if (admin && admin.password === password) {
        return res.json({ 
          success: true, 
          role: 'admin', 
          id: admin.username, 
          name: admin.name,
          token: admin.password 
        });
      }
    }
  } catch (err) {
    console.error('Failed to read admin database:', err);
  }

  // Check Operators
  try {
    const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
    const member = members.find(m => m.username.toLowerCase() === username.toLowerCase());
    
    if (member && member.password === password) {
      return res.json({
        success: true,
        role: 'operator',
        id: member.id,
        name: member.name,
        token: member.password
      });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read user database' });
  }

  res.status(401).json({ error: 'Invalid username or password' });
});

// Helper to move files across partitions safely (handles cross-device EXDEV error)
function moveFileSafe(oldPath, newPath) {
  try {
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    if (err.code === 'EXDEV' || err.code === 'EACCES') {
      fs.copyFileSync(oldPath, newPath);
      fs.unlinkSync(oldPath);
    } else {
      throw err;
    }
  }
}

// Multer Storage Configuration (Uploads initially to temp, then moved)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const tempDir = path.join(baseDir, 'uploads', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
    cb(null, `${uniqueSuffix}-${cleanName}`);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit per file
});

// API Routes

// 2. Get all members list (useful for dropdowns)
app.get('/api/members', checkAuth, (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Operators do not have access to members list' });
    }

    if (!fs.existsSync(membersPath)) {
      return res.status(404).json({ error: 'Members configuration not found' });
    }
    // Return only names and IDs (exclude passwords/usernames for security)
    const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
    const safeMembers = members.map(m => ({ id: m.id, name: m.name }));
    res.json(safeMembers);
  } catch (err) {
    res.status(500).json({ error: 'Failed to read members list' });
  }
});

// 3. Upload multiple files & metadata (authenticated)
app.post('/api/upload', checkAuth, upload.array('files', 15), async (req, res) => {
  try {
    let { memberId, type, reason, remarks, fileRemarks, uploadDate } = req.body;
    
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Force Operator to upload ONLY to their own folder
    if (req.user.role === 'operator') {
      memberId = req.user.id;
    }

    if (!memberId) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
      return res.status(400).json({ error: 'Member selection is required' });
    }

    // Verify member exists
    const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
    const member = members.find(m => m.id === memberId);
    if (!member) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      });
      return res.status(400).json({ error: 'Selected member does not exist' });
    }

    const dateStr = uploadDate || new Date().toISOString().split('T')[0];
    const newRecords = [];

    // Load current metadata list safely (used for local fallback)
    let metadata = [];
    if (!isSupabaseConfigured) {
      metadata = await readMetadataSafe();
    }

    // Parse individual file remarks (can be string or array)
    let fileRemarksArray = [];
    if (fileRemarks) {
      if (Array.isArray(fileRemarks)) {
        fileRemarksArray = fileRemarks;
      } else {
        fileRemarksArray = [fileRemarks];
      }
    }

    if (isSupabaseConfigured) {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const customRemark = fileRemarksArray[i] || '';
        const destName = `${dateStr}-${file.filename}`;

        // Read local temp file buffer
        const fileBuffer = fs.readFileSync(file.path);

        // Upload to Supabase Storage Bucket
        const { data: storageData, error: storageError } = await supabase.storage
          .from('field-files')
          .upload(`${memberId}/${destName}`, fileBuffer, {
            contentType: file.mimetype,
            duplex: 'half'
          });

        if (storageError) {
          throw new Error('Supabase Storage upload failed: ' + storageError.message);
        }

        const newRecord = {
          id: '_' + Math.random().toString(36).substr(2, 9) + Date.now(),
          memberId,
          memberName: member.name,
          filename: destName,
          originalName: file.originalname,
          filePath: `uploads/${memberId}/${destName}`,
          type: type || 'Document Screenshot',
          reason: reason || 'Not Specified',
          remarks: customRemark,
          batchRemarks: remarks || '',
          uploadDate: dateStr,
          timestamp: Date.now(),
          size: file.size
        };

        // Insert metadata row in Supabase Table
        const { error: dbError } = await supabase
          .from('uploads')
          .insert([newRecord]);

        if (dbError) {
          // Attempt to remove uploaded file from bucket to keep clean
          await supabase.storage.from('field-files').remove([`${memberId}/${destName}`]);
          throw new Error('Supabase Database insertion failed: ' + dbError.message);
        }

        // Delete local temp file immediately
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }

        newRecords.push(newRecord);
      }
    } else {
      for (let i = 0; i < req.files.length; i++) {
        const file = req.files[i];
        const customRemark = fileRemarksArray[i] || '';
        
        const destName = `${dateStr}-${file.filename}`;
        const destPath = path.join(baseDir, 'uploads', memberId, destName);
        
        // Ensure member directory exists
        const memberDir = path.join(baseDir, 'uploads', memberId);
        if (!fs.existsSync(memberDir)) {
          fs.mkdirSync(memberDir, { recursive: true });
        }

        // Move file from temp to member directory safely
        moveFileSafe(file.path, destPath);

        const newRecord = {
          id: '_' + Math.random().toString(36).substr(2, 9) + Date.now(),
          memberId,
          memberName: member.name,
          filename: destName,
          originalName: file.originalname,
          filePath: `uploads/${memberId}/${destName}`,
          type: type || 'Document Screenshot',
          reason: reason || 'Not Specified',
          remarks: customRemark, // Specific File remark
          batchRemarks: remarks || '', // Global Batch remarks
          uploadDate: dateStr,
          timestamp: Date.now(),
          size: file.size
        };

        metadata.unshift(newRecord); // Add to beginning (newest first)
        newRecords.push(newRecord);
      }

      // Write updated metadata safely (serialized queue)
      await writeMetadataSafe(metadata);
    }

    res.status(201).json({ success: true, records: newRecords });
  } catch (err) {
    console.error('Upload error:', err);
    if (req.files) {
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });
    }
    res.status(500).json({ error: 'File upload failed: ' + err.message });
  }
});

// 4. Get uploads with search/filters (authenticated)
app.get('/api/uploads', checkAuth, async (req, res) => {
  try {
    let metadata = [];

    if (isSupabaseConfigured) {
      let query = supabase.from('uploads').select('*');

      // RESTRICTION: If Operator, filter only their own uploads
      if (req.user.role === 'operator') {
        query = query.eq('memberId', req.user.id);
      }

      const { search, memberId, date, remarks } = req.query;

      // Apply filtering (Only allowed for Admin, or within Operator's restricted set)
      if (memberId && req.user.role === 'admin') {
        query = query.eq('memberId', memberId);
      }

      if (date) {
        query = query.eq('uploadDate', date);
      }

      if (remarks) {
        query = query.ilike('remarks', `%${remarks}%`);
      }

      if (search) {
        // Query reason, remarks, originalName, or memberName containing search string
        query = query.or(`reason.ilike.%${search}%,remarks.ilike.%${search}%,originalName.ilike.%${search}%,memberName.ilike.%${search}%`);
      }

      // Order by timestamp descending (newest first)
      query = query.order('timestamp', { ascending: false });

      const { data, error } = await query;
      if (error) throw error;
      metadata = data || [];
    } else {
      metadata = await readMetadataSafe();

      // RESTRICTION: If Operator, filter only their own uploads
      if (req.user.role === 'operator') {
        metadata = metadata.filter(r => r.memberId === req.user.id);
      }

      const { search, memberId, date, remarks } = req.query;

      // Apply filtering (Only allowed for Admin, or within Operator's restricted set)
      if (memberId && req.user.role === 'admin') {
        metadata = metadata.filter(r => r.memberId === memberId);
      }

      if (date) {
        metadata = metadata.filter(r => r.uploadDate === date);
      }

      if (remarks) {
        const rQuery = remarks.toLowerCase();
        metadata = metadata.filter(r => r.remarks.toLowerCase().includes(rQuery));
      }

      if (search) {
        const q = search.toLowerCase();
        metadata = metadata.filter(r => 
          r.reason.toLowerCase().includes(q) || 
          r.remarks.toLowerCase().includes(q) || 
          r.originalName.toLowerCase().includes(q) ||
          r.memberName.toLowerCase().includes(q)
        );
      }
    }

    res.json(metadata);
  } catch (err) {
    console.error('Fetch uploads error:', err);
    res.status(500).json({ error: 'Failed to retrieve uploads' });
  }
});

// 5. Delete an upload (restricted to Admin)
app.delete('/api/uploads/:id', checkAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Reject operators trying to delete records
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Operators do not have deletion privileges' });
    }

    if (isSupabaseConfigured) {
      // Fetch target record first to get filepath details
      const { data: record, error: fetchError } = await supabase
        .from('uploads')
        .select('*')
        .eq('id', id)
        .single();

      if (fetchError || !record) {
        return res.status(404).json({ error: 'Upload record not found' });
      }

      // Delete from storage bucket
      const { error: storageError } = await supabase.storage
        .from('field-files')
        .remove([`${record.memberId}/${record.filename}`]);

      if (storageError) {
        console.error('Supabase storage delete error (proceeding):', storageError);
      }

      // Delete row from database
      const { error: dbError } = await supabase
        .from('uploads')
        .delete()
        .eq('id', id);

      if (dbError) throw dbError;

    } else {
      let metadata = await readMetadataSafe();
      const recordIndex = metadata.findIndex(r => r.id === id);

      if (recordIndex === -1) {
        return res.status(404).json({ error: 'Upload record not found' });
      }

      const record = metadata[recordIndex];
      const fullPath = path.join(baseDir, record.filePath);

      // Delete the file from the filesystem if it exists
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }

      // Remove from metadata list
      metadata.splice(recordIndex, 1);
      await writeMetadataSafe(metadata);
    }

    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (err) {
    console.error('Delete error:', err);
    res.status(500).json({ error: 'Failed to delete record: ' + err.message });
  }
});

// 6. Download file (authenticated via query param or headers)
app.get('/api/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const token = req.query.token;
    const role = req.query.role;
    const userId = req.query.userId;

    // Validate authentication
    if (!role || !token || !userId) {
      return res.status(401).json({ error: 'Unauthorized: Missing download credentials' });
    }

    if (role === 'admin') {
      if (fs.existsSync(adminsPath)) {
        const admins = JSON.parse(fs.readFileSync(adminsPath, 'utf8'));
        const admin = admins.find(a => a.username.toLowerCase() === userId.toLowerCase() && a.password === token);
        if (!admin) return res.status(401).json({ error: 'Unauthorized' });
      } else {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    } else if (role === 'operator') {
      const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
      const member = members.find(m => m.id === userId && m.password === token);
      if (!member) return res.status(401).json({ error: 'Unauthorized' });
    } else {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    let record = null;

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('uploads')
        .select('*')
        .eq('id', id)
        .single();
      
      if (error || !data) {
        return res.status(404).json({ error: 'Record not found' });
      }
      record = data;
    } else {
      const metadata = await readMetadataSafe();
      record = metadata.find(r => r.id === id);
      if (!record) {
        return res.status(404).json({ error: 'Record not found' });
      }
    }

    // Restriction: Operator can only download their own files
    if (role === 'operator' && record.memberId !== userId) {
      return res.status(403).json({ error: 'Forbidden: Access to other user\'s files is denied' });
    }

    if (isSupabaseConfigured) {
      // Download from Supabase bucket and stream to client
      const { data, error } = await supabase.storage
        .from('field-files')
        .download(`${record.memberId}/${record.filename}`);

      if (error || !data) {
        console.error('Supabase download error:', error);
        return res.status(404).json({ error: 'Physical file not found on cloud storage' });
      }

      const buffer = Buffer.from(await data.arrayBuffer());
      res.setHeader('Content-Disposition', `attachment; filename="${record.originalName}"`);
      res.setHeader('Content-Type', data.type || 'application/octet-stream');
      res.send(buffer);
    } else {
      const fullPath = path.join(baseDir, record.filePath);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'Physical file not found on server' });
      }

      // Stream download with correct content disposition
      res.download(fullPath, record.originalName);
    }
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ error: 'Failed to download file' });
  }
});

// Serve frontend HTML pages (SPA Router Fallback)
app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Default server listener
app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Server started successfully on port ${PORT}`);
  console.log(`Portal Web:    http://localhost:${PORT}/upload`);
  console.log(`Dashboard:     http://localhost:${PORT}/dashboard`);
  console.log(`==================================================`);
});
