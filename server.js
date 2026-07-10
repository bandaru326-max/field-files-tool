const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

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
    if (token === DASHBOARD_PASSCODE) {
      req.user = { role: 'admin', id: 'admin', name: 'Administrator' };
      return next();
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
// Serve uploaded files statically for download/preview
app.use('/uploads', express.static(path.join(baseDir, 'uploads')));

// 1. Verify Login Credentials API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  // Check Admin first
  if (username.toLowerCase() === 'admin') {
    if (password === DASHBOARD_PASSCODE) {
      return res.json({ 
        success: true, 
        role: 'admin', 
        id: 'admin', 
        name: 'Administrator',
        token: DASHBOARD_PASSCODE 
      });
    } else {
      return res.status(401).json({ error: 'Invalid admin passcode' });
    }
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
app.get('/api/members', (req, res) => {
  try {
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

// 3. Upload file & metadata (authenticated)
app.post('/api/upload', checkAuth, upload.single('file'), (req, res) => {
  try {
    let { memberId, type, reason, remarks } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // Force Operator to upload ONLY to their own folder
    if (req.user.role === 'operator') {
      memberId = req.user.id;
    }

    if (!memberId) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Member selection is required' });
    }

    // Verify member exists
    const members = JSON.parse(fs.readFileSync(membersPath, 'utf8'));
    const member = members.find(m => m.id === memberId);
    if (!member) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Selected member does not exist' });
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const destName = `${dateStr}-${req.file.filename}`;
    const destPath = path.join(baseDir, 'uploads', memberId, destName);
    
    // Ensure member directory exists
    const memberDir = path.join(baseDir, 'uploads', memberId);
    if (!fs.existsSync(memberDir)) {
      fs.mkdirSync(memberDir, { recursive: true });
    }

    // Move file from temp to member directory
    fs.renameSync(req.file.path, destPath);

    // Save metadata
    let metadata = [];
    if (fs.existsSync(metadataPath)) {
      try {
        metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
      } catch (e) {
        metadata = [];
      }
    }

    const newRecord = {
      id: '_' + Math.random().toString(36).substr(2, 9) + Date.now(),
      memberId,
      memberName: member.name,
      filename: destName,
      originalName: req.file.originalname,
      filePath: `uploads/${memberId}/${destName}`,
      type: type || 'Document Screenshot', // 'PhonePe Screenshot' or 'Document Screenshot'
      reason: reason || 'Not Specified',
      remarks: remarks || '',
      uploadDate: dateStr,
      timestamp: Date.now(),
      size: req.file.size
    };

    metadata.unshift(newRecord); // Add to beginning (newest first)
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    res.status(201).json({ success: true, record: newRecord });
  } catch (err) {
    console.error('Upload error:', err);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'File upload failed: ' + err.message });
  }
});

// 4. Get uploads with search/filters (authenticated)
app.get('/api/uploads', checkAuth, (req, res) => {
  try {
    if (!fs.existsSync(metadataPath)) {
      return res.json([]);
    }
    let metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    // RESTRICTION: If Operator, filter only their own uploads
    if (req.user.role === 'operator') {
      metadata = metadata.filter(r => r.memberId === req.user.id);
    }

    const { search, memberId, startDate, endDate, type, remarks } = req.query;

    // Apply filtering (Only allowed for Admin, or within Operator's restricted set)
    if (memberId && req.user.role === 'admin') {
      metadata = metadata.filter(r => r.memberId === memberId);
    }

    if (type) {
      metadata = metadata.filter(r => r.type === type);
    }

    if (startDate) {
      metadata = metadata.filter(r => r.uploadDate >= startDate);
    }

    if (endDate) {
      metadata = metadata.filter(r => r.uploadDate <= endDate);
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

    res.json(metadata);
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve uploads' });
  }
});

// 5. Delete an upload (restricted to Admin)
app.delete('/api/uploads/:id', checkAuth, (req, res) => {
  try {
    const { id } = req.params;

    // Reject operators trying to delete records
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Operators do not have deletion privileges' });
    }

    if (!fs.existsSync(metadataPath)) {
      return res.status(404).json({ error: 'No uploads found' });
    }
    
    let metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
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
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

    res.json({ success: true, message: 'Record deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete record: ' + err.message });
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
