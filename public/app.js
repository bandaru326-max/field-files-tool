/**
 * Member File Sharing Portal - Client Logic
 * Coordinating uploads, statistics, filters, and modals.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Common Initialization
  loadMembers();

  // Detect Current Page
  const uploadForm = document.getElementById('upload-form');
  const recordsContainer = document.getElementById('records-container');

  if (uploadForm) {
    initUploadPage();
  }

  if (recordsContainer) {
    initDashboardPage();
  }
});

// Dynamic Member Loader
async function loadMembers() {
  try {
    const response = await fetch('/api/members');
    if (!response.ok) throw new Error('Failed to fetch members');
    const members = await response.json();
    
    // Populate Upload Select
    const memberSelect = document.getElementById('member-select');
    if (memberSelect) {
      members.forEach(member => {
        const opt = document.createElement('option');
        opt.value = member.id;
        opt.textContent = member.name;
        memberSelect.appendChild(opt);
      });
    }

    // Populate Dashboard Filter Select
    const filterMember = document.getElementById('filter-member');
    if (filterMember) {
      members.forEach(member => {
        const opt = document.createElement('option');
        opt.value = member.id;
        opt.textContent = member.name;
        filterMember.appendChild(opt);
      });
    }
  } catch (err) {
    console.error('Error loading member names list:', err);
    showAlert('error', 'Error initializing member database. Please check your server connection.');
  }
}

// Global Alert Handler
function showAlert(type, message) {
  const alertBox = document.getElementById('alert-box');
  const alertMessage = document.getElementById('alert-message');
  const alertIcon = document.getElementById('alert-icon');

  if (!alertBox) return;

  alertBox.className = `alert alert-${type}`;
  alertMessage.textContent = message;
  
  if (type === 'success') {
    alertIcon.textContent = '✅';
  } else {
    alertIcon.textContent = '❌';
  }
  
  alertBox.style.display = 'flex';
  
  // Smooth scroll to alert
  alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ----------------------------------------------------
// UPLOAD PAGE IMPLEMENTATION
// ----------------------------------------------------
function initUploadPage() {
  const uploadZone = document.getElementById('upload-zone');
  const fileInput = document.getElementById('file-input');
  const filePreviewBox = document.getElementById('file-preview-box');
  const fileThumb = document.getElementById('file-thumb');
  const fileName = document.getElementById('file-name');
  const fileSize = document.getElementById('file-size');
  const removeFileBtn = document.getElementById('remove-file-btn');
  const uploadForm = document.getElementById('upload-form');
  const submitBtn = document.getElementById('submit-btn');

  // Drag & Drop Listeners
  ['dragenter', 'dragover'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    uploadZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      uploadZone.classList.remove('dragover');
    }, false);
  });

  uploadZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleFileSelected(files[0]);
    }
  });

  // Clicking upload zone trigger file explorer
  uploadZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFileSelected(e.target.files[0]);
    }
  });

  removeFileBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // Avoid triggering uploadZone click
    resetFileSelection();
  });

  function handleFileSelected(file) {
    if (file.size > 10 * 1024 * 1024) {
      showAlert('error', 'File size exceeds the 10MB limit.');
      resetFileSelection();
      return;
    }

    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    
    // Thumbnail Preview if Image
    if (file.type.startsWith('image/')) {
      const fileUrl = URL.createObjectURL(file);
      fileThumb.style.backgroundImage = `url('${fileUrl}')`;
      fileThumb.textContent = '';
      
      // Release memory on unbind
      fileThumb.onload = () => URL.revokeObjectURL(fileUrl);
    } else if (file.type === 'application/pdf') {
      fileThumb.style.backgroundImage = 'none';
      fileThumb.textContent = '📕'; // PDF Emoji
    } else {
      fileThumb.style.backgroundImage = 'none';
      fileThumb.textContent = '📄'; // General file emoji
    }

    uploadZone.style.display = 'none';
    filePreviewBox.style.display = 'flex';
  }

  function resetFileSelection() {
    fileInput.value = '';
    uploadZone.style.display = 'flex';
    filePreviewBox.style.display = 'none';
  }

  // Handle Form Submission
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Check validation
    if (!uploadForm.checkValidity()) return;

    const formData = new FormData(uploadForm);
    
    // Update UI state to loading
    submitBtn.disabled = true;
    const origBtnContent = submitBtn.innerHTML;
    submitBtn.innerHTML = `<span class="spinner" style="border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; width: 18px; height: 18px; display: inline-block; animation: spin 1s linear infinite; margin-right: 0.5rem;"></span> Uploading...`;

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (response.ok) {
        showAlert('success', 'File uploaded and saved under member folder successfully!');
        uploadForm.reset();
        resetFileSelection();
      } else {
        throw new Error(result.error || 'Server rejected file upload');
      }
    } catch (err) {
      showAlert('error', 'Upload failed: ' + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = origBtnContent;
    }
  });
}

// ----------------------------------------------------
// DASHBOARD PAGE IMPLEMENTATION
// ----------------------------------------------------
let currentRecords = [];
let recordToDeleteId = null;

function initDashboardPage() {
  const filterForm = document.getElementById('filter-form');
  const searchInput = document.getElementById('search-input');
  const remarksInput = document.getElementById('remarks-search');
  const filterMember = document.getElementById('filter-member');
  const filterStartDate = document.getElementById('filter-start-date');
  const filterEndDate = document.getElementById('filter-end-date');
  const filterType = document.getElementById('filter-type');
  const downloadFilteredBtn = document.getElementById('download-filtered-btn');

  // Modal Nodes
  const previewModal = document.getElementById('preview-modal');
  const previewModalClose = document.getElementById('preview-modal-close');
  const deleteModal = document.getElementById('delete-modal');
  const deleteModalClose = document.getElementById('delete-modal-close');
  const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
  const cancelDeleteBtn = document.getElementById('cancel-delete-btn');

  // Security Lock Nodes
  const lockScreen = document.getElementById('dashboard-lock-screen');
  const lockForm = document.getElementById('lock-form');
  const lockPasscode = document.getElementById('lock-passcode');
  const lockErrorMsg = document.getElementById('lock-error-msg');
  const lockSubmitBtn = document.getElementById('lock-submit-btn');

  // Check if session passcode is already stored
  const savedPasscode = sessionStorage.getItem('dashboard_passcode');
  if (savedPasscode) {
    lockScreen.classList.add('unlocked');
    fetchUploads();
    setInterval(fetchUploads, 5000);
  } else {
    // Clear loading indicator while locked
    const container = document.getElementById('records-container');
    if (container) container.innerHTML = '';
  }

  // Handle Unlock Submit
  lockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const val = lockPasscode.value;
    
    lockSubmitBtn.disabled = true;
    lockSubmitBtn.textContent = 'Verifying...';
    lockErrorMsg.style.display = 'none';

    try {
      const res = await fetch('/api/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: val })
      });

      const data = await res.json();

      if (res.ok) {
        sessionStorage.setItem('dashboard_passcode', val);
        lockScreen.classList.add('unlocked');
        fetchUploads();
        setInterval(fetchUploads, 5000);
      } else {
        throw new Error(data.error || 'Invalid passcode');
      }
    } catch (err) {
      lockErrorMsg.style.display = 'block';
      const card = lockScreen.querySelector('.lock-card');
      card.classList.add('shake');
      setTimeout(() => card.classList.remove('shake'), 400);
      lockPasscode.value = '';
      lockPasscode.focus();
    } finally {
      lockSubmitBtn.disabled = false;
      lockSubmitBtn.textContent = 'Unlock Dashboard';
    }
  });

  // Search Input Debouncing
  let debounceTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      fetchUploads();
    }, 300);
  });

  remarksInput.addEventListener('input', () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      fetchUploads();
    }, 300);
  });

  // Filter Listeners
  [filterMember, filterStartDate, filterEndDate, filterType].forEach(elem => {
    elem.addEventListener('change', fetchUploads);
  });

  // Download Filtered Action
  downloadFilteredBtn.addEventListener('click', () => {
    const downloadLinks = document.querySelectorAll('.records-grid a[download]');
    if (downloadLinks.length === 0) {
      alert('No matching files found to download.');
      return;
    }
    
    // Trigger download for each link sequentially
    downloadLinks.forEach((link, idx) => {
      setTimeout(() => {
        link.click();
      }, idx * 250); // 250ms spacing is extremely robust and bypasses browser download protection
    });
  });

  // Modals closing triggers
  [previewModalClose, deleteModalClose, cancelDeleteBtn].forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });

  // Close modals clicking outside
  window.addEventListener('click', (e) => {
    if (e.target === previewModal || e.target === deleteModal) {
      closeAllModals();
    }
  });

  // Escape key closes modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllModals();
    }
  });

  // Delete Action Confirm
  confirmDeleteBtn.addEventListener('click', async () => {
    if (!recordToDeleteId) return;
    const passcode = sessionStorage.getItem('dashboard_passcode') || '';

    try {
      const res = await fetch(`/api/uploads/${recordToDeleteId}`, {
        method: 'DELETE',
        headers: { 'x-dashboard-passcode': passcode }
      });
      
      if (res.status === 401) {
        sessionStorage.removeItem('dashboard_passcode');
        document.getElementById('dashboard-lock-screen').classList.remove('unlocked');
        closeAllModals();
        return;
      }

      const result = await res.json();

      if (res.ok) {
        closeAllModals();
        fetchUploads(); // Reload list
      } else {
        alert('Failed to delete file: ' + result.error);
      }
    } catch (err) {
      console.error(err);
      alert('Network error when attempting to delete.');
    }
  });
}

// Retrieve records from Express server
async function fetchUploads() {
  const recordsContainer = document.getElementById('records-container');
  if (!recordsContainer) return;

  const passcode = sessionStorage.getItem('dashboard_passcode');
  if (!passcode) return; // Silent return if not logged in yet

  // Retrieve input filter states
  const search = document.getElementById('search-input').value;
  const remarks = document.getElementById('remarks-search').value;
  const memberId = document.getElementById('filter-member').value;
  const startDate = document.getElementById('filter-start-date').value;
  const endDate = document.getElementById('filter-end-date').value;
  const type = document.getElementById('filter-type').value;

  // Build Query Params
  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (remarks) params.append('remarks', remarks);
  if (memberId) params.append('memberId', memberId);
  if (startDate) params.append('startDate', startDate);
  if (endDate) params.append('endDate', endDate);
  if (type) params.append('type', type);

  try {
    const res = await fetch(`/api/uploads?${params.toString()}`, {
      headers: { 'x-dashboard-passcode': passcode }
    });
    
    if (res.status === 401) {
      sessionStorage.removeItem('dashboard_passcode');
      document.getElementById('dashboard-lock-screen').classList.remove('unlocked');
      return;
    }
    
    if (!res.ok) throw new Error('API fetch failed');
    currentRecords = await res.json();

    // Render Stats
    updateStatistics(currentRecords);

    // Group & Render list
    renderRecords(currentRecords);
  } catch (err) {
    console.error('Failed to load uploads records:', err);
    recordsContainer.innerHTML = `
      <div class="empty-state" style="border-color: var(--error);">
        <div class="empty-state-icon" style="color: var(--error);">⚠️</div>
        <h3>Failed to Fetch uploads</h3>
        <p>Could not retrieve items from database. Ensure the server is actively running.</p>
      </div>
    `;
  }
}

// Calculate Stats Dashboard Panel
function updateStatistics(records) {
  const totalElem = document.getElementById('stat-total');
  const screenshotElem = document.getElementById('stat-screenshots');
  const docsElem = document.getElementById('stat-documents');
  const resultsCount = document.getElementById('results-count');

  if (!totalElem) return;

  const total = records.length;
  const screenshots = records.filter(r => r.type === 'PhonePe Screenshot').length;
  const docs = records.filter(r => r.type === 'Document Screenshot').length;

  totalElem.textContent = total;
  screenshotElem.textContent = screenshots;
  if (docsElem) docsElem.textContent = docs;
  
  if (resultsCount) {
    resultsCount.textContent = total;
  }
}

// Group records date-wise and render HTML
function renderRecords(records) {
  const container = document.getElementById('records-container');
  if (!container) return;

  if (records.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📂</div>
        <h3>No uploads found</h3>
        <p>Try clearing filters or enter a different search keyword.</p>
      </div>
    `;
    return;
  }

  // Group by Date
  const grouped = {};
  records.forEach(record => {
    const dateStr = formatDateDisplay(record.uploadDate);
    if (!grouped[dateStr]) {
      grouped[dateStr] = [];
    }
    grouped[dateStr].push(record);
  });

  let htmlContent = '';

  // Loop through sorted groups
  Object.keys(grouped).forEach(dateLabel => {
    htmlContent += `
      <div class="date-group">
        <div class="date-divider">
          <span class="date-divider-text">${dateLabel}</span>
          <div class="date-divider-line"></div>
        </div>
        <div class="records-grid">
    `;

    grouped[dateLabel].forEach(record => {
      const isImg = record.filename.match(/\.(jpeg|jpg|gif|png|webp)$/i);
      const isPdf = record.filename.match(/\.(pdf)$/i);
      let mediaPreview = '';
      
      if (isImg) {
        mediaPreview = `style="background-image: url('/${record.filePath}');"`;
      }

      htmlContent += `
        <article class="record-card" aria-labelledby="title-${record.id}">
          <div class="record-media-container" ${mediaPreview} onclick="openPreview('${record.id}')" aria-label="View large preview of file">
            ${!isImg ? `<div class="record-media-placeholder">${isPdf ? '📕' : '📄'}</div>` : ''}
            <span class="record-badge ${record.type === 'PhonePe Screenshot' ? 'badge-screenshot' : 'badge-document'}">${record.type}</span>
          </div>
          <div class="record-card-body">
            <h3 class="record-member-name" id="title-${record.id}">${record.memberName}</h3>
            <p class="record-reason">${escapeHTML(record.reason)}</p>
            ${record.remarks ? `<p class="record-remarks">${escapeHTML(record.remarks)}</p>` : ''}
          </div>
          <div class="record-card-footer">
            <time class="record-date" datetime="${record.uploadDate}">${formatTime(record.timestamp)}</time>
            <div class="record-actions">
              <a href="/${record.filePath}" download="${record.originalName}" class="action-btn" title="Download direct file" aria-label="Download original file" style="display: flex; align-items: center; gap: 0.25rem; background: rgba(0, 242, 254, 0.1); border: 1px solid rgba(0, 242, 254, 0.2); padding: 0.35rem 0.6rem; border-radius: var(--radius-sm); font-size: 0.75rem; text-decoration: none; color: var(--accent-cyan); font-weight: 500;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Download
              </a>
              <button onclick="triggerDelete('${record.id}')" class="action-btn btn-delete" title="Delete record" aria-label="Delete this file record">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              </button>
            </div>
          </div>
        </article>
      `;
    });

    htmlContent += `
        </div>
      </div>
    `;
  });

  container.innerHTML = htmlContent;
}

// ----------------------------------------------------
// UI ACTIONS / MODAL HANDLERS
// ----------------------------------------------------
window.openPreview = function(recordId) {
  const record = currentRecords.find(r => r.id === recordId);
  if (!record) return;

  const previewModal = document.getElementById('preview-modal');
  const previewImage = document.getElementById('preview-image');
  const previewMemberName = document.getElementById('preview-member-name');
  const previewType = document.getElementById('preview-type');
  const previewReason = document.getElementById('preview-reason');
  const previewRemarks = document.getElementById('preview-remarks');
  const previewFilename = document.getElementById('preview-filename');

  // Populate data
  const isImg = record.filename.match(/\.(jpeg|jpg|gif|png|webp)$/i);
  if (isImg) {
    previewImage.src = '/' + record.filePath;
    previewImage.style.display = 'block';
  } else {
    // Hide image if it's a PDF or un-renderable
    previewImage.style.display = 'none';
  }

  previewMemberName.textContent = record.memberName;
  previewType.textContent = record.type;
  previewReason.textContent = record.reason;
  
  if (record.remarks) {
    previewRemarks.textContent = record.remarks;
    previewRemarks.classList.remove('empty');
  } else {
    previewRemarks.textContent = 'No remarks provided';
    previewRemarks.classList.add('empty');
  }

  previewFilename.textContent = record.originalName;

  // Open overlay
  previewModal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.triggerDelete = function(recordId) {
  recordToDeleteId = recordId;
  const deleteModal = document.getElementById('delete-modal');
  deleteModal.classList.add('active');
  document.body.style.overflow = 'hidden';
};

function closeAllModals() {
  document.getElementById('preview-modal').classList.remove('active');
  document.getElementById('delete-modal').classList.remove('active');
  document.body.style.overflow = 'auto';
  recordToDeleteId = null;
}

// ----------------------------------------------------
// UTILITY FUNCTIONS
// ----------------------------------------------------
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatDateDisplay(dateString) {
  // Input: yyyy-mm-dd
  // Output: July 9, 2026
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  const date = new Date(dateString);
  
  // Guard for invalid dates
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-US', options);
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
